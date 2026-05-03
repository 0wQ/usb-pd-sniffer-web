# USB PD Sniffer Web v2

This workspace is the v2 rewrite for the USB PD sniffer host UI and parser stack.

The current priority is `pd-core-v2` correctness and an ET240-style detail view. Compatibility with the old `usb-pd-sniffer-web` project is intentionally not a goal.

## Workspace Layout

| Path | Role |
| --- | --- |
| `packages/pd-core` | Protocol-only USB PD decoder. No WebHID, host transport, table aliases, or UI projection. |
| `packages/pd-device-native-hid` | Native WebHID device backend and native monitor-event helpers. |
| `packages/pd-device-native-cdc` | Native CDC/Web Serial device backend for the same monitor protocol over byte-stream frames. |
| `packages/pd-device-atk-c2` | ATK C2 WebUSB capture backend that emits monitor-shaped records. |
| `packages/pd-web` | React browser application that consumes `pd-core` output directly. |
| `.docs/planning` | Local scope, policy, and decoder coverage tracking. |
| `.docs/reference` | Local format notes for external files and host-facing compatibility. |

## Current MVP State

`pd-core` currently exposes an explain-first model:

- `DecodedMessage`
- `sections[]`
- `Section.fields[]`
- `Section.issues[]`

The web app renders these sections generically in `DecodeCard`; it should not add protocol-specific projections for message payload meaning.

Major completed branches include:

- Message Header and Extended Message Header bit-level decode
- Control message identification
- Source/Sink Capabilities and EPR Source/Sink Capabilities PDO decode
- Request and EPR_Request decode
- common Data Messages such as Alert, Battery_Status, BIST, Enter_USB, EPR_Mode, Source_Info, Revision, and Get_Country_Info
- common Extended Messages such as Status, PPS_Status, Source/Sink Capabilities Extended, Country_Info, Country_Codes, battery/manufacturer families, and Extended_Control
- named raw data block output for Security and Firmware Update families

Known post-MVP branches are tracked in `.docs/planning/pd-core-v2-coverage-by-type.md`.

## Package Boundaries

- `pd-core` stays protocol-only and parse-first.
- `pd-device-native-hid` owns native WebHID lifecycle, native HID ABI handling, and firmware monitor-event normalization.
- `pd-device-native-cdc` owns native CDC/Web Serial lifecycle and native CDC frame handling.
- `pd-device-atk-c2` owns ATK C2 WebUSB lifecycle and capture decoding into monitor-shaped records.
- `pd-web` owns browser UI state, capture buffers, power telemetry charts, table rendering, and detail rendering.
- Explicit context, when needed, is provided by callers; `pd-core` does not keep hidden rolling state.

## Commands

Run from `usb-pd-sniffer-web-v2`:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm web:dev
```

Package-specific checks:

```bash
pnpm -C packages/pd-core typecheck
pnpm -C packages/pd-core build
pnpm -C packages/pd-device-native-hid typecheck
pnpm -C packages/pd-device-native-cdc typecheck
pnpm -C packages/pd-device-atk-c2 typecheck
pnpm -C packages/pd-web typecheck
pnpm -C packages/pd-web build
```

## Docs

- `AGENT.md`: local implementation constraints and reference order.
- `.docs/README.md`: local documentation index.
- `.docs/planning/pd-core-v2-coverage-by-type.md`: branch-level decoder progress board.
- `.docs/planning/pd-core-v2-context-and-assemble-policy.md`: context and chunk assemble policy.
- `.docs/planning/pd-core-v2-reference-policy.md`: source/reference policy for parser work.
- `docs/reference/native-hid-abi.md`: native HID wire ABI.
- `docs/reference/native-cdc-abi.md`: native CDC frame ABI.
