import { html } from "hono/html";
import type { Component, Inventory, InventoryNote } from "../model/component.js";
import type { Scan } from "../scan.js";
import { formatRepoRef, repoHtmlUrl } from "../github/repo-ref.js";
import { page } from "./layout.js";

export function resultPage(scan: Scan) {
  const name = formatRepoRef(scan.ref);
  const query = encodeURIComponent(name);
  const { inventory } = scan;
  const count = inventory.components.length;

  return page(
    `${name} — software bill of materials`,
    html`
      <h1>${name}</h1>
      <p class="muted">
        <a href="${repoHtmlUrl(scan.ref)}">${repoHtmlUrl(scan.ref)}</a> ·
        <code>${inventory.subject.manifestPath}</code> on the default branch${inventory.subject.version === null
          ? ""
          : html` · declared version <code>${inventory.subject.version}</code>`}
      </p>

      <h2>${count === 1 ? "1 direct dependency" : `${count} direct dependencies`}</h2>
      ${count === 0
        ? html`<p>
            <code>package.json</code> declares no <code>dependencies</code> and no <code>optionalDependencies</code>.
            The bill of materials below is empty, and is valid.
          </p>`
        : ""}
      <p class="muted">
        Read from <code>dependencies</code> and <code>optionalDependencies</code>. ${excluded(inventory)}
        ${inventory.notes.map(note)}
      </p>

      <h2>Bill of materials</h2>
      <ul class="downloads">
        <li><a href="/sbom/cyclonedx.json?repo=${query}">CycloneDX 1.6 (JSON)</a></li>
        <li><a href="/sbom/spdx.json?repo=${query}">SPDX 2.3 (JSON)</a></li>
      </ul>
      <p class="cite muted">
        Both formats are emitted because none is mandated. Article 13(24) of Regulation (EU) 2024/2847 reserves the
        right to specify one later by implementing act.
      </p>

      ${count === 0 ? "" : componentTable(inventory.components)}

      <h2>What was not read</h2>
      <p>
        The transitive dependency tree, and any lockfile. Annex I Part II(1) requires a bill of materials “covering at
        the very least the top-level dependencies”; this covers those and stops there.
      </p>
      <p class="muted">
        Where <code>package.json</code> gives a version range rather than one version, no version is recorded in either
        document. The declared range is carried instead, verbatim, in a CycloneDX property and an SPDX package comment.
      </p>
    `,
  );
}

function excluded(inventory: Inventory) {
  const parts: string[] = [];
  const { devDependencies, peerDependencies } = inventory.exclusions;
  if (devDependencies > 0) parts.push(`${devDependencies} devDependencies`);
  if (peerDependencies > 0) parts.push(`${peerDependencies} peerDependencies`);
  if (parts.length === 0) return "";
  return `${parts.join(" and ")} were read and excluded: neither ships in the product.`;
}

function note(value: InventoryNote) {
  switch (value.kind) {
    case "declares-workspaces":
      return html`
        <br />This <code>package.json</code> declares ${value.patterns} workspace
        ${value.patterns === 1 ? "pattern" : "patterns"}. Only the root manifest was read; workspace member manifests
        were not.
      `;
    case "skipped-entries":
      return html`
        <br />${value.names.length} ${value.names.length === 1 ? "entry was" : "entries were"} skipped because the
        version specifier was not a string: <code>${value.names.join(", ")}</code>.
      `;
    case "unreadable-dependency-field":
      return html`<br />The <code>${value.field}</code> field is not an object and was not read.`;
  }
}

function componentTable(components: readonly Component[]) {
  return html`
    <table>
      <thead>
        <tr>
          <th>Component</th>
          <th>Declared specifier</th>
          <th>Version</th>
          <th>Scope</th>
          <th>Package URL</th>
        </tr>
      </thead>
      <tbody>
        ${components.map(
          (component) => html`
            <tr>
              <td class="mono">${component.name}</td>
              <td class="mono">${component.declaredRange}</td>
              <td class="mono">
                ${component.resolvedVersion ?? html`<span class="muted">range, not a version</span>`}
              </td>
              <td>${component.scope}</td>
              <td class="mono">${component.purl ?? html`<span class="muted">${sourceNote(component)}</span>`}</td>
            </tr>
          `,
        )}
      </tbody>
    </table>
  `;
}

function sourceNote(component: Component): string {
  return component.source === "alias" ? "aliases another package" : "not from the registry";
}
