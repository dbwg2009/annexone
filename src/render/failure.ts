import { html } from "hono/html";
import { MAX_MANIFEST_BYTES } from "../github/raw-contents.js";
import type { RepoRefFailure } from "../github/repo-ref.js";
import { formatRepoRef } from "../github/repo-ref.js";
import type { ScanFailure } from "../scan.js";
import { page } from "./layout.js";

export type PageFailure = ScanFailure | RepoRefFailure;

/**
 * The HTTP status that goes with each failure. These are real states of a
 * public checker, so they get real status codes rather than a 200 with an
 * apology in it.
 */
export function statusFor(failure: PageFailure): 400 | 404 | 422 | 429 | 502 {
  switch (failure.kind) {
    case "invalid-input":
      return 400;
    case "not-found":
      return 404;
    case "rate-limited":
      return 429;
    case "manifest-unparseable":
    case "manifest-too-large":
      return 422;
    case "upstream-error":
    case "network-error":
      return 502;
  }
}

export function failurePage(failure: PageFailure) {
  const { heading, body } = describe(failure);
  return page(`${heading} — Annex One`, html`<h1>${heading}</h1>${body}<p><a href="/">Try another repository</a></p>`);
}

function describe(failure: PageFailure): { heading: string; body: ReturnType<typeof html> } {
  switch (failure.kind) {
    case "invalid-input":
      return {
        heading: "That is not a GitHub repository",
        body: html`
          <p>Read as: <code>${failure.input}</code></p>
          <p>
            Give a public GitHub repository, either as a URL (<code>https://github.com/expressjs/express</code>) or as
            <code>owner/name</code>.
          </p>
        `,
      };

    case "not-found":
      return {
        heading: "No package.json found",
        body: html`
          <p>
            <code>${failure.path}</code> was not found at the root of the default branch of
            <code>${formatRepoRef(failure.ref)}</code>.
          </p>
          <p>
            GitHub answers identically in three cases, and this cannot tell them apart: the repository does not exist,
            the repository is private, or the repository exists and has no <code>${failure.path}</code> at its root.
          </p>
          <p class="muted">Only public repositories and only npm are supported in this version.</p>
        `,
      };

    case "rate-limited":
      return {
        heading: "GitHub is rate-limiting this service",
        body: html`
          <p>
            GitHub declined the request for the manifest. This service reads GitHub without authenticating, which is
            subject to a shared hourly limit, so this is a limit on the service and not on you.
          </p>
          <p>
            ${failure.retryAfterSeconds === null
              ? "GitHub did not say when to retry."
              : `GitHub asked for a wait of ${failure.retryAfterSeconds} seconds.`}
          </p>
        `,
      };

    case "manifest-unparseable":
      return {
        heading: "package.json could not be read",
        body: html`
          <p>The file was fetched but is not a JSON object.</p>
          <p>Reported by the parser: <code>${failure.detail}</code></p>
        `,
      };

    case "manifest-too-large":
      return {
        heading: "package.json is too large to read",
        body: html`
          <p>
            ${failure.declaredBytes === null
              ? html`The file did not declare a length, and reading it was abandoned at the limit.`
              : html`The file is ${failure.declaredBytes} bytes.`}
            This service reads manifests up to ${MAX_MANIFEST_BYTES} bytes.
          </p>
        `,
      };

    case "upstream-error":
      return {
        heading: "GitHub could not be reached",
        body: html`<p>GitHub answered ${failure.status}. Nothing is wrong with the repository as far as this can tell.</p>`,
      };

    case "network-error":
      return {
        heading: "GitHub could not be reached",
        body: html`
          <p>The request for the manifest did not complete.</p>
          <p>Reported: <code>${failure.detail}</code></p>
        `,
      };
  }
}
