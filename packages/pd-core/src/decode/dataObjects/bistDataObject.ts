import type { DecodeIssue, Section } from '../../types.js'
import { extractBits, readUint32Le } from '../../utils/bits.js'
import {
  type BuiltSection,
  buildGenericDataObject,
  createIssue,
  createSection,
  field,
} from './sectionBuilders.js'

function bistModeDisplay(raw4: number): string {
  switch (raw4) {
    case 0b0101:
      return 'BIST Carrier Mode'
    case 0b1000:
      return 'BIST Test Data'
    case 0b1001:
      return 'BIST Shared Test Mode Entry'
    case 0b1010:
      return 'BIST Shared Test Mode Exit'
    default:
      return 'Reserved'
  }
}

function buildBistDataObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  objectCount: number,
): BuiltSection {
  const bistMode = extractBits(raw32, 28, 4)
  const reserved = extractBits(raw32, 0, 28)
  const issues: DecodeIssue[] = []

  if (![0b0101, 0b1000, 0b1001, 0b1010].includes(bistMode)) {
    issues.push(
      createIssue(
        'PD_BIST_MODE_RESERVED',
        'BIST Data Object mode uses a reserved value.',
      ),
    )
  }

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_BIST_RESERVED_BITS_NONZERO',
        'BIST Data Object reserved bits 27..0 are non-zero.',
      ),
    )
  }

  if (bistMode === 0b1000) {
    if (objectCount !== 7) {
      issues.push(
        createIssue(
          'PD_BIST_TEST_DATA_OBJECT_COUNT_INVALID',
          `BIST Test Data mode shall use 7 Data Objects total; found ${objectCount}.`,
        ),
      )
    }
  } else if (objectCount !== 1) {
    issues.push(
      createIssue(
        'PD_BIST_OBJECT_COUNT_INVALID',
        `BIST mode ${bistModeDisplay(bistMode)} shall use exactly 1 Data Object; found ${objectCount}.`,
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:bist_data_object`,
      'data_object',
      'BIST Data Object (BDO)',
      'bist_data_object',
      byteOffset,
      raw32,
      [
        field('bist_mode', 'BIST Mode', 28, 4, bistMode, bistMode, {
          displayValue: bistModeDisplay(bistMode),
        }),
        field('reserved', 'Reserved', 0, 28, reserved, reserved),
      ],
      issues,
      index,
    ),
  }
}

export function explainBistDataObjects(
  payloadBytes: Uint8Array,
  parentSectionKey: string,
  payloadByteOffset: number,
): Section[] {
  const count = Math.floor(payloadBytes.length / 4)
  const sections: Section[] = []

  for (let index = 0; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const objectByteOffset = payloadByteOffset + index * 4
    const built =
      index === 0
        ? buildBistDataObject(
            raw32,
            index,
            parentSectionKey,
            objectByteOffset,
            count,
          )
        : buildGenericDataObject(
            raw32,
            index,
            parentSectionKey,
            objectByteOffset,
            'data_object',
            `BIST Test Data Object ${index + 1}`,
            'bist_test_data_object',
          )
    sections.push(built.section)
  }

  return sections
}
