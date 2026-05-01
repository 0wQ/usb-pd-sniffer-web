# Native HID ABI

This document records the current USB HID wire ABI shared by the native firmware variant and host software.

It is intentionally a reference document, not a planning document. Update it in the same change whenever the firmware report layout, monitor event numbers, or host parser constants change.

## Scope

- Firmware source of truth: `usb-pd-sniffer-firmware/src/usb_device/variant/usb_variant_native.c`
- Host source of truth: `packages/pd-monitor/src/monitorAdapter.ts`
- Native USB VID/PID: `0x1A86:0x2333`
- Native WebHID `reportId`: `0`
- Native HID IN report body size: `64` bytes
- Native HID OUT report body size: `64` bytes
- Native HID reports do not carry an explicit HID Report ID byte in the body.

## Native IN Report Body

All integer fields are little-endian. Signed current fields are two's-complement little-endian.

| Offset | Size | Field | Type | Unit | Notes |
| ---: | ---: | --- | --- | --- | --- |
| 0 | 4 | `timestamp_us_lo` | `uint32` | us | Low 32 bits of firmware timestamp in microseconds. |
| 4 | 4 | `timestamp_us_hi` | `uint32` | us | High 32 bits of firmware timestamp in microseconds. |
| 8 | 4 | `recv_count` | `uint32` | count | Monitor event receive counter. |
| 12 | 2 | `vbus_mv` | `uint16` | mV | VBUS voltage. |
| 14 | 2 | `ibus_ma` | `int16` | mA | Signed bus current. |
| 16 | 2 | `cc1_mv` | `uint16` | mV | CC1 voltage. |
| 18 | 2 | `cc2_mv` | `uint16` | mV | CC2 voltage. |
| 20 | 2 | `dp_mv` | `uint16` | mV | D+ voltage. |
| 22 | 2 | `dm_mv` | `uint16` | mV | D- voltage. |
| 24 | 1 | `event_type` | `uint8` | enum | See monitor event table below. |
| 25 | 1 | `pd_active_cc` | `uint8` | enum | `0` unknown, `1` CC1, `2` CC2. |
| 26 | 1 | `payload_len` | `uint8` | bytes | Clamped to 34 bytes by host parser. |
| 27 | 34 | `payload` | `uint8[34]` | bytes | PD/UFCS payload bytes. Unused tail is zero-filled by firmware. |
| 61 | 3 | `reserved` | `uint8[3]` | bytes | Reserved. Currently zero because firmware zero-initializes the report before filling fields. |

Host parser output combines `timestamp_us_hi` and `timestamp_us_lo` into a single `timestampUs` number.

## Native OUT Report Body

All native OUT commands use a fixed 64-byte body.

| Offset | Size | Field | Type | Notes |
| ---: | ---: | --- | --- | --- |
| 0 | 1 | `opcode` | `uint8` | Native monitor TX command. `0` is ignored by firmware. |
| 1 | 1 | `len` | `uint8` | Payload length. Raw PD TX accepts `2..34`. Reset commands require `0`. `SET_CC_MODE` uses `3`. |
| 2 | 62 | `payload` | `uint8[62]` | Raw command payload. For raw PD TX only the first `len` bytes are used. For `SET_CC_MODE`, bytes 2..4 are active CC, CC1 mode, CC2 mode. |

Native OUT opcodes:

| Opcode | Name | Payload |
| ---: | --- | --- |
| `0x01` | `SEND_RAW_SOP0` | Raw PD packet bytes for SOP. |
| `0x02` | `SEND_RAW_SOP1` | Raw PD packet bytes for SOP'. |
| `0x03` | `SEND_RAW_SOP2` | Raw PD packet bytes for SOP''. |
| `0x04` | `SEND_HARD_RESET` | Empty. |
| `0x05` | `SEND_CABLE_RESET` | Empty. |
| `0x10` | `SET_CC_MODE` | Three bytes: active CC, CC1 mode, CC2 mode. |

