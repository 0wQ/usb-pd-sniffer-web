# @usb-pd-sniffer/pd-device-native-hid

Device support package for the current USB PD Sniffer native HID backend.

`pd-device-native-hid` owns the host-side native HID device boundary. `pd-web` should use this package as its native HID entry point and must not parse HID report bodies or hold `HIDDevice` directly.

## Responsibilities

`pd-device-native-hid` owns:

- WebHID device lifecycle for the current native firmware device.
- Native HID report body parse/encode.
- Native HID event constants and TX command constants.
- Conversion from native HID events to upper-layer records.
- Raw PD TX command dispatch through the native firmware HID OUT report.

`pd-device-native-hid` does not own:

- React state, Zustand stores, table selection, chart buffers, or UI behavior.
- PD protocol semantic decoding. Use `@usb-pd-sniffer/pd-core` for PD packet decoding.
- CSV import/export policy. `pd-web` owns file-level import/export behavior.

## Main Interface

Use `createNativeHidDevice()` from `@usb-pd-sniffer/pd-device-native-hid`.

```ts
import { createNativeHidDevice } from '@usb-pd-sniffer/pd-device-native-hid'

const device = createNativeHidDevice()

const offRecord = device.onRecord((record) => {
  // Append to protocol capture buffer.
})

await device.connect()
await device.sendRawPd('SOP', Uint8Array.from([0x42, 0x10]))
await device.disconnect()

offRecord()
device.dispose()
```

`connect()` must be called from a user gesture because it uses WebHID device selection internally.

## NativeHidDevice

```ts
type NativeHidDevice = {
  readonly isSupported: boolean
  readonly isConnected: boolean
  readonly isConnecting: boolean
  readonly isSending: boolean
  readonly error: string | null
  readonly productName: string | null
  readonly fingerprint: string | null

  connect(): Promise<void>
  connectAuthorized(preferredFingerprint?: string | null): Promise<void>
  disconnect(): Promise<void>
  setAutoReconnect(enabled: boolean, preferredFingerprint?: string | null): void
  dispose(): void

  sendRawPd(sop: PdTxSop, payload: Uint8Array): Promise<void>
  sendHardReset(): Promise<void>
  sendCableReset(): Promise<void>
  setCCMode(config: CCModeConfig): Promise<void>

  onRecord(listener: (record: CaptureRecord) => void): () => void
}
```

### Lifecycle

- `isSupported` is `false` when `navigator.hid` is unavailable.
- `connect()` opens a user-selected native HID device using VID/PID `0x1A86:0x2333`.
- `connectAuthorized()` opens a previously authorized device without prompting, if available.
- `setAutoReconnect()` controls hotplug reconnect behavior inside the device support layer.
- `disconnect()` closes the current device.
- `dispose()` removes listeners and releases the current device reference. Call it when the owning UI/hook is torn down.

## Records

`onRecord()` emits protocol capture records for native HID events that are currently part of the PD capture path.

```ts
type CaptureRecord = {
  timestamp_us: number
  seq: number
  vbus_mv: number
  ibus_ma: number
  cc1_mv: number
  cc2_mv: number
  dp_mv: number
  dm_mv: number
  event_type: string
  active_cc: number
  data_len: number
  data: number[]
}
```

Current record emission behavior:

- `PD_SOP0`, `PD_SOP1`, `PD_SOP2`, `PD_SOP1_DEBUG`, and `PD_SOP2_DEBUG` emit records with raw PD packet bytes.
- `PD_HARD_RESET`, `PD_CABLE_RESET`, and `PD_ERROR` are accepted by the native HID path.
- `UFCS_DP` and `UFCS_DM` emit records with UFCS raw frames.
- HID may split `UFCS_DP` / `UFCS_DM` records across two consecutive reports when the raw frame is longer than 34 bytes.
- A full 34-byte UFCS HID report is held until the next report decides whether it is complete or the first split chunk.
- The second split report assembles only when it is consecutive, has the same `seq`, and has the same UFCS event type.
- Any different next record flushes the pending 34-byte UFCS report before the new record is processed.

## TX

```ts
type PdTxSop = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'
type ActiveCCMode = 'auto' | 'cc1' | 'cc2'
type CCMode = 'open' | 'rd' | 'ra' | 'rp'
type CCModeConfig = {
  activeCC: ActiveCCMode
  cc1: CCMode
  cc2: CCMode
}
```

- `sendRawPd(sop, payload)` sends raw PD packet bytes through the native firmware TX command.
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

These exports remain available for tests and tooling, but `pd-web` should prefer `createNativeHidDevice()` for live capture.

- `NATIVE_HID_EVENT`
- `NATIVE_HID_TX_CMD`
- `NATIVE_HID_REPORT_ID`
- `NATIVE_HID_REPORT_BODY_SIZE`
- `NATIVE_HID_PAYLOAD_MAX_LEN`
- `NATIVE_TX_PAYLOAD_MAX_LEN`
- `parseNativeHidReportBody(body)`
- `encodeNativeHidCommandPayload(command)`
- `encodeNativeHidTxCommandBody(command)`
- `nativeHidEventName(eventType)`
- `isPdNativeHidEvent(eventType)`
- `isUfcsNativeHidEvent(eventType)`
- `toPdObservedFrameFromNativeHidEvent(input)`

## Boundary Rules

- `pd-web` may import `createNativeHidDevice()` and public types from this package.
- `pd-web` must not use `navigator.hid`, `HIDDevice`, `sendReport()`, WebHID `reportId`, or native report byte offsets directly.
- HID report layout changes must be made in firmware native variant code and mirrored in this package's ABI parser/encoder.
- Update `docs/reference/native-hid-abi.md` whenever the native HID wire ABI changes.

## Known Follow-Ups

- Add tests around `createNativeHidDevice()` with a fake WebHID object before extending transport behavior further.
