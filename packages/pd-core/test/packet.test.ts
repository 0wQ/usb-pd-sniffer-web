import { describe, expect, expectTypeOf, test } from 'vitest'
import {
  calculatePdCrc32,
  decodePacket,
  type MessageFrame,
  type MessagePacket,
} from '../src/index.js'

describe('packet decoding', () => {
  test('keeps packet and CRC-free frame inputs structurally distinct', () => {
    expectTypeOf<MessagePacket>().not.toMatchTypeOf<MessageFrame>()
    expectTypeOf<MessageFrame>().not.toMatchTypeOf<MessagePacket>()
  })

  test('splits CRC32 from the packet tail instead of truncating by header-derived length', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([
        0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00, 0xe6, 0x1a, 0x4d, 0xe6,
      ]),
    })

    expect(Array.from(decoded.frame.messageBytes)).toEqual([
      0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00,
    ])
    expect(decoded.packetLayout.actualMessageByteLength).toBe(6)
    expect(decoded.packetLayout.expectedMessageByteLength).toBe(6)
    expect(Array.from(decoded.crc.rawBytes)).toEqual([0xe6, 0x1a, 0x4d, 0xe6])
    expect(decoded.crc.raw32).toBe(0xe64d1ae6)
    expect(decoded.crc.expectedRaw32).toBe(0xe64d1ae6)
    expect(decoded.crc.status).toBe('present')
    expect(decoded.crc.checkStatus).toBe('valid')
    expect(calculatePdCrc32(decoded.frame.messageBytes)).toBe(0xe64d1ae6)
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
      packetBytes: Uint8Array.from([
        0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00, 0xe7, 0x1a, 0x4d, 0xe6,
      ]),
    })

    expect(Array.from(decoded.frame.messageBytes)).toEqual([
      0xb1, 0x9e, 0x00, 0x8c, 0x00, 0x00,
    ])
    expect(decoded.crc.raw32).toBe(0xe64d1ae7)
    expect(decoded.crc.expectedRaw32).toBe(0xe64d1ae6)
    expect(decoded.crc.status).toBe('present')
    expect(decoded.crc.checkStatus).toBe('invalid')
    expect(
      decoded.issues.some((issue) => issue.code === 'PD_CRC32_INVALID'),
    ).toBe(false)
    expect(
      decoded.sections
        .find((section) => section.title === 'CRC32')
        ?.issues.some((issue) => issue.code === 'PD_CRC32_INVALID'),
    ).toBe(true)
  })

  test('reports packets shorter than message header plus CRC32', () => {
    const decoded = decodePacket({
      sop: 'SOP',
      packetBytes: Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a]),
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
})
