# USB PD Sniffer Web

`pd-web` is the browser UI for `usb-pd-sniffer-web-v2`.

It owns browser UI state, capture buffers, protocol table rendering, generic decode detail rendering, power telemetry display, and PD transmit controls. Native device access is delegated to `@usb-pd-sniffer/pd-monitor`. Protocol payload meaning should come from `@usb-pd-sniffer/pd-core`, not from view-layer special cases.

## Source Layout

| Path | Role |
| --- | --- |
| `src/components/card` | Protocol table and decode detail cards. |
| `src/components/common` | Shared app chrome, dialogs, masks, and navigation widgets. |
| `src/components/pages` | Page-level components such as the power telemetry page. |
| `src/components/power` | Power telemetry chart components and chart-specific styles. |
| `src/hooks` | Browser lifecycle hooks and monitor-device subscriptions. |
| `src/lib/analyzer` | Capture decode adapters, context selection, TX preview, and generic bit-view helpers. |
| `src/stores` | Zustand device/capture state. |
| `src/types` | Web app data types. |
| `src/utils` | App-local utilities such as CSV helpers. |

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm build
pnpm lint
```

Run these through the workspace when possible:

```bash
pnpm -C packages/pd-web typecheck
pnpm -C packages/pd-web build
```
