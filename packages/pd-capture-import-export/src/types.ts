import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'

export interface ValidationError {
  row: number
  field: string
  value: string
  reason: string
}

export interface CaptureImportResult {
  records: CaptureRecord[]
  errors: ValidationError[]
}

export type CaptureImportFormatId = 'csv' | 'pdStream' | 'atkcc'
export type CaptureExportFormatId = 'csv' | 'pdStream'

export type CaptureImportFormatDefinition = {
  id: CaptureImportFormatId
  label: string
  extensions: readonly string[]
  inputKind: 'text' | 'bytes'
}

export type CaptureExportFormatDefinition = {
  id: CaptureExportFormatId
  label: string
  extension: string
  mime: string
  outputKind: 'text' | 'bytes'
}

export type CaptureExportResult =
  | {
      format: CaptureExportFormatId
      extension: string
      mime: string
      text: string
    }
  | {
      format: CaptureExportFormatId
      extension: string
      mime: string
      bytes: Uint8Array
    }
