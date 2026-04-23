# pd-core-v2 Reference Policy

Date: 2026-04-23

This note records the source priority for future `pd-core-v2` decoder work.

## Source Priority

1. `/.tmp/USB_PD_R3_2_V1.1_2024-10.txt`

   Use this as the primary source for protocol names, field names, bit ranges, normative wording, reserved-bit behavior, units, and explanatory descriptions.

2. `/.tmp/USB_PD_Parser_API_Py`

   Use this to cross-check how message payloads are practically split into objects and fields. It is useful when implementing parser coverage, especially PDO/RDO/VDM/Extended payload decoding.

3. `/.tmp/UCPD-Monitor`

   Use this only as a tertiary implementation reference. It can help validate practical UI/parser choices, but do not copy its host-record envelope or display-tree model into `pd-core-v2`.

## Decoder Rules

- `pd-core-v2` owns protocol decoding only. It should not expose UI rows, table labels, host transport records, or product-specific presentation models.
- Field labels and notes should follow the USB PD specification terms unless there is a clear reason to normalize spelling or casing.
- If the specification text extraction conflicts with other sources, prefer the normative table/section meaning and cross-check with `USB_PD_Parser_API_Py`.
- If a field needs context to resolve uniquely, output explicit candidate interpretations instead of guessing.
- `UCPD-Monitor` names and summaries may be useful, but must be checked against the spec before migration.
- Reserved or deprecated fields should remain visible as fields and should add non-blocking issues when their raw value violates the spec.

## Current Direction

The output model remains:

- `DecodedMessage`
- `sections[]`
- `Section.fields[]`
- `Section.issues[]`

This is intended to support ET240-style protocol explanation in web without adding message-specific UI projections.
