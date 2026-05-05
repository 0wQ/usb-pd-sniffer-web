import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { exportCsv } from './formats/csv.js'
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
  }
}
