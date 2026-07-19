import type { DecodeIssue, Section } from '../../types.js'
import { extractBits, readUint32Le } from '../../utils/bits.js'
import {
  type BuiltSection,
  boolDisplay,
  buildGenericDataObject,
  createIssue,
  createSection,
  field,
} from './sectionBuilders.js'

function buildSourceInfoDataObject1(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  objectCount: number,
): BuiltSection {
  const portType = extractBits(raw32, 31, 1)
  const reserved = extractBits(raw32, 24, 7)
  const portMaximumPdp = extractBits(raw32, 16, 8)
  const portPresentPdp = extractBits(raw32, 8, 8)
  const portReportedPdp = extractBits(raw32, 0, 8)
  const issues: DecodeIssue[] = []

  if (objectCount !== 2) {
    issues.push(
      createIssue(
        'PD_SOURCE_INFO_OBJECT_COUNT_INVALID',
        `Source_Info Message shall contain exactly two Source Information Data Objects; found ${objectCount}.`,
      ),
    )
  }

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_SOURCE_INFO_RESERVED_BITS_NONZERO',
        'Source Information Data Object reserved bits 30..24 are non-zero.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:source_info_data_object_1`,
      'data_object',
      'Source Information Data Object 1',
      'source_info_data_object_1',
      byteOffset,
      raw32,
      [
        field('port_type', 'Port Type', 31, 1, portType, portType === 1, {
          displayValue:
            portType === 1
              ? 'Guaranteed Capability Port'
              : 'Managed Capability Port',
        }),
        field('reserved', 'Reserved', 24, 7, reserved, reserved),
        field(
          'port_maximum_pdp',
          'Port Maximum PDP',
          16,
          8,
          portMaximumPdp,
          portMaximumPdp,
          {
            displayValue: `${portMaximumPdp} W`,
          },
        ),
        field(
          'port_present_pdp',
          'Port Present PDP',
          8,
          8,
          portPresentPdp,
          portPresentPdp,
          {
            displayValue: `${portPresentPdp} W`,
          },
        ),
        field(
          'port_reported_pdp',
          'Port Reported PDP',
          0,
          8,
          portReportedPdp,
          portReportedPdp,
          {
            displayValue: `${portReportedPdp} W`,
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildSourceInfoDataObject2(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const portType = extractBits(raw32, 31, 1)
  const dpsPort = extractBits(raw32, 30, 1)
  const reserved = extractBits(raw32, 18, 12)
  const portMaximumPdp = extractBits(raw32, 9, 9)
  const portGuaranteedPdp = extractBits(raw32, 0, 9)
  const issues: DecodeIssue[] = []

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_SOURCE_INFO_2_RESERVED_BITS_NONZERO',
        'Source Information Data Object 2 reserved bits 29..18 are non-zero.',
      ),
    )
  }

  if (dpsPort === 1 && portType !== 0) {
    issues.push(
      createIssue(
        'PD_SOURCE_INFO_2_DPS_PORT_TYPE_INVALID',
        'DPS Port requires Port Type to be Managed Capability Port.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:source_info_data_object_2`,
      'data_object',
      'Source Information Data Object 2',
      'source_info_data_object_2',
      byteOffset,
      raw32,
      [
        field('port_type', 'Port Type', 31, 1, portType, portType === 1, {
          displayValue:
            portType === 1
              ? 'Guaranteed Capability Port'
              : 'Managed Capability Port',
        }),
        field('dps_port', 'DPS Port', 30, 1, dpsPort, dpsPort === 1, {
          displayValue: boolDisplay(dpsPort === 1, 'DPS Port', 'Non-DPS Port'),
        }),
        field('reserved', 'Reserved', 18, 12, reserved, reserved),
        field(
          'port_maximum_pdp',
          'Port Maximum PDP',
          9,
          9,
          portMaximumPdp,
          portMaximumPdp / 2,
          {
            displayValue: `${portMaximumPdp / 2} W`,
            unit: 'W',
            note: '0.5W units',
          },
        ),
        field(
          'port_guaranteed_pdp',
          'Port Guaranteed PDP',
          0,
          9,
          portGuaranteedPdp,
          portGuaranteedPdp / 2,
          {
            displayValue: `${portGuaranteedPdp / 2} W`,
            unit: 'W',
            note: '0.5W units',
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

export function explainSourceInfoDataObjects(
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
        ? buildSourceInfoDataObject1(
            raw32,
            index,
            parentSectionKey,
            objectByteOffset,
            count,
          )
        : index === 1
          ? buildSourceInfoDataObject2(
              raw32,
              index,
              parentSectionKey,
              objectByteOffset,
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
