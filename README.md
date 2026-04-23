# USB PD Sniffer Web Workspace

This workspace is intentionally split before any browser UI work starts.

Development baseline: `bun + TypeScript`.

The parser library itself is intended to stay runtime-agnostic. Bun is used as
the development toolchain here, not as a requirement for downstream users of
`@usb-pd-sniffer/pd-core`.

## Packages

- `@usb-pd-sniffer/pd-core`
  Pure TypeScript parsing library. No WebHID, no Node HID, no UI.
- `@usb-pd-sniffer/pd-cli`
  Command-line harness for fixtures and later hardware integration.

## Public Library Positioning

`@usb-pd-sniffer/pd-core` should remain a standard package:

- standard `package.json` exports
- generated `.d.ts`
- no Bun-specific runtime APIs in library code
- reusable from Bun, Node, browser bundlers, and test runners
- public API starts at observed PD frames, not HID events

## Why This Order

The main project risk is PD parsing correctness, not rendering. The parser must
be stable, testable, and reusable before a web UI consumes it.

## Initial Scope

- Freeze `pd-core` input/output contract
- Build descriptor-driven message classification
- Keep monitor/HID normalization in adapters and CLI
- Validate both fixture replay and live HID streaming

## Current Coverage

`pd-core` currently includes:

- Message Header and message-family classification
- Control/Data/Extended descriptor registries
- PDO/APDO decode
- Request and EPR_Request decode with capability-context checks
- Get_Country_Info, Enter_USB, EPR_Mode, Source_Info, Revision, Battery_Status, Alert, and BIST data object decode
- Structured/Unstructured VDM header decode
- Initial VDO families: ID Header, Cert Stat, Product, Discover SVIDs responder, generic Discover Modes Mode VDO, UFP, DFP, Passive Cable, Active Cable VDO1/VDO2, and VPD
- Generic structured/unstructured vendor-defined payload envelopes for mode-specific, SVID-specific, and otherwise opaque VDO payloads
- Extended Message Header and typed data blocks for Source_Capabilities_Extended, Sink_Capabilities_Extended, Status, Extended_Control, PPS_Status, Country_Codes, Country_Info, battery-query families, manufacturer-info families, Security/Firmware envelopes, and Vendor_Defined_Extended VDM envelopes
- Optional sequence analyzer for capability-context interpretation using latest SPR/EPR source capabilities

Recent parser-mainline refinements include:

- richer `Alert`, `Battery_Status`, `Source_Info`, and `Revision` value shapes
- richer `Country_Codes` / `Country_Info` structures for direct upper-layer consumption
- richer battery/manufacturer reference semantics in battery and manufacturer extended data blocks
- richer support-state semantics in `PPS_Status`, `Battery_Capabilities`, and `Manufacturer_Info`
- structured `Peak Current` / sink load-characteristic subfields inside Source/Sink Capabilities Extended blocks

These recent refinements improved parser utility, but they do not change the
mainline rule: future work should prioritize missing normative structure and
coverage gaps before adding more convenience-oriented derived fields.

The parser is intentionally parse-first:

- structural decode is primary
- suspicious or non-conformant values surface as non-blocking `issues`
- decoded objects still preserve `raw32` and field-level visibility

`pd-core` is not intended to grow into a protocol checker:

- parser work should prioritize field extraction and typed object modeling
- `issues` should stay focused on structural decode facts such as short payloads, reserved encodings, and directly local inconsistencies
- message-usage policing and broader protocol-correctness heuristics should not drive roadmap priority

## Current Boundaries

Current `pd-core` coverage is substantial but not complete:

- many PD 3.2 message families are decoded structurally
- some payload families remain intentionally opaque when the USB PD main specification does not define their inner fields
- external sub-specification payloads such as DisplayPort Alt Mode or Thunderbolt are not deeply decoded here
- some parser checklist items are considered complete within USB PD scope even though adjacent USB4 / Alt Mode behavior remains intentionally outside `pd-core`
- chunked Extended Message reconstruction is still deferred

## Deferred Until Transport Changes

- Full Extended Message support
- Chunked message reassembly
- Browser UI

## Quick Start

Run the sample fixture:

```bash
bun run cli:sample
bun run cli:sample:json
bun run cli:list
bun run cli:live
bun run cli:live:all
```

When TypeScript is installed in the workspace:

```bash
bun run typecheck
bun run build
```

See:

- `docs/README.md`
- `docs/spec/pd-parser-foundation.md`
- `docs/spec/pd-core-io-contract.md`
- `docs/spec/pd-schema.md`
- `docs/planning/pd-roadmap.md`
- `docs/planning/pd-core-coverage-checklist.md`
