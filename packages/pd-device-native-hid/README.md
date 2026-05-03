# @usb-pd-sniffer/pd-device-native-hid

Device support package for the current USB PD Sniffer native firmware monitor.

`pd-device-native-hid` owns the host-side native HID monitor device boundary. `pd-web` should use this package as its native HID entry point and must not parse HID report bodies or hold `HIDDevice` directly.

## Responsibilities

`pd-device-native-hid` owns:

- WebHID device lifecycle for the current native firmware device.
- Native HID report body parse/encode.
- Native monitor event constants and TX command constants.
- Conversion from native monitor events to upper-layer records and power samples.
- Raw PD TX command dispatch through the native firmware HID OUT report.

`pd-device-native-hid` does not own:

- React state, Zustand stores, table selection, chart buffers, or UI behavior.
- PD protocol semantic decoding. Use `@usb-pd-sniffer/pd-core` for PD packet decoding.
- CSV import/export policy. `pd-web` owns file-level import/export behavior.

## Main Interface

Use `createMonitorDevice()` from `@usb-pd-sniffer/pd-device-native-hid`.

```ts
import { createMonitorDevice } from '@usb-pd-sniffer/pd-device-native-hid'

const device = createMonitorDevice()

const offRecord = device.onRecord((record) => {
  // Append to protocol capture buffer.
})

const offPower = device.onPowerSample((sample) => {
  // Append to the power sample buffer if recording is enabled.
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
  setCCMode(config: MonitorCCModeConfig): Promise<void>

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
  data_len: number
  data: number[]
}
```

Current record emission behavior:

- `PD_SOP0`, `PD_SOP1`, `PD_SOP2`, `PD_SOP1_DEBUG`, and `PD_SOP2_DEBUG` emit records with raw PD packet bytes.
- `HARD_RESET`, `CABLE_RESET`, and `PD_ERROR` are accepted by the monitor path.
- `UFCS_DP` and `UFCS_DM` emit records with UFCS raw frames.
- HID may split `UFCS_DP` / `UFCS_DM` records across two consecutive reports when the raw frame is longer than 34 bytes.
- A full 34-byte UFCS HID report is held until the next report decides whether it is complete or the first split chunk.
- The second split report assembles only when it is consecutive, has the same `recv_counter`, and has the same UFCS event type.
- Any different next record flushes the pending 34-byte UFCS report before the new record is processed.

## Power Samples

`onPowerSample()` emits snapshot samples derived from native EVENT reports and HID `GET_STATUS` snapshots.

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

The device layer emits power samples whenever firmware sends a monitor event or replies to a HID status poll. UI/store code decides whether to record them based on user settings.

## TX

```ts
type MonitorPdTxTarget = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'
type MonitorActiveCCMode = 'auto' | 'cc1' | 'cc2'
type MonitorCCMode = 'open' | 'rd' | 'ra' | 'rp'
type MonitorCCModeConfig = {
  activeCC: MonitorActiveCCMode
  cc1: MonitorCCMode
  cc2: MonitorCCMode
}
```

- `sendRawPd(target, payload)` sends raw PD packet bytes through the native firmware TX command.
- `sendHardReset()` sends a native Hard Reset command.
- `sendCableReset()` sends a native Cable Reset command.
- `setCCMode({ activeCC, cc1, cc2 })` applies active CC auto/force selection and independent CC Open / Rd / Ra / Rp state.
- Only one TX command may be in flight at a time.

Use `parsePdHexPayload()` if UI code needs to convert user-entered hex into bytes before calling `sendRawPd()`.

```ts
import { parsePdHexPayload } from '@usb-pd-sniffer/pd-device-native-hid'

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
- `encodeNativeMonitorCommandPayload(command)`
- `encodeNativeMonitorTxCommandBody(command)`
- `monitorEventName(eventType)`
- `isPdMonitorEvent(eventType)`
- `isUfcsMonitorEvent(eventType)`
- `toPdObservedFrameFromMonitorEvent(input)`

## Boundary Rules

- `pd-web` may import `createMonitorDevice()` and public types from this package.
- `pd-web` must not use `navigator.hid`, `HIDDevice`, `sendReport()`, WebHID `reportId`, or native report byte offsets directly.
- HID report layout changes must be made in firmware native variant code and mirrored in this package's ABI parser/encoder.
- Update `docs/reference/native-hid-abi.md` whenever the native HID wire ABI changes.

## Known Follow-Ups

- Add tests around `createMonitorDevice()` with a fake WebHID object before extending transport behavior further.
