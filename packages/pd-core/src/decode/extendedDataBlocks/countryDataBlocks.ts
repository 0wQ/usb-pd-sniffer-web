import type { BitField, DecodeIssue } from '../../types.js'
import { readUint16Le } from '../../utils/bits.js'
import {
  asciiBytesDisplay,
  type BuiltSection,
  createDataBlockSection,
  createIssue,
  field,
  hex,
} from './sectionBuilders.js'

function asciiByteDisplay(value: number): string {
  if (value >= 0x20 && value <= 0x7e) {
    return `'${String.fromCharCode(value)}' (${hex(value, 2)})`
  }
  if (value === 0x00) {
    return "'\\0' (0x00)"
  }
  return hex(value, 2)
}

export function buildCountryCodesDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues: DecodeIssue[] = []

  if (declaredDataSize < 4 || declaredDataSize > 26) {
    issues.push(
      createIssue(
        'PD_COUNTRY_CODES_DATA_SIZE_INVALID',
        `Country_Codes declared Data Size ${declaredDataSize}, expected 4..26.`,
      ),
    )
  }

  if (bytes.length < Math.min(declaredDataSize, 2)) {
    issues.push(
      createIssue(
        'PD_COUNTRY_CODES_DATA_BLOCK_TRUNCATED',
        `Country_Codes requires at least 2 data byte(s), but only ${bytes.length} are present in this frame.`,
      ),
    )
  }

  const decodeLength = Math.min(bytes.length, Math.max(0, declaredDataSize))
  const decodeBytes = bytes.subarray(0, decodeLength)
  const length = bytes[0] ?? 0
  const reserved = bytes[1] ?? 0
  const expectedSize = 2 + length * 2

  if (reserved !== 0 && decodeBytes.length >= 2) {
    issues.push(
      createIssue(
        'PD_COUNTRY_CODES_RESERVED_BYTE_NONZERO',
        'Country_Codes reserved byte is non-zero.',
      ),
    )
  }

  if (declaredDataSize !== expectedSize && decodeBytes.length >= 2) {
    issues.push(
      createIssue(
        'PD_COUNTRY_CODES_LENGTH_MISMATCH',
        `Country_Codes Length=${length} implies Data Size ${expectedSize}, but header declares ${declaredDataSize}.`,
      ),
    )
  }

  const fields: BitField[] = [
    field('length', 'Length', 0, 8, length, length, {
      displayValue: `${length}`,
      note: 'Number of Alpha-2 country codes in the message.',
    }),
    field('reserved', 'Reserved', 8, 8, reserved, reserved),
  ]

  const codeCount = Math.max(0, Math.floor((decodeBytes.length - 2) / 2))
  for (let index = 0; index < codeCount; index += 1) {
    const first = decodeBytes[2 + index * 2] ?? 0
    const second = decodeBytes[2 + index * 2 + 1] ?? 0
    fields.push(
      field(
        `country_code_${index + 1}`,
        `Country Code ${index + 1}`,
        16 + index * 16,
        16,
        (first << 8) | second,
        `${String.fromCharCode(first)}${String.fromCharCode(second)}`,
        {
          displayValue: `${asciiByteDisplay(first)} ${asciiByteDisplay(second)}`,
        },
      ),
    )
  }

  if ((decodeBytes.length - 2) % 2 !== 0) {
    issues.push(
      createIssue(
        'PD_COUNTRY_CODES_TRAILING_BYTE',
        'Country_Codes payload has a trailing byte that does not form a complete Alpha-2 code.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:country-codes`,
      'Country Codes Data Block (CCDB)',
      'country_codes_data_block',
      byteOffset,
      decodeBytes,
      fields,
      issues,
    ),
  }
}

export function buildCountryInfoDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues: DecodeIssue[] = []

  if (declaredDataSize < 4 || declaredDataSize > 26) {
    issues.push(
      createIssue(
        'PD_COUNTRY_INFO_DATA_SIZE_INVALID',
        `Country_Info declared Data Size ${declaredDataSize}, expected 4..26.`,
      ),
    )
  }

  if (bytes.length < Math.min(declaredDataSize, 4)) {
    issues.push(
      createIssue(
        'PD_COUNTRY_INFO_DATA_BLOCK_TRUNCATED',
        `Country_Info requires at least 4 data byte(s), but only ${bytes.length} are present in this frame.`,
      ),
    )
  }

  const decodeLength = Math.min(bytes.length, Math.max(0, declaredDataSize))
  const decodeBytes = bytes.subarray(0, decodeLength)
  const firstCharacter = bytes[0] ?? 0
  const secondCharacter = bytes[1] ?? 0
  const reserved = readUint16Le(bytes, 2)
  const countrySpecificDataBytes = decodeBytes.subarray(
    Math.min(decodeBytes.length, 4),
  )
  const countrySpecificData = asciiBytesDisplay(countrySpecificDataBytes)

  if (reserved !== 0 && decodeBytes.length >= 4) {
    issues.push(
      createIssue(
        'PD_COUNTRY_INFO_RESERVED_BYTES_NONZERO',
        'Country_Info reserved bytes 3..2 are non-zero.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:country-info`,
      'Country Info Data Block (CIDB)',
      'country_info_data_block',
      byteOffset,
      decodeBytes,
      [
        field(
          'first_character',
          'First Character of Country Code',
          0,
          8,
          firstCharacter,
          firstCharacter,
          {
            displayValue: asciiByteDisplay(firstCharacter),
          },
        ),
        field(
          'second_character',
          'Second Character of Country Code',
          8,
          8,
          secondCharacter,
          secondCharacter,
          {
            displayValue: asciiByteDisplay(secondCharacter),
          },
        ),
        field('reserved', 'Reserved', 16, 16, reserved, reserved),
        field(
          'country_specific_data',
          'Country Specific Data',
          32,
          countrySpecificDataBytes.length * 8,
          countrySpecificDataBytes.length,
          countrySpecificData,
          {
            displayValue: `"${countrySpecificData}"`,
            note: 'Country-defined 1..22 byte payload. Unsupported Code is returned as a null-terminated ASCII string.',
          },
        ),
      ],
      issues,
    ),
  }
}
