# pd-core-v2 Coverage By Type

Date: 2026-04-23

This file tracks decoder progress by message type branch instead of by scattered field work.

Reference policy lives in [pd-core-v2-reference-policy.md](/Users/sora/project/usb-pd-sniffer-v4/usb-pd-sniffer-web-v2/docs/planning/pd-core-v2-reference-policy.md).

## Status Legend

- `Done`: dedicated sections/fields/issues exist and the type is usable in the ET240-style viewer.
- `Partial`: type is recognized and structurally visible, but decode is still generic, incomplete, or candidate-only.
- `Skeleton`: type is only visible through top-level framing, generic payload, or raw block presentation.
- `Pending`: type has no meaningful dedicated decode yet.

## Global Baseline

These apply to all messages before per-type decode:

| Area | Status | Notes |
| --- | --- | --- |
| Message Header | Done | Dedicated section with SOP-sensitive bit meaning and message type naming |
| Extended Message Header | Done | Dedicated section with reserved-bit issue reporting |
| Data message payload exposure | Done | No generic payload container is emitted; payload bytes are surfaced directly as final object sections or generic raw 32-bit object sections |
| Extended message payload exposure | Done | Supported families emit dedicated data-block sections, and unsupported extended families fall back to generic raw data-block sections |
| ET240-style web renderer | Done | `DecodeCard` now renders `sections[]` / `fields[]` / `issues[]` directly |

## Control Messages

At this stage control messages are mostly header-only, which is acceptable because they do not carry data objects.

| Branch | Status | Notes |
| --- | --- | --- |
| All control message identification | Done | Name lookup now covers every spec-defined control code from GoodCRC through Get_Revision; reserved codes remain unnamed |
| GoodCRC / Accept / Reject / PS_RDY / Wait / Soft_Reset / Not_Supported | Done | Header-level decode is sufficient |
| Get_Source_Cap / Get_Sink_Cap / DR_Swap / PR_Swap / VCONN_Swap / FR_Swap / Get_Status / Get_PPS_Status / Get_Source_Info / Get_Revision / Get_*_Extended | Done | Header-only by protocol shape |
| GotoMin / Ping / Data_Reset / Data_Reset_Complete | Done | Deprecated/header-only control messages are now registered by their spec names |

## Data Messages

| Branch | Status | Notes |
| --- | --- | --- |
| Source_Capabilities | Done | Fixed / Battery / Variable / SPR PPS / SPR AVS / EPR AVS split into dedicated PDO/APDO sections |
| Sink_Capabilities | Done | Same family coverage as Source_Capabilities with sink-side bit meanings |
| Request | Done | Without context it stays on `RDO - Common`; with explicit `Source_Capabilities` context it resolves to one concrete RDO branch |
| EPR_Request | Done | DO0 RDO is resolved directly from DO1 `Copy of Requested Power Data Object`, so no external frame context is required |
| Vendor_Defined | Partial | VDM Header plus standard Structured VDM branches are decoded; deeper SVID-specific payloads still fall back to generic raw VDO sections |
| BIST | Done | BIST Data Object now exposes mode, reserved bits, object-count rules, and test-data payload objects are surfaced explicitly |
| Battery_Status | Done | Battery Status Data Object now exposes capacity, battery info bits, charging-status rules, and reserved/object-count issues |
| Alert | Done | Alert Data Object now has dedicated fields for Type of Alert bits, battery bitmaps, extended alert event type, and reserved/object-count issues |
| Get_Country_Info | Done | Country Code Data Object now exposes both Alpha-2 country-code characters plus reserved/object-count issues |
| Enter_USB | Done | Enter USB Data Object now exposes USB mode, DRD flags, cable attributes, host capability flags, and reserved/object-count issues |
| EPR_Mode | Done | EPR Mode Data Object now exposes Action/Data semantics plus reserved/object-count issues |
| Source_Info | Done | Source Information Data Object now exposes port type, maximum/present/reported PDP, and reserved/object-count issues |
| Revision | Done | Revision Message Data Object now exposes Revision/Version major/minor fields plus reserved/object-count issues |

## Structured / Unstructured VDM Branches

This is the next major branch to complete deeply.

