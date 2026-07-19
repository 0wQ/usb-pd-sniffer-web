import type { BitField, DecodeIssue, Section } from '../../types.js'
import { readUint32Le } from '../../utils/bits.js'

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

export function createVendorDataObjectSection(
  key: string,
  title: string,
  semanticKind: string,
  byteOffset: number,
  raw32: number,
  fields: BitField[],
  issues: DecodeIssue[],
  index: number,
): Section {
  return createSection(
    key,
    'vendor_data_object',
    title,
    semanticKind,
    byteOffset,
    raw32,
    fields,
    issues,
    index,
  )
}

export function appendGenericVendorDataObjects(
  sections: Section[],
  payloadBytes: Uint8Array,
  startIndex: number,
  parentSectionKey: string,
  payloadByteOffset: number,
): void {
  const count = Math.floor(payloadBytes.length / 4)

  for (let index = startIndex; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    sections.push(
      createVendorDataObjectSection(
        `${parentSectionKey}:object-${index}:vendor_data_object`,
        `Vendor Data Object ${index + 1}`,
        'vendor_data_object',
        payloadByteOffset + index * 4,
        raw32,
        [field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8))],
        [],
        index,
      ),
    )
  }
}

export function buildGenericDataObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  kind: Section['kind'] = 'data_object',
  title = `Data Object ${index + 1}`,
  semanticKind = 'raw_data_object',
): BuiltSection {
  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:${semanticKind}`,
      kind,
      title,
      semanticKind,
      byteOffset,
      raw32,
      [field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8))],
      [],
      index,
    ),
  }
}
