import Papa from 'papaparse'
import type { PDReport } from '@/types/pd'
import type { ValidationError, ImportResult } from '@/types/csv'
import { MONITOR_EVENT, monitorEventName } from '@/lib/live/pdCore'

const CSV_HEADERS = [
  'timestamp_us',
  'recv_counter',
  'vbus_mv',
  'ibus_ma',
  'cc1_mv',
  'cc2_mv',
  'dp_mv',
  'dm_mv',
  'event_type',
  'active_cc',
  'data',
  'note'
] as const

type CaptureCsvHeader = typeof CSV_HEADERS[number]

const CAPTURE_EVENT_BY_NAME = {
  DISCONNECT: MONITOR_EVENT.DISCONNECT,
  CC1_CONNECT: MONITOR_EVENT.CC1_CONNECT,
  CC2_CONNECT: MONITOR_EVENT.CC2_CONNECT,
  PD_SOP0: MONITOR_EVENT.PD_SOP0,
  PD_SOP1: MONITOR_EVENT.PD_SOP1,
  PD_SOP2: MONITOR_EVENT.PD_SOP2,
  PD_SOP1_DEBUG: MONITOR_EVENT.PD_SOP1_DEBUG,
  PD_SOP2_DEBUG: MONITOR_EVENT.PD_SOP2_DEBUG,
  HARD_RESET: MONITOR_EVENT.HARD_RESET,
  CABLE_RESET: MONITOR_EVENT.CABLE_RESET,
  PD_ERROR: MONITOR_EVENT.PD_ERROR,
  BUFFER_OVERFLOW: MONITOR_EVENT.BUFFER_OVERFLOW,
  UFCS_DP_SINGLE: MONITOR_EVENT.UFCS_DP_SINGLE,
  UFCS_DM_SINGLE: MONITOR_EVENT.UFCS_DM_SINGLE,
} as const

const CAPTURE_EVENT_NAMES = new Set<string>(Object.keys(CAPTURE_EVENT_BY_NAME))
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

const NUMERIC_FIELDS: readonly CaptureCsvHeader[] = [
  'timestamp_us',
  'recv_counter',
  'vbus_mv',
  'ibus_ma',
  'cc1_mv',
  'cc2_mv',
  'dp_mv',
  'dm_mv',
  'active_cc',
]

const UNSIGNED_NUMERIC_FIELDS = new Set<CaptureCsvHeader>([
  'timestamp_us',
  'recv_counter',
  'vbus_mv',
  'cc1_mv',
  'cc2_mv',
  'dp_mv',
  'dm_mv',
  'active_cc',
])

export const serializeData = (bytes: number[]): string => {
  return bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join('')
}

