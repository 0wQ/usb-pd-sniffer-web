import { calculatePdCrc32 } from '@usb-pd-sniffer/pd-core'
import {
  CAPTURE_EVENT,
  type CaptureEventType,
  type CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import type { CaptureImportResult, ValidationError } from '../types.js'

function readDoubleBE(view: DataView, offset: number): number {
  return view.getFloat64(offset, false)
}

function pushFileError(
  errors: ValidationError[],
  reason: string,
): CaptureImportResult {
  errors.push({
    row: 0,
    field: 'file',
    value: '',
    reason,
  })
  return { records: [], errors }
}

type ImportedPdStreamEvent = {
  eventType: CaptureEventType
  activeCC: number
}

function mapPdStreamEvent(
  eventAux0: number,
  eventType: number,
  payloadLength: number,
): ImportedPdStreamEvent | null {
  if (payloadLength === 0) {
    if (eventType === 0x21) {
      return eventAux0 === 0x01
        ? { eventType: CAPTURE_EVENT.CC2_CONNECT, activeCC: 2 }
        : { eventType: CAPTURE_EVENT.CC1_CONNECT, activeCC: 1 }
    }

    if (eventType === 0x22) {
      return { eventType: CAPTURE_EVENT.DISCONNECT, activeCC: 0 }
    }

    return null
  }

  if (eventType === 0x00) {
    return { eventType: CAPTURE_EVENT.PD_SOP0, activeCC: 0 }
  }

  if (eventType === 0x01) {
    return { eventType: CAPTURE_EVENT.PD_SOP1, activeCC: 0 }
  }

  if (eventType === 0x02) {
    return { eventType: CAPTURE_EVENT.PD_SOP2, activeCC: 0 }
  }

  return null
}

function withPdCrc32(payload: Uint8Array): number[] {
  const crc32 = calculatePdCrc32(payload)

  return [
    ...payload,
    crc32 & 0xff,
    (crc32 >>> 8) & 0xff,
    (crc32 >>> 16) & 0xff,
    (crc32 >>> 24) & 0xff,
  ]
}

export function importPdStream(bytes: Uint8Array): CaptureImportResult {
  const errors: ValidationError[] = []
  const records: CaptureRecord[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let offset = 0
  let seq = 1

  while (offset < view.byteLength) {
    if (offset + 34 > view.byteLength) {
      return pushFileError(errors, 'pdStream record header is truncated')
    }

    const n = view.getUint32(offset, false)
    if (n < 6) {
      return pushFileError(errors, `Invalid pdStream record length word: ${n}`)
    }

    const payloadLength = n - 6
    const recordLength = n + 28
    if (offset + recordLength > view.byteLength) {
      return pushFileError(errors, 'pdStream record payload is truncated')
    }

    const tag = view.getUint8(offset + 4)
    if ((tag & 0x3f) !== n - 1) {
      errors.push({
        row: records.length + 1,
        field: 'tag',
        value: `0x${tag.toString(16)}`,
        reason: 'Length tag mismatch',
      })
    }

    const eventAux0 = view.getUint8(offset + 7)
    const eventType = view.getUint8(offset + 9)
    const payloadOffset = offset + 10
    const payload = bytes.subarray(payloadOffset, payloadOffset + payloadLength)
    const metricsOffset = payloadOffset + payloadLength
    const mappedEvent = mapPdStreamEvent(eventAux0, eventType, payloadLength)

    if (mappedEvent === null) {
      errors.push({
        row: records.length + 1,
        field: 'event_type',
        value: `0x${eventType.toString(16)}`,
        reason: 'Unsupported pdStream event type',
      })
      offset += recordLength
      continue
    }

    const data = payloadLength > 0 ? withPdCrc32(payload) : Array.from(payload)
    records.push({
      timestamp_us: Math.max(
        0,
        Math.round(readDoubleBE(view, metricsOffset) * 1_000_000),
      ),
      seq,
      vbus_mv: Math.max(
        0,
        Math.round(readDoubleBE(view, metricsOffset + 8) * 1000),
      ),
      ibus_ma: Math.round(readDoubleBE(view, metricsOffset + 16) * 1000),
      cc1_mv: 0,
      cc2_mv: 0,
      dp_mv: 0,
      dm_mv: 0,
      event_type: mappedEvent.eventType,
      active_cc: mappedEvent.activeCC,
      data_len: data.length,
      data,
    })

    seq += 1
    offset += recordLength
  }

  return { records, errors }
}

type PdStreamEventTuple = readonly [
  eventAux0: number,
  eventAux1: number,
  eventType: number,
]

function hasEmbeddedPdCrc32(packet: readonly number[]): boolean {
  if (packet.length < 6) {
    return false
  }

  const payload = packet.slice(0, -4)
  const expected = calculatePdCrc32(payload)
  const actual =
    (packet[packet.length - 4] ?? 0) |
    ((packet[packet.length - 3] ?? 0) << 8) |
    ((packet[packet.length - 2] ?? 0) << 16) |
    ((packet[packet.length - 1] ?? 0) << 24)

  return expected === actual >>> 0
}

function normalizePdStreamPayload(record: CaptureRecord): Uint8Array {
  const packet = record.data.slice(0, record.data_len)

  if (hasEmbeddedPdCrc32(packet)) {
    return Uint8Array.from(packet.slice(0, -4))
  }

  return Uint8Array.from(packet)
}

function mapCaptureRecordToPdStreamEventTuple(
  record: CaptureRecord,
): PdStreamEventTuple {
  switch (record.event_type) {
    case CAPTURE_EVENT.PD_SOP0:
      return [0x00, 0x00, 0x00]
    case CAPTURE_EVENT.PD_SOP1:
      return [0x00, 0x00, 0x01]
    case CAPTURE_EVENT.PD_SOP2:
      return [0x00, 0x00, 0x02]
    case CAPTURE_EVENT.CC1_CONNECT:
      return [0x00, 0x00, 0x21]
    case CAPTURE_EVENT.CC2_CONNECT:
      return [0x01, 0x00, 0x21]
    case CAPTURE_EVENT.DISCONNECT:
      return [record.active_cc === 2 ? 0x01 : 0x00, 0x00, 0x22]
    default:
      throw new Error(
        `pdStream export does not support event ${record.event_type}`,
      )
  }
}

function writeUint32BE(
  target: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength)
  view.setUint32(offset, value >>> 0, false)
}

function writeUint16LE(
  target: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength)
  view.setUint16(offset, value & 0xffff, true)
}

