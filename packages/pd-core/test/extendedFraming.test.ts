import { describe, expect, test } from 'vitest'
import { decodeMessage, decodePacket } from '../src/index.js'
import { extendedMessageBytes } from './messageFixtures.js'

describe('Extended Message framing', () => {
  test('preserves reserved Extended Message types as generic raw data', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: extendedMessageBytes(0x13, [0x11, 0x22, 0x33]),
    })

    expect(decoded.messageType.name).toBeNull()
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'Unknown Extended Data Block',
    ])
    expect(Array.from(decoded.sections[2]?.rawBytes ?? [])).toEqual([
      0x11, 0x22, 0x33,
    ])
  })

  test('uses Data Size instead of NDO length for unchunked extended messages', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([
        0xa4, 0x90, 0x01, 0x00, 0x01, 0x4e, 0x75, 0x00, 0x88,
      ]),
    })

    expect(decoded.packetLayout.actualMessageByteLength).toBe(5)
    expect(decoded.packetLayout.expectedMessageByteLength).toBe(5)
    expect(
      decoded.issues.some(
        (issue) => issue.code === 'PD_MESSAGE_LENGTH_MISMATCH',
      ),
    ).toBe(false)
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'Get Battery Status Data Block (GBSDB)',
      'CRC32',
    ])
  })

  test('diagnoses invalid Extended Message Header field combinations', () => {
    const unchunked = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([
        0x1e, 0x90, 0x04, 0x0c, 0xaa, 0xbb, 0xcc, 0xdd,
      ]),
    })
    const chunked = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([0x1e, 0x90, 0x05, 0xd1, 0x00, 0x00]),
    })
    const unchunkedIssues = unchunked.sections.find(
      (section) => section.title === 'Extended Message Header',
    )?.issues
    const chunkedIssues = chunked.sections.find(
      (section) => section.title === 'Extended Message Header',
    )?.issues

    expect(unchunkedIssues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'PD_EXTENDED_HEADER_UNCHUNKED_CHUNK_NUMBER_NONZERO',
        'PD_EXTENDED_HEADER_UNCHUNKED_REQUEST_CHUNK_SET',
        'PD_EXTENDED_HEADER_REQUEST_CHUNK_DATA_SIZE_NONZERO',
      ]),
    )
    expect(chunkedIssues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'PD_EXTENDED_HEADER_CHUNK_NUMBER_INVALID',
        'PD_EXTENDED_HEADER_DATA_SIZE_TOO_LARGE',
      ]),
    )
  })

  test('shows Request Chunk payload bytes as padding', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([
        0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00, 0xe6, 0x1a, 0x4d, 0xe6,
      ]),
    })

    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes('requests chunk 1'),
      ),
    ).toBe(true)
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'Padding',
      'CRC32',
    ])

    const paddingSection = decoded.sections.find(
      (section) => section.title === 'Padding',
    )
    expect(paddingSection?.byteOffset).toBe(4)
    expect(paddingSection?.byteLength).toBe(2)
    expect(Array.from(paddingSection?.rawBytes ?? [])).toEqual([0x00, 0x00])
    expect(paddingSection?.fields[0]?.label).toBe('Padding')
    expect(paddingSection?.fields[0]?.displayValue).toBe('0')
  })

  test('reports non-zero Request Chunk padding bytes', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([
        0xb1, 0x9e, 0x00, 0x8c, 0x01, 0x00, 0xa7, 0x2b, 0x56, 0xff,
      ]),
    })

    const paddingSection = decoded.sections.find(
      (section) => section.title === 'Padding',
    )

    expect(Array.from(paddingSection?.rawBytes ?? [])).toEqual([0x01, 0x00])
    expect(
      paddingSection?.issues.some(
        (issue) => issue.code === 'PD_EXTENDED_MESSAGE_PADDING_NONZERO',
      ),
    ).toBe(true)
  })
})
