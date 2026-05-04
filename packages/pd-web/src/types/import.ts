export interface ValidationError {
  row: number
  field: string
  value: string
  reason: string
}

export interface ImportResult {
  records: import('@usb-pd-sniffer/pd-device-types').CaptureRecord[]
  errors: ValidationError[]
}

export type ImportMode = 'replace' | 'append'

export type CaptureImportFormat = 'csv' | 'pdStream' | 'atkcc'

export interface ImportFileResult extends ImportResult {
  format: CaptureImportFormat
}
