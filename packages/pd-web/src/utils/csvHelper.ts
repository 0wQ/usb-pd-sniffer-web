import Papa from 'papaparse'
import type { PDReport } from '@/types/pd'
import type { ValidationError, ImportResult } from '@/types/csv'

// CSV header columns
const CSV_HEADERS = [
  'timestamp_us',
  'recv_counter',
  'vbus_mv',
  'cc1_mv',
  'cc2_mv',
  'event_type',
  'active_cc',
  'pd_data_len',
  'pd_raw'
] as const

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

/**
 * Serialize pd_raw number array to hex string
 * Example: [18, 52, 86] => "123456"
 */
export const serializePdRaw = (pdRaw: number[]): string => {
  return pdRaw.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join('')
}

/**
 * Deserialize hex string back to number array
 * Example: "123456" => [18, 52, 86]
 */
export const deserializePdRaw = (value: string): number[] => {
  const trimmed = value.trim()
  if (trimmed === '') return []

  // Validate hex string (must be even length, only hex chars)
  if (trimmed.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${trimmed.length} (must be even)`)
  }
  if (!/^[0-9A-Fa-f]*$/.test(trimmed)) {
    throw new Error('Invalid hex characters in pd_raw')
  }

  const result: number[] = []
  for (let i = 0; i < trimmed.length; i += 2) {
    result.push(parseInt(trimmed.slice(i, i + 2), 16))
  }
  return result
}

/**
 * Validate a single CSV row
 */
const validateRow = (row: Record<string, unknown>, rowIndex: number): ValidationError[] => {
  const errors: ValidationError[] = []
  const numericFields = [
    'timestamp_us', 'recv_counter', 'vbus_mv', 'cc1_mv', 'cc2_mv',
    'event_type', 'active_cc', 'pd_data_len'
  ]

  // Check for missing columns
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

  // Validate numeric fields
  for (const field of numericFields) {
    const value = row[field]
    if (value === '' || value === null || value === undefined) {
      errors.push({
        row: rowIndex,
        field,
        value: String(value),
        reason: 'Empty value'
      })
    } else if (isNaN(Number(value))) {
      errors.push({
        row: rowIndex,
        field,
        value: String(value),
        reason: 'Not a number'
      })
    } else if (Number(value) < 0) {
      errors.push({
        row: rowIndex,
        field,
        value: String(value),
        reason: 'Negative number not allowed'
      })
    }
  }

  // Validate pd_raw field
  if (row.pd_raw !== undefined && row.pd_raw !== null && row.pd_raw !== '') {
    if (typeof row.pd_raw !== 'string') {
      errors.push({
        row: rowIndex,
        field: 'pd_raw',
        value: String(row.pd_raw),
        reason: 'pd_raw must be a hex string',
      })
    } else {
      try {
        deserializePdRaw(row.pd_raw)
      } catch (error) {
        errors.push({
          row: rowIndex,
          field: 'pd_raw',
          value: String(row.pd_raw),
          reason: error instanceof Error ? error.message : 'Invalid array format'
        })
      }
    }
  }

  return errors
}

/**
 * Export PDReports to CSV string
 */
export const exportToCsv = (reports: PDReport[]): string => {
  const data = reports.map(report => ({
    timestamp_us: report.timestamp_us,
    recv_counter: report.recv_counter,
    vbus_mv: report.vbus_mv,
    cc1_mv: report.cc1_mv,
    cc2_mv: report.cc2_mv,
    event_type: report.event_type,
    active_cc: report.active_cc,
    pd_data_len: report.pd_data_len,
    // Only export valid data bytes based on pd_data_len
    pd_raw: serializePdRaw(report.pd_raw.slice(0, report.pd_data_len))
  }))

  const csv = Papa.unparse(data, {
    columns: CSV_HEADERS as unknown as string[],
    header: true,
    delimiter: ',',
    newline: '\r\n'
  })

  return csv
}

/**
 * Import CSV string and parse to PDReports
 */
export const importFromCsv = (content: string): ImportResult => {
  const errors: ValidationError[] = []
  const reports: PDReport[] = []

  const parseResult = Papa.parse<Record<string, string>>(content, {
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

  // Validate headers
  const headers = parseResult.meta.fields || []
  const missingHeaders = CSV_HEADERS.filter(h => !headers.includes(h))
  if (missingHeaders.length > 0) {
    errors.push({
      row: 0,
      field: 'headers',
      value: missingHeaders.join(', '),
      reason: `Missing required headers: ${missingHeaders.join(', ')}`
    })
    return { reports: [], errors }
  }

  // Validate and transform each row
  parseResult.data.forEach((row, index) => {
      const rowErrors = validateRow(row, index + 2) // +2 because row 1 is header, and 0-indexed
      if (rowErrors.length > 0) {
        errors.push(...rowErrors)
      } else {
        try {
          const report: PDReport = {
            timestamp_us: Number(row.timestamp_us),
            recv_counter: Number(row.recv_counter),
            vbus_mv: Number(row.vbus_mv),
            cc1_mv: Number(row.cc1_mv),
            cc2_mv: Number(row.cc2_mv),
            event_type: Number(row.event_type),
            active_cc: Number(row.active_cc),
            pd_data_len: Number(row.pd_data_len),
            pd_raw: typeof row.pd_raw === 'string' ? deserializePdRaw(row.pd_raw) : []
          }
          reports.push(report)
        } catch (error) {
          errors.push({
            row: index + 2,
          field: 'transformation',
          value: '',
          reason: error instanceof Error ? error.message : 'Failed to transform row'
        })
      }
    }
  })

  return { reports, errors }
}

/**
 * Generate filename with timestamp
 */
export const generateFilename = (): string => {
  const now = new Date()
  const date = now.toISOString().split('T')[0] // YYYY-MM-DD
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '') // HHMMSS
  return `USB_PD_Data_${date}_${time}.csv`
}

/**
 * Download CSV content as file
 */
export const downloadCsv = (content: string, filename: string): void => {
  const BOM = '\uFEFF' // UTF-8 BOM for Excel compatibility
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

/**
 * Read file content as text
 */
export const readFile = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (50MB)`))
      return
    }

    // Validate file extension
    if (!file.name.toLowerCase().endsWith('.csv')) {
      reject(new Error('Invalid file type. Please select a CSV file'))
      return
    }

    const reader = new FileReader()

    reader.onload = (e) => {
      const content = e.target?.result
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
