import { describe, expect, it, vi } from "vitest";
import { type FetchDeps, fetchManifest, manifestUrl } from "../src/github/raw-contents.js";
import type { RepoRef } from "../src/github/repo-ref.js";

const REF: RepoRef = { owner: "expressjs", repo: "express" };
const URL_FOR_REF = "https://raw.githubusercontent.com/expressjs/express/HEAD/package.json";

function responding(response: Response | (() => never)): FetchDeps {
  return {
    fetch: vi.fn(async () => {
      if (typeof response === "function") response();
      return response;
    }) as unknown as typeof globalThis.fetch,
  };
}

/** A Cache API stand-in; the real one does not exist outside the Workers runtime. */
function fakeCache(): Cache & { size: () => number } {
  const entries = new Map<string, Response>();
  return {
    async match(key: RequestInfo) {
      return entries.get(String(key))?.clone();
    },
    async put(key: RequestInfo, value: Response) {
      entries.set(String(key), value);
    },
    async delete() {
      return true;
    },
    size: () => entries.size,
  } as unknown as Cache & { size: () => number };
}

describe("manifestUrl", () => {
  it("addresses the default branch through HEAD, so no branch lookup is needed", () => {
    expect(manifestUrl(REF, "package.json")).toBe(URL_FOR_REF);
  });

  it("encodes each path segment separately, keeping the separators", () => {
    expect(manifestUrl(REF, "packages/a b/package.json")).toBe(
      "https://raw.githubusercontent.com/expressjs/express/HEAD/packages/a%20b/package.json",
    );
  });
});

describe("fetchManifest", () => {
  it("returns the body on 200", async () => {
    const result = await fetchManifest(REF, "package.json", responding(new Response('{"name":"express"}')));
    expect(result).toEqual({ ok: true, value: '{"name":"express"}' });
  });

  it("reports 404 as not-found, carrying the reference and path", async () => {
    const result = await fetchManifest(REF, "package.json", responding(new Response("404: Not Found", { status: 404 })));
    expect(result).toEqual({ ok: false, error: { kind: "not-found", ref: REF, path: "package.json" } });
  });

  it.each([429, 403])("reports %d as rate-limited", async (status) => {
    const result = await fetchManifest(REF, "package.json", responding(new Response("", { status })));
    expect(result).toEqual({ ok: false, error: { kind: "rate-limited", retryAfterSeconds: null } });
  });

  it("reads Retry-After in its delay-seconds form", async () => {
    const response = new Response("", { status: 429, headers: { "retry-after": "60" } });
    const result = await fetchManifest(REF, "package.json", responding(response));
    expect(result).toEqual({ ok: false, error: { kind: "rate-limited", retryAfterSeconds: 60 } });
  });

  it.each([
    ["an HTTP-date", "Wed, 21 Oct 2026 07:28:00 GMT"],
    ["a non-number", "soon"],
    ["a negative number", "-5"],
  ])("says nothing about when to retry when Retry-After is %s", async (_label, header) => {
    const response = new Response("", { status: 429, headers: { "retry-after": header } });
    const result = await fetchManifest(REF, "package.json", responding(response));
    expect(result).toEqual({ ok: false, error: { kind: "rate-limited", retryAfterSeconds: null } });
  });

  it("reports any other failing status as an upstream error", async () => {
    const result = await fetchManifest(REF, "package.json", responding(new Response("", { status: 503 })));
    expect(result).toEqual({ ok: false, error: { kind: "upstream-error", status: 503 } });
  });

  it("reports a thrown fetch as a network error rather than propagating it", async () => {
    const deps = responding(() => {
      throw new TypeError("connection reset");
    });
    const result = await fetchManifest(REF, "package.json", deps);
    expect(result).toEqual({ ok: false, error: { kind: "network-error", detail: "connection reset" } });
  });

  it("refuses a manifest that declares a length over the cap", async () => {
    const response = new Response("{}", { headers: { "content-length": String(3 * 1024 * 1024) } });
    const result = await fetchManifest(REF, "package.json", responding(response));
    expect(result).toEqual({ ok: false, error: { kind: "manifest-too-large", bytes: 3 * 1024 * 1024 } });
  });

  it("refuses an oversized manifest that declared no length", async () => {
    const response = new Response("x".repeat(2 * 1024 * 1024 + 1));
    response.headers.delete("content-length");
    const result = await fetchManifest(REF, "package.json", responding(response));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("manifest-too-large");
  });
});

describe("fetchManifest: caching", () => {
  it("serves a second read from the cache, costing one upstream request", async () => {
    const upstream = vi.fn(async () => new Response('{"name":"express"}'));
    const deps: FetchDeps = { fetch: upstream as unknown as typeof globalThis.fetch, cache: fakeCache() };

    const first = await fetchManifest(REF, "package.json", deps);
    const second = await fetchManifest(REF, "package.json", deps);

    expect(first).toEqual({ ok: true, value: '{"name":"express"}' });
    expect(second).toEqual({ ok: true, value: '{"name":"express"}' });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("caches a 404, so repeated bad input does not spend the request budget", async () => {
    const upstream = vi.fn(async () => new Response("404: Not Found", { status: 404 }));
    const deps: FetchDeps = { fetch: upstream as unknown as typeof globalThis.fetch, cache: fakeCache() };

    await fetchManifest(REF, "package.json", deps);
    const second = await fetchManifest(REF, "package.json", deps);

    expect(second).toEqual({ ok: false, error: { kind: "not-found", ref: REF, path: "package.json" } });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])("does not cache %d, because it is a moment and not a fact", async (status) => {
    const upstream = vi.fn(async () => new Response("", { status }));
    const deps: FetchDeps = { fetch: upstream as unknown as typeof globalThis.fetch, cache: fakeCache() };

    await fetchManifest(REF, "package.json", deps);
    await fetchManifest(REF, "package.json", deps);

    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("keys the cache on the manifest URL, so a different repository misses", async () => {
    const upstream = vi.fn(async () => new Response("{}"));
    const deps: FetchDeps = { fetch: upstream as unknown as typeof globalThis.fetch, cache: fakeCache() };

    await fetchManifest(REF, "package.json", deps);
    await fetchManifest({ owner: "honojs", repo: "hono" }, "package.json", deps);

    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("still scans when the cache throws", async () => {
    const broken = {
      match: async () => {
        throw new Error("cache unavailable");
      },
      put: async () => {
        throw new Error("cache unavailable");
      },
    } as unknown as Cache;
    const deps: FetchDeps = { fetch: (async () => new Response("{}")) as unknown as typeof globalThis.fetch, cache: broken };

    expect(await fetchManifest(REF, "package.json", deps)).toEqual({ ok: true, value: "{}" });
  });
});
