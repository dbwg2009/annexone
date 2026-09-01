/**
 * Package URL construction for npm.
 *
 * The scope-to-namespace rule is npm knowledge, so it lives here rather than in
 * the model. Verified against the purl specification's own npm type definition
 * (types/npm-definition.json): the namespace is the scope, the leading "@" is
 * always percent-encoded, and both namespace and name are case-sensitive.
 * Its example is pkg:npm/%40angular/animation@12.3.1.
 */

/** "@scope/name" or "name". Anything else is not an npm package name. */
const NPM_NAME = /^(?:(@[^/]+)\/)?([^/]+)$/;

/**
 * One segment of an npm package name -- the scope without its "@", or the name.
 *
 * npm rejects "~)('!*" and anything else not URL-safe, because the name appears
 * in registry URLs and directory paths. Uppercase is permitted: it is forbidden
 * for new packages but plenty of published ones predate that rule, and this
 * reads manifests rather than writing them.
 */
const NPM_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** npm's limit on the whole name, scope included. */
const MAX_NAME_LENGTH = 214;

/**
 * Percent-encodes one PURL component per ECMA-427 clause 5.2, which permits
 * only the alphanumerics and the punctuation characters ".-_~" inside a
 * component. encodeURIComponent alone is not enough: it leaves !'()* intact,
 * and those are not in the permitted set.
 *
 * Exported so the encoding rule is tested directly. npm package names cannot
 * contain those characters, so no valid input reaches this path through
 * npmPurl -- which is exactly why the encoder needs its own test rather than
 * one that depends on an invalid name slipping through.
 */
export function encodePurlComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * True where npm would accept the name. Only the rules npm treats as errors
 * are applied; its warnings about legacy names are not, because those names
 * are published and real.
 */
export function isNpmPackageName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  if (name.startsWith(".") || name.startsWith("_")) return false;

  const match = NPM_NAME.exec(name);
  if (match === null) return false;

  const scope = match[1];
  const bare = match[2];
  if (bare === undefined || !NPM_SEGMENT.test(bare)) return false;
  if (scope !== undefined && !NPM_SEGMENT.test(scope.slice(1))) return false;

  return true;
}

/**
 * Returns a package URL for an npm package, or null where the name is one npm
 * would not accept -- no such package can exist in the registry, and a package
 * URL naming one would be an identifier that resolves to nothing.
 *
 * Version is appended only when one is actually known: a purl carrying a range
 * would be a purl that does not resolve either.
 */
export function npmPurl(name: string, version: string | null): string | null {
  if (!isNpmPackageName(name)) return null;

  const match = NPM_NAME.exec(name);
  const scope = match?.[1];
  const bare = match?.[2];
  if (bare === undefined) return null;

  const namespace = scope === undefined ? "" : `${encodePurlComponent(scope)}/`;
  const suffix = version === null ? "" : `@${encodePurlComponent(version)}`;
  return `pkg:npm/${namespace}${encodePurlComponent(bare)}${suffix}`;
}
