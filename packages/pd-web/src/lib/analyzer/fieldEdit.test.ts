import { describe, expect, test } from 'vitest'
import type { BitField, Section } from '@usb-pd-sniffer/pd-core'
import { applyFieldRawValue, formatEditedBytes, formatFieldEditValue, parseFieldEditValue } from './fieldEdit'

const headerSection: Section = {
  key: 'message-header',
  kind: 'message_header',
  title: 'Message Header',
  byteOffset: 0,
  byteLength: 2,
  rawBytes: Uint8Array.from([0xa1, 0x73]),
  rawValue: 0x73a1,
  fields: [],
  issues: [],
}

describe('field editing helpers', () => {
  test('writes raw field bits into little-endian section bytes', () => {
    const messageIdField: BitField = {
      key: 'message_id',
      label: 'MessageID',
      bitStart: 9,
      bitLength: 3,
      rawValue: 1,
      decodedValue: 1,
    }

    const edited = applyFieldRawValue(Uint8Array.from([0xa1, 0x73]), headerSection, messageIdField, 5n)

    expect(formatEditedBytes(edited)).toBe('A1 7B')
  })

  test('formats raw field values as padded binary', () => {
    const messageIdField: BitField = {
      key: 'message_id',
      label: 'MessageID',
      bitStart: 9,
      bitLength: 3,
      rawValue: 1,
      decodedValue: 1,
    }

    expect(formatFieldEditValue(messageIdField, 'raw')).toBe('001')
    expect(parseFieldEditValue(messageIdField, 'raw', '101')).toBe(5n)
    expect(parseFieldEditValue(messageIdField, 'raw', '0b101')).toBe(5n)
  })

  test('rejects raw values that do not fit the field width', () => {
    const oneBitField: BitField = {
      key: 'flag',
      label: 'Flag',
      bitStart: 0,
      bitLength: 1,
      rawValue: 0,
      decodedValue: false,
    }

    expect(() => parseFieldEditValue(oneBitField, 'raw', '2')).toThrow('binary')
    expect(() => parseFieldEditValue(oneBitField, 'raw', '10')).toThrow('exceeds')
  })
})
