import { describe, expect, test } from 'vitest'
import { decodeMessage } from '../src/index.js'
import { extendedMessageBytes } from './messageFixtures.js'

describe('Battery Data Blocks', () => {
  test('routes battery request and capability messages to named layouts', () => {
    const cases = [
      {
        messageType: 0x03,
        payload: [0],
        title: 'Get Battery Cap Data Block',
      },
      {
        messageType: 0x04,
        payload: [0],
        title: 'Get Battery Status Data Block',
      },
      {
        messageType: 0x05,
        payload: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        title: 'Battery Capabilities Data Block',
      },
    ] as const

    for (const testCase of cases) {
      const decoded = decodeMessage({
        sop: 'SOP',
        messageBytes: extendedMessageBytes(
          testCase.messageType,
          testCase.payload,
        ),
      })

      expect(decoded.sections.map((section) => section.title)).toContain(
        testCase.title,
      )
    }
  })

  test('diagnoses a reserved battery reference', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: extendedMessageBytes(0x03, [8]),
    })
    const request = decoded.sections.find(
      (section) => section.title === 'Get Battery Cap Data Block',
    )

    expect(request?.issues.map((issue) => issue.code)).toContain(
      'PD_GET_BATTERY_CAP_REFERENCE_RESERVED',
    )
  })
})
