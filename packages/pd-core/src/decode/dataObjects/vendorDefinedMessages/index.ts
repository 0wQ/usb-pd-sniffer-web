import type { DecodeIssue, Section, StartOfPacket } from '../../../types.js'
import { extractBits, readUint32Le } from '../../../utils/bits.js'
import {
  appendGenericVendorDataObjects,
  type BuiltSection,
  createIssue,
  createSection,
  field,
  hex,
} from '../sectionBuilders.js'
import { explainDiscoverIdentityObjects } from './discoverIdentity.js'
import {
  explainStructuredVdmCommandObjects,
  vdmCommandTypeDisplay,
} from './structuredVdmCommands.js'

type StructuredVdmHeaderInfo = {
  readonly svid: number
  readonly major: number
  readonly minor: number
  readonly objectPosition: number
  readonly commandType: number
  readonly reserved: number
  readonly command: number
}

function vdmCommandDisplay(command: number): string {
  switch (command) {
    case 0:
      return 'Reserved'
    case 1:
      return 'Discover Identity'
    case 2:
      return 'Discover SVIDs'
    case 3:
      return 'Discover Modes'
    case 4:
      return 'Enter Mode'
    case 5:
      return 'Exit Mode'
    case 6:
      return 'Attention'
    default:
      return command >= 16 ? 'SVID Specific Command' : 'Reserved'
  }
}

function structuredVdmVersionDisplay(
  major: number,
  minor: number,
  command: number,
): string {
  if (major === 0) {
    return '1.0 (Deprecated)'
  }
  if (major === 1 && command <= 15) {
    if (minor === 0) {
      return '2.0'
    }
    if (minor === 1) {
      return '2.1'
    }
    return 'Reserved'
  }
  if (major === 1) {
    return `2.x / SVID-specific minor (${minor})`
  }
  return 'Reserved'
}

function parseStructuredVdmHeader(
  raw32: number,
): StructuredVdmHeaderInfo | null {
  if (extractBits(raw32, 15, 1) === 0) {
    return null
  }

  return {
    svid: extractBits(raw32, 16, 16),
    major: extractBits(raw32, 13, 2),
    minor: extractBits(raw32, 11, 2),
    objectPosition: extractBits(raw32, 8, 3),
    commandType: extractBits(raw32, 6, 2),
    reserved: extractBits(raw32, 5, 1),
    command: extractBits(raw32, 0, 5),
  }
}

function buildVdmHeaderObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const svid = extractBits(raw32, 16, 16)
  const vdmType = extractBits(raw32, 15, 1)
  const issues: DecodeIssue[] = []

  if (vdmType === 0) {
    return {
      section: createSection(
        `${parentSectionKey}:object-${index}:unstructured-vdm-header`,
        'vdm_header',
        'VDM Header',
        'unstructured_vdm_header',
        byteOffset,
        raw32,
        [
          field('vid', 'Vendor ID (VID)', 16, 16, svid, hex(svid, 4)),
          field('vdm_type', 'VDM Type', 15, 1, 0, 'Unstructured'),
          field(
            'vendor_defined_payload',
            'Vendor Defined Payload',
            0,
            15,
            extractBits(raw32, 0, 15),
            hex(extractBits(raw32, 0, 15), 4),
          ),
        ],
        [],
        index,
      ),
    }
  }

  const major = extractBits(raw32, 13, 2)
  const minor = extractBits(raw32, 11, 2)
  const objectPosition = extractBits(raw32, 8, 3)
  const commandType = extractBits(raw32, 6, 2)
  const reserved = extractBits(raw32, 5, 1)
  const command = extractBits(raw32, 0, 5)

  if (major === 0) {
    issues.push(
      createIssue(
        'PD_VDM_VERSION_MAJOR_DEPRECATED',
        'Structured VDM version major 00b means Version 1.0, which is deprecated.',
      ),
    )
  } else if (major > 1) {
    issues.push(
      createIssue(
        'PD_VDM_VERSION_MAJOR_RESERVED',
        'Structured VDM version major values 10b and 11b are reserved.',
      ),
    )
  }

  if (command <= 15 && major === 1 && minor > 1) {
    issues.push(
      createIssue(
        'PD_VDM_VERSION_MINOR_RESERVED',
        'Structured VDM version minor values 10b and 11b are reserved for Commands 0..15.',
      ),
    )
  }

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_VDM_RESERVED_BIT_NONZERO',
        'Structured VDM Header reserved bit 5 is non-zero.',
      ),
    )
  }

  if (command === 0 || (command >= 7 && command <= 15)) {
    issues.push(
      createIssue(
        'PD_VDM_RESERVED_COMMAND',
        'Structured VDM command 0 and 7..15 are reserved.',
      ),
    )
  }

  if (command >= 1 && command <= 3 && objectPosition !== 0) {
    issues.push(
      createIssue(
        'PD_VDM_RESERVED_OBJECT_POSITION',
        'Structured VDM commands 1..3 shall use Object Position 000b.',
      ),
    )
  }

  if (
    (command === 4 || command === 5 || command === 6) &&
    objectPosition === 0
  ) {
    issues.push(
      createIssue(
        'PD_VDM_OBJECT_POSITION_ZERO_RESERVED',
        'Enter Mode, Exit Mode, and Attention use Object Position 000b as reserved.',
      ),
    )
  }

  if ((command === 1 || command === 2) && svid !== 0xff00) {
    issues.push(
      createIssue(
        'PD_VDM_PD_SID_REQUIRED',
        'Discover Identity and Discover SVIDs shall use the PD SID 0xFF00.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:structured-vdm-header`,
      'vdm_header',
      'VDM Header',
      'structured_vdm_header',
      byteOffset,
      raw32,
      [
        field(
          'svid',
          'Standard or Vendor ID (SVID)',
          16,
          16,
          svid,
          hex(svid, 4),
        ),
        field('vdm_type', 'VDM Type', 15, 1, 1, 'Structured'),
        field(
          'structured_vdm_version_major',
          'Structured VDM Version (Major)',
          13,
          2,
          major,
          major,
          {
            displayValue:
              major === 0
                ? '1.0 (Deprecated)'
                : major === 1
                  ? '2.x'
                  : 'Reserved',
          },
        ),
        field(
          'structured_vdm_version_minor',
          'Structured VDM Version (Minor)',
          11,
          2,
          minor,
          minor,
          {
            displayValue: structuredVdmVersionDisplay(major, minor, command),
          },
        ),
        field(
          'object_position',
          'Object Position',
          8,
          3,
          objectPosition,
          objectPosition,
          {
            displayValue:
              command === 5 && objectPosition === 0b111
                ? '7 (Exit all Active Modes)'
                : String(objectPosition),
          },
        ),
        field('command_type', 'Command Type', 6, 2, commandType, commandType, {
          displayValue: vdmCommandTypeDisplay(commandType),
        }),
        field('reserved', 'Reserved', 5, 1, reserved, reserved),
        field('command', 'Command', 0, 5, command, command, {
          displayValue: vdmCommandDisplay(command),
        }),
      ],
      issues,
      index,
    ),
  }
}

export function explainVendorDefinedMessage(
  payloadBytes: Uint8Array,
  sop: StartOfPacket,
  parentSectionKey: string,
  payloadByteOffset: number,
): Section[] {
  const count = Math.floor(payloadBytes.length / 4)
  if (count === 0) return []

  const headerRaw32 = readUint32Le(payloadBytes, 0)
  const headerBuilt = buildVdmHeaderObject(
    headerRaw32,
    0,
    parentSectionKey,
    payloadByteOffset,
  )
  const structured = parseStructuredVdmHeader(headerRaw32)

  if (structured === null) {
    const sections: Section[] = [headerBuilt.section]
    appendGenericVendorDataObjects(
      sections,
      payloadBytes,
      1,
      parentSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (structured.command === 1) {
    return explainDiscoverIdentityObjects(
      payloadBytes,
      sop,
      parentSectionKey,
      payloadByteOffset,
      headerBuilt.section,
      structured.commandType,
    )
  }

  const commandSections = explainStructuredVdmCommandObjects(
    payloadBytes,
    parentSectionKey,
    payloadByteOffset,
    headerBuilt.section,
    structured,
  )
  if (commandSections !== null) return commandSections

  const sections: Section[] = [headerBuilt.section]
  appendGenericVendorDataObjects(
    sections,
    payloadBytes,
    1,
    parentSectionKey,
    payloadByteOffset,
  )
  return sections
}
