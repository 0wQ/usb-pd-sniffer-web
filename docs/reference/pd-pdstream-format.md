# pd.pdStream Format Notes

Date: 2026-04-23

This note records the currently observed binary layout of `pd.pdStream` for future import/export compatibility work.

Scope:

- Based only on the sample file `/Users/sora/project/usb-pd-sniffer-v4/pd.pdStream`
- Cross-checked against the user-provided UI screenshot that shows the same capture source
- Not based on `.cpd` or `UCPD-Monitor` record formats
- Reverse-engineered, not an official producer specification

## Sample Facts

- File size: `2488` bytes
- Parsed cleanly as `64` concatenated records
- No file header was observed before record `0`
- Record walk reaches EOF exactly when using the layout below

## Record Boundary

Each record starts with a 4-byte big-endian word named `n` here only as a neutral placeholder.

Observed formulas:

- `payloadLen = n - 6`
- `recordLen = n + 28`

Equivalent expanded layout:

- `4` bytes: `n`
- `1` byte: `tag`
- `2` bytes: `elapsedMsLo`
- `3` bytes: event tuple
- `payloadLen` bytes: payload
- `24` bytes: trailing metrics

So:

```text
recordLen = 4 + 1 + 2 + 3 + payloadLen + 24
          = n + 28
```

## Observed Record Layout

| Offset | Size | Field | Encoding | Status |
| --- | ---: | --- | --- | --- |
| `0x00..0x03` | 4 | `n` | `u32be` | Confirmed as the length word that drives record boundaries |
| `0x04` | 1 | `tag` | `u8` | Partially understood |
| `0x05..0x06` | 2 | `elapsedMsLo` | `u16le` | Confirmed as low 16 bits of elapsed milliseconds |
| `0x07` | 1 | `eventAux0` | `u8` | Meaning not fully confirmed |
| `0x08` | 1 | `eventAux1` | `u8` | Meaning not fully confirmed |
| `0x09` | 1 | `eventType` | `u8` | Partially understood |
| `0x0A..` | `payloadLen` | `payload` | raw bytes | Confirmed |
| `payloadEnd + 0x00..0x07` | 8 | `timeSeconds` | `f64be` | Confirmed |
| `payloadEnd + 0x08..0x0F` | 8 | `vbusVolts` | `f64be` | Confirmed |
| `payloadEnd + 0x10..0x17` | 8 | `ibusAmps` | `f64be` | Confirmed |

## `tag` Byte

Observed values in the sample:

- `0x45`
- `0x87`
- `0x8b`
- `0x93`
- `0x9b`
- `0xa3`

Confirmed rule:

```text
tag & 0x3f == n - 1
```

Equivalent form:

```text
payloadLen == (tag & 0x3f) - 5
```

Observed high-bit groups:

- `tag & 0xc0 == 0x40`: zero-payload event records
- `tag & 0xc0 == 0x80`: records carrying PD payload bytes

The exact semantic meaning of the high bits is still unconfirmed. For compatibility work, treat the low 6 bits as redundant length encoding and preserve the full raw byte on export.

## Time Fields

Two different time representations are present.

### `elapsedMsLo`

- Stored at `0x05..0x06`
- `u16le`
- Matches the low 16 bits of elapsed milliseconds

Evidence:

- Record `0`: `0x13f8 = 5112`, matches `5.112 s`
- Final record: `timeSeconds = 67.806`, `elapsedMsLo = 2270`
- `67806 mod 65536 = 2270`

This means `elapsedMsLo` is not a full timestamp and will wrap.

### `timeSeconds`

- Stored in the trailing metrics area
- `f64be`
- Matches the full elapsed timestamp seen in the source UI

For importers, `timeSeconds` should be treated as the canonical timestamp.

## Event Tuple

The three bytes at offsets `0x07..0x09` are better treated as an event tuple than as one 24-bit integer.

Observed values:

- PD payload rows:
  - `00 00 00`
  - `00 00 01`
- Zero-payload event rows:
  - `00 00 21`
  - `00 00 22`
  - `01 00 22`

Strong correlations from the sample plus screenshot:

- `eventType = 0x21`: attach-like event
- `eventType = 0x22`: detach-like event
- `eventType = 0x01`: the rows shown as `SOP1` in the source UI
- `eventType = 0x00`: the rows shown as `SOP` in the source UI

What remains unconfirmed:

- Whether `eventType 0x00/0x01` mean pure SOP class, or a broader producer-specific channel enum
- Why the final detach record uses `eventAux0 = 0x01` while the earlier detach uses `0x00`
- Whether other captures can contain additional event tuple values for `SOP2`, debug, errors, or telemetry

For compatibility work, preserve all three event bytes even when only `eventType` is currently interpreted.

## Payload Bytes

