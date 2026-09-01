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
  // ajv-formats implements no internationalised format, and registering these
  // as always-pass would quietly switch off validation of the CycloneDX fields
  // that use them. Their ASCII counterparts are used instead: every URI is an
  // IRI and every ASCII address is an IDN address, so this is strictly stronger
  // than a stub and exact for everything this project emits, which is ASCII by
  // construction. It would wrongly reject a genuinely non-ASCII IRI; nothing
  // here produces one, and a stub that accepts anything is the worse trade.
  alias(ajv, "iri-reference", "uri-reference");
  alias(ajv, "iri", "uri");
  alias(ajv, "idn-email", "email");
  alias(ajv, "idn-hostname", "hostname");
  return ajv;
}

/** Registers an existing ajv-formats validator under a second name. */
function alias(ajv: InstanceType<typeof Ajv>, name: string, existing: string): void {
  const format = ajv.formats[existing];
  if (format === undefined) throw new Error(`ajv-formats does not provide "${existing}"`);
  ajv.addFormat(name, format);
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
