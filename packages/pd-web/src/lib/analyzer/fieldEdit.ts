import type { BitField, Section } from '@usb-pd-sniffer/pd-core'

export type FieldEditMode = 'raw'

export function formatEditedBytes(
  bytes: readonly number[] | Uint8Array,
): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0').toUpperCase(),
  ).join(' ')
}

function rawBigInt(rawValue: number | bigint): bigint {
  return typeof rawValue === 'bigint' ? rawValue : BigInt(rawValue >>> 0)
}

function fieldMaxValue(field: BitField): bigint {
  return (1n << BigInt(field.bitLength)) - 1n
}

function parseRawBitString(input: string): bigint {
  const trimmed = input.trim().replace(/_/g, '')
  const bits =
    trimmed.startsWith('0b') || trimmed.startsWith('0B')
      ? trimmed.slice(2)
      : trimmed

  if (bits.length === 0) {
    throw new Error('Enter a binary value before applying the edit.')
  }

  if (!/^[01]+$/.test(bits)) {
    throw new Error('Use a binary value such as 0b1010.')
  }

  return BigInt(`0b${bits}`)
}

export function formatFieldEditValue(
  field: BitField,
  _mode: FieldEditMode,
): string {
  return rawBigInt(field.rawValue).toString(2).padStart(field.bitLength, '0')
}

export function parseFieldEditValue(
  field: BitField,
  _mode: FieldEditMode,
  input: string,
): bigint {
  const parsed = parseRawBitString(input)
  if (parsed > fieldMaxValue(field)) {
    throw new Error(
      `Value exceeds ${field.bitLength}-bit field maximum 0x${fieldMaxValue(field).toString(16).toUpperCase()}.`,
    )
  }

  return parsed
}

function readLittleEndian(
  bytes: Uint8Array,
  byteOffset: number,
  byteLength: number,
): bigint {
  let value = 0n

  for (let index = 0; index < byteLength; index += 1) {
    value |= BigInt(bytes[byteOffset + index] ?? 0) << BigInt(index * 8)
  }

  return value
}

function writeLittleEndian(
  bytes: Uint8Array,
  byteOffset: number,
  byteLength: number,
  value: bigint,
): void {
  for (let index = 0; index < byteLength; index += 1) {
    bytes[byteOffset + index] = Number((value >> BigInt(index * 8)) & 0xffn)
  }
}

export function applyFieldRawValue(
  bytes: Uint8Array,
  section: Section,
  field: BitField,
  rawValue: bigint,
): Uint8Array {
  if (section.byteLength <= 0) {
    throw new Error('Cannot edit a zero-length decode section.')
  }

  if (
    section.byteOffset < 0 ||
    section.byteOffset + section.byteLength > bytes.length
  ) {
    throw new Error(
      'Cannot edit this field because its section is outside the payload bytes.',
    )
  }

  if (
    field.bitStart < 0 ||
    field.bitLength <= 0 ||
    field.bitStart + field.bitLength > section.byteLength * 8
  ) {
    throw new Error(
      'Cannot edit this field because its bit range is outside the section bytes.',
    )
  }

  if (rawValue < 0n || rawValue > fieldMaxValue(field)) {
    throw new Error(
      `Value exceeds ${field.bitLength}-bit field maximum 0x${fieldMaxValue(field).toString(16).toUpperCase()}.`,
    )
  }

  const editedBytes = Uint8Array.from(bytes)
  const sectionValue = readLittleEndian(
    editedBytes,
    section.byteOffset,
    section.byteLength,
  )
  const mask = fieldMaxValue(field) << BigInt(field.bitStart)
  const editedSectionValue =
    (sectionValue & ~mask) | (rawValue << BigInt(field.bitStart))

  writeLittleEndian(
    editedBytes,
    section.byteOffset,
    section.byteLength,
    editedSectionValue,
  )

  return editedBytes
}
