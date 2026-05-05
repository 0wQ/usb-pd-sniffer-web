import { calculatePdCrc32 } from '@usb-pd-sniffer/pd-core'
import {
  CAPTURE_EVENT,
  type CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import { readPowerZSqlitePacketRows } from '../sqlite/powerZSqlite.js'
import type { CaptureImportResult } from '../types.js'

type ImportedSqliteEvent = {
  eventType: CaptureRecord['event_type']
  activeCC: number
}

function mapSqliteEvent(
  eventType: number,
  payloadLength: number,
): ImportedSqliteEvent | null {
  if (payloadLength === 0) {
    switch (eventType) {
      case 0x11:
        return { eventType: CAPTURE_EVENT.CC1_CONNECT, activeCC: 1 }
      case 0x12:
        return { eventType: CAPTURE_EVENT.DISCONNECT, activeCC: 0 }
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

export async function importSqlite(
  bytes: Uint8Array,
): Promise<CaptureImportResult> {
  const { packetRows, errors } = await readPowerZSqlitePacketRows(bytes)
  const records: CaptureRecord[] = []

  let seq = 1
  let inferredActiveCC = 0

  for (let index = 0; index < packetRows.length; index += 1) {
    const row = packetRows[index]
    if (!row) continue

    if (row.raw.length < 6) {
      errors.push({
        row: index + 1,
        field: 'Raw',
        value: `${row.raw.length}`,
        reason: 'sqlite packet row is shorter than the 6-byte header',
      })
      continue
    }

    const tag = row.raw[0] ?? 0
    if ((tag & 0x3f) !== row.raw.length - 1) {
      errors.push({
        row: index + 1,
        field: 'tag',
        value: `0x${tag.toString(16)}`,
        reason: 'Length tag mismatch',
      })
    }

    const eventType = row.raw[5] ?? 0
    const payload = row.raw.subarray(6)
    const mappedEvent = mapSqliteEvent(eventType, payload.length)
    let nextInferredActiveCC = inferredActiveCC

    if (payload.length === 0) {
      if (eventType === 0x11) {
        nextInferredActiveCC = 1
      } else if (eventType === 0x21) {
        nextInferredActiveCC = 2
      } else if (eventType === 0x12 || eventType === 0x22) {
        nextInferredActiveCC = 0
      }
    }

    if (mappedEvent === null) {
      errors.push({
        row: index + 1,
        field: 'event_type',
        value: `0x${eventType.toString(16)}`,
        reason: 'Unsupported sqlite event type',
      })
      continue
    }

    const data = payload.length > 0 ? withPdCrc32(payload) : Array.from(payload)
    const activeCC =
      mappedEvent.eventType === CAPTURE_EVENT.DISCONNECT
        ? 0
        : mappedEvent.activeCC === 0
          ? inferredActiveCC
          : mappedEvent.activeCC

    records.push({
      timestamp_us: Math.max(0, Math.round(row.timeSeconds * 1_000_000)),
      seq,
      vbus_mv: Math.max(0, Math.round(row.vbusVolts * 1000)),
      ibus_ma: Math.round(row.ibusAmps * 1000),
      cc1_mv: 0,
      cc2_mv: 0,
      dp_mv: 0,
      dm_mv: 0,
      event_type: mappedEvent.eventType,
      active_cc: activeCC,
      data_len: data.length,
      data,
    })

    if (
      mappedEvent.eventType === CAPTURE_EVENT.CC1_CONNECT ||
      mappedEvent.eventType === CAPTURE_EVENT.CC2_CONNECT
    ) {
      inferredActiveCC = mappedEvent.activeCC
    } else if (mappedEvent.eventType === CAPTURE_EVENT.DISCONNECT) {
      inferredActiveCC = 0
    } else {
      inferredActiveCC = nextInferredActiveCC
    }

    seq += 1
  }

  return { records, errors }
}
