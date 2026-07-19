import { describe, expect, test } from 'vitest'
import { decodeMessage, decodePacket } from '../src/index.js'

describe('decode context', () => {
  test('resolves Request RDO kind when Source_Capabilities packet context is provided explicitly', () => {
    const decoded = decodePacket(
      {
        sop: 'SOP',
        packetBytes: Uint8Array.from([
          0xa2, 0x11, 0xc8, 0x20, 0x03, 0x20, 0x11, 0x22, 0x33, 0x44,
        ]),
      },
      {
        sourceCapabilities: {
          kind: 'packet',
          packet: {
            sop: 'SOP',
            packetBytes: Uint8Array.from([
              0xa1, 0x31, 0x2c, 0x91, 0x01, 0x00, 0xc8, 0xd0, 0x02, 0x00, 0x2c,
              0x41, 0x06, 0x00, 0xc9, 0x46, 0x82, 0xb0,
            ]),
          },
        },
      },
    )

    expect(decoded.explainContext.mode).toBe('sequence')
    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes('Resolved Request object position 2'),
      ),
    ).toBe(true)
    expect(
      decoded.sections.some(
        (section) => section.title === 'RDO - Fixed and Variable',
      ),
    ).toBe(true)
  })

  test('ignores Source_Capabilities packet context with an invalid CRC32', () => {
    const decoded = decodePacket(
      {
        sop: 'SOP',
        packetBytes: Uint8Array.from([
          0xa2, 0x11, 0xc8, 0x20, 0x03, 0x20, 0x11, 0x22, 0x33, 0x44,
        ]),
      },
      {
        sourceCapabilities: {
          kind: 'packet',
          packet: {
            sop: 'SOP',
            packetBytes: Uint8Array.from([
              0xa1, 0x31, 0x2c, 0x91, 0x01, 0x00, 0xc8, 0xd0, 0x02, 0x00, 0x2c,
              0x41, 0x06, 0x00, 0xaa, 0xbb, 0xcc, 0xdd,
            ]),
          },
        },
      },
    )

    expect(decoded.explainContext.mode).toBe('single_frame')
    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes('invalid CRC32'),
      ),
    ).toBe(true)
    expect(
      decoded.sections.some((section) => section.title === 'RDO - Common'),
    ).toBe(true)
    expect(
      decoded.sections.some(
        (section) => section.title === 'RDO - Fixed and Variable',
      ),
    ).toBe(false)
  })

  test('ignores Source_Capabilities packet context without a CRC32', () => {
    const decoded = decodeMessage(
      {
        sop: 'SOP',
        messageBytes: Uint8Array.from([0xa2, 0x11, 0xc8, 0x20, 0x03, 0x20]),
      },
      {
        sourceCapabilities: {
          kind: 'packet',
          packet: {
            sop: 'SOP',
            packetBytes: Uint8Array.from([0xa1, 0x31]),
          },
        },
      },
    )

    expect(decoded.explainContext.mode).toBe('single_frame')
    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes('has no CRC32'),
      ),
    ).toBe(true)
    expect(
      decoded.sections.some((section) => section.title === 'RDO - Common'),
    ).toBe(true)
  })

  test('keeps Request on the common RDO branch without Source_Capabilities context', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([
        0xa2, 0x11, 0xc8, 0x20, 0x03, 0x20, 0x11, 0x22, 0x33, 0x44,
      ]),
    })

    expect(decoded.explainContext.mode).toBe('single_frame')
    expect(decoded.explainContext.notes).toHaveLength(0)
    const rdoSection = decoded.sections.find(
      (section) => section.title === 'RDO - Common',
    )

    expect(rdoSection).toBeDefined()
    expect(rdoSection?.semanticKind).toBe('rdo_common')
    expect(
      rdoSection?.fields.some((field) => field.label === 'GiveBack / Reserved'),
    ).toBe(true)
    expect(
      rdoSection?.fields.some((field) => field.label === 'Operating Current'),
    ).toBe(false)
  })

  test('keeps EPR_Source_Capabilities chunk 1 raw-only without previous chunk context', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([
        0xb1, 0xbd, 0x24, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0xd0,
      ]),
    })

    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes('requires previous chunk context 0..0'),
      ),
    ).toBe(true)
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'EPR_Source_Capabilities Data Block',
    ])
  })

  test('assembles EPR_Source_Capabilities chunk 1 when previous chunk context is provided', () => {
    const decoded = decodeMessage(
      {
        sop: 'SOP',
        messageBytes: Uint8Array.from([
          0xb1, 0xbd, 0x24, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0xd0,
        ]),
      },
      {
        chunkedExtendedMessage: {
          previousChunks: [
            {
              kind: 'frame',
              frame: {
                sop: 'SOP',
                messageBytes: Uint8Array.from([
                  0xb1, 0xfb, 0x24, 0x80, 0x2c, 0x91, 0x81, 0x08, 0x2c, 0xd1,
                  0x02, 0x00, 0x0a, 0xb1, 0x04, 0x00, 0xc8, 0x40, 0x06, 0x00,
                  0x48, 0x32, 0xdc, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                ]),
              },
            },
          ],
        },
      },
    )

    expect(decoded.explainContext.mode).toBe('sequence')
    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes(
          'Assembled EPR_Source_Capabilities payload prefix from chunks 0..1',
        ),
      ),
    ).toBe(true)
    expect(
      decoded.sections.some(
        (section) => section.title === 'SPR PDO 7 - Empty PDO',
      ),
    ).toBe(true)
    expect(
      decoded.sections.some(
        (section) => section.title === 'EPR PDO 8 - Empty PDO',
      ),
    ).toBe(true)
    expect(
      decoded.sections.some(
        (section) => section.title === 'EPR PDO 9 - EPR AVS APDO',
      ),
    ).toBe(true)
  })

  test('keeps a chunk raw-only when packet context has an invalid CRC32', () => {
    const decoded = decodeMessage(
      {
        sop: 'SOP',
        messageBytes: Uint8Array.from([
          0xb1, 0xbd, 0x24, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0xd0,
        ]),
      },
      {
        chunkedExtendedMessage: {
          previousChunks: [
            {
              kind: 'packet',
              packet: {
                sop: 'SOP',
                packetBytes: Uint8Array.from([
                  0xb1, 0xfb, 0x24, 0x80, 0x2c, 0x91, 0x81, 0x08, 0x2c, 0xd1,
                  0x02, 0x00, 0x0a, 0xb1, 0x04, 0x00, 0xc8, 0x40, 0x06, 0x00,
                  0x48, 0x32, 0xdc, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                  0xaa, 0xbb, 0xcc, 0xdd,
                ]),
              },
            },
          ],
        },
      },
    )

    expect(decoded.explainContext.mode).toBe('single_frame')
    expect(
      decoded.explainContext.notes.some((note) =>
        note.includes('previous chunk 0 has an invalid CRC32'),
      ),
    ).toBe(true)
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'EPR_Source_Capabilities Data Block',
    ])
  })
})
