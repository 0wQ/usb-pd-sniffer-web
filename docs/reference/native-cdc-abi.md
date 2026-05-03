# Native CDC ABI

This document records the current CDC ACM byte-stream ABI shared by the native CDC firmware variant and host software.

## Scope

- Firmware source of truth: `usb-pd-sniffer-firmware/src/transports/usb/variant/native_cdc.c`
- Host source of truth: `packages/pd-device-native-cdc/src/protocol.ts`
- Native CDC USB VID/PID: `0x1A86:0x2334`
- Browser API: Web Serial
- CDC requires DTR before firmware sends monitor events

All multi-byte fields are little-endian. Signed current fields are two's-complement little-endian.

## Frame

The CDC stream is framed as:

| Offset | Size | Field | Notes |
| ---: | ---: | --- | --- |
| 0 | 4 | `magic` | Fixed bytes `0A 55 50 53` (`"\nUPS"`) |
| 4 | 1 | `type` | `0x01` event, `0x80` host command |
| 5 | 2 | `len` | Payload length |
| 7 | `len` | `payload` | Type-specific payload |

The parser searches for `magic` only while seeking a new frame. Magic bytes inside payload are data.

## Event Payload

`type = 0x01` uses a 28-byte event header followed by event data:

| Offset | Size | Field | Type | Unit | Notes |
| ---: | ---: | --- | --- | --- | --- |
| 0 | 4 | `timestamp_us_lo` | `uint32` | us | Low 32 bits of timestamp |
| 4 | 4 | `timestamp_us_hi` | `uint32` | us | High 32 bits of timestamp |
| 8 | 4 | `recv_count` | `uint32` | count | Monitor queue sequence |
| 12 | 2 | `vbus_mv` | `uint16` | mV | VBUS voltage |
| 14 | 4 | `ibus_ua` | `int32` | uA | Signed bus current |
| 18 | 2 | `cc1_mv` | `uint16` | mV | CC1 voltage |
| 20 | 2 | `cc2_mv` | `uint16` | mV | CC2 voltage |
| 22 | 2 | `dp_mv` | `uint16` | mV | D+ voltage |
| 24 | 2 | `dm_mv` | `uint16` | mV | D- voltage |
| 26 | 1 | `event_type` | `uint8` | enum | `monitor_event_type_t` |
| 27 | 1 | `active_cc` | `uint8` | enum | `0` none, `1` CC1, `2` CC2 |
| 28 | `len - 28` | `event_data` | `uint8[]` | bytes | Event payload bytes |

CDC event payload has no inner `data_len`; host code uses `frame.len - 28`. Maximum event data is 65 bytes, so maximum event payload is 93 bytes.

## Command Payload

`type = 0x80` uses an opcode followed by command data:

| Offset | Size | Field | Notes |
| ---: | ---: | --- | --- |
| 0 | 1 | `opcode` | Native monitor TX command |
| 1 | `len - 1` | `cmd_data` | Command data |

CDC command payload has no inner `cmd_len`; host code uses `frame.len - 1`. Maximum command data is 62 bytes.

Native CDC shares monitor event numbers, TX opcodes, and CC mode values with the native HID ABI. The current command set is:

| Opcode | Name | `cmd_data` |
| ---: | --- | --- |
| `0x01` | `SEND_RAW_SOP0` | 2..30 bytes PD message without CRC32 |
| `0x02` | `SEND_RAW_SOP1` | 2..30 bytes PD message without CRC32 |
| `0x03` | `SEND_RAW_SOP2` | 2..30 bytes PD message without CRC32 |
| `0x04` | `SEND_HARD_RESET` | Empty |
| `0x05` | `SEND_CABLE_RESET` | Empty |
| `0x10` | `SET_CC_MODE` | `active_cc, cc1_mode, cc2_mode` |

## Monitor Events

CDC uses the same `monitor_event_type_t` numbering as native HID.

| Value | Name | Payload |
| ---: | --- | --- |
| `0` | `DISCONNECT` | Empty |
| `1` | `CC1_CONNECT` | Empty |
| `2` | `CC2_CONNECT` | Empty |
| `20` | `PD_SOP0` | Raw PD packet bytes |
| `21` | `PD_SOP1` | Raw PD packet bytes |
| `22` | `PD_SOP2` | Raw PD packet bytes |
| `23` | `PD_SOP1_DEBUG` | Raw PD packet bytes |
| `24` | `PD_SOP2_DEBUG` | Raw PD packet bytes |
| `25` | `HARD_RESET` | Empty |
| `26` | `CABLE_RESET` | Empty |
| `30` | `PD_ERROR` | Firmware-defined payload or empty |
| `31` | `BUFFER_OVERFLOW` | Empty |
| `40` | `UFCS_DP` | Raw UFCS bytes |
| `41` | `UFCS_DM` | Raw UFCS bytes |
