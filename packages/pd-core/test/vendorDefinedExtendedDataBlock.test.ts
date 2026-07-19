import { describe, expect, test } from 'vitest'
import { decodeMessage } from '../src/index.js'

describe('Vendor Defined Extended Data Block', () => {
  const firstChunk = Uint8Array.from([
    0x1e, 0xf0, 0x1d, 0x80, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13,
    0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
  ])
  const secondChunk = Uint8Array.from([
    0x1e, 0xa0, 0x1d, 0x88, 0x1a, 0x1b, 0x1c, 0x00, 0x00, 0x00,
  ])

  test('keeps chunk 0 raw-only before the full payload is assembled', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: firstChunk,
    })
    const dataBlock = decoded.sections.find(
      (section) => section.title === 'Vendor_Defined_Extended Data Block',
    )

    expect(decoded.explainContext.notes).toContain(
      'Vendor_Defined_Extended remains raw-only until its complete assembled payload is available.',
    )
    expect(dataBlock?.byteLength).toBe(26)
  })

  test('keeps a follow-up chunk raw-only without required prior chunks', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: secondChunk,
    })
    const dataBlock = decoded.sections.find(
      (section) => section.title === 'Vendor_Defined_Extended Data Block',
    )

    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes('requires previous chunk context 0..0'),
      ),
    ).toBe(true)
    expect(dataBlock?.byteLength).toBe(3)
  })

  test('keeps a follow-up chunk raw-only when the prior chunk is out of order', () => {
    const outOfOrderFirstChunk = Uint8Array.from(firstChunk)
    outOfOrderFirstChunk[3] = 0x88
    const decoded = decodeMessage(
      {
        sop: 'SOP',
        messageBytes: secondChunk,
      },
      {
        chunkedExtendedMessage: {
          previousChunks: [
            {
              kind: 'frame',
              frame: {
                sop: 'SOP',
                messageBytes: outOfOrderFirstChunk,
              },
            },
          ],
        },
      },
    )
    const dataBlock = decoded.sections.find(
      (section) => section.title === 'Vendor_Defined_Extended Data Block',
    )

    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes('previous chunk 0 declares Chunk Number 1'),
      ),
    ).toBe(true)
    expect(dataBlock?.byteLength).toBe(3)
  })

  test('preserves an assembled Vendor Defined Extended raw payload', () => {
    const decoded = decodeMessage(
      {
        sop: 'SOP',
        messageBytes: secondChunk,
      },
      {
        chunkedExtendedMessage: {
          previousChunks: [
            {
              kind: 'frame',
              frame: {
                sop: 'SOP',
                messageBytes: firstChunk,
              },
            },
          ],
        },
      },
    )

    const dataBlock = decoded.sections.find(
      (section) => section.title === 'Vendor_Defined_Extended Data Block',
    )

    expect(dataBlock?.byteLength).toBe(29)
    expect(Array.from(dataBlock?.rawBytes ?? [])).toEqual([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
      0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
      0x18, 0x19, 0x1a, 0x1b, 0x1c,
    ])
    expect(
      decoded.sections.some((section) => section.title === 'Padding'),
    ).toBe(false)
  })
})
