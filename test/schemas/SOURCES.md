# Vendored schemas

The SBOM serialisers are validated against the published schemas, not against
hand-written assertions about the shape of their output. The schemas are
committed here so the test suite runs offline and so an upstream change arrives
as a reviewable diff.

Regenerate with `npm run fetch-schemas`. Fetched 2026-09-01.

## `bom-1.6.schema.json`

CycloneDX 1.6.

- Source: <https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/bom-1.6.schema.json>
- Bytes: 252625
- sha256: `3e92dddbc30cf7f6a02b80f0942b1a4cfd4fb1c26f1dfc4310afa9d613cafb93`

## `spdx.schema.json`

Referenced by bom-1.6.schema.json for SPDX licence identifiers. Not the SPDX document schema.

- Source: <https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/spdx.schema.json>
- Bytes: 14269
- sha256: `baa9d3bd1ed57b6751b0887edead6b5063ff53ff7429cf85d476c6c94af0166e`

## `jsf-0.82.schema.json`

Referenced by bom-1.6.schema.json for JSON signatures.

- Source: <https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/jsf-0.82.schema.json>
- Bytes: 8058
- sha256: `8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae`

## `spdx-2.3.schema.json`

SPDX 2.3, from the v2.3 tag of the specification repository.

- Source: <https://raw.githubusercontent.com/spdx/spdx-spec/refs/tags/v2.3/schemas/spdx-schema.json>
- Bytes: 45304
- sha256: `239208b7ac287b3cf5d9a9af23f9d69863971102a5e1587a27a398b43490b89b`
