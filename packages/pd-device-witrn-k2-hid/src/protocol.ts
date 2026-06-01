import { CAPTURE_EVENT, type CaptureEventType } from '@usb-pd-sniffer/pd-device-types'

export const WITRN_K2_HID_USB = {
  vendorId: 0x0716,
  productId: 0x5060,
} as const

export const WITRN_K2_HID_REPORT_ID = 0x00
export const WITRN_K2_HID_REPORT_SIZE = 64

export const WITRN_K2_REPORT_TYPE = {
  PD: 0xfe,
  GENERAL: 0xff,
} as const

const GENERAL_META_START = 8
const GENERAL_META_END = 61
const GENERAL_CHECKSUM_META_OFFSET = 62
const GENERAL_CHECKSUM_ALL_OFFSET = 63
const CC_CONNECT_THRESHOLD_MV = 200

export type WitrnK2Snapshot = {
  vbusMv: number
  ibusMa: number
  cc1Mv: number
  cc2Mv: number
}

export type WitrnK2PdReport = {
  kind: 'pd'
  eventType: CaptureEventType
  payload: Uint8Array
}

export type WitrnK2GeneralReport = {
  kind: 'general'
  seq: number
  runtimeSec: number
  dropCount: number
  snapshot: WitrnK2Snapshot
}

export type WitrnK2InputReport = WitrnK2PdReport | WitrnK2GeneralReport

const PD_CRC32_INITIAL = 0xffffffff
const PD_CRC32_POLY = 0x04c11db6

function getU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function getU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function putU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function reverse32(value: number): number {
  let result = 0

  for (let index = 0; index < 32; index += 1) {
    result = (result | (((value >>> index) & 1) << (31 - index))) >>> 0
  }

  return result >>> 0
}

function getF32LE(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getFloat32(offset, true)
}

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value)
}

function toMillivolts(volts: number): number {
  return roundNumber(volts * 1000)
}

function toMilliamps(amps: number): number {
  return roundNumber(amps * 1000)
}

function sumBytes(bytes: Uint8Array, start: number, end: number): number {
  let sum = 0
  for (let index = start; index <= end; index += 1) {
    sum = (sum + (bytes[index] ?? 0)) & 0xff
  }
  return sum
}

export function calculateWitrnK2PdCrc32(
  messageBytes: readonly number[] | Uint8Array,
): number {
  let crc = PD_CRC32_INITIAL

  for (const byte of messageBytes) {
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      const newBit = (((crc >>> 31) ^ ((byte >>> bitIndex) & 1)) & 1) >>> 0
      const shifted = (((crc << 1) >>> 0) | newBit) >>> 0
      crc = (shifted ^ (newBit === 1 ? PD_CRC32_POLY : 0)) >>> 0
    }
  }

  return reverse32(~crc >>> 0)
}

export function appendWitrnK2PdCrc32(messageBytes: Uint8Array): Uint8Array {
  const packetBytes = new Uint8Array(messageBytes.length + 4)
  packetBytes.set(messageBytes, 0)
  putU32LE(
    packetBytes,
    messageBytes.length,
    calculateWitrnK2PdCrc32(messageBytes),
  )
  return packetBytes
}

function k2SopToCaptureEvent(sop: number): CaptureEventType {
  switch (sop) {
    case 0xe0:
      return CAPTURE_EVENT.PD_SOP0
    case 0xc0:
      return CAPTURE_EVENT.PD_SOP1
    case 0xa0:
      return CAPTURE_EVENT.PD_SOP2
    case 0x80:
      return CAPTURE_EVENT.PD_SOP1_DEBUG
    case 0x60:
      return CAPTURE_EVENT.PD_SOP2_DEBUG
    default:
      throw new Error(`Unsupported WITRN K2 SOP byte 0x${sop.toString(16)}.`)
  }
}

export function inferWitrnK2ActiveCc(snapshot: WitrnK2Snapshot): 0 | 1 | 2 {
  if (
    snapshot.cc1Mv < CC_CONNECT_THRESHOLD_MV &&
    snapshot.cc2Mv < CC_CONNECT_THRESHOLD_MV
  ) {
    return 0
  }

  return snapshot.cc1Mv >= snapshot.cc2Mv ? 1 : 2
}

export function parseWitrnK2InputReport(
  body: Uint8Array,
): WitrnK2InputReport {
  if (body.length !== WITRN_K2_HID_REPORT_SIZE) {
    throw new Error(
      `Unexpected WITRN K2 input report length ${body.length}; expected ${WITRN_K2_HID_REPORT_SIZE}.`,
    )
  }

  const reportType = body[0] ?? 0

  if (reportType === WITRN_K2_REPORT_TYPE.PD) {
    const payloadFieldLen = body[1] ?? 0
    if (payloadFieldLen < 1) {
      throw new Error('WITRN K2 PD report payload length is invalid.')
    }

    const payloadLen = payloadFieldLen - 1
    const payloadEnd = 3 + payloadLen
    if (payloadEnd > WITRN_K2_HID_REPORT_SIZE) {
      throw new Error('WITRN K2 PD report payload exceeds report size.')
    }

    return {
      kind: 'pd',
      eventType: k2SopToCaptureEvent(body[2] ?? 0),
      payload: body.slice(3, payloadEnd),
    }
  }

  if (reportType === WITRN_K2_REPORT_TYPE.GENERAL) {
    const checksumMeta = sumBytes(body, GENERAL_META_START, GENERAL_META_END)
    const checksumAll = sumBytes(body, 0, GENERAL_CHECKSUM_META_OFFSET)
    if ((body[GENERAL_CHECKSUM_META_OFFSET] ?? 0) !== checksumMeta) {
      throw new Error('WITRN K2 general report metadata checksum mismatch.')
    }
    if ((body[GENERAL_CHECKSUM_ALL_OFFSET] ?? 0) !== checksumAll) {
      throw new Error('WITRN K2 general report checksum mismatch.')
    }

    return {
      kind: 'general',
      seq: getU16LE(body, 2),
      runtimeSec: getU32LE(body, 22),
      dropCount: getU32LE(body, 57),
      snapshot: {
        vbusMv: toMillivolts(getF32LE(body, 46)),
        ibusMa: toMilliamps(getF32LE(body, 50)),
        cc1Mv: (body[55] ?? 0) * 100,
        cc2Mv: (body[56] ?? 0) * 100,
      },
    }
  }

  throw new Error(
    `Unexpected WITRN K2 report type 0x${reportType.toString(16)}.`,
  )
}

export function encodeWitrnK2ForceGeneralReportBody(): Uint8Array {
  const body = new Uint8Array(WITRN_K2_HID_REPORT_SIZE)
  body[0] = 0xff
  body[1] = 0x55
  return body
}
