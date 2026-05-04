import type { ImportFileResult } from '@/types/import'
import { importFromCsv } from '@/utils/csvHelper'
import { importFromAtkcc } from './atkcc'
import { importFromPdStream } from './pdStream'

const MAX_IMPORT_FILE_SIZE = 200 * 1024 * 1024

function getFileExtension(name: string): string {
  const lastDotIndex = name.lastIndexOf('.')
  return lastDotIndex < 0 ? '' : name.slice(lastDotIndex + 1).toLowerCase()
}

function validateFileSize(file: File): void {
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    throw new Error(
      `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (200MB)`,
    )
  }
}

export async function importCaptureFile(file: File): Promise<ImportFileResult> {
  validateFileSize(file)

  const extension = getFileExtension(file.name)

  if (extension === 'csv') {
    return {
      format: 'csv',
      ...importFromCsv(await file.text()),
    }
  }

  if (extension === 'pdstream') {
    return {
      format: 'pdStream',
      ...importFromPdStream(await file.arrayBuffer()),
    }
  }

  if (extension === 'atkcc') {
    return {
      format: 'atkcc',
      ...(await importFromAtkcc(await file.arrayBuffer())),
    }
  }

  throw new Error(
    'Unsupported file type. Please select a CSV, pdStream, or atkcc file',
  )
}
