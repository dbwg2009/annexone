import type { Component, DocumentMeta, Inventory } from "../model/component.js";

/**
 * CycloneDX 1.6 serialisation.
 *
 * Imports the model and nothing else -- not the npm parser, not the SPDX
 * serialiser. Pure and deterministic: everything that varies between runs
 * arrives in DocumentMeta.
 *
 * The regulation mandates no format. Article 13(24) reserves the right to
 * specify one later by implementing act, so this is one of two emitters and
 * neither is privileged.
 */

/** Namespace for the fields CycloneDX has no first-class place for. */
const PROPERTY_PREFIX = "annexone:npm";

export function toCycloneDx16(inventory: Inventory, meta: DocumentMeta): Record<string, unknown> {
  const subjectRef = `annexone:subject:${inventory.subject.name}`;

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: meta.serialNumber,
    version: 1,
    metadata: {
      timestamp: meta.generatedAt,
      tools: { components: [{ type: "application", name: meta.toolName, version: meta.toolVersion }] },
      component: subjectComponent(inventory, subjectRef),
    },
    components: inventory.components.map(toCycloneDxComponent),
    dependencies: [{ ref: subjectRef, dependsOn: inventory.components.map(bomRef) }],
  };
}

function subjectComponent(inventory: Inventory, ref: string): Record<string, unknown> {
  const { subject } = inventory;
  return {
    type: "application",
    "bom-ref": ref,
    name: subject.name,
    ...(subject.version === null ? {} : { version: subject.version }),
    ...(subject.sourceUrl === null ? {} : { externalReferences: [{ type: "vcs", url: subject.sourceUrl }] }),
  };
}

function toCycloneDxComponent(component: Component): Record<string, unknown> {
  const { group, name } = splitScope(component.name);
  return {
    type: "library",
    "bom-ref": bomRef(component),
    ...(group === null ? {} : { group }),
    name,
    // Omitted where the manifest gave a range. CycloneDX defines version as "a
    // single disjunctive version identifier"; "^6.15.2" is not one, and writing
    // it here would assert something package.json does not say.
    ...(component.resolvedVersion === null ? {} : { version: component.resolvedVersion }),
    scope: component.scope,
    ...(component.purl === null ? {} : { purl: component.purl }),
    properties: [
      { name: `${PROPERTY_PREFIX}:declaredRange`, value: component.declaredRange },
      { name: `${PROPERTY_PREFIX}:packageName`, value: component.name },
      { name: `${PROPERTY_PREFIX}:source`, value: component.source },
    ],
  };
}

/**
 * npm scopes map to CycloneDX groups, as the CycloneDX npm tooling does it:
 * "@hono/node-server" becomes group "@hono", name "node-server". The unsplit
 * name is kept as a property so nothing has to reassemble it.
 */
function splitScope(fullName: string): { group: string | null; name: string } {
  const match = /^(@[^/]+)\/(.+)$/.exec(fullName);
  const group = match?.[1];
  const bare = match?.[2];
  if (group === undefined || bare === undefined) return { group: null, name: fullName };
  return { group, name: bare };
}

/**
 * Unique within the document because dependency names are unique within a
 * manifest.
 */
function bomRef(component: Component): string {
  return component.purl ?? `${PROPERTY_PREFIX}:${component.name}`;
}
