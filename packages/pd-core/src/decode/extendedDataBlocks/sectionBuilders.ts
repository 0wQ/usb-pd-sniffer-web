import type { BitField, DecodeIssue, Section } from '../../types.js'

export type BuiltSection = {
  section: Section
  extraSections?: Section[]
}

export function hex(value: number, width: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`
}

export function asciiBytesDisplay(bytes: Uint8Array): string {
  let result = ''
  for (const value of bytes) {
    if (value === 0x00) {
      result += '\\0'
    } else if (value >= 0x20 && value <= 0x7e) {
      result += String.fromCharCode(value)
    } else {
      result += `\\x${value.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return result
}

export function boolDisplay(
  value: boolean,
  whenTrue = 'Set',
  whenFalse = 'Clear',
): string {
  return value ? whenTrue : whenFalse
}

export function field(
  key: string,
  label: string,
  bitStart: number,
  bitLength: number,
  rawValue: number,
  decodedValue: BitField['decodedValue'],
  options: {
    displayValue?: string
    note?: string
    unit?: string
  } = {},
): BitField {
  const displayValue =
    options.displayValue ??
    (options.unit !== undefined
      ? `${String(decodedValue)} ${options.unit}`
      : String(decodedValue))

  return {
    key,
    label,
    bitStart,
    bitLength,
    rawValue,
    decodedValue,
    displayValue,
    note: options.note,
    unit: options.unit,
  }
}

export function createIssue(code: string, message: string): DecodeIssue {
  return {
    severity: 'warning',
    code,
    message,
  }
}

export function createDataBlockSection(
  key: string,
  title: string,
  semanticKind: string,
  byteOffset: number,
  rawBytes: Uint8Array,
  fields: BitField[],
  issues: DecodeIssue[],
): Section {
  return {
    key,
    kind: 'data_block',
    title,
    semanticKind,
    byteOffset,
    byteLength: rawBytes.length,
    rawBytes,
    fields,
    issues,
  }
}

export function buildPaddingSection(
  bytes: Uint8Array,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const rawValue = bytes.reduce(
    (value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)),
    0n,
  )
  const decodedValue =
    rawValue <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(rawValue)
      : rawValue.toString()
  const issues: DecodeIssue[] = bytes.some((byte) => byte !== 0)
    ? [
        createIssue(
          'PD_EXTENDED_MESSAGE_PADDING_NONZERO',
          'Extended Message padding bytes shall be zero.',
        ),
      ]
    : []

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:padding`,
      'Padding',
      'padding',
      byteOffset,
      bytes,
      bytes.length > 0
        ? [
            {
              key: 'padding',
              label: 'Padding',
              bitStart: 0,
              bitLength: bytes.length * 8,
              rawValue,
              decodedValue,
              displayValue: String(decodedValue),
            },
          ]
        : [],
      issues,
    ),
  }
}