function writeFloat64BE(
  target: Uint8Array,
  offset: number,
  value: number,
): void {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength)
  view.setFloat64(offset, value, false)
}

function encodePdStreamRecord(record: CaptureRecord): Uint8Array {
  const eventTuple = mapCaptureRecordToPdStreamEventTuple(record)
  const payload =
    record.event_type === CAPTURE_EVENT.CC1_CONNECT ||
    record.event_type === CAPTURE_EVENT.CC2_CONNECT ||
    record.event_type === CAPTURE_EVENT.DISCONNECT
      ? new Uint8Array(0)
      : normalizePdStreamPayload(record)

  const n = payload.length + 6
  if (n - 1 > 0x3f) {
    throw new Error(
      `pdStream export payload too long for record seq=${record.seq}: ${payload.length} byte(s)`,
    )
  }

  const recordLength = n + 28
  const encoded = new Uint8Array(recordLength)
  const elapsedMsLo =
    Math.floor(Math.max(0, record.timestamp_us) / 1000) & 0xffff
  const tag = (payload.length === 0 ? 0x40 : 0x80) | ((n - 1) & 0x3f)
  const metricsOffset = 10 + payload.length

  writeUint32BE(encoded, 0, n)
  encoded[4] = tag
  writeUint16LE(encoded, 5, elapsedMsLo)
  encoded[7] = eventTuple[0]
  encoded[8] = eventTuple[1]
  encoded[9] = eventTuple[2]
  encoded.set(payload, 10)
  writeFloat64BE(
    encoded,
    metricsOffset,
    Math.max(0, record.timestamp_us) / 1_000_000,
  )
  writeFloat64BE(encoded, metricsOffset + 8, record.vbus_mv / 1000)
  writeFloat64BE(encoded, metricsOffset + 16, record.ibus_ma / 1000)

  return encoded
}

export function exportPdStream(records: CaptureRecord[]): Uint8Array {
  const encodedRecords = records.map(encodePdStreamRecord)
  const totalLength = encodedRecords.reduce(
    (sum, record) => sum + record.length,
    0,
  )
  const output = new Uint8Array(totalLength)
  let offset = 0

  for (const record of encodedRecords) {
    output.set(record, offset)
    offset += record.length
  }

  return output
}
