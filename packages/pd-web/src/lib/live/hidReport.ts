export const USB_HID_REPORT_ID = 0x00
export const USB_HID_REPORT_BODY_SIZE = 64
export const MONITOR_PAYLOAD_MAX_LEN = 34

function getU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function getI16LE(bytes: Uint8Array, offset: number): number {
  const value = getU16LE(bytes, offset)
  return value & 0x8000 ? value - 0x10000 : value
}

function getU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0
}

function copyDataViewBytes(data: DataView): Uint8Array {
  return Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
}

function normalizeReportBody(reportId: number, data: DataView): Uint8Array {
  const bytes = copyDataViewBytes(data)

  if (reportId !== USB_HID_REPORT_ID) {
    throw new Error(`Unexpected HID input report ID ${reportId}; expected ${USB_HID_REPORT_ID}.`)
  }

  if (bytes.length === USB_HID_REPORT_BODY_SIZE) {
    return bytes
  }

  throw new Error(
    `Unexpected HID input report length ${bytes.length}; expected ${USB_HID_REPORT_BODY_SIZE}.`
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
  const body = normalizeReportBody(reportId, data)
  const timestampUsLo = getU32LE(body, 0)
  const timestampUsHi = getU32LE(body, 4)
  const timestampUs = (BigInt(timestampUsHi) << 32n) | BigInt(timestampUsLo)
  const payloadLen = Math.min(body[26] ?? 0, MONITOR_PAYLOAD_MAX_LEN)

  return {
    timestamp_us: Number(timestampUs),
    recv_counter: getU32LE(body, 8),
    vbus_mv: getU16LE(body, 12),
    ibus_ma: getI16LE(body, 14),
    cc1_mv: getU16LE(body, 16),
    cc2_mv: getU16LE(body, 18),
    dp_mv: getU16LE(body, 20),
    dm_mv: getU16LE(body, 22),
    event_type: body[24] ?? 0,
    active_cc: body[25] ?? 0,
    pd_data_len: payloadLen,
    pd_raw: Array.from(body.subarray(27, 27 + payloadLen)),
  }
}
