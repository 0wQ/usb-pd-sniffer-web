import { describe, expect, test } from 'vitest'
import { decodeMessage } from '../src/index.js'
import { extendedMessageBytes } from './messageFixtures.js'

describe('Manufacturer and Country Data Blocks', () => {
  test('routes Manufacturer Info request and response layouts', () => {
    const cases = [
      {
        messageType: 0x06,
        payload: [0, 0],
        title: 'Get Manufacturer Info Data Block',
      },
      {
        messageType: 0x07,
        payload: [0x34, 0x12, 0x78, 0x56, 0],
        title: 'Manufacturer Info Data Block (MIDB)',
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

  test('routes Country Info and Country Codes layouts', () => {
    const cases = [
      {
        messageType: 0x0d,
        payload: [0x55, 0x53, 0, 0, 0x58],
        title: 'Country Info Data Block (CIDB)',
      },
      {
        messageType: 0x0e,
        payload: [1, 0, 0x55, 0x53],
        title: 'Country Codes Data Block (CCDB)',
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

  test('diagnoses a Country Codes length mismatch', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: extendedMessageBytes(0x0e, [2, 0, 0x55, 0x53]),
    })
    const countryCodes = decoded.sections.find(
      (section) => section.title === 'Country Codes Data Block (CCDB)',
    )

    expect(countryCodes?.issues.map((issue) => issue.code)).toContain(
      'PD_COUNTRY_CODES_LENGTH_MISMATCH',
    )
  })
})
