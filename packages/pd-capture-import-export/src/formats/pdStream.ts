import { calculatePdCrc32 } from '@usb-pd-sniffer/pd-core'
import {
  CAPTURE_EVENT,
  type CaptureEventType,
  type CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import type { CaptureImportResult, ValidationError } from '../types.js'

const PDSTREAM_EXPORTABLE_EVENTS = new Set<CaptureEventType>([
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
  eventType: number,
  payloadLength: number,
): ImportedPdStreamEvent | null {
  if (payloadLength === 0) {
    switch (eventType) {
      case 0x21:
        return { eventType: CAPTURE_EVENT.CC2_CONNECT, activeCC: 2 }
      case 0x22:
        return { eventType: CAPTURE_EVENT.DISCONNECT, activeCC: 0 }
      case 0x24:
      case 0x2c:
        return { eventType: CAPTURE_EVENT.PD_HARD_RESET, activeCC: 0 }
      case 0x25:
      case 0x2d:
        return { eventType: CAPTURE_EVENT.PD_CABLE_RESET, activeCC: 0 }
      default:
        return null
    }
  }

  switch (eventType) {
    case 0x00:
      return { eventType: CAPTURE_EVENT.PD_SOP0, activeCC: 0 }
    case 0x01:
      return { eventType: CAPTURE_EVENT.PD_SOP1, activeCC: 0 }
    case 0x02:
      return { eventType: CAPTURE_EVENT.PD_SOP2, activeCC: 0 }
    case 0x23:
      return { eventType: CAPTURE_EVENT.PD_SOP1_DEBUG, activeCC: 0 }
    case 0x24:
      return { eventType: CAPTURE_EVENT.PD_SOP2_DEBUG, activeCC: 0 }
    default:
      return null
  }
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
  let inferredActiveCC = 0

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

    const eventType = view.getUint8(offset + 9)
    const payloadOffset = offset + 10
    const payload = bytes.subarray(payloadOffset, payloadOffset + payloadLength)
    const metricsOffset = payloadOffset + payloadLength
    const mappedEvent = mapPdStreamEvent(eventType, payloadLength)
    let nextInferredActiveCC = inferredActiveCC

    if (payloadLength === 0) {
      if (eventType === 0x21 || eventType === 0x29) {
        nextInferredActiveCC = eventType === 0x21 ? 2 : 0
      } else if (eventType === 0x22 || eventType === 0x2a) {
        nextInferredActiveCC = 0
      }
    }

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
    const activeCC =
      mappedEvent.eventType === CAPTURE_EVENT.DISCONNECT
        ? 0
        : mappedEvent.activeCC === 0
          ? inferredActiveCC
          : mappedEvent.activeCC

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
      active_cc: activeCC,
      data_len: data.length,
      data,
    })

    if (mappedEvent.eventType === CAPTURE_EVENT.CC2_CONNECT) {
      inferredActiveCC = 2
    } else if (mappedEvent.eventType === CAPTURE_EVENT.DISCONNECT) {
      inferredActiveCC = 0
    } else {
      inferredActiveCC = nextInferredActiveCC
    }

    seq += 1
    offset += recordLength
  }

  return { records, errors }
}

type PdStreamEventType = number

export function canExportPdStreamRecord(record: CaptureRecord): boolean {
  return PDSTREAM_EXPORTABLE_EVENTS.has(record.event_type)
}

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

function mapCaptureRecordToPdStreamEventType(
  record: CaptureRecord,
): PdStreamEventType {
  if (!canExportPdStreamRecord(record)) {
    throw new Error(
      `pdStream export does not support event ${record.event_type}`,
    )
  }

  switch (record.event_type) {
    case CAPTURE_EVENT.PD_SOP0:
      return 0x00
    case CAPTURE_EVENT.PD_SOP1:
      return 0x01
    case CAPTURE_EVENT.PD_SOP2:
      return 0x02
    case CAPTURE_EVENT.CC2_CONNECT:
      return 0x21
    case CAPTURE_EVENT.DISCONNECT:
      return 0x22
    case CAPTURE_EVENT.PD_HARD_RESET:
      return 0x24
    case CAPTURE_EVENT.PD_SOP1_DEBUG:
      return 0x23
    case CAPTURE_EVENT.PD_SOP2_DEBUG:
      return 0x24
    case CAPTURE_EVENT.PD_CABLE_RESET:
      return 0x25
    default:
      throw new Error(`Unhandled pdStream export event ${record.event_type}`)
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
  const eventType = mapCaptureRecordToPdStreamEventType(record)
  const payload =
    record.event_type === CAPTURE_EVENT.CC2_CONNECT ||
    record.event_type === CAPTURE_EVENT.DISCONNECT ||
    record.event_type === CAPTURE_EVENT.PD_HARD_RESET ||
    record.event_type === CAPTURE_EVENT.PD_CABLE_RESET
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
  const elapsedMs = Math.floor(Math.max(0, record.timestamp_us) / 1000)
  const elapsedMsLo = elapsedMs & 0xffff
  const elapsedMsHi = (elapsedMs >>> 16) & 0xff
  const elapsedMsHigher = (elapsedMs >>> 24) & 0xff
  const tag = (payload.length === 0 ? 0x40 : 0x80) | ((n - 1) & 0x3f)
  const metricsOffset = 10 + payload.length

  writeUint32BE(encoded, 0, n)
  encoded[4] = tag
  writeUint16LE(encoded, 5, elapsedMsLo)
  encoded[7] = elapsedMsHi
  encoded[8] = elapsedMsHigher
  encoded[9] = eventType
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
