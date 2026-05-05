import { calculatePdCrc32 } from '@usb-pd-sniffer/pd-core'
import {
  CAPTURE_EVENT,
  type CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import { readPowerZSqlitePacketRows } from '../sqlite/powerZSqlite.js'
import {
  createWritableSqliteDatabase,
  exportSqliteDatabaseBytes,
} from '../sqlite/sqliteWasm.js'
import type { CaptureExportResult, CaptureImportResult } from '../types.js'
import { canExportSqliteRecord } from './sqliteShared.js'

type ImportedSqliteEvent = {
  eventType: CaptureRecord['event_type']
  activeCC: number
}

type SqliteChartState = {
  timestampUs: number
  vbusVolts: number
  ibusAmps: number
  cc1Volts: number
  cc2Volts: number
  activeCC: number
  isConnected: boolean
}

type SqliteChartSample = {
  timeSeconds: number
  vbusVolts: number
  ibusAmps: number
  cc1Volts: number
  cc2Volts: number
}

const SQLITE_CHART_SAMPLE_INTERVAL_US = 50_000

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

function normalizeSqlitePayload(record: CaptureRecord): Uint8Array {
  const packet = record.data.slice(0, record.data_len)

  if (hasEmbeddedPdCrc32(packet)) {
    return Uint8Array.from(packet.slice(0, -4))
  }

  return Uint8Array.from(packet)
}

function deriveSqliteChartState(
  record: CaptureRecord,
  previousState: SqliteChartState | null,
): SqliteChartState {
  let activeCC =
    record.active_cc === 1 || record.active_cc === 2
      ? record.active_cc
      : (previousState?.activeCC ?? 0)
  let isConnected = previousState?.isConnected ?? false

  if (record.event_type === CAPTURE_EVENT.CC1_CONNECT) {
    activeCC = 1
    isConnected = true
  } else if (record.event_type === CAPTURE_EVENT.CC2_CONNECT) {
    activeCC = 2
    isConnected = true
  } else if (record.event_type === CAPTURE_EVENT.DISCONNECT) {
    activeCC = 0
    isConnected = false
  } else if (activeCC !== 0) {
    isConnected = true
  }

  const hasExplicitCcVoltage = record.cc1_mv !== 0 || record.cc2_mv !== 0
  let cc1Volts = 0
  let cc2Volts = 0

  if (hasExplicitCcVoltage) {
    cc1Volts = record.cc1_mv / 1000
    cc2Volts = record.cc2_mv / 1000
  }

  return {
    timestampUs: Math.max(0, Math.round(record.timestamp_us)),
    vbusVolts: Math.max(0, record.vbus_mv / 1000),
    ibusAmps: record.ibus_ma / 1000,
    cc1Volts,
    cc2Volts,
    activeCC,
    isConnected,
  }
}

function buildSqliteChartSamples(
  records: CaptureRecord[],
): SqliteChartSample[] {
  if (records.length === 0) {
    return []
  }

  const samples: SqliteChartSample[] = []
  let state: SqliteChartState | null = null
  let nextSampleUs: number | null = null

  for (const record of records) {
    if (state !== null && nextSampleUs !== null) {
      while (nextSampleUs < record.timestamp_us) {
        samples.push({
          timeSeconds: nextSampleUs / 1_000_000,
          vbusVolts: state.vbusVolts,
          ibusAmps: state.ibusAmps,
          cc1Volts: state.cc1Volts,
          cc2Volts: state.cc2Volts,
        })
        nextSampleUs += SQLITE_CHART_SAMPLE_INTERVAL_US
      }
    }

    state = deriveSqliteChartState(record, state)
    samples.push({
      timeSeconds: state.timestampUs / 1_000_000,
      vbusVolts: state.vbusVolts,
      ibusAmps: state.ibusAmps,
      cc1Volts: state.cc1Volts,
      cc2Volts: state.cc2Volts,
    })

    if (nextSampleUs === null) {
      nextSampleUs = state.timestampUs + SQLITE_CHART_SAMPLE_INTERVAL_US
      continue
    }

    while (nextSampleUs <= state.timestampUs) {
      nextSampleUs += SQLITE_CHART_SAMPLE_INTERVAL_US
    }
  }

  return samples
}

function mapCaptureRecordToSqliteEventType(
  record: CaptureRecord,
  inferredActiveCC: number,
): number {
  if (!canExportSqliteRecord(record)) {
    throw new Error(`sqlite export does not support event ${record.event_type}`)
  }

  switch (record.event_type) {
    case CAPTURE_EVENT.PD_SOP0:
      return 0x00
    case CAPTURE_EVENT.PD_SOP1:
      return 0x01
    case CAPTURE_EVENT.PD_SOP2:
      return 0x02
    case CAPTURE_EVENT.CC1_CONNECT:
      return 0x11
    case CAPTURE_EVENT.DISCONNECT:
      return inferredActiveCC === 2 ? 0x22 : 0x12
    case CAPTURE_EVENT.CC2_CONNECT:
      return 0x21
    case CAPTURE_EVENT.PD_SOP1_DEBUG:
      return 0x23
    case CAPTURE_EVENT.PD_SOP2_DEBUG:
      return 0x24
    case CAPTURE_EVENT.PD_HARD_RESET:
      return 0x2c
    case CAPTURE_EVENT.PD_CABLE_RESET:
      return 0x2d
  }

  throw new Error(`Unhandled sqlite export event ${record.event_type}`)
}

function encodeSqliteRawRecord(
  record: CaptureRecord,
  inferredActiveCC: number,
): Uint8Array {
  const payload =
    record.event_type === CAPTURE_EVENT.CC1_CONNECT ||
    record.event_type === CAPTURE_EVENT.CC2_CONNECT ||
    record.event_type === CAPTURE_EVENT.DISCONNECT ||
    record.event_type === CAPTURE_EVENT.PD_HARD_RESET ||
    record.event_type === CAPTURE_EVENT.PD_CABLE_RESET
      ? new Uint8Array()
      : normalizeSqlitePayload(record)
  const eventType = mapCaptureRecordToSqliteEventType(record, inferredActiveCC)
  const rawLength = payload.length + 6
  const tagPrefix = payload.length === 0 ? 0x40 : 0x80
  const timestampMs = Math.max(0, Math.round(record.timestamp_us / 1000))
  const raw = new Uint8Array(rawLength)

  raw[0] = tagPrefix | ((rawLength - 1) & 0x3f)
  raw[1] = timestampMs & 0xff
  raw[2] = (timestampMs >>> 8) & 0xff
  raw[3] = (timestampMs >>> 16) & 0xff
  raw[4] = (timestampMs >>> 24) & 0xff
  raw[5] = eventType
  raw.set(payload, 6)

  return raw
}

export async function exportSqlite(
  records: CaptureRecord[],
): Promise<CaptureExportResult> {
  const db = await createWritableSqliteDatabase()
  const chartSamples = buildSqliteChartSamples(records)

  try {
    db.exec(`
      CREATE TABLE pd_chart(Time real, VBUS real, IBUS real, CC1 real, CC2 real);
      CREATE TABLE pd_table(Time real, Vbus real, Ibus real, Raw Blob);
      CREATE TABLE pd_table_key(key integer);
    `)

    const chartStatement = db.prepare(
      'INSERT INTO pd_chart(Time, VBUS, IBUS, CC1, CC2) VALUES(?, ?, ?, ?, ?)',
    )
    const tableStatement = db.prepare(
      'INSERT INTO pd_table(Time, Vbus, Ibus, Raw) VALUES(?, ?, ?, ?)',
    )

    let inferredActiveCC = 0

    try {
      db.exec('BEGIN')

      for (const sample of chartSamples) {
        chartStatement
          .bind([
            sample.timeSeconds,
            sample.vbusVolts,
            sample.ibusAmps,
            sample.cc1Volts,
            sample.cc2Volts,
          ])
          .stepReset()
      }

      for (const record of records) {
        const timeSeconds = Math.max(0, record.timestamp_us / 1_000_000)
        const vbusVolts = record.vbus_mv / 1000
        const ibusAmps = record.ibus_ma / 1000
        const raw = encodeSqliteRawRecord(record, inferredActiveCC)

        tableStatement.bind([timeSeconds, vbusVolts, ibusAmps, raw]).stepReset()

        if (record.event_type === CAPTURE_EVENT.CC1_CONNECT) {
          inferredActiveCC = 1
        } else if (record.event_type === CAPTURE_EVENT.CC2_CONNECT) {
          inferredActiveCC = 2
        } else if (record.event_type === CAPTURE_EVENT.DISCONNECT) {
          inferredActiveCC = 0
        }
      }

      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // ignore
      }
      throw error
    } finally {
      chartStatement.finalize()
      tableStatement.finalize()
    }

    return {
      format: 'sqlite',
      extension: 'sqlite',
      mime: 'application/vnd.sqlite3',
      bytes: await exportSqliteDatabaseBytes(db),
    }
  } finally {
    db.close()
  }
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
