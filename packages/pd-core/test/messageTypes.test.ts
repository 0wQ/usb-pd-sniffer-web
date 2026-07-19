import { describe, expect, test } from 'vitest'
import { decodeMessage } from '../src/index.js'

describe('message type names', () => {
  test('covers all spec-defined control message names through Get_Revision', () => {
    const expectedControlTypes = new Map<number, string>([
      [0x01, 'GoodCRC'],
      [0x02, 'GotoMin'],
      [0x03, 'Accept'],
      [0x04, 'Reject'],
      [0x05, 'Ping'],
      [0x06, 'PS_RDY'],
      [0x07, 'Get_Source_Cap'],
      [0x08, 'Get_Sink_Cap'],
      [0x09, 'DR_Swap'],
      [0x0a, 'PR_Swap'],
      [0x0b, 'VCONN_Swap'],
      [0x0c, 'Wait'],
      [0x0d, 'Soft_Reset'],
      [0x0e, 'Data_Reset'],
      [0x0f, 'Data_Reset_Complete'],
      [0x10, 'Not_Supported'],
      [0x11, 'Get_Source_Cap_Extended'],
      [0x12, 'Get_Status'],
      [0x13, 'FR_Swap'],
      [0x14, 'Get_PPS_Status'],
      [0x15, 'Get_Country_Codes'],
      [0x16, 'Get_Sink_Cap_Extended'],
      [0x17, 'Get_Source_Info'],
      [0x18, 'Get_Revision'],
    ])

    for (const [code, expectedName] of expectedControlTypes) {
      expect(
        decodeMessage({
          sop: 'SOP',
          messageBytes: Uint8Array.from([code, 0x00]),
        }).messageType.name,
      ).toBe(expectedName)
    }

    expect(
      decodeMessage({
        sop: 'SOP',
        messageBytes: Uint8Array.from([0x00, 0x00]),
      }).messageType.name,
    ).toBeNull()
    expect(
      decodeMessage({
        sop: 'SOP',
        messageBytes: Uint8Array.from([0x19, 0x00]),
      }).messageType.name,
    ).toBeNull()
  })

  test('keeps Message Type meaning semantic without duplicating the raw value', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([0x01, 0x00]),
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
      messageBytes: Uint8Array.from([0x8f, 0x51]),
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
      messageBytes: Uint8Array.from([0xaf, 0x51]),
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
})
