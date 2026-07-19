import { describe, expect, test } from 'vitest'
import { decodePacket } from '../src/index.js'

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
})
