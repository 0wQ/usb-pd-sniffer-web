import type { DecodedMessage } from '@usb-pd-sniffer/pd-core'

export type BitFieldRow = {
  bits: string
  label: string
  raw: string
  meaning: string
}

export type BitBreakdownWord = {
  key: string
  title: string
  rawHex: string
  bytesHex: string
  binary: string
  rows: BitFieldRow[]
}

function bitLabel(start: number, length: number): string {
  return length === 1 ? `${start}` : `${start + length - 1}:${start}`
}

function toHex(raw: number | bigint | undefined, width: number): string {
  if (raw === undefined) return '-'
  const normalized =
    typeof raw === 'bigint' ? raw.toString(16) : (raw >>> 0).toString(16)
  return `0x${normalized.toUpperCase().padStart(width, '0')}`
}

function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte.toString(16).toUpperCase().padStart(2, '0'),
  ).join(' ')
}

function binaryString(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(2).padStart(8, '0'))
    .join(' ')
}

export function buildBitBreakdown(message: DecodedMessage): BitBreakdownWord[] {
  return message.sections.map((section, index) => ({
    key: `${section.kind}-${section.semanticKind ?? 'section'}-${index}`,
    title: section.title,
    rawHex: toHex(section.rawValue, Math.max(2, section.rawBytes.length * 2)),
    bytesHex: bytesHex(section.rawBytes),
    binary: binaryString(section.rawBytes),
    rows: section.fields.map((field) => ({
      bits: bitLabel(field.bitStart, field.bitLength),
      label: field.label,
      raw:
        typeof field.rawValue === 'bigint'
          ? field.rawValue.toString()
          : String(field.rawValue),
      meaning: field.unit
        ? `${String(field.decodedValue)} ${field.unit}`
        : String(field.decodedValue),
    })),
  }))
}
