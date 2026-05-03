# Native CDC ABI

This document records the current CDC ACM byte-stream ABI shared by the native CDC firmware variant and host software.

## Scope

- Firmware source of truth: `usb-pd-sniffer-firmware/src/usb_device/variant/usb_variant_native_cdc.c`
- Host source of truth: `packages/pd-device-native-cdc/src/protocol.ts`
- Native CDC USB VID/PID: `0x1A86:0x2334`
- Browser API: Web Serial
- CDC requires DTR before firmware sends monitor events.

## Frame

All multi-byte fields are little-endian. The CDC stream is framed as:

| Offset | Size | Field | Notes |
| ---: | ---: | --- | --- |
| 0 | 4 | `magic` | Fixed bytes `0A 55 50 53` (`"\nUPS"`). |
| 4 | 1 | `type` | `0x01` event, `0x80` host command. |
| 5 | 2 | `len` | Payload length. |
| 7 | `len` | `payload` | Type-specific payload. |

The parser searches for magic only while seeking a new frame. Magic bytes inside payload are data.

## Event Payload

`type = 0x01` uses a 26-byte event header followed by event data:

| Offset | Size | Field | Notes |
| ---: | ---: | --- | --- |
| 0 | 4 | `timestamp_us_lo` | Low 32 bits of timestamp in microseconds. |
| 4 | 4 | `timestamp_us_hi` | High 32 bits of timestamp in microseconds. |
| 8 | 4 | `recv_count` | Event bus counter. |
| 12 | 2 | `vbus_mv` | VBUS millivolts. |
| 14 | 2 | `ibus_ma` | Signed current milliamps. |
| 16 | 2 | `cc1_mv` | CC1 millivolts. |
| 18 | 2 | `cc2_mv` | CC2 millivolts. |
| 20 | 2 | `dp_mv` | D+ millivolts. |
| 22 | 2 | `dm_mv` | D- millivolts. |
| 24 | 1 | `event_type` | `monitor_event_type_t`. |
| 25 | 1 | `pd_active_cc` | `0=None`, `1=CC1`, `2=CC2`. |
| 26 | `len - 26` | `event_data` | Monitor event data. |

CDC event payload has no inner `data_len`; host code uses frame length minus 26. Maximum event data is 65 bytes, so maximum event payload is 91 bytes.

## Command Payload

`type = 0x80` uses an opcode followed by command data:

| Offset | Size | Field | Notes |
| ---: | ---: | --- | --- |
| 0 | 1 | `opcode` | Native monitor TX command. |
| 1 | `len - 1` | `cmd_data` | Command data. |

CDC command payload has no inner `cmd_len`; host code uses frame length minus 1. Maximum command data is 62 bytes.

Native CDC shares monitor event numbers, TX opcodes, and CC mode values with the native HID ABI.
