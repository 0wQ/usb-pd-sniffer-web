export interface ValidationError {
  row: number
  field: string
  value: string
  reason: string
}

export interface ImportResult {
  reports: import('./pd').PDReport[]
  errors: ValidationError[]
}

export type ImportMode = 'replace' | 'append'
