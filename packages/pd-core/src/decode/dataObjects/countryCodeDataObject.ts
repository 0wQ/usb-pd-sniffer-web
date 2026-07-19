import type { DecodeIssue, Section } from '../../types.js'
import { extractBits, readUint32Le } from '../../utils/bits.js'
import {
  asciiByteDisplay,
  type BuiltSection,
  buildGenericDataObject,
  createIssue,
  createSection,
  field,
} from './sectionBuilders.js'

function buildGetCountryInfoDataObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  objectCount: number,
): BuiltSection {
  const firstCharacter = extractBits(raw32, 24, 8)
  const secondCharacter = extractBits(raw32, 16, 8)
  const reserved = extractBits(raw32, 0, 16)
  const issues: DecodeIssue[] = []

  if (objectCount !== 1) {
    issues.push(
      createIssue(
        'PD_GET_COUNTRY_INFO_OBJECT_COUNT_INVALID',
        `Get_Country_Info Message shall contain exactly one Country Code Data Object; found ${objectCount}.`,
      ),
    )
  }

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_GET_COUNTRY_INFO_RESERVED_BITS_NONZERO',
        'Country Code Data Object reserved bits 15..0 are non-zero.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:country_code_data_object`,
      'data_object',
      'Country Code Data Object',
      'country_code_data_object',
      byteOffset,
      raw32,
      [
        field(
          'first_character',
          'First Character of Alpha-2 Country Code',
          24,
          8,
          firstCharacter,
          firstCharacter,
          {
            displayValue: asciiByteDisplay(firstCharacter),
            note: 'ISO 3166 Alpha-2 country code character.',
          },
        ),
        field(
          'second_character',
          'Second Character of Alpha-2 Country Code',
          16,
          8,
          secondCharacter,
          secondCharacter,
          {
            displayValue: asciiByteDisplay(secondCharacter),
            note: 'ISO 3166 Alpha-2 country code character.',
          },
        ),
        field('reserved', 'Reserved', 0, 16, reserved, reserved),
      ],
      issues,
      index,
    ),
  }
}

export function explainCountryCodeDataObjects(
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
        ? buildGetCountryInfoDataObject(
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
