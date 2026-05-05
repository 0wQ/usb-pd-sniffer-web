import { inflateSync } from 'fflate'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_MAX_COMMENT_LENGTH = 0xffff
const ZIP_EOCD_MIN_SIZE = 22

export type ZipEntry = {
  filename: string
  data: Uint8Array
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

function sliceBytes(
  bytes: Uint8Array,
  offset: number,
  length: number,
): Uint8Array {
  return bytes.subarray(offset, offset + length)
}

function decodeBytes(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(
    0,
    view.byteLength - ZIP_MAX_COMMENT_LENGTH - ZIP_EOCD_MIN_SIZE,
  )

  for (
    let offset = view.byteLength - ZIP_EOCD_MIN_SIZE;
    offset >= minOffset;
    offset -= 1
  ) {
    if (readUint32(view, offset) === EOCD_SIGNATURE) {
      return offset
    }
  }

  throw new Error('Invalid ZIP file: end of central directory not found')
}

function inflateRaw(data: Uint8Array): Uint8Array {
  return inflateSync(data)
}

function readEntryData(
  bytes: Uint8Array,
  view: DataView,
  localHeaderOffset: number,
  compressionMethod: number,
  compressedSize: number,
): Uint8Array {
  if (readUint32(view, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error('Invalid ZIP file: local file header not found')
  }

  const localFileNameLength = readUint16(view, localHeaderOffset + 26)
  const localExtraLength = readUint16(view, localHeaderOffset + 28)
  const dataOffset =
    localHeaderOffset + 30 + localFileNameLength + localExtraLength
  const compressedData = sliceBytes(bytes, dataOffset, compressedSize)

  if (compressionMethod === 0) {
    return compressedData.slice()
  }

  if (compressionMethod === 8) {
    return inflateRaw(compressedData)
  }

  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`)
}

export async function unzipEntries(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(view)
  const entryCount = readUint16(view, eocdOffset + 10)
  const centralDirectorySize = readUint32(view, eocdOffset + 12)
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16)
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize

  let offset = centralDirectoryOffset
  const entries: ZipEntry[] = []

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd) {
      throw new Error('Invalid ZIP file: central directory truncated')
    }

    if (readUint32(view, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid ZIP file: central directory entry not found')
    }

    const compressionMethod = readUint16(view, offset + 10)
    const compressedSize = readUint32(view, offset + 20)
    const uncompressedSize = readUint32(view, offset + 24)
    const fileNameLength = readUint16(view, offset + 28)
    const extraLength = readUint16(view, offset + 30)
    const commentLength = readUint16(view, offset + 32)
    const localHeaderOffset = readUint32(view, offset + 42)
    const fileNameOffset = offset + 46
    const filename = decodeBytes(
      sliceBytes(bytes, fileNameOffset, fileNameLength),
    )

    offset += 46 + fileNameLength + extraLength + commentLength

    if (filename.endsWith('/')) {
      continue
    }

    const data = readEntryData(
      bytes,
      view,
      localHeaderOffset,
      compressionMethod,
      compressedSize,
    )

    if (data.length !== uncompressedSize) {
      throw new Error(`Invalid ZIP entry size for ${filename}`)
    }

    entries.push({ filename, data })
  }

  return entries
}
