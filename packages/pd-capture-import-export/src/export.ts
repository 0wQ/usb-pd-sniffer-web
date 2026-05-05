import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { exportCsv } from './formats/csv.js'
import { exportPdStream } from './formats/pdStream.js'
import type {
  CaptureExportFormatDefinition,
  CaptureExportFormatId,
  CaptureExportResult,
} from './types.js'

export const CAPTURE_EXPORT_FORMATS = {
  csv: {
    id: 'csv',
    label: 'CSV',
    extension: 'csv',
    mime: 'text/csv;charset=utf-8;',
    outputKind: 'text',
  },
  pdStream: {
    id: 'pdStream',
    label: 'pdStream',
    extension: 'pdStream',
    mime: 'application/octet-stream',
    outputKind: 'bytes',
  },
  sqlite: {
    id: 'sqlite',
    label: 'SQLite',
    extension: 'sqlite',
    mime: 'application/vnd.sqlite3',
    outputKind: 'bytes',
  },
} as const satisfies Record<
  CaptureExportFormatId,
  CaptureExportFormatDefinition
>

export function exportCapture(
  format: CaptureExportFormatId,
  records: CaptureRecord[],
): CaptureExportResult {
  switch (format) {
    case 'csv':
      return {
        format,
        extension: CAPTURE_EXPORT_FORMATS.csv.extension,
        mime: CAPTURE_EXPORT_FORMATS.csv.mime,
        text: exportCsv(records),
      }
    case 'pdStream':
      return {
        format,
        extension: CAPTURE_EXPORT_FORMATS.pdStream.extension,
        mime: CAPTURE_EXPORT_FORMATS.pdStream.mime,
        bytes: exportPdStream(records),
      }
    case 'sqlite':
      throw new Error('sqlite export requires exportCaptureAsync()')
  }
}

export async function exportCaptureAsync(
  format: CaptureExportFormatId,
  records: CaptureRecord[],
): Promise<CaptureExportResult> {
  switch (format) {
    case 'csv':
    case 'pdStream':
      return exportCapture(format, records)
    case 'sqlite':
      return (await import('./formats/sqlite.js')).exportSqlite(records)
  }
}
