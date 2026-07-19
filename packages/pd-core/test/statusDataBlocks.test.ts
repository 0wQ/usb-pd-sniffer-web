import { describe, expect, test } from 'vitest'
import { decodeMessage } from '../src/index.js'
import { extendedMessageBytes } from './messageFixtures.js'

describe('Status Data Blocks', () => {
  test('uses the SOP-specific seven-byte Status layout', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: extendedMessageBytes(0x02, [0, 0, 0, 0, 0, 0, 0]),
    })

    const status = decoded.sections.find(
      (section) => section.title === 'SOP Status Data Block',
    )

    expect(status?.semanticKind).toBe('sop_status_data_block')
    expect(status?.byteLength).toBe(7)
    expect(status?.issues).toEqual([])
  })

  test('uses the cable-plug two-byte Status layout on SOP prime', () => {
    const decoded = decodeMessage({
      sop: 'SOP_PRIME',
      messageBytes: extendedMessageBytes(0x02, [0, 0]),
    })

    const status = decoded.sections.find(
      (section) => section.title === 'Cable Plug Status Data Block',
    )

    expect(status?.semanticKind).toBe('cable_plug_status_data_block')
    expect(status?.byteLength).toBe(2)
  })

  test('diagnoses a truncated SOP Status Data Block', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: extendedMessageBytes(0x02, [0, 0, 0], 7),
    })
    const status = decoded.sections.find(
      (section) => section.title === 'SOP Status Data Block',
    )

    expect(status?.issues.map((issue) => issue.code)).toContain(
      'PD_STATUS_DATA_BLOCK_TRUNCATED',
    )
  })

  test('decodes PPS Status independently from Status', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: extendedMessageBytes(0x0c, [0, 0, 0, 0]),
    })

    expect(decoded.sections.map((section) => section.title)).toContain(
      'PPS Status Data Block',
    )
  })

  test('diagnoses reserved PPS Status real-time flag bits', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: extendedMessageBytes(0x0c, [0, 0, 0, 0x11]),
    })
    const status = decoded.sections.find(
      (section) => section.title === 'PPS Status Data Block',
    )

    expect(status?.issues.map((issue) => issue.code)).toContain(
      'PD_PPS_STATUS_RESERVED_REAL_TIME_FLAGS_NONZERO',
    )
  })
})
