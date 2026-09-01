/**
 * Validation against the published JSON schemas, vendored under test/schemas.
 *
 * The point of validating against the real schemas rather than asserting the
 * shape by hand is that an invalid SBOM is worse than none, and our idea of the
 * shape is exactly the thing under test.
 */
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import bom16 from "./schemas/bom-1.6.schema.json?raw";
import cyclonedxJsf from "./schemas/jsf-0.82.schema.json?raw";
import cyclonedxSpdxLicences from "./schemas/spdx.schema.json?raw";
import spdx23 from "./schemas/spdx-2.3.schema.json?raw";

// ajv and ajv-formats ship CommonJS; under an ESM loader the callable may
// arrive on .default.
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as typeof addFormatsModule;

function newAjv(): InstanceType<typeof Ajv> {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  // Neither format is implemented by ajv-formats. They are registered
  // permissively so that their absence cannot silently disable validation of
  // the surrounding schema; nothing here claims to check IRI or IDN syntax.
  ajv.addFormat("iri-reference", true);
  ajv.addFormat("iri", true);
  ajv.addFormat("idn-email", true);
  ajv.addFormat("idn-hostname", true);
  return ajv;
}

function compileCycloneDx() {
  const ajv = newAjv();
  // bom-1.6.schema.json $refs both of these as relative URIs, which resolve
  // against its own $id. Registering them under their declared $id is what
  // makes those references resolve.
  ajv.addSchema(JSON.parse(cyclonedxSpdxLicences) as object);
  ajv.addSchema(JSON.parse(cyclonedxJsf) as object);
  return ajv.compile(JSON.parse(bom16) as object);
}

function compileSpdx() {
  return newAjv().compile(JSON.parse(spdx23) as object);
}

const cycloneDxValidator = compileCycloneDx();
const spdxValidator = compileSpdx();

function report(validator: ReturnType<typeof compileSpdx>, document: unknown): string[] {
  if (validator(document)) return [];
  return (validator.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}

/** Returns the schema violations, so a failing test names them. Empty is valid. */
export function cycloneDx16Errors(document: unknown): string[] {
  return report(cycloneDxValidator, document);
}

export function spdx23Errors(document: unknown): string[] {
  return report(spdxValidator, document);
}