In this sample, the payload region behaves like raw PD message bytes without stored CRC32.

Evidence:

- `8f1001a800ff` has length `6`, which matches `2-byte header + 1 data object`
- `8f5141a000ff5d2c0018000000000000000042200800` has length `22`, which matches `2-byte header + 5 data objects`
- `84322c9101262cd10200e1c00300` has length `14`, which matches `2-byte header + 3 data objects`

If CRC32 were stored in the payload, each of the examples above would be `4` bytes longer.

### Screenshot CRC vs file payload

The source UI screenshot shows a CRC value for:

- payload: `8F 10 01 A8 00 FF`
- displayed CRC: `0x7C11141C`

CRC32 computed directly from those `6` payload bytes is also `0x7C11141C`.

This strongly suggests:

- the source UI can calculate and display CRC32 from the payload bytes
- the file itself does not need to store the CRC bytes for that UI to show them

Current compatibility assumption:

- importer: treat payload as CRC-free unless future `pd.pdStream` samples prove otherwise
- exporter: if targeting this exact observed format, do not append CRC32 inside `payload`

## Trailing Metrics

The last `24` bytes of each record decode cleanly as three big-endian doubles:

1. `timeSeconds`
2. `vbusVolts`
3. `ibusAmps`

Example: record `1` at offset `34`

- payload: `8f1001a800ff`
- `timeSeconds = 5.443`
- `vbusVolts = 4.998`
- `ibusAmps = 0.012`

These values match the screenshot's elapsed time and `VBUS/IBUS` columns.

## Worked Examples

### Record 0

Offset `0`

```text
00 00 00 06 45 f8 13 00 00 21
40 14 72 b0 20 c4 9b a6
3f 68 93 74 bc 6a 7e fa
00 00 00 00 00 00 00 00
```

Decoded:

- `n = 6`
- `payloadLen = 0`
- `tag = 0x45`
- `elapsedMsLo = 5112`
- event tuple = `00 00 21`
- `timeSeconds = 5.112`
- `vbusVolts = 0.003`
- `ibusAmps = 0.000`

### Record 1

Offset `34`

```text
00 00 00 0c 8b 43 15 00 00 01
8f 10 01 a8 00 ff
40 15 c5 a1 ca c0 83 12
40 13 fd f3 b6 45 a1 cb
3f 88 93 74 bc 6a 7e fa
```

Decoded:

- `n = 12`
- `payloadLen = 6`
- `tag = 0x8b`
- `elapsedMsLo = 5443`
- event tuple = `00 00 01`
- payload = `8f1001a800ff`
- `timeSeconds = 5.443`
- `vbusVolts = 4.998`
- `ibusAmps = 0.012`

### Record 3

Offset `110`

Decoded:

- `n = 28`
- `payloadLen = 22`
- `tag = 0x9b`
- event tuple = `00 00 01`
- payload = `8f5141a000ff5d2c0018000000000000000042200800`
- `timeSeconds = 5.446`
- `vbusVolts = 4.998`
- `ibusAmps = 0.012`

## Import Guidance

For a first compatible importer:

1. Treat the file as a concatenation of variable-length records with no file header.
2. Read `n` as `u32be`.
3. Reject or flag records where `n < 6`.
4. Compute `payloadLen = n - 6`.
5. Compute `recordLen = n + 28`.
6. Ensure the record stays within file bounds before reading tail doubles.
7. Soft-validate `tag & 0x3f == n - 1`.
8. Parse `elapsedMsLo` as diagnostic data only.
9. Parse the event tuple as raw bytes and keep unknown values visible.
10. Parse the trailing `24` bytes as `f64be` metrics.
11. Do not assume payload contains CRC32 bytes.

## Export Guidance

For a first compatible exporter:

1. Preserve the raw event tuple bytes when round-tripping.
2. Preserve `tag` exactly when rewriting an existing record.
3. If synthesizing new records, set:
   - `n = payloadLen + 6`
   - low 6 bits of `tag` to `n - 1`
4. Write `elapsedMsLo` as the low 16 bits of elapsed milliseconds if a producer-compatible value is needed.
5. Write `timeSeconds`, `vbusVolts`, and `ibusAmps` as big-endian doubles.
6. Do not append CRC32 to the payload unless future captures show that another producer variant stores it.

## Open Questions

- Exact producer meaning of `tag` high bits
- Exact semantics of `eventAux0` and `eventAux1`
- Whether `eventType 0x00` and `0x01` are SOP classes only, or direction-aware channel identifiers
- Whether other `pd.pdStream` files can contain debug rows, reset rows, errors, or power-only rows in this same envelope
- Whether any producer variant stores CRC32 in payload for special record classes not present in this sample

Until more samples appear, compatibility code should keep the parser permissive and preserve raw bytes for unresolved fields.
