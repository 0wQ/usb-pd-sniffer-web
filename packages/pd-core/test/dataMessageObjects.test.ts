import { describe, expect, test } from 'vitest'
import { decodeMessage, decodePacket } from '../src/index.js'

describe('message-specific Data Objects', () => {
  test('routes every Table 6.23 through 6.31 Data Object to its named layout', () => {
    const cases = [
      {
        name: 'BIST',
        messageBytes: [0x83, 0x10, 0x00, 0x00, 0x00, 0x50],
        title: 'BIST Data Object',
      },
      {
        name: 'Battery_Status',
        messageBytes: [0x85, 0x10, 0xff, 0xff, 0x00, 0x00],
        title: 'Battery Status Data Object',
      },
      {
        name: 'Alert',
        messageBytes: [0x86, 0x10, 0x00, 0x00, 0x00, 0x00],
        title: 'Alert Data Object',
      },
      {
        name: 'Get_Country_Info',
        messageBytes: [0x87, 0x10, 0x00, 0x00, 0x53, 0x55],
        title: 'Country Code Data Object',
      },
      {
        name: 'Enter_USB',
        messageBytes: [0x88, 0x10, 0x00, 0x00, 0x00, 0x00],
        title: 'Enter USB Data Object',
      },
      {
        name: 'EPR_Mode',
        messageBytes: [0x8a, 0x10, 0x00, 0x00, 0x64, 0x01],
        title: 'EPR Mode Data Object',
      },
      {
        name: 'Source_Info',
        messageBytes: [
          0x8b, 0x20, 0x64, 0x64, 0x8c, 0x00, 0x78, 0x30, 0x02, 0x40,
        ],
        title: 'Source Information Data Object 1',
      },
      {
        name: 'Revision',
        messageBytes: [0x8c, 0x10, 0x00, 0x00, 0x21, 0x32],
        title: 'Revision Message Data Object',
      },
    ] as const

    for (const testCase of cases) {
      const decoded = decodeMessage({
        sop: 'SOP',
        messageBytes: Uint8Array.from(testCase.messageBytes),
      })

      expect(decoded.messageType.name).toBe(testCase.name)
      expect(
        decoded.sections.some((section) => section.title === testCase.title),
      ).toBe(true)
    }
  })

  test('keeps reserved Data Message types on the generic object fallback', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([0x8d, 0x10, 0x78, 0x56, 0x34, 0x12]),
    })

    expect(decoded.messageType.name).toBeNull()
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Data Object 1',
    ])
    expect(decoded.sections[1]?.semanticKind).toBe('raw_data_object')
  })

  test('keeps invalid extra BIST objects visible and diagnoses the shape', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([
        0x83, 0x20, 0x00, 0x00, 0x00, 0x50, 0x78, 0x56, 0x34, 0x12,
      ]),
    })
    const bist = decoded.sections.find(
      (section) => section.title === 'BIST Data Object',
    )

    expect(bist?.issues.map((issue) => issue.code)).toContain(
      'PD_BIST_OBJECT_COUNT_INVALID',
    )
    expect(decoded.sections.map((section) => section.title)).toContain(
      'BIST Test Data Object 2',
    )
  })

  test('decodes USB PD R3.2 v1.2 Source_Info SIDO1 and DPS SIDO2', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([
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
      packetBytes: Uint8Array.from([
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
})
