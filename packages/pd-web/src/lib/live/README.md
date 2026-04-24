Current `pd-web` analyzer mainline:

1. WebHID input -> `src/lib/live/hidReport.ts`
2. PD monitor-event filtering -> `src/hooks/useWebHid.ts`
3. `PDReport` -> `PdObservedFrame`/`pd-core` -> `src/lib/live/pdCore.ts`
4. UI rendering -> `src/components/card/TableCard.tsx`, `src/components/card/DecodeCard.tsx`, and `src/components/pages/PowerPage.tsx`

The copied v3 parser under `src/lib/pd/**` and legacy helpers such as
`src/utils/usbPdParser.ts` are legacy carryovers from the shell migration.
They are not part of the active analyzer path and should not be reintroduced
into the mainline.
