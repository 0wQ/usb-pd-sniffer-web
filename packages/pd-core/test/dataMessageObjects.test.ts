import { describe, expect, test } from 'vitest'
import { decodePacket } from '../src/index.js'

describe('message-specific Data Objects', () => {
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
