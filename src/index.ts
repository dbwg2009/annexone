import { Hono } from "hono";
import { parseRepoRef, formatRepoRef } from "./github/repo-ref.js";
import { toCycloneDx16 } from "./sbom/cyclonedx.js";
import { toSpdx23 } from "./sbom/spdx.js";
import { type ScanDeps, scanRepository } from "./scan.js";
import { homePage } from "./render/home.js";
import { failurePage, statusFor } from "./render/failure.js";
import { resultPage } from "./render/result.js";

export type Env = Record<string, never>;

export const app = new Hono<{ Bindings: Env }>();

/**
 * Nothing is persisted, so a result page is addressed by the repository itself.
 * When shareable result identifiers arrive, POST /check redirects there instead
 * and this shape is what changes.
 */
function resultUrl(repo: string): string {
  return `/check?repo=${encodeURIComponent(repo)}`;
}

function depsFor(url: string): ScanDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    // caches is absent under a plain test runner; the fetch module treats an
    // absent cache as a miss.
    ...(typeof caches === "undefined" ? {} : { cache: caches.default }),
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
    origin: new URL(url).origin,
  };
}

app.get("/", (c) => c.html(homePage()));

app.post("/check", async (c) => {
  const form = await c.req.formData();
  const submitted = form.get("repo");
  const ref = parseRepoRef(typeof submitted === "string" ? submitted : "");
  if (!ref.ok) return c.html(failurePage(ref.error), statusFor(ref.error));
  return c.redirect(resultUrl(formatRepoRef(ref.value)), 303);
});

app.get("/check", async (c) => {
  const ref = parseRepoRef(c.req.query("repo") ?? "");
  if (!ref.ok) return c.html(failurePage(ref.error), statusFor(ref.error));

  const scan = await scanRepository(ref.value, depsFor(c.req.url));
  if (!scan.ok) return c.html(failurePage(scan.error), statusFor(scan.error));

  return c.html(resultPage(scan.value));
});

app.get("/sbom/:format{cyclonedx\\.json|spdx\\.json}", async (c) => {
  const ref = parseRepoRef(c.req.query("repo") ?? "");
  if (!ref.ok) return c.html(failurePage(ref.error), statusFor(ref.error));

  const scan = await scanRepository(ref.value, depsFor(c.req.url));
  if (!scan.ok) return c.html(failurePage(scan.error), statusFor(scan.error));

  const isCycloneDx = c.req.param("format") === "cyclonedx.json";
  const document = isCycloneDx
    ? toCycloneDx16(scan.value.inventory, scan.value.meta)
    : toSpdx23(scan.value.inventory, scan.value.meta);
  const filename = `${ref.value.owner}-${ref.value.repo}.${isCycloneDx ? "cdx" : "spdx"}.json`;

  return new Response(`${JSON.stringify(document, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
});

app.notFound((c) => c.html(homePage(), 404));

export default app;
