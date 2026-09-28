import { describe, expect, test } from 'vitest'
import { decodeMessage, decodePacket } from '../src/index.js'

describe('Extended Control Data Block', () => {
  test('does not emit empty generic payload container sections for Extended_Control', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([
        0xb0, 0x92, 0x02, 0x80, 0x03, 0x00, 0x6e, 0x46, 0xdf, 0x60,
      ]),
    })

    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'Extended Control Data Block (ECDB)',
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

  test('diagnoses reserved type and nonzero data', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([0x90, 0x90, 0x02, 0x00, 0x00, 0x01]),
    })
    const control = decoded.sections.find(
      (section) => section.title === 'Extended Control Data Block (ECDB)',
    )

    expect(control?.issues.map((issue) => issue.code)).toEqual([
      'PD_EXTENDED_CONTROL_TYPE_RESERVED',
      'PD_EXTENDED_CONTROL_DATA_NONZERO',
    ])
  })
})
