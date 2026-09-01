/**
 * Downloads the published JSON schemas the SBOM tests validate against.
 *
 * The schemas are committed rather than fetched per test run: the suite then
 * works offline, and a change upstream shows up as a reviewable diff rather
 * than as a test that starts failing on a machine with a network.
 *
 * Run with: npm run fetch-schemas
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "schemas");

const SCHEMAS = [
  {
    file: "bom-1.6.schema.json",
    url: "https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/bom-1.6.schema.json",
    note: "CycloneDX 1.6.",
  },
  {
    file: "spdx.schema.json",
    url: "https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/spdx.schema.json",
    note: "Referenced by bom-1.6.schema.json for SPDX licence identifiers. Not the SPDX document schema.",
  },
  {
    file: "jsf-0.82.schema.json",
    url: "https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/jsf-0.82.schema.json",
    note: "Referenced by bom-1.6.schema.json for JSON signatures.",
  },
  {
    file: "spdx-2.3.schema.json",
    url: "https://raw.githubusercontent.com/spdx/spdx-spec/refs/tags/v2.3/schemas/spdx-schema.json",
    note: "SPDX 2.3, from the v2.3 tag of the specification repository.",
  },
];

await mkdir(OUT, { recursive: true });

const rows = [];
for (const schema of SCHEMAS) {
  const response = await fetch(schema.url);
  if (!response.ok) throw new Error(`${schema.url} answered ${response.status}`);
  const body = await response.text();
  JSON.parse(body); // Refuse to commit anything that is not JSON.
  await writeFile(join(OUT, schema.file), body);
  const sha256 = createHash("sha256").update(body).digest("hex");
  rows.push({ ...schema, sha256, bytes: body.length });
  console.log(`${schema.file}  ${body.length} bytes  sha256:${sha256.slice(0, 16)}...`);
}

const today = new Date().toISOString().slice(0, 10);
const sources = `# Vendored schemas

The SBOM serialisers are validated against the published schemas, not against
hand-written assertions about the shape of their output. The schemas are
committed here so the test suite runs offline and so an upstream change arrives
as a reviewable diff.

Regenerate with \`npm run fetch-schemas\`. Fetched ${today}.

${rows
  .map(
    (row) =>
      `## \`${row.file}\`\n\n${row.note}\n\n- Source: <${row.url}>\n- Bytes: ${row.bytes}\n- sha256: \`${row.sha256}\`\n`,
  )
  .join("\n")}`;

await writeFile(join(OUT, "SOURCES.md"), sources);
console.log("wrote SOURCES.md");
