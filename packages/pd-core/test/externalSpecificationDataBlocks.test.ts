import { describe, expect, test } from 'vitest'
import { decodeMessage } from '../src/index.js'

describe('external-specification Data Blocks', () => {
  test('shows Security_Request as a dedicated raw SRQDB section without assemble requirements', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([0xa8, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
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
        messageBytes: testCase.bytes,
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
      messageBytes: Uint8Array.from([0xa8, 0x90, 0x1d, 0x88, 0xaa, 0xbb, 0xcc]),
    })

    expect(decoded.messageType.name).toBe('Security_Request')
    expect(decoded.explainContext.notes).toHaveLength(0)
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'Extended Message Header',
      'Security Request Data Block (SRQDB)',
    ])
  })

  test('separates final chunk padding from Security_Request raw data', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([
        0x08, 0xa0, 0x1d, 0x88, 0x11, 0x22, 0x33, 0x00, 0x00, 0x00,
      ]),
    })

    const dataBlock = decoded.sections.find(
      (section) => section.title === 'Security Request Data Block (SRQDB)',
    )
    const padding = decoded.sections.find(
      (section) => section.title === 'Padding',
    )

    expect(Array.from(dataBlock?.rawBytes ?? [])).toEqual([0x11, 0x22, 0x33])
    expect(Array.from(padding?.rawBytes ?? [])).toEqual([0x00, 0x00, 0x00])
    expect(padding?.byteOffset).toBe(7)
    expect(padding?.issues).toEqual([])
  })
})
