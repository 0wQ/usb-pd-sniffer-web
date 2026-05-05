import type { ValidationError } from '../types.js'
import { openReadonlySqliteDatabase } from './sqliteWasm.js'

type PowerZSqliteTableName = 'pd_chart' | 'pd_table' | 'pd_table_key'

export type PowerZSqlitePacketRow = {
  timeSeconds: number
  vbusVolts: number
  ibusAmps: number
  raw: Uint8Array
}

const REQUIRED_TABLES = new Set<PowerZSqliteTableName>([
  'pd_chart',
  'pd_table',
  'pd_table_key',
])

function pushFileError(
  errors: ValidationError[],
  reason: string,
): ValidationError[] {
  errors.push({
    row: 0,
    field: 'file',
    value: '',
    reason,
  })
  return errors
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeBlob(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  return null
}

export async function readPowerZSqlitePacketRows(bytes: Uint8Array): Promise<{
  packetRows: PowerZSqlitePacketRow[]
  errors: ValidationError[]
}> {
  const errors: ValidationError[] = []
  const db = await openReadonlySqliteDatabase(bytes)

  try {
    const tableRows = db.selectArrays(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    const tableNames = new Set<string>()

    for (const row of tableRows) {
      const name = row[0]
      if (typeof name === 'string') {
        tableNames.add(name)
      }
    }

    for (const requiredTable of REQUIRED_TABLES) {
      if (!tableNames.has(requiredTable)) {
        return {
          packetRows: [],
          errors: pushFileError(
            errors,
            `Missing required sqlite table: ${requiredTable}`,
          ),
        }
      }
    }

    const packetValueRows = db.selectArrays(
      'SELECT Time, Vbus, Ibus, Raw FROM pd_table ORDER BY rowid ASC',
    )
    const packetRows: PowerZSqlitePacketRow[] = []

    for (let index = 0; index < packetValueRows.length; index += 1) {
      const row = packetValueRows[index] ?? []
      const timeSeconds = row[0]
      const vbusVolts = row[1]
      const ibusAmps = row[2]
      const raw = normalizeBlob(row[3])

      if (!isFiniteNumber(timeSeconds)) {
        errors.push({
          row: index + 1,
          field: 'Time',
          value: String(timeSeconds),
          reason: 'Invalid sqlite packet row time',
        })
        continue
      }

      if (!isFiniteNumber(vbusVolts)) {
        errors.push({
          row: index + 1,
          field: 'Vbus',
          value: String(vbusVolts),
          reason: 'Invalid sqlite packet row Vbus',
        })
        continue
      }

      if (!isFiniteNumber(ibusAmps)) {
        errors.push({
          row: index + 1,
          field: 'Ibus',
          value: String(ibusAmps),
          reason: 'Invalid sqlite packet row Ibus',
        })
        continue
      }

      if (raw === null) {
        errors.push({
          row: index + 1,
          field: 'Raw',
          value: String(row[3]),
          reason: 'Invalid sqlite packet row Raw blob',
        })
        continue
      }

      packetRows.push({
        timeSeconds,
        vbusVolts,
        ibusAmps,
        raw,
      })
    }

    return { packetRows, errors }
  } finally {
    db.close()
  }
}