`SET_CC_MODE` active CC values:

| Value | Name |
| ---: | --- |
| `0x00` | `AUTO` |
| `0x01` | `CC1` |
| `0x02` | `CC2` |

`SET_CC_MODE` CC mode values:

| Value | Name |
| ---: | --- |
| `0x00` | `OPEN` |
| `0x01` | `RD` |
| `0x02` | `RA` |
| `0x03` | `RP` |

Raw PD TX payloads are expected to include the PD packet bytes required by the firmware TX path. The host does not synthesize CRC32 in this ABI layer.

## Monitor Events

These values must stay aligned between firmware `monitor_event_type_t` and host `MONITOR_EVENT`.

| Value | Name | Meaning | Payload |
| ---: | --- | --- | --- |
| `0` | `DISCONNECT` | Disconnected. | Empty. |
| `1` | `CC1_CONNECT` | CC1 connected. | Empty. |
| `2` | `CC2_CONNECT` | CC2 connected. | Empty. |
| `10` | `POWER_TELEMETRY` | Idle-gap power telemetry. | Empty. |
| `20` | `PD_SOP0` | PD SOP packet. | Raw PD packet bytes. |
| `21` | `PD_SOP1` | PD SOP' packet. | Raw PD packet bytes. |
| `22` | `PD_SOP2` | PD SOP'' packet. | Raw PD packet bytes. |
| `23` | `PD_SOP1_DEBUG` | PD SOP' Debug packet. | Raw PD packet bytes. |
| `24` | `PD_SOP2_DEBUG` | PD SOP'' Debug packet. | Raw PD packet bytes. |
| `25` | `HARD_RESET` | PD Hard Reset. | Empty. |
| `26` | `CABLE_RESET` | PD Cable Reset. | Empty. |
| `30` | `PD_ERROR` | PD PHY error. | Firmware-defined error payload or empty. |
| `31` | `BUFFER_OVERFLOW` | Monitor buffer overflow. | Empty. |
| `40` | `UFCS_DP_SINGLE` | UFCS D+ single packet. | Raw UFCS bytes, max 34. |
| `41` | `UFCS_DM_SINGLE` | UFCS D- single packet. | Raw UFCS bytes, max 34. |
| `42` | `UFCS_DP_CHUNK0` | UFCS D+ chunk 0. | Raw UFCS chunk bytes. |
| `43` | `UFCS_DM_CHUNK0` | UFCS D- chunk 0. | Raw UFCS chunk bytes. |
| `44` | `UFCS_DP_CHUNK1` | UFCS D+ chunk 1. | Raw UFCS chunk bytes. |
| `45` | `UFCS_DM_CHUNK1` | UFCS D- chunk 1. | Raw UFCS chunk bytes. |

The web CSV import/export format may choose to reject chunked UFCS events, but the native HID ABI still reserves event numbers for them because firmware can emit them.

## Host Responsibilities

- WebHID must call `sendReport(0, body)` for native OUT commands.
- WebHID input must reject non-zero `reportId` for native devices.
- Host code must use `@usb-pd-sniffer/pd-monitor` for native HID constants and native report parsing instead of duplicating byte offsets in `pd-web`.
- Host code must treat `payload_len` as the authoritative valid payload length and ignore zero padding after `payload_len`.
- Host code must not infer PD direction from `event_type`; native monitor events are direction-neutral observations.

## K2 Variant Contrast

The K2 variant is also a 64-byte no-Report-ID HID body, but it is not the native ABI.

- K2 USB VID/PID: `0x0716:0x5060`
- K2 PD report marker: byte `0` is `0xFE`
- K2 general report marker: byte `0` is `0xFF`
- K2 report body includes compatibility fields and checksums at byte `62` and byte `63`.
- K2 formatting stays in `usb-pd-sniffer-firmware/src/usb_device/variant/usb_variant_k2.c` and should not leak into native host parsing.
