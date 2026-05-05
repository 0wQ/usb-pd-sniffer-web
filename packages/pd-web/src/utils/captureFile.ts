import {
  CAPTURE_IMPORT_FORMATS,
  type CaptureExportResult,
  type CaptureImportFormatId,
  type CaptureImportResult,
  importCapture,
} from '@usb-pd-sniffer/pd-capture-import-export'

const MAX_IMPORT_FILE_SIZE = 200 * 1024 * 1024

export type ImportFileResult = CaptureImportResult & {
  format: CaptureImportFormatId
}

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

function findImportFormatForExtension(
  extension: string,
): CaptureImportFormatId | null {
  for (const formatId of Object.keys(
    CAPTURE_IMPORT_FORMATS,
  ) as CaptureImportFormatId[]) {
    const format = CAPTURE_IMPORT_FORMATS[formatId]
    if ((format.extensions as readonly string[]).includes(extension)) {
      return formatId
    }
  }

  return null
}

export async function importCaptureFile(file: File): Promise<ImportFileResult> {
  validateFileSize(file)

  const format = findImportFormatForExtension(getFileExtension(file.name))
  if (format === null) {
    throw new Error(
      'Unsupported file type. Please select a CSV, pdStream, sqlite, or atkcc file',
    )
  }

  const formatDefinition = CAPTURE_IMPORT_FORMATS[format]
  const result =
    formatDefinition.inputKind === 'text'
      ? await importCapture(format, await file.text())
      : await importCapture(format, new Uint8Array(await file.arrayBuffer()))

  return {
    format,
    ...result,
  }
}

export function generateCaptureFilename(extension: string): string {
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '')
  return `capture_record_${date}_${time}.${extension}`
}

export function downloadCaptureExport(
  exportResult: CaptureExportResult,
  filename: string,
): void {
  const blob =
    'text' in exportResult
      ? new Blob(
          [
            exportResult.mime.startsWith('text/csv') ? '\uFEFF' : '',
            exportResult.text,
          ],
          { type: exportResult.mime },
        )
      : (() => {
          const copy = new Uint8Array(exportResult.bytes.byteLength)
          copy.set(exportResult.bytes)
          return new Blob([copy], { type: exportResult.mime })
        })()

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
