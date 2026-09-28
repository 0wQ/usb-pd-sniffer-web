import { describe, expect, test } from 'vitest'
import { decodeMessage } from '../src/index.js'
import { extendedMessageBytes } from './messageFixtures.js'

describe('Capabilities Extended Data Blocks', () => {
  test('routes Source and Sink Capabilities Extended to distinct layouts', () => {
    const cases = [
      {
        messageType: 0x01,
        payload: Array.from({ length: 25 }, () => 0),
        title: 'Source Capabilities Extended Data Block (SCEDB)',
      },
      {
        messageType: 0x0f,
        payload: Array.from({ length: 24 }, () => 0),
        title: 'Sink Capabilities Extended Data Block (SKEDB)',
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

  test('diagnoses truncated Source Capabilities Extended data', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: extendedMessageBytes(0x01, [0, 0, 0, 0], 25),
    })
    const capabilities = decoded.sections.find(
      (section) =>
        section.title === 'Source Capabilities Extended Data Block (SCEDB)',
    )

    expect(capabilities?.issues.map((issue) => issue.code)).toContain(
      'PD_SOURCE_CAPABILITIES_EXTENDED_DATA_BLOCK_TRUNCATED',
    )
  })
})
