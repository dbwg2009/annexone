import { afterEach, describe, expect, it, vi } from "vitest";
import expressManifest from "./fixtures/express.package.json?raw";
import honoManifest from "./fixtures/hono.package.json?raw";
import { app } from "../src/index.js";
import { cycloneDx16Errors, spdx23Errors } from "./validate.js";

const BASE = "https://annexone.example";

/** Replaces the outbound fetch the worker makes to raw.githubusercontent.com. */
function upstream(response: Response | (() => Response)) {
  const stub = vi.fn(async () => (typeof response === "function" ? response() : response.clone()));
  vi.stubGlobal("fetch", stub);
  return stub;
}

async function get(path: string): Promise<Response> {
  return await app.request(new Request(`${BASE}${path}`));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /", () => {
  it("serves the form and states the scope with its citation", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('name="repo"');
    expect(body).toContain("Annex I Part II(1)");
    expect(body).toContain("top-level dependencies");
    expect(body).toContain("Article 13(24)");
  });

  it("does not claim that using it makes anyone compliant", async () => {
    const body = await (await get("/")).text();
    expect(body).toContain("does not make anyone compliant");
  });
});

describe("POST /check", () => {
  it("redirects to the result address for the normalised repository", async () => {
    const form = new FormData();
    form.set("repo", "https://github.com/expressjs/express/tree/master");
    const response = await app.request(new Request(`${BASE}/check`, { method: "POST", body: form }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/check?repo=expressjs%2Fexpress");
  });

  it("answers 400 for input that is not a GitHub repository", async () => {
    const form = new FormData();
    form.set("repo", "https://gitlab.com/a/b");
    const response = await app.request(new Request(`${BASE}/check`, { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("not a GitHub repository");
  });
});

describe("GET /check", () => {
  it("lists the direct dependencies of a repository that has them", async () => {
    const stub = upstream(new Response(expressManifest));
    const response = await get("/check?repo=expressjs%2Fexpress");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("28 direct dependencies");
    expect(body).toContain("body-parser");
    expect(body).toContain("^6.15.2");
    expect(body).toContain("pkg:npm/qs");
    expect(body).toContain("/sbom/cyclonedx.json?repo=expressjs%2Fexpress");
    expect(body).toContain("/sbom/spdx.json?repo=expressjs%2Fexpress");
    expect(stub).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/expressjs/express/HEAD/package.json",
      expect.anything(),
    );
  });

  it("reports zero dependencies as a result, not as a failure", async () => {
    upstream(new Response(honoManifest));
    const response = await get("/check?repo=honojs%2Fhono");

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("0 direct dependencies");
    expect(body).toContain("declares no <code>dependencies</code>");
    expect(body).toContain("is valid");
  });

  it("names all three things a 404 can mean, rather than guessing", async () => {
    upstream(new Response("404: Not Found", { status: 404 }));
    const response = await get("/check?repo=owner%2Fnope");

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain("does not exist");
    expect(body).toContain("private");
    expect(body).toContain("no <code>package.json</code>");
  });

  it("says a rate limit is the service's and not the visitor's", async () => {
    upstream(new Response("", { status: 429, headers: { "retry-after": "60" } }));
    const response = await get("/check?repo=owner%2Fname");

    expect(response.status).toBe(429);
    const body = await response.text();
    expect(body).toContain("60 seconds");
    expect(body).toContain("not on you");
  });

  it("answers 422 for a manifest that is not JSON", async () => {
    upstream(new Response("<!doctype html>"));
    expect((await get("/check?repo=owner%2Fname")).status).toBe(422);
  });

  it("answers 502 when GitHub cannot be reached", async () => {
    upstream(new Response("", { status: 503 }));
    expect((await get("/check?repo=owner%2Fname")).status).toBe(502);
  });

  it("answers 400 for a missing or unusable repo parameter", async () => {
    expect((await get("/check")).status).toBe(400);
    expect((await get("/check?repo=nonsense")).status).toBe(400);
  });

  it("escapes dependency names into the page rather than interpolating them", async () => {
    upstream(new Response(JSON.stringify({ dependencies: { "<script>alert(1)</script>": "^1.0.0" } })));
    const body = await (await get("/check?repo=owner%2Fname")).text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("GET /sbom", () => {
  it("serves a schema-valid CycloneDX 1.6 document as an attachment", async () => {
    upstream(new Response(expressManifest));
    const response = await get("/sbom/cyclonedx.json?repo=expressjs%2Fexpress");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="expressjs-express.cdx.json"');

    const document = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(cycloneDx16Errors(document)).toEqual([]);
    expect((document["components"] as unknown[]).length).toBe(28);
  });

  it("serves a schema-valid SPDX 2.3 document as an attachment", async () => {
    upstream(new Response(expressManifest));
    const response = await get("/sbom/spdx.json?repo=expressjs%2Fexpress");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="expressjs-express.spdx.json"');

    const document = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(spdx23Errors(document)).toEqual([]);
    expect(document["documentNamespace"]).toMatch(/^https:\/\/annexone\.example\/sbom\//);
  });

  it("serves a schema-valid pair for a repository with no dependencies", async () => {
    upstream(() => new Response(honoManifest));
    const cyclonedx = JSON.parse(await (await get("/sbom/cyclonedx.json?repo=honojs%2Fhono")).text()) as unknown;
    const spdx = JSON.parse(await (await get("/sbom/spdx.json?repo=honojs%2Fhono")).text()) as unknown;

    expect(cycloneDx16Errors(cyclonedx)).toEqual([]);
    expect(spdx23Errors(spdx)).toEqual([]);
  });

  it("carries a failure through with its status rather than serving a broken document", async () => {
    upstream(new Response("", { status: 404 }));
    const response = await get("/sbom/cyclonedx.json?repo=owner%2Fnope");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
