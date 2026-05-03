# Native HID ABI

This document records the current USB HID wire ABI shared by the native firmware variant and host software.

## Scope

- Firmware source of truth: `usb-pd-sniffer-firmware/src/transports/usb/variant/native_hid.c`
- Host source of truth: `packages/pd-device-native-hid/src/monitorAdapter.ts`
- Native USB VID/PID: `0x1A86:0x2333`
- Native WebHID `reportId`: `0`
- Native HID IN report body size: `64` bytes
- Native HID OUT report body size: `64` bytes

All multi-byte fields are little-endian. Signed current fields are two's-complement little-endian.

## Native IN Report Body

Byte `0` is an application-layer `report_type`, not a USB HID Report ID.

| Value | Name | Meaning |
| ---: | --- | --- |
| `0x01` | `EVENT` | Monitor event report |
| `0x02` | `STATUS` | Host-requested status snapshot |

### EVENT report

| Offset | Size | Field | Type | Unit | Notes |
| ---: | ---: | --- | --- | --- | --- |
| 0 | 1 | `report_type` | `uint8` | - | Fixed `0x01` |
| 1 | 1 | `event_type` | `uint8` | enum | `monitor_event_type_t` |
| 2 | 1 | `payload_len` | `uint8` | bytes | Clamped to 34 by the host parser |
| 3 | 1 | `active_cc` | `uint8` | enum | `0` none, `1` CC1, `2` CC2 |
| 4 | 4 | `timestamp_us_lo` | `uint32` | us | Low 32 bits of timestamp |
| 8 | 4 | `timestamp_us_hi` | `uint32` | us | High 32 bits of timestamp |
| 12 | 4 | `recv_count` | `uint32` | count | Monitor queue sequence |
| 16 | 2 | `vbus_mv` | `uint16` | mV | VBUS voltage |
| 18 | 4 | `ibus_ua` | `int32` | uA | Signed bus current |
| 22 | 2 | `cc1_mv` | `uint16` | mV | CC1 voltage |
| 24 | 2 | `cc2_mv` | `uint16` | mV | CC2 voltage |
| 26 | 2 | `dp_mv` | `uint16` | mV | D+ voltage |
| 28 | 2 | `dm_mv` | `uint16` | mV | D- voltage |
| 30 | 34 | `payload` | `uint8[34]` | bytes | Event payload bytes |

### STATUS report

`GET_STATUS` returns one STATUS report.

| Offset | Size | Field | Type | Unit | Notes |
| ---: | ---: | --- | --- | --- | --- |
| 0 | 1 | `report_type` | `uint8` | - | Fixed `0x02` |
| 1 | 1 | `status_type` | `uint8` | - | Currently `0x00` |
| 2 | 1 | `payload_len` | `uint8` | bytes | Currently `4` |
| 3 | 1 | `active_cc` | `uint8` | enum | `0` none, `1` CC1, `2` CC2 |
| 4 | 4 | `timestamp_us_lo` | `uint32` | us | Low 32 bits of timestamp |
| 8 | 4 | `timestamp_us_hi` | `uint32` | us | High 32 bits of timestamp |
| 12 | 4 | `recv_count` | `uint32` | count | Current monitor queue sequence |
| 16 | 2 | `vbus_mv` | `uint16` | mV | VBUS voltage |
| 18 | 4 | `ibus_ua` | `int32` | uA | Signed bus current |
| 22 | 2 | `cc1_mv` | `uint16` | mV | CC1 voltage |
| 24 | 2 | `cc2_mv` | `uint16` | mV | CC2 voltage |
| 26 | 2 | `dp_mv` | `uint16` | mV | D+ voltage |
| 28 | 2 | `dm_mv` | `uint16` | mV | D- voltage |
| 30 | 4 | `drop_count` | `uint32` | count | Monitor queue drop counter |
| 34 | 30 | `reserved` | `uint8[30]` | bytes | Zero-filled |

## Native OUT Report Body

All native OUT commands use a fixed 64-byte body.

| Offset | Size | Field | Type | Notes |
| ---: | ---: | --- | --- | --- |
| 0 | 1 | `opcode` | `uint8` | Native monitor TX command. `0` is ignored by firmware. |
| 1 | 1 | `len` | `uint8` | Payload length. Raw PD TX accepts `2..30`. `SET_CC_MODE` uses `3`. `GET_STATUS` uses `0`. |
| 2 | 62 | `payload` | `uint8[62]` | Raw command payload. |

Native OUT opcodes:

| Opcode | Name | Payload |
| ---: | --- | --- |
| `0x01` | `SEND_RAW_SOP0` | Raw PD packet bytes for SOP |
| `0x02` | `SEND_RAW_SOP1` | Raw PD packet bytes for SOP' |
| `0x03` | `SEND_RAW_SOP2` | Raw PD packet bytes for SOP'' |
| `0x04` | `SEND_HARD_RESET` | Empty |
| `0x05` | `SEND_CABLE_RESET` | Empty |
| `0x10` | `SET_CC_MODE` | `active_cc, cc1_mode, cc2_mode` |
| `0x20` | `GET_STATUS` | Empty |

## Monitor Events

These values must stay aligned between firmware `monitor_event_type_t` and host `MONITOR_EVENT`.

| Value | Name | Meaning | Payload |
| ---: | --- | --- | --- |
| `0` | `DISCONNECT` | Disconnected | Empty |
| `1` | `CC1_CONNECT` | CC1 connected | Empty |
| `2` | `CC2_CONNECT` | CC2 connected | Empty |
| `20` | `PD_SOP0` | PD SOP packet | Raw PD packet bytes |
| `21` | `PD_SOP1` | PD SOP' packet | Raw PD packet bytes |
| `22` | `PD_SOP2` | PD SOP'' packet | Raw PD packet bytes |
| `23` | `PD_SOP1_DEBUG` | PD SOP' Debug packet | Raw PD packet bytes |
| `24` | `PD_SOP2_DEBUG` | PD SOP'' Debug packet | Raw PD packet bytes |
| `25` | `HARD_RESET` | PD Hard Reset | Empty |
| `26` | `CABLE_RESET` | PD Cable Reset | Empty |
| `30` | `PD_ERROR` | PD PHY error | Firmware-defined payload or empty |
| `31` | `BUFFER_OVERFLOW` | Monitor buffer overflow | Empty |
| `40` | `UFCS_DP` | UFCS D+ raw frame | Raw UFCS bytes |
| `41` | `UFCS_DM` | UFCS D- raw frame | Raw UFCS bytes |

## UFCS HID Splitting

HID payload space is 34 bytes, while a UFCS raw frame can be 65 bytes.

- If the raw frame is `<= 34` bytes, firmware sends one EVENT report.
- If the raw frame is `> 34` bytes, firmware sends two consecutive EVENT reports with the same `recv_count` and `event_type`.
- The first report carries bytes `0..33`; the second carries the remainder.
- Host code assembles only consecutive reports with the same `recv_count` and same UFCS event type.

## Host Responsibilities

- WebHID must call `sendReport(0, body)` for native OUT commands.
- Host code must use `payload_len` as the authoritative valid payload length.
- Host code must treat `ibus_ua` as the wire-unit source of truth.
- Host code must not infer PD direction from `event_type`; native monitor events are direction-neutral observations.
