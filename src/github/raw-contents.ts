import { type Result, ok, err } from "../result.js";
import type { RepoRef } from "./repo-ref.js";

/**
 * Every way fetching a manifest can end other than with its bytes. These are
 * ordinary states of a public checker -- a repository that does not exist, an
 * upstream that has had enough of us -- and they travel as values so the result
 * page can render each one specifically.
 */
export type FetchFailure =
  | { readonly kind: "not-found"; readonly ref: RepoRef; readonly path: string }
  | { readonly kind: "rate-limited"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "upstream-error"; readonly status: number }
  | { readonly kind: "network-error"; readonly detail: string }
  | { readonly kind: "manifest-too-large"; readonly bytes: number };

export type FetchDeps = {
  readonly fetch: typeof globalThis.fetch;
  /**
   * Injected rather than imported, so the module runs under a plain test
   * runner where the Workers Cache API does not exist.
   */
  readonly cache?: Cache;
};

/**
 * A package.json larger than this is not a manifest we are willing to read into
 * memory on a free tier.
 */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * How long a fetched manifest stays in the edge cache. GitHub allows 60
 * unauthenticated requests an hour per address and Workers share outbound
 * addresses, so a result page and its two SBOM downloads must cost one upstream
 * request, not three.
 */
const CACHE_SECONDS = 300;

const USER_AGENT = "annexone/0.1.0 (+https://annexone.dbwg2009.uk)";

/**
 * "HEAD" resolves to the repository's default branch, which is why no separate
 * call is needed to discover the branch name.
 */
export function manifestUrl(ref: RepoRef, path: string): string {
  const segments = path.split("/").map((segment) => encodeURIComponent(segment));
  return `https://raw.githubusercontent.com/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/HEAD/${segments.join("/")}`;
}

/**
 * Fetches one manifest from the default branch of a public repository.
 *
 * raw.githubusercontent.com answers 404 identically for a repository that does
 * not exist, a repository that is private, and a repository with no such file.
 * That ambiguity is carried into the "not-found" failure rather than resolved
 * by guessing, and the result page says all three.
 */
export async function fetchManifest(ref: RepoRef, path: string, deps: FetchDeps): Promise<Result<string, FetchFailure>> {
  const url = manifestUrl(ref, path);

  const cached = await readCache(deps.cache, url);
  if (cached !== null) return fromResponse(cached, ref, path);

  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "GET",
      headers: { accept: "text/plain", "user-agent": USER_AGENT },
      redirect: "follow",
    });
  } catch (cause) {
    return err({ kind: "network-error", detail: cause instanceof Error ? cause.message : String(cause) });
  }

  // Only settled answers are cached. A rate-limited or failing upstream is a
  // moment, not a fact about the repository, and caching it would strand every
  // later visitor on the same error.
  if (response.status === 200 || response.status === 404) {
    await writeCache(deps.cache, url, response);
  }

  return fromResponse(response, ref, path);
}

async function fromResponse(response: Response, ref: RepoRef, path: string): Promise<Result<string, FetchFailure>> {
  if (response.status === 404) return err({ kind: "not-found", ref, path });
  if (response.status === 429 || response.status === 403) {
    return err({ kind: "rate-limited", retryAfterSeconds: retryAfter(response) });
  }
  if (!response.ok) return err({ kind: "upstream-error", status: response.status });

  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return err({ kind: "manifest-too-large", bytes: declared });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    return err({ kind: "network-error", detail: cause instanceof Error ? cause.message : String(cause) });
  }

  // A backstop for a response that declared no length.
  if (text.length > MAX_BYTES) return err({ kind: "manifest-too-large", bytes: text.length });

  return ok(text);
}

/**
 * Reads Retry-After. Only the delay-seconds form is understood; the HTTP-date
 * form yields null, and the page then says nothing about when to retry rather
 * than guessing.
 */
function retryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header.trim());
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

async function readCache(cache: Cache | undefined, url: string): Promise<Response | null> {
  if (cache === undefined) return null;
  try {
    return (await cache.match(url)) ?? null;
  } catch {
    // A cache that will not answer is not a reason to fail the scan.
    return null;
  }
}

async function writeCache(cache: Cache | undefined, url: string, response: Response): Promise<void> {
  if (cache === undefined) return;
  try {
    const body = await response.clone().arrayBuffer();
    const headers = new Headers({
      "cache-control": `max-age=${CACHE_SECONDS}`,
      "content-type": response.headers.get("content-type") ?? "text/plain",
      "content-length": String(body.byteLength),
    });
    await cache.put(url, new Response(body, { status: response.status, headers }));
  } catch {
    // Caching is an optimisation. Failing to cache is not a failure to scan.
  }
}
