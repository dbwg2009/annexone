import { describe, expect, it, vi } from "vitest";
import { type FetchDeps, MAX_MANIFEST_BYTES, fetchManifest, manifestUrl } from "../src/github/raw-contents.js";
import type { RepoRef } from "../src/github/repo-ref.js";

const REF: RepoRef = { owner: "expressjs", repo: "express" };
const URL_FOR_REF = "https://raw.githubusercontent.com/expressjs/express/HEAD/package.json";

function responding(response: Response | (() => never), now?: Date): FetchDeps {
  return {
    fetch: vi.fn(async () => {
      if (typeof response === "function") response();
      return response;
    }) as unknown as typeof globalThis.fetch,
    ...(now === undefined ? {} : { now: () => now }),
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

  it("converts the HTTP-date form of Retry-After into a delay", async () => {
    // RFC 9110 allows both forms. Understanding only delay-seconds would have
    // the page say GitHub did not say when to retry in cases where it did.
    const now = new Date("2026-10-21T07:00:00Z");
    const response = new Response("", { status: 429, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } });
    const result = await fetchManifest(REF, "package.json", responding(response, now));
    expect(result).toEqual({ ok: false, error: { kind: "rate-limited", retryAfterSeconds: 28 * 60 } });
  });

  it("treats an HTTP-date already past as no wait at all", async () => {
    const now = new Date("2026-10-21T08:00:00Z");
    const response = new Response("", { status: 429, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } });
    const result = await fetchManifest(REF, "package.json", responding(response, now));
    expect(result).toEqual({ ok: false, error: { kind: "rate-limited", retryAfterSeconds: 0 } });
  });

  it.each([
    ["a non-number", "soon"],
    ["a negative number", "-5"],
    ["an empty value", "   "],
  ])("says nothing about when to retry when Retry-After is %s", async (_label, header) => {
    // "-5" must not reach the date branch: Date.parse("-5") is a date in 2001.
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
    expect(result).toEqual({ ok: false, error: { kind: "manifest-too-large", declaredBytes: 3 * 1024 * 1024 } });
  });

  it("refuses an oversized manifest that declared no length", async () => {
    const response = new Response("x".repeat(MAX_MANIFEST_BYTES + 1));
    response.headers.delete("content-length");
    const result = await fetchManifest(REF, "package.json", responding(response));
    expect(result).toEqual({ ok: false, error: { kind: "manifest-too-large", declaredBytes: null } });
  });
});

describe("fetchManifest: the size limit is enforced while reading, not after", () => {
  // A Worker has a small memory ceiling, so a body that would breach it must
  // never be buffered whole in order to discover that it breaches it.

  const CHUNK = 64 * 1024;
  const OVERSIZED = 8 * 1024 * 1024;

  /**
   * A response whose body reports how much of it was actually pulled.
   *
   * Constructing a Response over a stream pulls one chunk eagerly, before
   * fetchManifest is ever called, so every assertion below measures the bytes
   * pulled from the moment of the call rather than the running total.
   */
  function metered(totalBytes: number, headers: Record<string, string> = {}) {
    const meter = { pulled: 0, cancelled: false };
    let remaining = totalBytes;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining <= 0) {
          controller.close();
          return;
        }
        const size = Math.min(CHUNK, remaining);
        remaining -= size;
        meter.pulled += size;
        controller.enqueue(new Uint8Array(size));
      },
      cancel() {
        meter.cancelled = true;
      },
    });
    const response = new Response(body, { headers });
    return { response, meter };
  }

  it("refuses a declared over-limit length without reading the body, and ends the transfer", async () => {
    const { response, meter } = metered(OVERSIZED, { "content-length": String(OVERSIZED) });
    const before = meter.pulled;

    const result = await fetchManifest(REF, "package.json", responding(response));

    expect(result).toEqual({ ok: false, error: { kind: "manifest-too-large", declaredBytes: OVERSIZED } });
    expect(meter.cancelled).toBe(true);
    // Nothing is read to reach this decision. The single chunk that moves is
    // the one already in flight when the body is cancelled -- taking it is the
    // price of ending the transfer rather than leaving it running.
    expect(meter.pulled - before).toBeLessThanOrEqual(CHUNK);
    expect(meter.pulled).toBeLessThan(OVERSIZED / 2);
  });

  it("abandons an undeclared body at the limit instead of draining it", async () => {
    const { response, meter } = metered(OVERSIZED);
    const before = meter.pulled;

    const result = await fetchManifest(REF, "package.json", responding(response));

    expect(result).toEqual({ ok: false, error: { kind: "manifest-too-large", declaredBytes: null } });
    expect(meter.cancelled).toBe(true);
    // The limit, plus the chunk that crosses it, plus the one the reader holds
    // ahead. Nothing beyond that, and far short of the whole body.
    expect(meter.pulled - before).toBeLessThanOrEqual(MAX_MANIFEST_BYTES + 2 * CHUNK);
    expect(meter.pulled).toBeLessThan(OVERSIZED / 2);
  });

  it("reads a manifest that sits just under the limit", async () => {
    const body = "x".repeat(MAX_MANIFEST_BYTES);
    const result = await fetchManifest(REF, "package.json", responding(new Response(body)));
    expect(result).toEqual({ ok: true, value: body });
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

  it("does not cache a manifest it refused for its size", async () => {
    // Storing a body we just declined to accept is the cost the limit exists
    // to avoid.
    const cache = fakeCache();
    const oversized = () =>
      new Response("x".repeat(MAX_MANIFEST_BYTES + 1), { headers: { "content-length": String(3 * 1024 * 1024) } });
    const upstream = vi.fn(async () => oversized());
    const deps: FetchDeps = { fetch: upstream as unknown as typeof globalThis.fetch, cache };

    await fetchManifest(REF, "package.json", deps);

    expect(cache.size()).toBe(0);
  });

  it("does not cache an upstream error", async () => {
    const cache = fakeCache();
    const deps: FetchDeps = {
      fetch: (async () => new Response("", { status: 503 })) as unknown as typeof globalThis.fetch,
      cache,
    };

    await fetchManifest(REF, "package.json", deps);

    expect(cache.size()).toBe(0);
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
