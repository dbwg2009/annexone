/**
 * Inventory construction for the serialiser tests. Builds through the real npm
 * parser rather than by hand, so the shapes under test are the shapes the
 * running checker actually produces.
 */
import { parsePackageJson } from "../src/ecosystems/npm/package-json.js";
import type { DocumentMeta, Inventory } from "../src/model/component.js";

/** Fixed, because the serialisers must be deterministic given their inputs. */
export const META: DocumentMeta = {
  generatedAt: "2026-09-01T12:00:00.000Z",
  serialNumber: "urn:uuid:0f14d0ab-9605-4a62-a9e4-5ed26688389b",
  documentNamespace: "https://annexone.dbwg2009.uk/sbom/0f14d0ab-9605-4a62-a9e4-5ed26688389b",
  toolName: "annexone",
  toolVersion: "0.1.0",
};

export function inventoryFrom(manifest: unknown, repository = "owner/name"): Inventory {
  // JSON.stringify is typed as returning string but returns undefined for
  // undefined, a function or a symbol. No caller passes one; rejecting them
  // here turns a confusing downstream parse failure into a clear one.
  const text = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
  if (typeof text !== "string") throw new Error(`fixture cannot be serialised: ${String(manifest)}`);

  const parsed = parsePackageJson(text);
  if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.error.detail}`);

  return {
    subject: {
      name: repository,
      version: parsed.value.declaredVersion,
      sourceUrl: `https://github.com/${repository}`,
      manifestPath: "package.json",
    },
    components: parsed.value.components,
    notes: parsed.value.notes,
    exclusions: {
      devDependencies: parsed.value.excludedDevDependencies,
      peerDependencies: parsed.value.excludedPeerDependencies,
    },
  };
}

/** A manifest exercising every specifier shape the model distinguishes. */
export const MIXED_MANIFEST = {
  name: "mixed",
  version: "2.1.0",
  dependencies: {
    "@hono/node-server": "^1.13.7",
    "exact-pin": "1.2.3",
    "build-metadata": "1.2.3+build.5",
    "from-a-path": "file:../local",
    "from-a-workspace": "workspace:*",
    "from-git": "git+https://github.com/u/r.git",
    "under-an-alias": "npm:lodash@^4.17.21",
    ranged: "^6.15.2",
  },
  optionalDependencies: { "only-sometimes": "~2.0.0" },
  devDependencies: { vitest: "^4.0.0" },
  peerDependencies: { react: "^19.0.0" },
};
