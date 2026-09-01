import { describe, expect, it } from "vitest";
import { cycloneDx16Errors, spdx23Errors } from "./validate.js";

/**
 * Guards the vendored schemas and the validator wiring itself. If a schema were
 * to fail to compile, or a cross-reference to fail to resolve, every other SBOM
 * test would pass vacuously.
 */
describe("vendored schemas", () => {
  it("accepts a minimal CycloneDX 1.6 document", () => {
    expect(cycloneDx16Errors({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1 })).toEqual([]);
  });

  it("rejects a CycloneDX document missing its required fields", () => {
    expect(cycloneDx16Errors({ specVersion: "1.6" })).not.toEqual([]);
  });

  it("rejects a CycloneDX document with an unknown top-level field", () => {
    // The schema sets additionalProperties: false, which is what catches a
    // serialiser inventing a field.
    const errors = cycloneDx16Errors({ bomFormat: "CycloneDX", specVersion: "1.6", invented: true });
    expect(errors).not.toEqual([]);
  });

  it("resolves the cross-references CycloneDX makes to its sibling schemas", () => {
    // licenses[].license.id draws on spdx.schema.json; an unresolved $ref would
    // make this pass by accident, so an invalid identifier must be rejected.
    const withBadLicence = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [{ type: "library", name: "x", licenses: [{ license: { id: "Not-A-Real-Licence" } }] }],
    };
    expect(cycloneDx16Errors(withBadLicence)).not.toEqual([]);
    const withGoodLicence = {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [{ type: "library", name: "x", licenses: [{ license: { id: "MIT" } }] }],
    };
    expect(cycloneDx16Errors(withGoodLicence)).toEqual([]);
  });

  it("accepts a minimal SPDX 2.3 document", () => {
    const document = {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: "example",
      documentNamespace: "https://example.invalid/1",
      creationInfo: { created: "2026-09-01T00:00:00Z", creators: ["Tool: annexone-0.1.0"] },
    };
    expect(spdx23Errors(document)).toEqual([]);
  });

  it("rejects an SPDX document missing its required fields", () => {
    expect(spdx23Errors({ spdxVersion: "SPDX-2.3" })).not.toEqual([]);
  });

  it("rejects an SPDX document with an unknown top-level field", () => {
    const document = {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: "example",
      documentNamespace: "https://example.invalid/1",
      creationInfo: { created: "2026-09-01T00:00:00Z", creators: ["Tool: annexone-0.1.0"] },
      invented: true,
    };
    expect(spdx23Errors(document)).not.toEqual([]);
  });
});
