import type { Component, ComponentSource, DependencyScope, InventoryNote } from "../../model/component.js";
import { byName } from "../../model/component.js";
import { type Result, ok, err } from "../../result.js";
import { npmPurl } from "./purl.js";

export type NpmParseFailure = {
  readonly kind: "manifest-unparseable";
  readonly detail: string;
};

/** What a package.json yields, before the repository identity is attached. */
export type NpmManifestScan = {
  readonly declaredName: string | null;
  readonly declaredVersion: string | null;
  readonly components: readonly Component[];
  readonly notes: readonly InventoryNote[];
  readonly excludedDevDependencies: number;
  readonly excludedPeerDependencies: number;
};

/**
 * One exact version, optionally written with npm's "=" or "v" prefix. A partial
 * version such as "1.2" is a range ("1.2.x") and is deliberately not matched.
 */
const EXACT_VERSION = /^[=v]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

const NON_REGISTRY_SCHEME = /^(?:file|link|workspace|portal|git|git\+[a-z]+|ssh|https?|github|gitlab|bitbucket|gist):/;

const NPM_ALIAS = /^npm:/;

/**
 * Reads the direct dependencies out of a package.json.
 *
 * Scope is dependencies and optionalDependencies only. devDependencies and
 * peerDependencies are counted and excluded: neither ships in the product, and
 * Annex I Part II(1) asks for a bill of materials of the product. The
 * transitive tree is not resolved -- that is a deliberate limit, not an
 * omission, and the reasoning is in CLAUDE.md.
 */
export function parsePackageJson(text: string): Result<NpmManifestScan, NpmParseFailure> {
  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch (cause) {
    return err({ kind: "manifest-unparseable", detail: cause instanceof Error ? cause.message : String(cause) });
  }

  if (!isRecord(document)) {
    return err({ kind: "manifest-unparseable", detail: `expected a JSON object, found ${describe(document)}` });
  }

  const notes: InventoryNote[] = [];
  const skipped: string[] = [];

  const required = readDependencyField(document, "dependencies", notes);
  const optional = readDependencyField(document, "optionalDependencies", notes);

  // npm: "Entries in optionalDependencies will override entries of the same
  // name in dependencies", so optional is applied second and wins.
  const specs = new Map<string, { spec: unknown; scope: DependencyScope }>();
  for (const [name, spec] of Object.entries(required)) specs.set(name, { spec, scope: "required" });
  for (const [name, spec] of Object.entries(optional)) specs.set(name, { spec, scope: "optional" });

  const components: Component[] = [];
  for (const [name, { spec, scope }] of specs) {
    if (name.length === 0) continue;
    if (typeof spec !== "string") {
      skipped.push(name);
      continue;
    }
    components.push(toComponent(name, spec, scope));
  }
  components.sort(byName);

  if (skipped.length > 0) notes.push({ kind: "skipped-entries", names: skipped.sort() });

  const workspaces = countWorkspacePatterns(document["workspaces"]);
  if (workspaces > 0) notes.push({ kind: "declares-workspaces", patterns: workspaces });

  return ok({
    declaredName: readString(document["name"]),
    declaredVersion: readString(document["version"]),
    components,
    notes,
    excludedDevDependencies: Object.keys(readDependencyField(document, "devDependencies", notes)).length,
    excludedPeerDependencies: Object.keys(readDependencyField(document, "peerDependencies", notes)).length,
  });
}

function toComponent(name: string, rawSpec: string, scope: DependencyScope): Component {
  const declaredRange = rawSpec.trim();
  const source = classify(declaredRange);
  const resolvedVersion = source === "registry" ? exactVersion(declaredRange) : null;
  return {
    ecosystem: "npm",
    name,
    declaredRange: rawSpec,
    resolvedVersion,
    source,
    scope,
    purl: source === "registry" ? npmPurl(name, resolvedVersion) : null,
  };
}

/**
 * An empty specifier is npm's shorthand for "*", so it is a registry spec.
 * A specifier containing "/" with no scheme is npm's "user/repo" GitHub
 * shorthand -- no version range ever contains a slash.
 */
function classify(spec: string): ComponentSource {
  if (NPM_ALIAS.test(spec)) return "alias";
  if (NON_REGISTRY_SCHEME.test(spec)) return "other";
  if (spec.includes("/")) return "other";
  return "registry";
}

function exactVersion(spec: string): string | null {
  return EXACT_VERSION.exec(spec)?.[1] ?? null;
}

/**
 * Returns the field's entries, or an empty object where the field is absent or
 * is not an object. A field of the wrong type is recorded as a note rather than
 * failing the scan: it is a fact about the manifest the reader should see, and
 * the rest of the manifest is still readable.
 */
function readDependencyField(document: Record<string, unknown>, field: string, notes: InventoryNote[]): Record<string, unknown> {
  const value = document[field];
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    notes.push({ kind: "unreadable-dependency-field", field });
    return {};
  }
  return value;
}

/** Both npm forms: an array of patterns, or { packages: [...] }. */
function countWorkspacePatterns(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value) && Array.isArray(value["packages"])) return value["packages"].length;
  return 0;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
