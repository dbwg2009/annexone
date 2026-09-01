import { describe, expect, it } from "vitest";
import expressManifest from "./fixtures/express.package.json?raw";
import honoManifest from "./fixtures/hono.package.json?raw";
import { toCycloneDx16 } from "../src/sbom/cyclonedx.js";
import { META, MIXED_MANIFEST, inventoryFrom } from "./inventory.js";
import { cycloneDx16Errors } from "./validate.js";

type Bom = {
  components: Array<Record<string, unknown>>;
  dependencies: Array<{ ref: string; dependsOn: string[] }>;
  metadata: Record<string, unknown>;
} & Record<string, unknown>;

function bomFor(manifest: unknown, repository?: string): Bom {
  const document = toCycloneDx16(inventoryFrom(manifest, repository), META) as unknown as Bom;
  // Validated on every construction: no test below can assert about a document
  // that would not survive a schema check.
  expect(cycloneDx16Errors(document)).toEqual([]);
  return document;
}

function component(bom: Bom, name: string): Record<string, unknown> {
  const found = bom.components.find((candidate) => candidate["name"] === name);
  if (found === undefined) throw new Error(`expected a component named ${name}`);
  return found;
}

function property(entry: Record<string, unknown>, suffix: string): string | undefined {
  const properties = entry["properties"] as Array<{ name: string; value: string }> | undefined;
  return properties?.find((candidate) => candidate.name === `annexone:npm:${suffix}`)?.value;
}

describe("toCycloneDx16: document", () => {
  it("emits a schema-valid document for expressjs/express", () => {
    const bom = bomFor(expressManifest, "expressjs/express");
    expect(bom["bomFormat"]).toBe("CycloneDX");
    expect(bom["specVersion"]).toBe("1.6");
    expect(bom["serialNumber"]).toBe(META.serialNumber);
    expect(bom.components).toHaveLength(28);
  });

  it("emits a schema-valid document for a repository with no dependencies at all", () => {
    // honojs/hono declares none. An empty bill of materials is a correct one.
    const bom = bomFor(honoManifest, "honojs/hono");
    expect(bom.components).toEqual([]);
    expect(bom.dependencies).toEqual([{ ref: "annexone:subject:honojs/hono", dependsOn: [] }]);
  });

  it("names the repository as the subject, with its version and source", () => {
    const bom = bomFor(MIXED_MANIFEST, "owner/name");
    expect(bom.metadata["component"]).toMatchObject({
      type: "application",
      name: "owner/name",
      version: "2.1.0",
      externalReferences: [{ type: "vcs", url: "https://github.com/owner/name" }],
    });
  });

  it("records the tool that produced it", () => {
    expect(bomFor(MIXED_MANIFEST).metadata["tools"]).toEqual({
      components: [{ type: "application", name: "annexone", version: "0.1.0" }],
    });
  });

  it("is deterministic given the same inventory and metadata", () => {
    expect(JSON.stringify(bomFor(MIXED_MANIFEST))).toBe(JSON.stringify(bomFor(MIXED_MANIFEST)));
  });
});

describe("toCycloneDx16: the dependency graph", () => {
  it("declares what the subject depends on, and says nothing about the rest", () => {
    // CycloneDX: components "not represented in the dependency graph MAY have
    // unknown dependencies", whereas an empty element asserts none. Only direct
    // dependencies are read, so the components' own graphs are unknown and are
    // deliberately left out rather than asserted empty.
    const bom = bomFor(MIXED_MANIFEST);
    expect(bom.dependencies).toHaveLength(1);
    expect(bom.dependencies[0]?.ref).toBe("annexone:subject:owner/name");
    expect(bom.dependencies[0]?.dependsOn).toHaveLength(9);
  });

  it("references every component by a bom-ref the document defines", () => {
    const bom = bomFor(MIXED_MANIFEST);
    const defined = new Set(bom.components.map((entry) => entry["bom-ref"]));
    expect(defined.size).toBe(bom.components.length);
    for (const ref of bom.dependencies[0]?.dependsOn ?? []) expect(defined).toContain(ref);
  });
});

describe("toCycloneDx16: components", () => {
  it("omits the version where the manifest gave a range", () => {
    const entry = component(bomFor(MIXED_MANIFEST), "ranged");
    expect(entry["version"]).toBeUndefined();
    expect(entry["purl"]).toBe("pkg:npm/ranged");
    expect(property(entry, "declaredRange")).toBe("^6.15.2");
  });

  it("carries the version where the manifest pinned one exactly", () => {
    const entry = component(bomFor(MIXED_MANIFEST), "exact-pin");
    expect(entry["version"]).toBe("1.2.3");
    expect(entry["purl"]).toBe("pkg:npm/exact-pin@1.2.3");
  });

  it("splits an npm scope into a CycloneDX group, keeping the whole name as a property", () => {
    const entry = component(bomFor(MIXED_MANIFEST), "node-server");
    expect(entry["group"]).toBe("@hono");
    expect(entry["purl"]).toBe("pkg:npm/%40hono/node-server");
    expect(property(entry, "packageName")).toBe("@hono/node-server");
  });

  it("gives an unscoped component no group", () => {
    expect(component(bomFor(MIXED_MANIFEST), "ranged")["group"]).toBeUndefined();
  });

  it("marks an optional dependency as optional and the rest as required", () => {
    const bom = bomFor(MIXED_MANIFEST);
    expect(component(bom, "only-sometimes")["scope"]).toBe("optional");
    expect(component(bom, "ranged")["scope"]).toBe("required");
  });

  it.each([
    ["from-a-path", "file:../local"],
    ["from-a-workspace", "workspace:*"],
    ["from-git", "git+https://github.com/u/r.git"],
  ])("gives %s no package URL and records why", (name, range) => {
    const entry = component(bomFor(MIXED_MANIFEST), name);
    expect(entry["purl"]).toBeUndefined();
    expect(property(entry, "source")).toBe("other");
    expect(property(entry, "declaredRange")).toBe(range);
  });

  it("records an npm alias as an alias", () => {
    const entry = component(bomFor(MIXED_MANIFEST), "under-an-alias");
    expect(entry["purl"]).toBeUndefined();
    expect(property(entry, "source")).toBe("alias");
    expect(property(entry, "declaredRange")).toBe("npm:lodash@^4.17.21");
  });

  it("types every component as a library", () => {
    expect(bomFor(expressManifest).components.every((entry) => entry["type"] === "library")).toBe(true);
  });
});

describe("toCycloneDx16: schema conformance under awkward input", () => {
  it.each([
    ["a manifest with no fields at all", {}],
    ["a name that is not a well-formed npm name", { dependencies: { "@scope/a/b": "1.0.0" } }],
    ["a specifier that is an empty string", { dependencies: { pkg: "" } }],
    ["a specifier full of characters needing encoding", { dependencies: { pkg: ">=1 <2 || ~3" } }],
    ["a manifest with no version", { dependencies: { pkg: "^1.0.0" } }],
    ["a dependency field of the wrong type", { dependencies: [] }],
  ])("stays schema-valid for %s", (_label, manifest) => {
    expect(cycloneDx16Errors(toCycloneDx16(inventoryFrom(manifest), META))).toEqual([]);
  });
});
