import type { NpmManifestScan, NpmParseFailure } from "./ecosystems/npm/package-json.js";
import { parsePackageJson } from "./ecosystems/npm/package-json.js";
import type { FetchDeps, FetchFailure } from "./github/raw-contents.js";
import { fetchManifest } from "./github/raw-contents.js";
import type { RepoRef } from "./github/repo-ref.js";
import { formatRepoRef, repoHtmlUrl } from "./github/repo-ref.js";
import type { DocumentMeta, Inventory } from "./model/component.js";
import { type Result, ok } from "./result.js";
import { TOOL_NAME, TOOL_VERSION } from "./version.js";

/**
 * The only module that knows about all of fetching, parsing and the model. Each
 * of those knows nothing about the others.
 */

export const MANIFEST_PATH = "package.json";

export type ScanFailure = FetchFailure | NpmParseFailure;

export type Scan = {
  readonly ref: RepoRef;
  readonly inventory: Inventory;
  readonly meta: DocumentMeta;
};

export type ScanDeps = FetchDeps & {
  readonly now: () => Date;
  readonly uuid: () => string;
  /** Where this instance is served from, used to mint the SPDX namespace. */
  readonly origin: string;
};

export async function scanRepository(ref: RepoRef, deps: ScanDeps): Promise<Result<Scan, ScanFailure>> {
  const manifest = await fetchManifest(ref, MANIFEST_PATH, deps);
  if (!manifest.ok) return manifest;

  const parsed = parsePackageJson(manifest.value);
  if (!parsed.ok) return parsed;

  return ok({ ref, inventory: toInventory(ref, parsed.value), meta: documentMeta(deps) });
}

/** Attaches the repository identity to what the manifest yielded. */
export function toInventory(ref: RepoRef, manifest: NpmManifestScan): Inventory {
  return {
    subject: {
      name: formatRepoRef(ref),
      version: manifest.declaredVersion,
      sourceUrl: repoHtmlUrl(ref),
      manifestPath: MANIFEST_PATH,
    },
    components: manifest.components,
    notes: manifest.notes,
    exclusions: {
      devDependencies: manifest.excludedDevDependencies,
      peerDependencies: manifest.excludedPeerDependencies,
    },
  };
}

export function documentMeta(deps: Pick<ScanDeps, "now" | "uuid" | "origin">): DocumentMeta {
  const uuid = deps.uuid();
  return {
    generatedAt: deps.now().toISOString(),
    serialNumber: `urn:uuid:${uuid}`,
    documentNamespace: `${deps.origin}/sbom/${uuid}`,
    toolName: TOOL_NAME,
    toolVersion: TOOL_VERSION,
  };
}
