import { describe, expect, test } from 'vitest'
import { decodeMessage } from '../src/index.js'

describe('Request Data Objects', () => {
  test('decodes Request through the common RDO branch without context', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([0x82, 0x10, 0xc8, 0x20, 0x03, 0x20]),
    })

    expect(decoded.messageType.name).toBe('Request')
    expect(decoded.sections.map((section) => section.title)).toContain(
      'RDO - Common',
    )
  })

  test('decodes EPR_Request RDO and Copy of PDO as one protocol layout', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([
        0x89, 0x20, 0x00, 0x00, 0x00, 0x10, 0x2c, 0x91, 0x01, 0x00,
      ]),
    })

    expect(decoded.messageType.name).toBe('EPR_Request')
    expect(decoded.sections.map((section) => section.title)).toEqual([
      'Message Header',
      'EPR Request Data Object - Fixed and Variable',
      'Copy of PDO - Fixed Supply',
    ])
    expect(
      decoded.sections.find(
        (section) => section.semanticKind === 'copy_of_pdo',
      ),
    ).toBeDefined()
  })
})