| Branch | Status | Notes |
| --- | --- | --- |
| Unstructured VDM Header | Done | VID / VDM Type / vendor payload bits decoded |
| Structured VDM Header | Done | SVID / version / object position / command type / command / reserved rules decoded |
| Discover Identity request/ACK/NAK/BUSY rules | Done | REQ/NAK/BUSY object-count rules plus ACK shape validation now emit dedicated issues |
| ID Header VDO | Done | SOP vs SOP' product-type semantics, connector type, reserved bits, and VID exposed as dedicated fields |
| Cert Stat VDO | Done | XID exposed as a dedicated section |
| Product VDO | Done | USB Product ID and bcdDevice exposed as dedicated fields |
| UFP VDO | Done | Version, USB capabilities, Alternate Modes, power requirements, speed, and reserved/deprecated checks decoded |
| DFP VDO | Done | Version, host capabilities, port number, and hub/power-brick host-capability rules decoded |
| Passive Cable VDO | Done | Cable latency / termination / voltage / current / speed plus deprecated/reserved checks decoded |
| Active Cable VDO1 | Done | Cable identity, SBU, VBUS-through, SOP'' presence, and speed fields decoded |
| Active Cable VDO2 | Done | Thermal / low-power / transport capability fields plus optical-cable checks decoded |
| VPD VDO | Done | Charge-through support, impedance fields, and deprecated voltage handling decoded |
| Discover SVIDs payload | Done | REQ/NAK/BUSY no-VDO rules plus ACK SVID-pair VDO decoding and terminator checks are implemented |
| Discover Modes payload | Done | REQ/NAK/BUSY no-VDO rules plus ACK generic Mode VDO sections are implemented; SVID-specific mode semantics remain separate work |
| Enter Mode / Exit Mode / Attention payload branches | Done | Object-count, response-type, and Object Position rules are enforced; optional mode-specific VDOs are exposed generically without SVID-specific projection |
| SVID-specific command payloads | Partial | DisplayPort (`0xFF01`) Discover Modes first Mode VDO and Enter Mode / Attention Status VDO now have dedicated sections; remaining SVID-specific branches are still generic |

## Extended Messages

| Branch | Status | Notes |
| --- | --- | --- |
| Extended message identification | Done | Message type lookup works |
| Raw extended payload exposure | Done | Supported branches emit dedicated data-block sections, and unsupported or raw-only extended branches now fall back to generic raw data-block sections |
| Source_Capabilities_Extended | Done | SCEDB now exposes fixed fields, Voltage Regulation, Compliance, Touch Current, Peak Current blocks, Source Inputs, battery counts, and PDP ratings with reserved checks |
| Status | Done | SOP and SOP'/SOP'' Status Data Blocks now expose dedicated fields plus reserved/data-size checks |
| Get_Battery_Cap | Done | Get Battery Cap Data Block now exposes Battery Cap Ref plus reserved/data-size issues |
| Get_Battery_Status | Done | Get Battery Status Data Block now exposes Battery Status Ref plus reserved/data-size issues |
| Battery_Capabilities | Done | Battery Capabilities Data Block now exposes VID/PID/capacity fields plus invalid-reference and reserved checks |
| Get_Manufacturer_Info | Done | Get Manufacturer Info Data Block now exposes target/reference semantics plus reserved/data-size issues |
| Manufacturer_Info | Done | Manufacturer Info Data Block now exposes VID/PID/string fields plus PID/VID consistency checks |
| Security_Request | Done | Current frame or chunk payload is surfaced directly as `Security Request Data Block (SRQDB)` raw bytes without requiring assemble |
| Security_Response | Done | Current frame or chunk payload is surfaced directly as `Security Response Data Block (SRPDB)` raw bytes without requiring assemble |
| Firmware_Update_Request | Done | Current frame or chunk payload is surfaced directly as `Firmware Update Request Data Block (FRQDB)` raw bytes without requiring assemble |
| Firmware_Update_Response | Done | Current frame or chunk payload is surfaced directly as `Firmware Update Response Data Block (FRPDB)` raw bytes without requiring assemble |
| PPS_Status | Done | PPS Status Data Block now exposes output voltage/current and Real Time Flags with reserved-bit checks |
| Country_Info | Done | Country Info Data Block now exposes country code, reserved bytes, and country-specific data |
| Country_Codes | Done | Country Codes Data Block now exposes Length/header bytes and parsed Alpha-2 country-code entries |
| Sink_Capabilities_Extended | Done | SKEDB now exposes version/load-step/load-characteristics/compliance/touch-temp/battery-info/sink-modes/PDP fields with reserved and ordering checks |
| Extended_Control | Done | Extended Control Data Block now exposes Type/Data semantics plus reserved/data-size issues |
| EPR_Source_Capabilities | Done | Chunk 0 and assembled prefixes share the common PDO decode path with Source_Capabilities while exposing SPR/EPR position-aware titles; all-zero capability objects display as `Empty PDO`; incomplete tail bytes intentionally remain surfaced as `Trailing Raw Payload` |
| EPR_Sink_Capabilities | Done | Chunk 0 and assembled prefixes share the common PDO decode path with Sink_Capabilities while exposing SPR/EPR position-aware titles; all-zero capability objects display as `Empty PDO`; incomplete tail bytes intentionally remain surfaced as `Trailing Raw Payload` |
| Vendor_Defined_Extended | Partial | Raw data block fallback exists; semantic decode still requires complete assemble and dedicated branch work |

## Recommended Execution Order

Do not shallow-fill every branch. Work one branch to completion before switching.

Suggested order:

1. `Vendor_Defined_Extended`
2. Remaining SVID-specific command payloads

## Definition Of “Complete Enough”

A branch should be moved to `Done` only when dedicated sections/fields/issues exist and the web renderer can show it without branch-specific projection logic.
