# @usb-pd-sniffer/pd-monitor

Device support package for the current USB PD Sniffer native firmware monitor.

`pd-monitor` owns the host-side native monitor device boundary. `pd-web` should use this package as its only device entry point and must not parse HID report bodies or hold `HIDDevice` directly.

## Responsibilities

`pd-monitor` owns:

- WebHID device lifecycle for the current native firmware device.
- Native HID report body parse/encode.
- Native monitor event constants and TX command constants.
- Conversion from native monitor events to upper-layer records and power samples.
- Raw PD TX command dispatch through the native firmware HID OUT report.

`pd-monitor` does not own:

- React state, Zustand stores, table selection, chart buffers, or UI behavior.
- PD protocol semantic decoding. Use `@usb-pd-sniffer/pd-core` for PD packet decoding.
- CSV import/export policy. `pd-web` owns file-level import/export behavior.

## Main Interface

Use `createMonitorDevice()` from `@usb-pd-sniffer/pd-monitor`.

```ts
import { createMonitorDevice } from '@usb-pd-sniffer/pd-monitor'

const device = createMonitorDevice()

const offRecord = device.onRecord((record) => {
  // Append to protocol capture buffer.
})

const offPower = device.onPowerSample((sample) => {
  // Append to power telemetry buffer if recording is enabled.
})

const offStatus = device.onStatus((status) => {
  // Mirror connection/sending/error state into UI state.
})

await device.connect()
await device.sendRawPd('SOP', Uint8Array.from([0x42, 0x10]))
await device.disconnect()

offRecord()
offPower()
offStatus()
device.dispose()
```

`connect()` must be called from a user gesture because it uses WebHID device selection internally.

## MonitorDevice

```ts
type MonitorDevice = {
  readonly isSupported: boolean

  connect(): Promise<void>
  connectAuthorized(preferredFingerprint?: string | null): Promise<void>
  disconnect(): Promise<void>
  setAutoReconnect(enabled: boolean, preferredFingerprint?: string | null): void
  dispose(): void

  sendRawPd(target: MonitorPdTxTarget, payload: Uint8Array): Promise<void>
  sendHardReset(): Promise<void>
  sendCableReset(): Promise<void>

  onRecord(listener: (record: MonitorRecord) => void): () => void
  onPowerSample(listener: (sample: MonitorPowerSample) => void): () => void
  onStatus(listener: (status: MonitorDeviceStatus) => void): () => void
}
```

### Lifecycle

- `isSupported` is `false` when `navigator.hid` is unavailable.
- `connect()` opens a user-selected native monitor device using VID/PID `0x1A86:0x2333`.
- `connectAuthorized()` opens a previously authorized device without prompting, if available.
- `setAutoReconnect()` controls hotplug reconnect behavior inside the device support layer.
- `disconnect()` closes the current device.
- `dispose()` removes listeners and releases the current device reference. Call it when the owning UI/hook is torn down.

### Status

`onStatus()` immediately invokes the listener with the current status and then emits updates.

```ts
type MonitorDeviceStatus = {
  readonly isSupported: boolean
  readonly isConnected: boolean
  readonly isConnecting: boolean
  readonly isSending: boolean
  readonly error: string | null
  readonly productName: string | null
  readonly fingerprint: string | null
}
```

The `fingerprint` is stable enough for choosing a previously authorized device in this app. It is currently built from VID, PID, and product name.

## Records

`onRecord()` emits protocol capture records for native monitor events that are currently part of the PD monitor path.

```ts
type MonitorRecord = {
  timestamp_us: number
  recv_counter: number
  drop_count?: number
  vbus_mv: number
  ibus_ma: number
  cc1_mv: number
  cc2_mv: number
  dp_mv: number
  dm_mv: number
  event_type: number
  active_cc: number
  pd_data_len: number
  pd_raw: number[]
}
```

`pd_data_len` and `pd_raw` are legacy field names preserved for the current `pd-web` store. They should be renamed to `data_len` and `data` in a later web-wide record cleanup.

Current record emission behavior:

- `PD_SOP0`, `PD_SOP1`, `PD_SOP2`, `PD_SOP1_DEBUG`, and `PD_SOP2_DEBUG` emit records with raw PD packet bytes.
- `HARD_RESET`, `CABLE_RESET`, and `PD_ERROR` are accepted by the monitor path.
- `POWER_TELEMETRY` emits through `onPowerSample()`, not `onRecord()`.
- UFCS event constants exist in the ABI, but UFCS single/chunk record emission and chunk assembly are not complete yet.

## Power Samples

`onPowerSample()` emits native `POWER_TELEMETRY` reports.

```ts
type MonitorPowerSample = {
  timestamp_us: number
  recv_counter: number
  vbus_mv: number
  ibus_ma: number
  cc1_mv: number
  cc2_mv: number
  dp_mv: number
  dm_mv: number
  active_cc: number
  event_type: number
}
```

The device layer emits power samples whenever firmware sends them. UI/store code decides whether to record them based on user settings.

## TX

```ts
type MonitorPdTxTarget = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'
```

- `sendRawPd(target, payload)` sends raw PD packet bytes through the native firmware TX command.
- `sendHardReset()` sends a native Hard Reset command.
- `sendCableReset()` sends a native Cable Reset command.
- Only one TX command may be in flight at a time.

Use `parsePdHexPayload()` if UI code needs to convert user-entered hex into bytes before calling `sendRawPd()`.

```ts
import { parsePdHexPayload } from '@usb-pd-sniffer/pd-monitor'

await device.sendRawPd('SOP', parsePdHexPayload('42 10 aa bb'))
```

## Low-Level ABI Helpers

These exports remain available for tests and tooling, but `pd-web` should prefer `createMonitorDevice()` for live capture.

- `MONITOR_EVENT`
- `MONITOR_TX_CMD`
- `NATIVE_HID_REPORT_ID`
- `NATIVE_HID_REPORT_BODY_SIZE`
- `NATIVE_MONITOR_PAYLOAD_MAX_LEN`
- `NATIVE_TX_PAYLOAD_MAX_LEN`
- `parseNativeMonitorHidReportBody(body)`
- `encodeNativeMonitorTxCommandBody(command)`
- `monitorEventName(eventType)`
- `isPdMonitorEvent(eventType)`
- `toPdObservedFrameFromMonitorEvent(input)`

## Boundary Rules

- `pd-web` may import `createMonitorDevice()` and public types from this package.
- `pd-web` must not use `navigator.hid`, `HIDDevice`, `sendReport()`, WebHID `reportId`, or native report byte offsets directly.
- HID report layout changes must be made in firmware native variant code and mirrored in this package's ABI parser/encoder.
- Update `docs/reference/native-hid-abi.md` whenever the native HID wire ABI changes.

## Known Follow-Ups

- Assemble UFCS chunk reports inside `pd-monitor` so `pd-web` only sees complete UFCS records.
- Rename `MonitorRecord.pd_raw` / `MonitorRecord.pd_data_len` to `data` / `data_len` after the web store and CSV paths are migrated.
- Add tests around `createMonitorDevice()` with a fake WebHID object before extending transport behavior further.

