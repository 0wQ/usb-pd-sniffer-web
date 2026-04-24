export interface ValidationError {
  row: number
  field: string
  value: string
  reason: string
}

export interface ImportResult {
  records: import('./pd').CaptureRecord[]
  errors: ValidationError[]
}

export type ImportMode = 'replace' | 'append'
