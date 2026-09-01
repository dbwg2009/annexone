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
 * Percent-encodes one PURL component per ECMA-427 clause 5.2, which permits
 * only the alphanumerics and the punctuation characters ".-_~" inside a
 * component. encodeURIComponent alone is not enough: it leaves !'()* intact,
 * and those are not in the permitted set.
 */
function encodeComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Returns a package URL for an npm package, or null where the name is not a
 * well-formed npm name. Version is appended only when one is actually known --
 * a purl carrying a range would be a purl that does not resolve.
 */
export function npmPurl(name: string, version: string | null): string | null {
  const match = NPM_NAME.exec(name);
  if (match === null) return null;

  const scope = match[1];
  const bare = match[2];
  if (bare === undefined || bare.length === 0) return null;

  const namespace = scope === undefined ? "" : `${encodeComponent(scope)}/`;
  const suffix = version === null ? "" : `@${encodeComponent(version)}`;
  return `pkg:npm/${namespace}${encodeComponent(bare)}${suffix}`;
}
