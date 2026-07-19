// @ts-nocheck
import { describe, expect, test } from 'vitest'
import { calculatePdCrc32 } from '../utils/pdCrc32.js'
import { decodeMessage, decodePacket } from './message.js'

describe('decodePacket', () => {
  test('splits CRC32 from the packet tail instead of truncating by header-derived length', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([
        0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00, 0xe6, 0x1a, 0x4d, 0xe6,
      ]),
    })

    expect(Array.from(decoded.frame.bytes)).toEqual([
      0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00,
    ])
    expect(decoded.packetLayout.actualMessageByteLength).toBe(6)
    expect(decoded.packetLayout.expectedMessageByteLength).toBe(6)
    expect(Array.from(decoded.crc.rawBytes)).toEqual([0xe6, 0x1a, 0x4d, 0xe6])
    expect(decoded.crc.raw32).toBe(0xe64d1ae6)
    expect(decoded.crc.expectedRaw32).toBe(0xe64d1ae6)
    expect(decoded.crc.status).toBe('present')
    expect(decoded.crc.checkStatus).toBe('valid')
    expect(calculatePdCrc32(decoded.frame.bytes)).toBe(0xe64d1ae6)
    expect(
      decoded.issues.some((issue) => issue.code === 'PD_CRC32_INVALID'),
    ).toBe(false)
    expect(
      decoded.sections.some(
        (section) => section.title === 'Trailing Raw Bytes',
      ),
    ).toBe(false)
  })

  test('reports invalid CRC32 without changing packet tail splitting', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([
        0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00, 0xe7, 0x1a, 0x4d, 0xe6,
      ]),
    })

    expect(Array.from(decoded.frame.bytes)).toEqual([
      0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00,
    ])
    expect(decoded.crc.raw32).toBe(0xe64d1ae7)
    expect(decoded.crc.expectedRaw32).toBe(0xe64d1ae6)
    expect(decoded.crc.status).toBe('present')
    expect(decoded.crc.checkStatus).toBe('invalid')
    expect(
      decoded.issues.some((issue) => issue.code === 'PD_CRC32_INVALID'),
    ).toBe(true)
    expect(
      decoded.sections
        .find((section) => section.title === 'CRC32')
        ?.issues.some((issue) => issue.code === 'PD_CRC32_INVALID'),
    ).toBe(true)
  })

  test('accepts the USB PD R3.2 v1.2 Active Cable VDO1 Version 1.3', () => {
    const decoded = decodePacket({
      sop: 'SOP_PRIME',
      bytes: Uint8Array.from([
        0x8f, 0x61, 0x41, 0xa0, 0x00, 0xff, 0x34, 0x12, 0x60, 0x20, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x30, 0x68, 0x00, 0x00, 0x00,
        0x00, 0x00, 0xe5, 0x53, 0x25, 0x70,
      ]),
    })

    const activeCableVdo1 = decoded.sections.find(
      (section) => section.title === 'Active Cable VDO1',
    )

    expect(
      activeCableVdo1?.fields.find((field) => field.key === 'vdo_version'),
    ).toMatchObject({
      rawValue: 3,
      displayValue: 'Version 1.3',
    })
    expect(
      activeCableVdo1?.issues.some(
        (issue) => issue.code === 'PD_ACTIVE_CABLE_VDO1_VERSION_RESERVED',
      ),
    ).toBe(false)
    expect(decoded.crc.checkStatus).toBe('valid')
  })

  test('decodes USB PD R3.2 v1.2 Source_Info SIDO1 and DPS SIDO2', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([
        0x8b, 0x20, 0x64, 0x64, 0x8c, 0x00, 0x78, 0x30, 0x02, 0x40, 0xc6, 0x44,
        0xbe, 0xf3,
      ]),
    })

    const sido2 = decoded.sections.find(
      (section) => section.title === 'Source Information Data Object 2',
    )

    expect(decoded.sections.map((section) => section.title)).toContain(
      'Source Information Data Object 1',
    )
    expect(
      sido2?.fields.find((field) => field.key === 'dps_port'),
    ).toMatchObject({
      decodedValue: true,
      displayValue: 'DPS Port',
    })
    expect(
      sido2?.fields.find((field) => field.key === 'port_maximum_pdp'),
    ).toMatchObject({
      decodedValue: 140,
      displayValue: '140 W',
    })
    expect(
      decoded.sections
        .flatMap((section) => section.issues)
        .some((issue) => issue.code === 'PD_SOURCE_INFO_OBJECT_COUNT_INVALID'),
    ).toBe(false)
    expect(decoded.crc.checkStatus).toBe('valid')
  })

  test('accepts USB PD R3.2 v1.2 Alert Extended Event Type 5', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([
        0x86, 0x10, 0x05, 0x00, 0x00, 0x80, 0xf6, 0xb2, 0xad, 0xc3,
      ]),
    })

    const alert = decoded.sections.find(
      (section) => section.title === 'Alert Data Object',
    )

    expect(
      alert?.fields.find((field) => field.key === 'extended_alert_event_type'),
    ).toMatchObject({
      rawValue: 5,
      displayValue: 'Source is about to reduce Source Capabilities',
    })
    expect(
      alert?.issues.some(
        (issue) => issue.code === 'PD_ALERT_EXTENDED_TYPE_RESERVED',
      ),
    ).toBe(false)
    expect(decoded.crc.checkStatus).toBe('valid')
  })

  test('does not emit empty generic payload container sections for Extended_Control', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([
        0xb0, 0x92, 0x02, 0x80, 0x03, 0x00, 0x6e, 0x46, 0xdf, 0x60,
      ]),
    })

    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'Extended Control Data Block',
      'CRC32',
    ])
    expect(
      decoded.sections.every(
        (section) =>
          !Object.hasOwn(section, 'parentSectionKey') &&
          !Object.hasOwn(section, 'depth'),
      ),
    ).toBe(true)
  })

  test('uses Data Size instead of NDO length for unchunked extended messages', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([
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
      'Get Battery Status Data Block',
      'CRC32',
    ])
  })

  test('shows Security_Request as a dedicated raw SRQDB section without assemble requirements', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      bytes: Uint8Array.from([0xa8, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
    })

    expect(decoded.messageType.name).toBe('Security_Request')
    expect(decoded.explainContext.notes).toHaveLength(0)
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'Security Request Data Block (SRQDB)',
    ])
  })

  test('shows dedicated raw data-block titles for Security_Response and Firmware Update messages', () => {
    const cases = [
      {
        bytes: Uint8Array.from([0xa9, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
        messageTypeName: 'Security_Response',
        title: 'Security Response Data Block (SRPDB)',
      },
      {
        bytes: Uint8Array.from([0xaa, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
        messageTypeName: 'Firmware_Update_Request',
        title: 'Firmware Update Request Data Block (FRQDB)',
      },
      {
        bytes: Uint8Array.from([0xab, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
        messageTypeName: 'Firmware_Update_Response',
        title: 'Firmware Update Response Data Block (FRPDB)',
      },
    ] as const

    for (const testCase of cases) {
      const decoded = decodeMessage({
        sop: 'SOP',
        bytes: testCase.bytes,
      })

      expect(decoded.messageType.name).toBe(testCase.messageTypeName)
      expect(
        decoded.sections.some((section) => section.title === testCase.title),
      ).toBe(true)
    }
  })

  test('shows chunked Security_Request follow-up chunks as SRQDB raw without previous chunk context', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      bytes: Uint8Array.from([0xa8, 0x90, 0x07, 0x88, 0xaa, 0xbb, 0xcc]),
    })

    expect(decoded.messageType.name).toBe('Security_Request')
    expect(decoded.explainContext.notes).toHaveLength(0)
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'Security Request Data Block (SRQDB)',
    ])
  })

  test('shows Request Chunk payload bytes as padding', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([
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
      bytes: Uint8Array.from([
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

  test('reports packets shorter than message header plus CRC32', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a]),
    })

    expect(
      decoded.issues.some((issue) => issue.code === 'PD_PACKET_TOO_SHORT'),
    ).toBe(true)
    expect(decoded.crc.status).toBe('missing')
    expect(decoded.crc.checkStatus).toBe('not_applicable')
    expect(decoded.crc.raw32).toBeNull()
    expect(decoded.crc.expectedRaw32).toBeNull()
    expect(Array.from(decoded.crc.rawBytes)).toEqual([])
    expect(decoded.packetLayout.crcByteLength).toBe(0)
    expect(decoded.packetLayout.crcByteOffset).toBeNull()
    expect(
      decoded.sections.some(
        (section) => section.title === 'Trailing Raw Bytes',
      ),
    ).toBe(false)
  })

  test('resolves Request RDO kind when Source_Capabilities packet context is provided explicitly', () => {
    const decoded = decodePacket(
      {
        sop: 'SOP',
        bytes: Uint8Array.from([
          0xa2, 0x11, 0xc8, 0x20, 0x03, 0x20, 0x11, 0x22, 0x33, 0x44,
        ]),
      },
      {
        sourceCapabilities: {
          kind: 'packet',
          packet: {
            sop: 'SOP',
            bytes: Uint8Array.from([
              0xa1, 0x31, 0x2c, 0x91, 0x01, 0x00, 0xc8, 0xd0, 0x02, 0x00, 0x2c,
              0x41, 0x06, 0x00, 0xaa, 0xbb, 0xcc, 0xdd,
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

  test('keeps Request on the common RDO branch without Source_Capabilities context', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      bytes: Uint8Array.from([
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
})

describe('decodeMessage', () => {
  test('keeps Message Type meaning semantic without duplicating the raw value', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      bytes: Uint8Array.from([0x01, 0x00]),
    })

    const headerSection = decoded.sections.find(
      (section) => section.title === 'Message Header',
    )
    const messageTypeField = headerSection?.fields.find(
      (field) => field.label === 'Message Type',
    )

    expect(decoded.messageType.name).toBe('GoodCRC')
    expect(messageTypeField?.rawValue).toBe(1)
    expect(messageTypeField?.displayValue).toBe('GoodCRC')
  })

  test('shows Message Header B5 as Reserved for SOP prime packets', () => {
    const decoded = decodeMessage({
      sop: 'SOP_PRIME',
      bytes: Uint8Array.from([0x8f, 0x51]),
    })

    const headerSection = decoded.sections.find(
      (section) => section.title === 'Message Header',
    )
    const bit5Field = headerSection?.fields.find(
      (field) => field.bitStart === 5,
    )

    expect(bit5Field?.label).toBe('Reserved')
    expect(bit5Field?.rawValue).toBe(0)
    expect(bit5Field?.displayValue).toBe('0')
    expect(bit5Field?.note).toBeUndefined()
    expect(headerSection?.issues).toHaveLength(0)
  })

  test('reports non-zero Message Header B5 for SOP prime packets', () => {
    const decoded = decodeMessage({
      sop: 'SOP_PRIME',
      bytes: Uint8Array.from([0xaf, 0x51]),
    })

    const headerSection = decoded.sections.find(
      (section) => section.title === 'Message Header',
    )
    const bit5Field = headerSection?.fields.find(
      (field) => field.bitStart === 5,
    )

    expect(bit5Field?.label).toBe('Reserved')
    expect(bit5Field?.rawValue).toBe(1)
    expect(bit5Field?.displayValue).toBe('1')
    expect(
      headerSection?.issues.some(
        (issue) => issue.code === 'PD_MESSAGE_HEADER_RESERVED_B5_NONZERO',
      ),
    ).toBe(true)
  })

  test('decodes all-zero Source_Capabilities objects as Empty PDO', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      bytes: Uint8Array.from([0xa1, 0x11, 0x00, 0x00, 0x00, 0x00]),
    })

    expect(decoded.messageType.name).toBe('Source_Capabilities')
    const emptyPdoSection = decoded.sections.find(
      (section) => section.title === 'PDO 1 - Empty PDO',
    )

    expect(emptyPdoSection).toBeDefined()
    expect(emptyPdoSection?.fields).toHaveLength(1)
    expect(emptyPdoSection?.fields[0]?.label).toBe('Empty PDO')
    expect(emptyPdoSection?.fields[0]?.displayValue).toBe('Empty PDO')
  })

  test('decodes EPR_Source_Capabilities chunk 0 as a partial semantic prefix', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      bytes: Uint8Array.from([
        0xb1, 0xfb, 0x24, 0x80, 0x2c, 0x91, 0x81, 0x08, 0x2c, 0xd1, 0x02, 0x00,
        0x0a, 0xb1, 0x04, 0x00, 0xc8, 0x40, 0x06, 0x00, 0x48, 0x32, 0xdc, 0xc0,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    })

    expect(decoded.messageType.name).toBe('EPR_Source_Capabilities')
    expect(
      decoded.sections.some(
        (section) => section.title === 'SPR PDO 1 - Fixed Supply',
      ),
    ).toBe(true)
    expect(
      decoded.sections.some(
        (section) => section.title === 'SPR PDO 5 - SPR PPS APDO',
      ),
    ).toBe(true)
    expect(
      decoded.sections.some(
        (section) => section.title === 'SPR PDO 6 - Empty PDO',
      ),
    ).toBe(true)
    expect(
      decoded.sections.some(
        (section) => section.title === 'Trailing Raw Payload',
      ),
    ).toBe(true)
  })

  test('keeps EPR_Source_Capabilities chunk 1 raw-only without previous chunk context', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      bytes: Uint8Array.from([
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
        bytes: Uint8Array.from([
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
                bytes: Uint8Array.from([
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

  test('applies the same neutral position titles to EPR_Sink_Capabilities', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      bytes: Uint8Array.from([
        0xb2, 0xfb, 0x24, 0x80, 0x2c, 0x91, 0x81, 0x08, 0x2c, 0xd1, 0x02, 0x00,
        0x0a, 0xb1, 0x04, 0x00, 0xc8, 0x40, 0x06, 0x00, 0x48, 0x32, 0xdc, 0xc0,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    })

    expect(decoded.messageType.name).toBe('EPR_Sink_Capabilities')
    expect(
      decoded.sections.some(
        (section) => section.title === 'SPR PDO 6 - Empty PDO',
      ),
    ).toBe(true)
  })
})
