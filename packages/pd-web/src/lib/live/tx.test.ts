import { describe, expect, test } from 'vitest'
import { parsePdHexPayload, previewPdTxFrame } from './tx'

describe('web native tx helpers', () => {
  test('parses spaced hex payload into bytes', () => {
    expect(Array.from(parsePdHexPayload('42 10 aa bb'))).toEqual([0x42, 0x10, 0xaa, 0xbb])
  })

  test('parses compact and 0x-prefixed hex payload into bytes', () => {
    expect(Array.from(parsePdHexPayload('0x4210AABB'))).toEqual([0x42, 0x10, 0xaa, 0xbb])
  })

  test('rejects odd-length hex payload', () => {
    expect(() => parsePdHexPayload('421')).toThrow('even')
  })

  test('rejects non-hex payload', () => {
    expect(() => parsePdHexPayload('42 zz')).toThrow('non-hex')
  })

  test('builds local preview decode for tx payload', () => {
    const preview = previewPdTxFrame('SOP', '42 10 aa bb')

    expect(preview.frame).toEqual({
      sop: 'SOP',
      bytes: Uint8Array.from([0x42, 0x10, 0xaa, 0xbb]),
    })
    expect(preview.decoded.messageType.name).toBe('Request')
  })
})
