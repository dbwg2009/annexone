import { describe, expect, it } from "vitest";
import expressManifest from "./fixtures/express.package.json?raw";
import honoManifest from "./fixtures/hono.package.json?raw";
import { toSpdx23 } from "../src/sbom/spdx.js";
import { META, MIXED_MANIFEST, inventoryFrom } from "./inventory.js";
import { spdx23Errors } from "./validate.js";

type SpdxPackage = {
  SPDXID: string;
  name: string;
  versionInfo?: string;
  downloadLocation: string;
  comment?: string;
  externalRefs?: Array<{ referenceCategory: string; referenceType: string; referenceLocator: string }>;
} & Record<string, unknown>;

type SpdxDocument = {
  packages: SpdxPackage[];
  relationships: Array<{ spdxElementId: string; relatedSpdxElement: string; relationshipType: string }>;
  documentDescribes: string[];
} & Record<string, unknown>;

function documentFor(manifest: unknown, repository?: string): SpdxDocument {
  const document = toSpdx23(inventoryFrom(manifest, repository), META) as unknown as SpdxDocument;
  // Validated on every construction, so nothing below asserts about a document
  // that would not survive a schema check.
  expect(spdx23Errors(document)).toEqual([]);
  return document;
}

function pkg(document: SpdxDocument, name: string): SpdxPackage {
  const found = document.packages.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`expected a package named ${name}`);
  return found;
}

describe("toSpdx23: document", () => {
  it("emits a schema-valid document for expressjs/express", () => {
    const document = documentFor(expressManifest, "expressjs/express");
    expect(document["spdxVersion"]).toBe("SPDX-2.3");
    expect(document["dataLicense"]).toBe("CC0-1.0");
    expect(document["SPDXID"]).toBe("SPDXRef-DOCUMENT");
    expect(document["name"]).toBe("expressjs/express");
    expect(document["documentNamespace"]).toBe(META.documentNamespace);
    expect(document["creationInfo"]).toEqual({
      created: META.generatedAt,
      creators: ["Tool: annexone-0.1.0"],
    });
    // 28 dependencies plus the repository itself.
    expect(document.packages).toHaveLength(29);
  });

  it("emits a schema-valid document for a repository with no dependencies at all", () => {
    const document = documentFor(honoManifest, "honojs/hono");
    expect(document.packages).toHaveLength(1);
    expect(document.packages[0]?.SPDXID).toBe("SPDXRef-Package-Subject");
    expect(document.relationships).toEqual([
      { spdxElementId: "SPDXRef-DOCUMENT", relatedSpdxElement: "SPDXRef-Package-Subject", relationshipType: "DESCRIBES" },
    ]);
  });

  it("describes the repository, both ways SPDX allows", () => {
    const document = documentFor(MIXED_MANIFEST, "owner/name");
    expect(document.documentDescribes).toEqual(["SPDXRef-Package-Subject"]);
    expect(document.relationships[0]).toEqual({
      spdxElementId: "SPDXRef-DOCUMENT",
      relatedSpdxElement: "SPDXRef-Package-Subject",
      relationshipType: "DESCRIBES",
    });
  });

  it("gives the repository the one download location actually established", () => {
    const subject = pkg(documentFor(MIXED_MANIFEST, "owner/name"), "owner/name");
    expect(subject.downloadLocation).toBe("https://github.com/owner/name");
    expect(subject.versionInfo).toBe("2.1.0");
    expect(subject["primaryPackagePurpose"]).toBe("APPLICATION");
  });

  it("is deterministic given the same inventory and metadata", () => {
    expect(JSON.stringify(documentFor(MIXED_MANIFEST))).toBe(JSON.stringify(documentFor(MIXED_MANIFEST)));
  });
});

