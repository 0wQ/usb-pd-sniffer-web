import {
  NATIVE_HID_REPORT_BODY_SIZE,
  NATIVE_HID_REPORT_ID,
  parseNativeMonitorHidReportBody,
} from '@usb-pd-sniffer/pd-monitor'

function copyDataViewBytes(data: DataView): Uint8Array {
  return Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
}

function normalizeReportBody(reportId: number, data: DataView): Uint8Array {
  const bytes = copyDataViewBytes(data)

  if (reportId !== NATIVE_HID_REPORT_ID) {
    throw new Error(`Unexpected HID input report ID ${reportId}; expected ${NATIVE_HID_REPORT_ID}.`)
  }

  if (bytes.length === NATIVE_HID_REPORT_BODY_SIZE) {
    return bytes
  }

  throw new Error(
    `Unexpected HID input report length ${bytes.length}; expected ${NATIVE_HID_REPORT_BODY_SIZE}.`
  )
}

export type WebHidPdReport = {
  timestamp_us: number
  recv_counter: number
  drop_count?: number
  vbus_mv: number
  ibus_ma: number
  cc1_mv: number
  cc2_mv: number
  dp_mv: number
  dm_mv: number
  event_type: number
  active_cc: number
  pd_data_len: number
  pd_raw: number[]
}

export function parseWebHidPdReport(reportId: number, data: DataView): WebHidPdReport {
  const report = parseNativeMonitorHidReportBody(normalizeReportBody(reportId, data))

  return {
    timestamp_us: report.timestampUs,
    recv_counter: report.recvCount,
    vbus_mv: report.snapshot.vbusMv,
    ibus_ma: report.snapshot.ibusMa,
    cc1_mv: report.snapshot.cc1Mv,
    cc2_mv: report.snapshot.cc2Mv,
    dp_mv: report.snapshot.dpMv,
    dm_mv: report.snapshot.dmMv,
    event_type: report.eventType,
    active_cc: report.activeCc,
    pd_data_len: report.payloadLen,
    pd_raw: Array.from(report.payload),
  }
}
