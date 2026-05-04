import { extractBits, readUint16Le } from '../utils/bits.js'
import type { BitField, ExtendedMessageHeader, Section } from '../types.js'

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
    issues:
      reserved === 0
        ? []
        : [
            {
              severity: 'warning',
              code: 'PD_EXTENDED_HEADER_RESERVED_NONZERO',
              message: 'Extended Message Header reserved bit 9 is non-zero.',
            },
          ],
  }
}
