/**
 * The internal component model.
 *
 * This module imports nothing. It knows no package ecosystem and no
 * serialisation format -- CLAUDE.md requires that the model not be coupled to
 * either CycloneDX or SPDX, because Article 13(24) reserves the right to
 * mandate a format later and we do not know which one.
 */

export type Ecosystem = "npm";

/** dependencies vs optionalDependencies. Nothing else is in scope. */
export type DependencyScope = "required" | "optional";

/**
 * Where the dependency comes from, which determines whether a package URL can
 * be constructed for it.
 *
 * - "registry": an ordinary package from the ecosystem's registry.
 * - "alias":    a registry package installed under a different local name
 *               (npm's "npm:other-package@range" form). The component that
 *               ships is not the one the manifest key names.
 * - "other":    a filesystem path, workspace link, git URL, tarball URL or
 *               repository shorthand. No registry coordinates exist.
 */
export type ComponentSource = "registry" | "alias" | "other";

export type Component = {
  readonly ecosystem: Ecosystem;
  /** The dependency name exactly as the manifest keys it. */
  readonly name: string;
  /** The version specifier verbatim: "^6.15.2", "workspace:*", "github:u/r". */
  readonly declaredRange: string;
  /**
   * Set only where declaredRange names one exact version. A range is not a
   * version, and this field is not the place to pretend otherwise.
   */
  readonly resolvedVersion: string | null;
  readonly source: ComponentSource;
  readonly scope: DependencyScope;
  /** A package URL, or null where the source admits no registry coordinates. */
  readonly purl: string | null;
};

/**
 * Something true about the manifest that the reader should know when judging
 * the component list, rather than an error.
 */
export type InventoryNote =
  | { readonly kind: "declares-workspaces"; readonly patterns: number }
  | { readonly kind: "skipped-entries"; readonly names: readonly string[] }
  | { readonly kind: "unreadable-dependency-field"; readonly field: string };

/** What the bill of materials is about. */
export type Subject = {
  /** "expressjs/express" -- the repository, which is what the user asked about. */
  readonly name: string;
  /** The "version" field of the manifest, where it declares one. */
  readonly version: string | null;
  readonly sourceUrl: string | null;
  readonly manifestPath: string;
};

/** Dependencies read but deliberately left out of the bill of materials. */
export type Exclusions = {
  readonly devDependencies: number;
  readonly peerDependencies: number;
};

export type Inventory = {
  readonly subject: Subject;
  /** Sorted by name, by code point, so that output is byte-stable. */
  readonly components: readonly Component[];
  readonly notes: readonly InventoryNote[];
  readonly exclusions: Exclusions;
};

/**
 * The non-deterministic parts of a bill of materials, supplied by the caller so
 * that the serialisers stay pure and their output is byte-stable under test.
 */
export type DocumentMeta = {
  /** ISO 8601, UTC. */
  readonly generatedAt: string;
  readonly serialNumber: string;
  readonly documentNamespace: string;
  readonly toolName: string;
  readonly toolVersion: string;
};

/** Orders components by name by code point. Deliberately not locale-aware. */
export function byName(a: Component, b: Component): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}
