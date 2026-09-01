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
  | {
      readonly kind: "manifest-too-large";
      /**
       * The length the response declared, or null where it declared none and
       * the read was abandoned at the limit. Null means the true size is
       * unknown and greater than the limit -- not that it is unknowable.
       */
      readonly declaredBytes: number | null;
    };

export type FetchDeps = {
  readonly fetch: typeof globalThis.fetch;
  /** Reads the clock, so the HTTP-date form of Retry-After is testable. */
  readonly now?: () => Date;
  /**
   * Injected rather than imported, so the module runs under a plain test
   * runner where the Workers Cache API does not exist.
   */
  readonly cache?: Cache;
};

/**
 * A package.json larger than this is not a manifest we are willing to read into
 * memory on a free tier. Enforced while reading, not after: a Worker has a
 * small memory ceiling, so a body that would breach it must never be buffered
 * whole in order to discover that it breaches it.
 */
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

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

  const now = deps.now?.() ?? new Date();

  const cached = await readCache(deps.cache, url);
  if (cached !== null) return interpret(cached, ref, path, now);

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

  const outcome = await interpret(response, ref, path, now);

  // Cached after interpreting, and only when the answer is one worth repeating.
  // A rate-limited or failing upstream is a moment, not a fact about the
  // repository, and caching it would strand every later visitor on the same
  // error. A manifest that was refused for its size is not cached either --
  // storing a body we just declined to accept is the cost the limit exists to
  // avoid.
  if (response.status === 404) {
    await writeCache(deps.cache, url, 404, "");
  } else if (outcome.ok) {
    await writeCache(deps.cache, url, 200, outcome.value);
  }

  return outcome;
}

/** Maps one response, cached or live, onto the outcome it represents. */
async function interpret(
  response: Response,
  ref: RepoRef,
  path: string,
  now: Date,
): Promise<Result<string, FetchFailure>> {
  if (response.status === 404) return err({ kind: "not-found", ref, path });
  if (response.status === 429 || response.status === 403) {
    return err({ kind: "rate-limited", retryAfterSeconds: retryAfter(response, now) });
  }
  if (!response.ok) return err({ kind: "upstream-error", status: response.status });
  return readBounded(response);
}

/**
 * Reads the body as text, refusing to hold more than the limit at any point.
 *
 * A declared length over the limit is refused before a single byte is read. An
 * undeclared body is read in chunks and abandoned the moment it crosses the
 * limit, cancelling the transfer rather than draining it. Checking the size
 * after buffering the whole body would be a limit that costs exactly what it
 * is meant to save.
 */
async function readBounded(response: Response): Promise<Result<string, FetchFailure>> {
  const header = response.headers.get("content-length");
  const declared = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(declared) && declared > MAX_MANIFEST_BYTES) {
    await discard(response);
    return err({ kind: "manifest-too-large", declaredBytes: declared });
  }

  const body = response.body;
  if (body === null) return ok("");

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;

      total += value.byteLength;
      if (total > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        return err({ kind: "manifest-too-large", declaredBytes: null });
      }
      chunks.push(value);
    }
  } catch (cause) {
    return err({ kind: "network-error", detail: cause instanceof Error ? cause.message : String(cause) });
  }

  return ok(new TextDecoder().decode(concat(chunks, total)));
}

/**
 * Ends a transfer we have decided not to read, rather than leaving it running
 * to no purpose.
 */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A body that will not cancel is not a reason to fail the scan.
  }
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * Reads Retry-After in both forms RFC 9110 defines: delay-seconds, and an
 * HTTP-date converted to a delay against the clock. Understanding only the
 * first would have the page say "GitHub did not say when to retry" in cases
 * where GitHub did say -- a false statement, not merely a missing one.
 *
 * A date already past yields 0: the wait is over, not negative.
 */
function retryAfter(response: Response, now: Date): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;

  const trimmed = header.trim();
  if (trimmed.length === 0) return null;

  // Anything purely numeric is a delay-seconds value, well formed or not. It
  // must never reach the date branch: Date.parse("-5") is a date in 2001, so a
  // malformed delay would otherwise become a confident and wrong answer.
  if (/^[+-]?\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - now.getTime()) / 1000));
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

/**
 * Stores the text already accepted, rather than a clone of the upstream
 * response. Cloning would mean buffering the body a second time, and would
 * reintroduce the unbounded read this module exists to avoid.
 */
async function writeCache(cache: Cache | undefined, url: string, status: number, text: string): Promise<void> {
  if (cache === undefined) return;
  try {
    const headers = new Headers({
      "cache-control": `max-age=${CACHE_SECONDS}`,
      "content-type": "text/plain; charset=utf-8",
    });
    await cache.put(url, new Response(text, { status, headers }));
  } catch {
    // Caching is an optimisation. Failing to cache is not a failure to scan.
  }
}