describe("toSpdx23: identifiers", () => {
  // The published JSON schema types SPDXID as a bare string, so it cannot catch
  // a malformed identifier. The specification text requires the pattern below,
  // and this is the one place the tests assert a shape by hand rather than
  // deferring to the schema.
  const SPDX_ID = /^SPDXRef-[0-9a-zA-Z.+-]+$/;

  it("gives every element an identifier matching the pattern the schema does not check", () => {
    const document = documentFor({
      dependencies: { "@hono/node-server": "^1.0.0", "under_scores": "^1.0.0", "___": "^1.0.0", "a.b+c": "^1.0.0" },
    });
    for (const entry of document.packages) expect(entry.SPDXID).toMatch(SPDX_ID);
    for (const relationship of document.relationships) {
      expect(relationship.spdxElementId).toMatch(SPDX_ID);
      expect(relationship.relatedSpdxElement).toMatch(SPDX_ID);
    }
  });

  it("keeps identifiers unique where sanitising alone would collide", () => {
    // "@scope/name" and "scope-name" reduce to the same characters, which is
    // why the index is part of the identifier.
    const document = documentFor({ dependencies: { "@scope/name": "^1.0.0", "scope-name": "^1.0.0" } });
    const ids = document.packages.map((entry) => entry.SPDXID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only identifiers the document defines", () => {
    const document = documentFor(MIXED_MANIFEST);
    const defined = new Set([...document.packages.map((entry) => entry.SPDXID), "SPDXRef-DOCUMENT"]);
    for (const relationship of document.relationships) {
      expect(defined).toContain(relationship.spdxElementId);
      expect(defined).toContain(relationship.relatedSpdxElement);
    }
    for (const id of document.documentDescribes) expect(defined).toContain(id);
  });
});

describe("toSpdx23: packages", () => {
  it("omits versionInfo where the manifest gave a range, and says so in the comment", () => {
    const entry = pkg(documentFor(MIXED_MANIFEST), "ranged");
    expect(entry.versionInfo).toBeUndefined();
    expect(entry.comment).toContain('"^6.15.2"');
    expect(entry.comment).toContain("No exact version was resolved");
  });

  it("carries versionInfo where the manifest pinned one exactly", () => {
    const entry = pkg(documentFor(MIXED_MANIFEST), "exact-pin");
    expect(entry.versionInfo).toBe("1.2.3");
    expect(entry.comment).toContain("names one exact version");
  });

  it("asserts no download location for a dependency, because none was resolved", () => {
    for (const entry of documentFor(expressManifest).packages.slice(1)) {
      expect(entry.downloadLocation).toBe("NOASSERTION");
    }
  });

  it("makes no claim about licence or copyright", () => {
    const entry = pkg(documentFor(MIXED_MANIFEST), "ranged");
    expect(entry["licenseConcluded"]).toBe("NOASSERTION");
    expect(entry["licenseDeclared"]).toBe("NOASSERTION");
    expect(entry["copyrightText"]).toBe("NOASSERTION");
    expect(entry["filesAnalyzed"]).toBe(false);
  });

  it("carries the package URL as a package-manager external reference", () => {
    expect(pkg(documentFor(MIXED_MANIFEST), "@hono/node-server").externalRefs).toEqual([
      { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:npm/%40hono/node-server" },
    ]);
  });

  it.each(["from-a-path", "from-a-workspace", "from-git", "under-an-alias"])(
    "gives %s no external reference, because it has no registry coordinates",
    (name) => {
      expect(pkg(documentFor(MIXED_MANIFEST), name).externalRefs).toBeUndefined();
    },
  );

  it("keeps the full npm name, scope included", () => {
    expect(pkg(documentFor(MIXED_MANIFEST), "@hono/node-server").name).toBe("@hono/node-server");
  });
});

describe("toSpdx23: relationships", () => {
  it("relates a required dependency as DEPENDS_ON from the repository", () => {
    const document = documentFor(MIXED_MANIFEST);
    const id = pkg(document, "ranged").SPDXID;
    expect(document.relationships).toContainEqual({
      spdxElementId: "SPDXRef-Package-Subject",
      relatedSpdxElement: id,
      relationshipType: "DEPENDS_ON",
    });
  });

  it("relates an optional dependency as OPTIONAL_DEPENDENCY_OF the repository", () => {
    const document = documentFor(MIXED_MANIFEST);
    const id = pkg(document, "only-sometimes").SPDXID;
    expect(document.relationships).toContainEqual({
      spdxElementId: id,
      relatedSpdxElement: "SPDXRef-Package-Subject",
      relationshipType: "OPTIONAL_DEPENDENCY_OF",
    });
  });

  it("relates every dependency exactly once", () => {
    const document = documentFor(MIXED_MANIFEST);
    expect(document.relationships).toHaveLength(document.packages.length);
  });
});

describe("toSpdx23: schema conformance under awkward input", () => {
  it.each([
    ["a manifest with no fields at all", {}],
    ["a name that is not a well-formed npm name", { dependencies: { "@scope/a/b": "1.0.0" } }],
    ["a specifier that is an empty string", { dependencies: { pkg: "" } }],
    ["a specifier full of characters needing encoding", { dependencies: { pkg: ">=1 <2 || ~3" } }],
    ["a manifest with no version", { dependencies: { pkg: "^1.0.0" } }],
    ["a dependency field of the wrong type", { dependencies: [] }],
  ])("stays schema-valid for %s", (_label, manifest) => {
    expect(spdx23Errors(toSpdx23(inventoryFrom(manifest), META))).toEqual([]);
  });
});
