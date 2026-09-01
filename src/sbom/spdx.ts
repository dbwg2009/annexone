import type { Component, DocumentMeta, Inventory } from "../model/component.js";

/**
 * SPDX 2.3 serialisation.
 *
 * Imports the model and nothing else -- not the npm parser, not the CycloneDX
 * serialiser. Pure and deterministic: everything that varies between runs
 * arrives in DocumentMeta.
 *
 * The regulation mandates no format. Article 13(24) reserves the right to
 * specify one later by implementing act, so this is one of two emitters and
 * neither is privileged.
 */

const DOCUMENT_ID = "SPDXRef-DOCUMENT";
const SUBJECT_ID = "SPDXRef-Package-Subject";

/**
 * SPDX 2.3 requires an identifier to match SPDXRef-[0-9a-zA-Z.\-+]+, which npm
 * package names do not.
 */
const DISALLOWED_IN_ID = /[^0-9a-zA-Z.+-]+/g;

/** Used where a field is required but nothing about it has been established. */
const NOASSERTION = "NOASSERTION";

export function toSpdx23(inventory: Inventory, meta: DocumentMeta): Record<string, unknown> {
  const packages = inventory.components.map((component, index) => toSpdxPackage(component, index));

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: DOCUMENT_ID,
    name: inventory.subject.name,
    documentNamespace: meta.documentNamespace,
    creationInfo: {
      created: meta.generatedAt,
      creators: [`Tool: ${meta.toolName}-${meta.toolVersion}`],
    },
    documentDescribes: [SUBJECT_ID],
    packages: [subjectPackage(inventory), ...packages],
    relationships: [
      { spdxElementId: DOCUMENT_ID, relatedSpdxElement: SUBJECT_ID, relationshipType: "DESCRIBES" },
      ...inventory.components.map((component, index) => toRelationship(component, index)),
    ],
  };
}

function subjectPackage(inventory: Inventory): Record<string, unknown> {
  const { subject } = inventory;
  return {
    SPDXID: SUBJECT_ID,
    name: subject.name,
    ...(subject.version === null ? {} : { versionInfo: subject.version }),
    // The one download location actually established: it is where the manifest
    // was read from.
    downloadLocation: subject.sourceUrl ?? NOASSERTION,
    filesAnalyzed: false,
    licenseConcluded: NOASSERTION,
    licenseDeclared: NOASSERTION,
    copyrightText: NOASSERTION,
    primaryPackagePurpose: "APPLICATION",
  };
}

function toSpdxPackage(component: Component, index: number): Record<string, unknown> {
  return {
    SPDXID: packageId(component, index),
    name: component.name,
    // Omitted where the manifest gave a range, for the same reason CycloneDX's
    // version is: a range is not a version.
    ...(component.resolvedVersion === null ? {} : { versionInfo: component.resolvedVersion }),
    // No registry URL was resolved or checked. Synthesising one would assert a
    // location nobody has verified.
    downloadLocation: NOASSERTION,
    filesAnalyzed: false,
    licenseConcluded: NOASSERTION,
    licenseDeclared: NOASSERTION,
    copyrightText: NOASSERTION,
    primaryPackagePurpose: "LIBRARY",
    ...(component.purl === null
      ? {}
      : { externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: component.purl }] }),
    comment: comment(component),
  };
}

/**
 * SPDX has no field for a version range, so the declared specifier goes in the
 * package comment, where it stays legible to a human reading the document.
 */
function comment(component: Component): string {
  const resolution =
    component.resolvedVersion === null
      ? "No exact version was resolved; the specifier is a range."
      : "The specifier names one exact version.";
  return `Declared in package.json as ${JSON.stringify(component.declaredRange)} (${component.scope}, ${component.source}). ${resolution}`;
}

function toRelationship(component: Component, index: number): Record<string, unknown> {
  const id = packageId(component, index);
  return component.scope === "optional"
    ? { spdxElementId: id, relatedSpdxElement: SUBJECT_ID, relationshipType: "OPTIONAL_DEPENDENCY_OF" }
    : { spdxElementId: SUBJECT_ID, relatedSpdxElement: id, relationshipType: "DEPENDS_ON" };
}

/**
 * The index guarantees uniqueness. Sanitising alone would not: "@scope/name"
 * and "scope-name" both reduce to the same characters.
 */
function packageId(component: Component, index: number): string {
  const sanitised = component.name.replace(DISALLOWED_IN_ID, "-").replace(/^-+|-+$/g, "");
  return sanitised.length === 0 ? `SPDXRef-Package-${index + 1}` : `SPDXRef-Package-${index + 1}-${sanitised}`;
}
