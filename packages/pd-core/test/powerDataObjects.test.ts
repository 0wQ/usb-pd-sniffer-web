import { describe, expect, test } from 'vitest'
import { decodeMessage, decodePacket } from '../src/index.js'

describe('Power Data Objects', () => {
  test('routes Source and Sink capabilities through their PDO layouts', () => {
    const cases = [
      { messageType: 0x01, name: 'Source_Capabilities' },
      { messageType: 0x04, name: 'Sink_Capabilities' },
    ] as const

    for (const testCase of cases) {
      const decoded = decodeMessage({
        sop: 'SOP',
        messageBytes: Uint8Array.from([
          0x80 | testCase.messageType,
          0x10,
          0x2c,
          0x91,
          0x01,
          0x00,
        ]),
      })

      expect(decoded.messageType.name).toBe(testCase.name)
      expect(
        decoded.sections.some((section) =>
          section.title.includes('PDO 1 - Fixed Supply'),
        ),
      ).toBe(true)
    }
  })

  test('preserves a truncated PDO as trailing raw payload', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([0x81, 0x10, 0xaa, 0xbb, 0xcc]),
    })

    const trailing = decoded.sections.find(
      (section) => section.title === 'Trailing Raw Payload',
    )

    expect(Array.from(trailing?.rawBytes ?? [])).toEqual([0xaa, 0xbb, 0xcc])
    expect(trailing?.issues.map((issue) => issue.code)).toContain(
      'PD_PAYLOAD_NOT_32BIT_ALIGNED',
    )
  })

  test('labels USB PD R3.2 v1.2 EPR AVS Sink PDO low byte as Maximum Power', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([
        0x84, 0x10, 0x8c, 0x96, 0xc0, 0xd3, 0x0e, 0xf9, 0x32, 0xde,
      ]),
    })

    const eprAvs = decoded.sections.find(
      (section) => section.title === 'PDO 1 - EPR AVS APDO',
    )

    expect(
      eprAvs?.fields.find((field) => field.key === 'maximum_power'),
    ).toMatchObject({
      label: 'Maximum Power',
      decodedValue: 140,
      displayValue: '140 W',
    })
    expect(eprAvs?.fields.some((field) => field.key === 'pdp')).toBe(false)
    expect(decoded.crc.checkStatus).toBe('valid')
  })

  test('decodes all-zero Source_Capabilities objects as Empty PDO', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([0xa1, 0x11, 0x00, 0x00, 0x00, 0x00]),
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
      messageBytes: Uint8Array.from([
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

  test('applies the same neutral position titles to EPR_Sink_Capabilities', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([
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
