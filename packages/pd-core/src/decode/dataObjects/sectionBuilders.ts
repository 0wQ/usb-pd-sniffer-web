import type { BitField, DecodeIssue, Section } from '../../types.js'

export type BuiltSection = {
  section: Section
  extraSections?: Section[]
}

export function hex(value: number, width: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`
}

function raw32Bytes(raw32: number): Uint8Array {
  return new Uint8Array([
    raw32 & 0xff,
    (raw32 >>> 8) & 0xff,
    (raw32 >>> 16) & 0xff,
    (raw32 >>> 24) & 0xff,
  ])
}

export function boolDisplay(
  value: boolean,
  whenTrue = 'Set',
  whenFalse = 'Clear',
): string {
  return value ? whenTrue : whenFalse
}

export function asciiByteDisplay(value: number): string {
  if (value >= 0x20 && value <= 0x7e) {
    return `'${String.fromCharCode(value)}' (${hex(value, 2)})`
  }

  return hex(value, 2)
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
    unit?: string
    note?: string
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
    unit: options.unit,
    note: options.note,
  }
}

export function flagField(
  key: string,
  label: string,
  bitStart: number,
  rawValue: number,
  whenTrue = 'Yes',
  whenFalse = 'No',
  note?: string,
): BitField {
  return field(key, label, bitStart, 1, rawValue, rawValue === 1, {
    displayValue: boolDisplay(rawValue === 1, whenTrue, whenFalse),
    note,
  })
}

export function createIssue(code: string, message: string): DecodeIssue {
  return {
    severity: 'warning',
    code,
    message,
  }
}

export function createSection(
  key: string,
  kind: Section['kind'],
  title: string,
  semanticKind: string,
  byteOffset: number,
  raw32: number,
  fields: BitField[],
  issues: DecodeIssue[],
  index?: number,
): Section {
  return {
    key,
    kind,
    title,
    index,
    semanticKind,
    byteOffset,
    byteLength: 4,
    rawBytes: raw32Bytes(raw32),
    fields,
    issues,
  }
}
