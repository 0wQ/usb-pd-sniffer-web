import type { DecodeIssue, Section } from '../../types.js'
import { extractBits, readUint32Le } from '../../utils/bits.js'
import {
  type BuiltSection,
  buildGenericDataObject,
  createIssue,
  createSection,
  field,
} from './sectionBuilders.js'

function buildRevisionDataObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  objectCount: number,
): BuiltSection {
  const revisionMajor = extractBits(raw32, 28, 4)
  const revisionMinor = extractBits(raw32, 24, 4)
  const versionMajor = extractBits(raw32, 20, 4)
  const versionMinor = extractBits(raw32, 16, 4)
  const reserved = extractBits(raw32, 0, 16)
  const issues: DecodeIssue[] = []

  if (objectCount !== 1) {
    issues.push(
      createIssue(
        'PD_REVISION_OBJECT_COUNT_INVALID',
        `Revision Message shall contain exactly one Revision Message Data Object; found ${objectCount}.`,
      ),
    )
  }

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_REVISION_RESERVED_BITS_NONZERO',
        'Revision Message Data Object reserved bits 15..0 are non-zero.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:revision_message_data_object`,
      'data_object',
      'Revision Message Data Object (RMDO)',
      'revision_message_data_object',
      byteOffset,
      raw32,
      [
        field(
          'revision_major',
          'Revision.major',
          28,
          4,
          revisionMajor,
          revisionMajor,
          {
            displayValue: String(revisionMajor),
          },
        ),
        field(
          'revision_minor',
          'Revision.minor',
          24,
          4,
          revisionMinor,
          revisionMinor,
          {
            displayValue: String(revisionMinor),
          },
        ),
        field(
          'version_major',
          'Version.major',
          20,
          4,
          versionMajor,
          versionMajor,
          {
            displayValue: String(versionMajor),
          },
        ),
        field(
          'version_minor',
          'Version.minor',
          16,
          4,
          versionMinor,
          versionMinor,
          {
            displayValue: String(versionMinor),
          },
        ),
        field('reserved', 'Reserved', 0, 16, reserved, reserved),
      ],
      issues,
      index,
    ),
  }
}

export function explainRevisionDataObjects(
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
        ? buildRevisionDataObject(
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
          )
    sections.push(built.section)
  }
  return sections
}
