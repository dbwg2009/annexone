import { html } from "hono/html";
import { page } from "./layout.js";

export function homePage(prefill = "") {
  return page(
    "Annex One — software bill of materials",
    html`
      <h1>Software bill of materials for a public GitHub repository</h1>
      <p>
        Paste a public GitHub repository. This reads <code>package.json</code> from the default branch and produces a
        bill of materials of its direct dependencies in CycloneDX 1.6 and SPDX 2.3.
      </p>

      <form method="post" action="/check">
        <input
          type="text"
          name="repo"
          value="${prefill}"
          placeholder="https://github.com/expressjs/express"
          aria-label="Public GitHub repository URL or owner/name"
          required
        />
        <button type="submit">Generate</button>
      </form>

      <h2>Scope</h2>
      <p>
        <code>dependencies</code> and <code>optionalDependencies</code> from the repository's root
        <code>package.json</code>. Not <code>devDependencies</code>, not the transitive tree, and no lockfile is read.
      </p>
      <p class="cite">
        Annex I Part II(1) of Regulation (EU) 2024/2847 requires manufacturers to
      </p>
      <blockquote class="cite">
        “identify and document vulnerabilities and components contained in products with digital elements, including by
        drawing up a software bill of materials in a commonly used and machine-readable format covering at the very
        least the top-level dependencies of the products”.
      </blockquote>
      <p class="cite muted">
        No format is mandated. Neither CycloneDX nor SPDX appears in the regulation; Article 13(24) reserves the right
        to specify one later by implementing act, so both are emitted.
      </p>
      <p class="muted">npm only for now. Nothing is stored and no account is needed.</p>
    `,
  );
}
