Current `pd-web` analyzer boundary:

1. Native monitor device support -> `@usb-pd-sniffer/pd-monitor`
2. Device subscriptions -> `src/hooks/useMonitorDevice.ts`
3. `CaptureRecord` -> `MessagePacket`/`pd-core` -> `src/lib/analyzer/decode.ts`
4. UI rendering -> `src/components/card/TableCard.tsx`, `src/components/card/DecodeCard.tsx`, and `src/components/pages/PowerPage.tsx`

`pd-web` must not parse HID report bodies or hold `HIDDevice` directly. Device
transport and native monitor ABI handling belong to `@usb-pd-sniffer/pd-monitor`.

This directory is not a protocol parser. It adapts capture records to
`pd-core`, selects optional decode context, and prepares generic analyzer UI
helpers. Protocol meaning belongs in `@usb-pd-sniffer/pd-core`; device ABI
meaning belongs in `@usb-pd-sniffer/pd-monitor`.
