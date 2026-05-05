import {
  CAPTURE_EVENT,
  type CaptureEventType,
  type CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'

const SQLITE_EXPORTABLE_EVENTS = new Set<CaptureEventType>([
  CAPTURE_EVENT.CC1_CONNECT,
  CAPTURE_EVENT.CC2_CONNECT,
  CAPTURE_EVENT.DISCONNECT,
  CAPTURE_EVENT.PD_HARD_RESET,
  CAPTURE_EVENT.PD_CABLE_RESET,
  CAPTURE_EVENT.PD_SOP0,
  CAPTURE_EVENT.PD_SOP1,
  CAPTURE_EVENT.PD_SOP2,
  CAPTURE_EVENT.PD_SOP1_DEBUG,
  CAPTURE_EVENT.PD_SOP2_DEBUG,
])

export function canExportSqliteRecord(record: CaptureRecord): boolean {
  return SQLITE_EXPORTABLE_EVENTS.has(record.event_type)
}
