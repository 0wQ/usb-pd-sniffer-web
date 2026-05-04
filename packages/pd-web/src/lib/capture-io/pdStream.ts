import type { ImportResult, ValidationError } from '@/types/import'
import {
  CAPTURE_EVENT,
  type CaptureEventType,
  type CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'

function readDoubleBE(view: DataView, offset: number): number {
  return view.getFloat64(offset, false)
}

function pushFileError(errors: ValidationError[], reason: string): ImportResult {
  errors.push({
    row: 0,
    field: 'file',
    value: '',
    reason,
  })
  return { records: [], errors }
}

function mapPdStreamEventType(
  eventType: number,
  payloadLength: number,
): CaptureEventType | null {
  if (payloadLength === 0) {
    if (eventType === 0x21) return CAPTURE_EVENT.CC1_CONNECT
    if (eventType === 0x22) return CAPTURE_EVENT.DISCONNECT
    return null
  }

  if (eventType === 0x00) return CAPTURE_EVENT.PD_SOP0
  if (eventType === 0x01) return CAPTURE_EVENT.PD_SOP1
  if (eventType === 0x02) return CAPTURE_EVENT.PD_SOP2
  return null
}

export function importFromPdStream(buffer: ArrayBuffer): ImportResult {
  const errors: ValidationError[] = []
  const records: CaptureRecord[] = []
  const view = new DataView(buffer)

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

    const eventType = view.getUint8(offset + 9)
    const payloadOffset = offset + 10
    const payload = new Uint8Array(buffer, payloadOffset, payloadLength)
    const metricsOffset = payloadOffset + payloadLength
    const mappedEventType = mapPdStreamEventType(eventType, payloadLength)

    if (mappedEventType === null) {
      errors.push({
        row: records.length + 1,
        field: 'event_type',
        value: `0x${eventType.toString(16)}`,
        reason: 'Unsupported pdStream event type',
      })
      offset += recordLength
      continue
    }

    const data = Array.from(payload)
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
      event_type: mappedEventType,
      active_cc: 0,
      data_len: data.length,
      data,
    })

    seq++
    offset += recordLength
  }

  return { records, errors }
}
