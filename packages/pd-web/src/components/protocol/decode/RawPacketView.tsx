import clsx from 'clsx'
import type { Section } from '@usb-pd-sniffer/pd-core'

const RAW_PACKET_SECTION_TONES = [
  'text-[#3B82F6]',
  'text-[#EF4444]',
  'text-[#10B981]',
  'text-[#F59E0B]',
  'text-[#8B5CF6]',
  'text-[#06B6D4]',
] as const

type RawPacketViewProps = {
  bytes: readonly number[] | Uint8Array
  sections?: readonly Section[]
  className?: string
  ungroupedToneClassName?: string
}

type RawPacketChunk = {
  key: string
  text: string
  toneClassName: string
}

function sectionTone(index: number): string {
  return RAW_PACKET_SECTION_TONES[index % RAW_PACKET_SECTION_TONES.length]
}

function findSectionForByte(
  sections: readonly Section[],
  byteOffset: number,
): { section: Section; index: number } | null {
  for (const [index, section] of sections.entries()) {
    const start = section.byteOffset
    const end = start + section.byteLength
    if (byteOffset >= start && byteOffset < end) {
      return { section, index }
    }
  }

  return null
}

function buildRawPacketChunks(
  bytes: readonly number[] | Uint8Array,
  sections: readonly Section[],
  ungroupedToneClassName: string,
): RawPacketChunk[] {
  const chunks: RawPacketChunk[] = []
  let currentSectionIndex: number | null = null
  let currentBytes: string[] = []

  const flush = () => {
    if (currentBytes.length === 0) {
      return
    }

    chunks.push({
      key: `${chunks.length}-${currentSectionIndex ?? 'raw'}`,
      text: currentBytes.join(' '),
      toneClassName:
        currentSectionIndex === null
          ? ungroupedToneClassName
          : sectionTone(currentSectionIndex),
    })
    currentBytes = []
  }

  for (const [byteOffset, byte] of bytes.entries()) {
    const sectionMatch = findSectionForByte(sections, byteOffset)
    const nextSectionIndex = sectionMatch?.index ?? null

    if (nextSectionIndex !== currentSectionIndex) {
      flush()
      currentSectionIndex = nextSectionIndex
    }

    currentBytes.push(byte.toString(16).toUpperCase().padStart(2, '0'))
  }

  flush()

  return chunks
}

const RawPacketView = ({
  bytes,
  sections = [],
  className,
  ungroupedToneClassName = 'text-base-content/55',
}: RawPacketViewProps) => {
  const chunks = buildRawPacketChunks(bytes, sections, ungroupedToneClassName)

  return (
    <div
      className={clsx(
        'flex flex-wrap gap-y-1 font-mono text-xs leading-5',
        className,
      )}
    >
      {chunks.map((chunk, index) => (
        <span
          key={chunk.key}
          className={clsx('whitespace-pre font-medium', chunk.toneClassName)}
        >
          {index < chunks.length - 1 ? `${chunk.text} ` : chunk.text}
        </span>
      ))}
    </div>
  )
}

export default RawPacketView
