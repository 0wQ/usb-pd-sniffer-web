# USB PD Sniffer Web v2

This workspace is the v2 rewrite for the USB PD sniffer host UI and parser stack.

The current priority is `pd-core-v2` correctness and an ET240-style detail view. Compatibility with the old `usb-pd-sniffer-web` project is intentionally not a goal.

## Workspace Layout

| Path | Role |
| --- | --- |
| `packages/pd-core` | Protocol-only USB PD decoder. No WebHID, host transport, table aliases, or UI projection. |
| `packages/pd-monitor` | Shared monitor-event adapter that converts firmware/HID monitor records into core input frames. |
| `packages/pd-web` | React + WebHID application that consumes `pd-core` output directly. |
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
- `pd-monitor` owns firmware monitor-event normalization.
- `pd-web` owns WebHID, capture buffers, power telemetry charts, table rendering, and detail rendering.
- Explicit context, when needed, is provided by callers; `pd-core` does not keep hidden rolling state.

## Commands

Run from `usb-pd-sniffer-web-v2`:

```bash
bun run typecheck
bun run build
bun run test
bun run web:dev
```

Package-specific checks:

```bash
bun run --cwd packages/pd-core typecheck
bun run --cwd packages/pd-core build
bun run --cwd packages/pd-web typecheck
bun run --cwd packages/pd-web build
```

## Docs

- `AGENT.md`: local implementation constraints and reference order.
- `.docs/README.md`: local documentation index.
- `.docs/planning/pd-core-v2-coverage-by-type.md`: branch-level decoder progress board.
- `.docs/planning/pd-core-v2-context-and-assemble-policy.md`: context and chunk assemble policy.
- `.docs/planning/pd-core-v2-reference-policy.md`: source/reference policy for parser work.
- `.docs/reference/pd-pdstream-format.md`: `.pdStream` format notes.
