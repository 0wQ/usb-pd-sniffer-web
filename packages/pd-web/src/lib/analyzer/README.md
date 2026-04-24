Current `pd-web` analyzer boundary:

1. Native monitor device support -> `@usb-pd-sniffer/pd-monitor`
2. Device subscriptions -> `src/hooks/useMonitorDevice.ts`
3. `CaptureRecord` -> `MessagePacket`/`pd-core` -> `src/lib/analyzer/decode.ts`
4. UI rendering -> `src/components/card/TableCard.tsx`, `src/components/card/DecodeCard.tsx`, and `src/components/pages/PowerPage.tsx`

`pd-web` must not parse HID report bodies or hold `HIDDevice` directly. Device
transport and native monitor ABI handling belong to `@usb-pd-sniffer/pd-monitor`.

The copied v3 parser under `src/lib/pd/**` and legacy helpers such as
`src/utils/usbPdParser.ts` are legacy carryovers from the shell migration.
They are not part of the active analyzer path and should not be reintroduced
into the mainline.
