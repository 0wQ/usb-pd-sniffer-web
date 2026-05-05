import { importAtkcc } from './formats/atkcc.js'
import { importCsv } from './formats/csv.js'
import { importPdStream } from './formats/pdStream.js'
import type {
  CaptureImportFormatDefinition,
  CaptureImportFormatId,
  CaptureImportResult,
} from './types.js'

export const CAPTURE_IMPORT_FORMATS = {
  csv: {
    id: 'csv',
    label: 'CSV',
    extensions: ['csv'],
    inputKind: 'text',
  },
  pdStream: {
    id: 'pdStream',
    label: 'pdStream',
    extensions: ['pdstream'],
    inputKind: 'bytes',
  },
  atkcc: {
    id: 'atkcc',
    label: 'ATKCC',
    extensions: ['atkcc'],
    inputKind: 'bytes',
  },
  sqlite: {
    id: 'sqlite',
    label: 'SQLite',
    extensions: ['sqlite'],
    inputKind: 'bytes',
  },
} as const satisfies Record<
  CaptureImportFormatId,
  CaptureImportFormatDefinition
>

export async function importCapture(
  format: CaptureImportFormatId,
  input: string | Uint8Array,
): Promise<CaptureImportResult> {
  switch (format) {
    case 'csv':
      if (typeof input !== 'string') {
        throw new Error('CSV import expects text input')
      }
      return importCsv(input)
    case 'pdStream':
      if (typeof input === 'string') {
        throw new Error('pdStream import expects binary input')
      }
      return importPdStream(input)
    case 'atkcc':
      if (typeof input === 'string') {
        throw new Error('atkcc import expects binary input')
      }
      return importAtkcc(input)
    case 'sqlite':
      if (typeof input === 'string') {
        throw new Error('sqlite import expects binary input')
      }
      return (await import('./formats/sqlite.js')).importSqlite(input)
  }
}
