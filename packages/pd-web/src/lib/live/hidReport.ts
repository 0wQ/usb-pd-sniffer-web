export const USB_HID_IN_REPORT_ID = 0x01
export const USB_HID_REPORT_BODY_SIZE = 63
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

  if (bytes.length === USB_HID_REPORT_BODY_SIZE) {
    return bytes
  }

  if (bytes.length === USB_HID_REPORT_BODY_SIZE + 1 && bytes[0] === USB_HID_IN_REPORT_ID) {
    return bytes.subarray(1)
  }

  if (reportId === USB_HID_IN_REPORT_ID && bytes.length === USB_HID_REPORT_BODY_SIZE) {
    return bytes
  }

  throw new Error(
    `Unexpected HID input report length ${bytes.length}; expected ${USB_HID_REPORT_BODY_SIZE} or ${USB_HID_REPORT_BODY_SIZE + 1}.`
  )
}

export type WebHidPdReport = {
  timestamp_us: number
  recv_counter: number
  drop_count?: number
  vbus_mv: number
  ibus_ma: number
  pbus_10mw: number
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
  const payloadLen = Math.min(body[28] ?? 0, MONITOR_PAYLOAD_MAX_LEN)

  return {
    timestamp_us: Number(timestampUs),
    recv_counter: getU32LE(body, 8),
    vbus_mv: getU16LE(body, 12),
    ibus_ma: getI16LE(body, 14),
    pbus_10mw: getU16LE(body, 16),
    cc1_mv: getU16LE(body, 18),
    cc2_mv: getU16LE(body, 20),
    dp_mv: getU16LE(body, 22),
    dm_mv: getU16LE(body, 24),
    event_type: body[26] ?? 0,
    active_cc: body[27] ?? 0,
    pd_data_len: payloadLen,
    pd_raw: Array.from(body.subarray(29, 29 + payloadLen)),
  }
}
