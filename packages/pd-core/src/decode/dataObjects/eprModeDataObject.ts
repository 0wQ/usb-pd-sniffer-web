import type { DecodeIssue, Section } from '../../types.js'
import { extractBits, readUint32Le } from '../../utils/bits.js'
import {
  type BuiltSection,
  buildGenericDataObject,
  createIssue,
  createSection,
  field,
} from './sectionBuilders.js'

function eprModeActionDisplay(action: number): string {
  switch (action) {
    case 0x01:
      return 'Enter'
    case 0x02:
      return 'Enter Acknowledged'
    case 0x03:
      return 'Enter Succeeded'
    case 0x04:
      return 'Enter Failed'
    case 0x05:
      return 'Exit'
    case 0x00:
      return 'Reserved'
    default:
      return 'Reserved'
  }
}

function eprModeEnterFailedDataDisplay(data: number): string {
  switch (data) {
    case 0x00:
      return 'Unknown cause'
    case 0x01:
      return 'Cable not EPR Capable'
    case 0x02:
      return 'Source failed to become VCONN Source'
    case 0x03:
      return 'EPR Capable bit not set in RDO'
    case 0x04:
      return 'Source unable to enter EPR Mode'
    case 0x05:
      return 'EPR Capable bit not set in PDO'
    default:
      return 'Reserved'
  }
}

function buildEprModeDataObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  objectCount: number,
): BuiltSection {
  const action = extractBits(raw32, 24, 8)
  const data = extractBits(raw32, 16, 8)
  const reserved = extractBits(raw32, 0, 16)
  const issues: DecodeIssue[] = []

  if (objectCount !== 1) {
    issues.push(
      createIssue(
        'PD_EPR_MODE_OBJECT_COUNT_INVALID',
        `EPR_Mode Message shall contain exactly one EPR Mode Data Object; found ${objectCount}.`,
      ),
    )
  }

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_EPR_MODE_RESERVED_BITS_NONZERO',
        'EPR Mode Data Object reserved bits 15..0 are non-zero.',
      ),
    )
  }

  if (action === 0x00 || action >= 0x06) {
    issues.push(
      createIssue(
        'PD_EPR_MODE_ACTION_RESERVED',
        'EPR Mode Data Object Action value is reserved.',
      ),
    )
  }

  if ((action === 0x02 || action === 0x03 || action === 0x05) && data !== 0) {
    issues.push(
      createIssue(
        'PD_EPR_MODE_DATA_NONZERO_FOR_RESERVED_ACTION_DATA',
        'EPR Mode Data Object Data field shall be zero for Enter Acknowledged, Enter Succeeded, and Exit.',
      ),
    )
  }

  if (action === 0x04 && data >= 0x06) {
    issues.push(
      createIssue(
        'PD_EPR_MODE_ENTER_FAILED_DATA_RESERVED',
        'EPR Mode Enter Failed Data field values 0x06..0xFF are reserved.',
      ),
    )
  }

  const dataDisplay =
    action === 0x01
      ? `${data} W`
      : action === 0x04
        ? eprModeEnterFailedDataDisplay(data)
        : 'Reserved'

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:epr_mode_data_object`,
      'data_object',
      'EPR Mode Data Object (EPRMDO)',
      'epr_mode_data_object',
      byteOffset,
      raw32,
      [
        field('action', 'Action', 24, 8, action, action, {
          displayValue: eprModeActionDisplay(action),
        }),
        field('data', 'Data', 16, 8, data, data, {
          displayValue: dataDisplay,
          note:
            action === 0x01
              ? 'Sink Operational PDP in 1 W units.'
              : action === 0x04
                ? 'Enter Failed cause code.'
                : 'Reserved for this Action; shall be set to zero.',
        }),
        field('reserved', 'Reserved', 0, 16, reserved, reserved),
      ],
      issues,
      index,
    ),
  }
}

export function explainEprModeDataObjects(
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
        ? buildEprModeDataObject(
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
