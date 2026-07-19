import type { BitField, ExtendedMessageHeader, Section } from '../types.js'
import { extractBits, readUint16Le } from '../utils/bits.js'

function field(
  key: string,
  label: string,
  bitStart: number,
  bitLength: number,
  rawValue: number,
  decodedValue: BitField['decodedValue'],
): BitField {
  return {
    key,
    label,
    bitStart,
    bitLength,
    rawValue,
    decodedValue,
    displayValue: String(decodedValue),
  }
}

export function decodeExtendedMessageHeader(
  bytes: Uint8Array,
): ExtendedMessageHeader {
  const raw16 = readUint16Le(bytes, 0)

  return {
    raw16,
    chunked: extractBits(raw16, 15, 1) === 1,
    chunkNumber: extractBits(raw16, 11, 4),
    requestChunk: extractBits(raw16, 10, 1) === 1,
    dataSize: extractBits(raw16, 0, 9),
  }
}

export function explainExtendedMessageHeader(
  header: ExtendedMessageHeader,
  bytes: Uint8Array,
): Section {
  const reserved = extractBits(header.raw16, 9, 1)
  const issues = []

  if (reserved !== 0) {
    issues.push({
      severity: 'warning' as const,
      code: 'PD_EXTENDED_HEADER_RESERVED_NONZERO',
      message: 'Extended Message Header reserved bit 9 is non-zero.',
    })
  }
  if (!header.chunked && header.chunkNumber !== 0) {
    issues.push({
      severity: 'warning' as const,
      code: 'PD_EXTENDED_HEADER_UNCHUNKED_CHUNK_NUMBER_NONZERO',
      message: 'Unchunked Extended Messages shall use Chunk Number zero.',
    })
  }
  if (!header.chunked && header.requestChunk) {
    issues.push({
      severity: 'warning' as const,
      code: 'PD_EXTENDED_HEADER_UNCHUNKED_REQUEST_CHUNK_SET',
      message: 'Unchunked Extended Messages shall clear Request Chunk.',
    })
  }
  if (header.chunked && header.chunkNumber >= 10) {
    issues.push({
      severity: 'warning' as const,
      code: 'PD_EXTENDED_HEADER_CHUNK_NUMBER_INVALID',
      message:
        'Chunked Extended Message Chunk Number values 10..15 are invalid.',
    })
  }
  if (header.requestChunk && header.dataSize !== 0) {
    issues.push({
      severity: 'warning' as const,
      code: 'PD_EXTENDED_HEADER_REQUEST_CHUNK_DATA_SIZE_NONZERO',
      message:
        'Extended Message Request Chunk frames shall use Data Size zero.',
    })
  }
  if (header.dataSize > 260) {
    issues.push({
      severity: 'warning' as const,
      code: 'PD_EXTENDED_HEADER_DATA_SIZE_TOO_LARGE',
      message: 'Extended Message Data Size shall not exceed 260 bytes.',
    })
  }

  return {
    key: 'extended-message-header',
    kind: 'extended_message_header',
    title: 'Extended Message Header',
    byteOffset: 2,
    byteLength: 2,
    rawBytes: bytes.slice(0, 2),
    fields: [
      field(
        'chunked',
        'Chunked',
        15,
        1,
        header.chunked ? 1 : 0,
        header.chunked,
      ),
      field(
        'chunk_number',
        'Chunk Number',
        11,
        4,
        header.chunkNumber,
        header.chunkNumber,
      ),
      field(
        'request_chunk',
        'Request Chunk',
        10,
        1,
        header.requestChunk ? 1 : 0,
        header.requestChunk,
      ),
      field('reserved', 'Reserved', 9, 1, reserved, reserved),
      field('data_size', 'Data Size', 0, 9, header.dataSize, header.dataSize),
    ],
    issues,
  }
}