export const deserializeData = (value: string): number[] => {
  const compact = value.replace(/\s+/g, '').trim()
  if (compact === '') return []

  if (compact.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${compact.length} (must be even)`)
  }
  if (!/^[0-9A-Fa-f]*$/.test(compact)) {
    throw new Error('Invalid hex characters in data')
  }

  const result: number[] = []
  for (let i = 0; i < compact.length; i += 2) {
    result.push(parseInt(compact.slice(i, i + 2), 16))
  }
  return result
}

function parseCaptureEventName(value: string): number {
  const name = value.trim()
  if (!CAPTURE_EVENT_NAMES.has(name)) {
    throw new Error(`Unsupported capture event_type "${value}"`)
  }
  return CAPTURE_EVENT_BY_NAME[name as keyof typeof CAPTURE_EVENT_BY_NAME]
}

function validateRow(row: Record<string, unknown>, rowIndex: number): ValidationError[] {
  const errors: ValidationError[] = []

  for (const header of CSV_HEADERS) {
    if (!(header in row)) {
      errors.push({
        row: rowIndex,
        field: header,
        value: '',
        reason: 'Missing column'
      })
    }
  }

  for (const field of NUMERIC_FIELDS) {
    const value = row[field]
    if (value === '' || value === null || value === undefined) {
      errors.push({
        row: rowIndex,
        field,
        value: String(value),
        reason: 'Empty value'
      })
      continue
    }

    const numberValue = Number(value)
    if (!Number.isFinite(numberValue)) {
      errors.push({
        row: rowIndex,
        field,
        value: String(value),
        reason: 'Not a number'
      })
    } else if (UNSIGNED_NUMERIC_FIELDS.has(field) && numberValue < 0) {
      errors.push({
        row: rowIndex,
        field,
        value: String(value),
        reason: 'Negative number not allowed'
      })
    }
  }

  if (row.active_cc !== undefined) {
    const activeCc = Number(row.active_cc)
    if (Number.isFinite(activeCc) && ![0, 1, 2].includes(activeCc)) {
      errors.push({
        row: rowIndex,
        field: 'active_cc',
        value: String(row.active_cc),
        reason: 'active_cc must be 0, 1, or 2'
      })
    }
  }

  if (typeof row.event_type !== 'string') {
    errors.push({
      row: rowIndex,
      field: 'event_type',
      value: String(row.event_type),
      reason: 'event_type must be a capture event name'
    })
  } else {
    try {
      parseCaptureEventName(row.event_type)
    } catch (error) {
      errors.push({
        row: rowIndex,
        field: 'event_type',
        value: row.event_type,
        reason: error instanceof Error ? error.message : 'Invalid event_type'
      })
    }
  }

  if (typeof row.data !== 'string') {
    errors.push({
      row: rowIndex,
      field: 'data',
      value: String(row.data),
      reason: 'data must be a hex string'
    })
  } else {
    try {
      deserializeData(row.data)
    } catch (error) {
      errors.push({
        row: rowIndex,
        field: 'data',
        value: row.data,
        reason: error instanceof Error ? error.message : 'Invalid data'
      })
    }
  }

  return errors
}

export const exportToCsv = (reports: PDReport[]): string => {
  const data = reports.map(report => ({
    timestamp_us: report.timestamp_us,
    recv_counter: report.recv_counter,
    vbus_mv: report.vbus_mv,
    ibus_ma: report.ibus_ma ?? 0,
    cc1_mv: report.cc1_mv,
    cc2_mv: report.cc2_mv,
    dp_mv: report.dp_mv ?? 0,
    dm_mv: report.dm_mv ?? 0,
    event_type: monitorEventName(report.event_type),
    active_cc: report.active_cc,
    data: serializeData(report.pd_raw.slice(0, report.pd_data_len)),
    note: ''
  }))

  return Papa.unparse(data, {
    columns: CSV_HEADERS as unknown as string[],
    header: true,
    delimiter: ',',
    newline: '\r\n'
  })
}

export const importFromCsv = (content: string): ImportResult => {
  const errors: ValidationError[] = []
  const reports: PDReport[] = []

  const parseResult = Papa.parse<Record<string, string>>(content.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (header: string) => header.trim()
  })

  if (parseResult.errors.length > 0) {
    parseResult.errors.forEach(error => {
      errors.push({
        row: error.row ?? -1,
        field: 'parsing',
        value: '',
        reason: error.message
      })
    })
  }

  const headers = parseResult.meta.fields || []
  const missingHeaders = CSV_HEADERS.filter(header => !headers.includes(header))
  if (missingHeaders.length > 0) {
    errors.push({
      row: 0,
      field: 'headers',
      value: missingHeaders.join(', '),
      reason: `Missing required headers: ${missingHeaders.join(', ')}`
    })
    return { reports: [], errors }
  }

  parseResult.data.forEach((row, index) => {
    const rowErrors = validateRow(row, index + 2)
    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      return
    }

    try {
      const bytes = deserializeData(row.data)
      reports.push({
        timestamp_us: Number(row.timestamp_us),
        recv_counter: Number(row.recv_counter),
        vbus_mv: Number(row.vbus_mv),
        ibus_ma: Number(row.ibus_ma),
        cc1_mv: Number(row.cc1_mv),
        cc2_mv: Number(row.cc2_mv),
        dp_mv: Number(row.dp_mv),
        dm_mv: Number(row.dm_mv),
        event_type: parseCaptureEventName(row.event_type),
        active_cc: Number(row.active_cc),
        pd_data_len: bytes.length,
        pd_raw: bytes,
      })
    } catch (error) {
      errors.push({
        row: index + 2,
        field: 'transformation',
        value: '',
        reason: error instanceof Error ? error.message : 'Failed to transform row'
      })
    }
  })

  return { reports, errors }
}

export const generateFilename = (): string => {
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '')
  return `capture_record_${date}_${time}.csv`
}

export const downloadCsv = (content: string, filename: string): void => {
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  setTimeout(() => URL.revokeObjectURL(url), 100)
}

export const readFile = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (50MB)`))
      return
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      reject(new Error('Invalid file type. Please select a CSV file'))
      return
    }

    const reader = new FileReader()

    reader.onload = (event) => {
      const content = event.target?.result
      if (typeof content === 'string') {
        resolve(content)
      } else {
        reject(new Error('Failed to read file as text'))
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsText(file, 'UTF-8')
  })
}
