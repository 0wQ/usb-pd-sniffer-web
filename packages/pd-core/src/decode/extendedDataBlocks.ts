import type {
  BitField,
  DecodeIssue,
  ExtendedMessageHeader,
  MessageTypeInfo,
  Section,
  StartOfPacket,
} from '../types.js'
import { readUint16Le } from '../utils/bits.js'
import { explainDataObjects } from './dataObjects/index.js'
import {
  buildSinkCapabilitiesExtendedDataBlock,
  buildSourceCapabilitiesExtendedDataBlock,
} from './extendedDataBlocks/capabilitiesDataBlocks.js'
import { buildDeclaredDataSizeIssues } from './extendedDataBlocks/dataBlockValidation.js'
import { buildExtendedControlDataBlock } from './extendedDataBlocks/extendedControlDataBlock.js'
import { buildPpsStatusDataBlock } from './extendedDataBlocks/ppsStatusDataBlock.js'
import {
  type BuiltSection,
  buildPaddingSection,
  createDataBlockSection,
  createIssue,
  field,
  hex,
} from './extendedDataBlocks/sectionBuilders.js'
import { buildStatusDataBlock } from './extendedDataBlocks/statusDataBlock.js'

const MAX_EXTENDED_MESSAGE_CHUNK_LENGTH = 26

function rawExtendedDataBlockInfo(messageTypeName: string | null): {
  title: string
  semanticKind: string
} {
  switch (messageTypeName) {
    case 'Security_Request':
      return {
        title: 'Security Request Data Block (SRQDB)',
        semanticKind: 'security_request_data_block_raw',
      }
    case 'Security_Response':
      return {
        title: 'Security Response Data Block (SRPDB)',
        semanticKind: 'security_response_data_block_raw',
      }
    case 'Firmware_Update_Request':
      return {
        title: 'Firmware Update Request Data Block (FRQDB)',
        semanticKind: 'firmware_update_request_data_block_raw',
      }
    case 'Firmware_Update_Response':
      return {
        title: 'Firmware Update Response Data Block (FRPDB)',
        semanticKind: 'firmware_update_response_data_block_raw',
      }
    case null:
      return {
        title: 'Unknown Extended Data Block',
        semanticKind: 'raw_extended_data_block',
      }
    default:
      return {
        title: `${messageTypeName} Data Block`,
        semanticKind: `${messageTypeName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_data_block_raw`,
      }
  }
}

function buildRawExtendedDataBlock(
  bytes: Uint8Array,
  messageTypeName: string | null,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const info = rawExtendedDataBlockInfo(messageTypeName)

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:${info.semanticKind}`,
      info.title,
      info.semanticKind,
      byteOffset,
      bytes,
      [],
      [],
    ),
  }
}

function batteryReferenceDisplay(value: number): string {
  if (value <= 3) {
    return `Fixed Battery ${value}`
  }
  if (value <= 7) {
    return `Hot Swappable Battery ${value - 4}`
  }
  return 'Reserved'
}

function manufacturerInfoTargetDisplay(value: number): string {
  if (value === 0) {
    return 'Port / Cable Plug'
  }
  if (value === 1) {
    return 'Battery'
  }
  return 'Reserved'
}

function asciiByteDisplay(value: number): string {
  if (value >= 0x20 && value <= 0x7e) {
    return `'${String.fromCharCode(value)}' (${hex(value, 2)})`
  }
  if (value === 0x00) {
    return "'\\0' (0x00)"
  }
  return hex(value, 2)
}

function asciiBytesDisplay(bytes: Uint8Array): string {
  let result = ''
  for (const value of bytes) {
    if (value === 0x00) {
      result += '\\0'
    } else if (value >= 0x20 && value <= 0x7e) {
      result += String.fromCharCode(value)
    } else {
      result += `\\x${value.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return result
}

function buildGetBatteryCapDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues = buildDeclaredDataSizeIssues(
    'Get_Battery_Cap',
    1,
    declaredDataSize,
    bytes.length,
  )
  const batteryCapRef = bytes[0] ?? 0

  if (batteryCapRef >= 8 && bytes.length >= 1) {
    issues.push(
      createIssue(
        'PD_GET_BATTERY_CAP_REFERENCE_RESERVED',
        'Battery Cap Ref values 8..255 are reserved.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:get-battery-cap`,
      'Get Battery Cap Data Block',
      'get_battery_cap_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 1)),
      [
        field(
          'battery_cap_ref',
          'Battery Cap Ref',
          0,
          8,
          batteryCapRef,
          batteryCapRef,
          {
            displayValue: batteryReferenceDisplay(batteryCapRef),
          },
        ),
      ],
      issues,
    ),
  }
}

function buildGetBatteryStatusDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues = buildDeclaredDataSizeIssues(
    'Get_Battery_Status',
    1,
    declaredDataSize,
    bytes.length,
  )
  const batteryStatusRef = bytes[0] ?? 0

  if (batteryStatusRef >= 8 && bytes.length >= 1) {
    issues.push(
      createIssue(
        'PD_GET_BATTERY_STATUS_REFERENCE_RESERVED',
        'Battery Status Ref values 8..255 are reserved.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:get-battery-status`,
      'Get Battery Status Data Block',
      'get_battery_status_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 1)),
      [
        field(
          'battery_status_ref',
          'Battery Status Ref',
          0,
          8,
          batteryStatusRef,
          batteryStatusRef,
          {
            displayValue: batteryReferenceDisplay(batteryStatusRef),
          },
        ),
      ],
      issues,
    ),
  }
}

function buildBatteryCapabilitiesDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues = buildDeclaredDataSizeIssues(
    'Battery_Capabilities',
    9,
    declaredDataSize,
    bytes.length,
  )
  const vid = readUint16Le(bytes, 0)
  const pid = readUint16Le(bytes, 2)
  const designCapacity = readUint16Le(bytes, 4)
  const lastFullChargeCapacity = readUint16Le(bytes, 6)
  const batteryType = bytes[8] ?? 0
  const invalidBatteryReference = batteryType & 0x01
  const reservedBatteryTypeBits = batteryType & 0xfe

  if (vid === 0xffff && pid !== 0x0000) {
    issues.push(
      createIssue(
        'PD_BATTERY_CAPABILITIES_PID_NONZERO_WITH_UNKNOWN_VID',
        'PID shall be 0x0000 when Battery Capabilities VID is 0xFFFF.',
      ),
    )
  }

  if (reservedBatteryTypeBits !== 0) {
    issues.push(
      createIssue(
        'PD_BATTERY_CAPABILITIES_RESERVED_TYPE_BITS_NONZERO',
        'Battery Type reserved bits 7..1 are non-zero.',
      ),
    )
  }

  const designCapacityDisplay =
    designCapacity === 0x0000
      ? 'Battery Not Present'
      : designCapacity === 0xffff
        ? 'Design Capacity Unknown'
        : `${(designCapacity / 10).toFixed(1)} Wh`

  const lastFullChargeDisplay =
    lastFullChargeCapacity === 0x0000
      ? 'Battery Not Present'
      : lastFullChargeCapacity === 0xffff
        ? 'Last Full Charge Capacity Unknown'
        : `${(lastFullChargeCapacity / 10).toFixed(1)} Wh`

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:battery-capabilities`,
      'Battery Capabilities Data Block',
      'battery_capabilities_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 9)),
      [
        field('vid', 'VID', 0, 16, vid, vid, {
          displayValue: hex(vid, 4),
        }),
        field('pid', 'PID', 16, 16, pid, pid, {
          displayValue: hex(pid, 4),
        }),
        field(
          'battery_design_capacity',
          'Battery Design Capacity',
          32,
          16,
          designCapacity,
          designCapacity,
          {
            displayValue: designCapacityDisplay,
            note: '0x0000 = Battery not present, 0xFFFF = design capacity unknown.',
          },
        ),
        field(
          'battery_last_full_charge_capacity',
          'Battery Last Full Charge Capacity',
          48,
          16,
          lastFullChargeCapacity,
          lastFullChargeCapacity,
          {
            displayValue: lastFullChargeDisplay,
            note: '0x0000 = Battery not present, 0xFFFF = last full charge capacity unknown.',
          },
        ),
        field(
          'invalid_battery_reference',
          'Invalid Battery Reference',
          64,
          1,
          invalidBatteryReference,
          invalidBatteryReference === 1,
          {
            displayValue: invalidBatteryReference === 1 ? 'Invalid' : 'Valid',
          },
        ),
        field(
          'reserved_battery_type_bits',
          'Reserved',
          65,
          7,
          reservedBatteryTypeBits >>> 1,
          reservedBatteryTypeBits >>> 1,
          {
            note: 'Battery Type bits 7..1 are reserved.',
          },
        ),
      ],
      issues,
    ),
  }
}

function buildGetManufacturerInfoDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues = buildDeclaredDataSizeIssues(
    'Get_Manufacturer_Info',
    2,
    declaredDataSize,
    bytes.length,
  )
  const target = bytes[0] ?? 0
  const reference = bytes[1] ?? 0

  if (target >= 2 && bytes.length >= 1) {
    issues.push(
      createIssue(
        'PD_GET_MANUFACTURER_INFO_TARGET_RESERVED',
        'Manufacturer Info Target values 2..255 are reserved.',
      ),
    )
  }

  if (target !== 1 && reference !== 0 && bytes.length >= 2) {
    issues.push(
      createIssue(
        'PD_GET_MANUFACTURER_INFO_REF_NONZERO',
        'Manufacturer Info Ref shall be zero unless Manufacturer Info Target is Battery.',
      ),
    )
  }

  if (target === 1 && reference >= 8 && bytes.length >= 2) {
    issues.push(
      createIssue(
        'PD_GET_MANUFACTURER_INFO_REF_RESERVED',
        'Manufacturer Info Ref values 8..255 are reserved for Battery target.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:get-manufacturer-info`,
      'Get Manufacturer Info Data Block',
      'get_manufacturer_info_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 2)),
      [
        field(
          'manufacturer_info_target',
          'Manufacturer Info Target',
          0,
          8,
          target,
          target,
          {
            displayValue: manufacturerInfoTargetDisplay(target),
          },
        ),
        field(
          'manufacturer_info_ref',
          'Manufacturer Info Ref',
          8,
          8,
          reference,
          reference,
          {
            displayValue:
              target === 1 ? batteryReferenceDisplay(reference) : 'Reserved',
          },
        ),
      ],
      issues,
    ),
  }
}

function buildManufacturerInfoDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues: DecodeIssue[] = []

  if (declaredDataSize < 5 || declaredDataSize > 26) {
    issues.push(
      createIssue(
        'PD_MANUFACTURER_INFO_DATA_SIZE_INVALID',
        `Manufacturer_Info declared Data Size ${declaredDataSize}, expected 5..26.`,
      ),
    )
  }

  if (bytes.length < Math.min(declaredDataSize, 5)) {
    issues.push(
      createIssue(
        'PD_MANUFACTURER_INFO_DATA_BLOCK_TRUNCATED',
        `Manufacturer_Info requires at least 5 data byte(s), but only ${bytes.length} are present in this frame.`,
      ),
    )
  }

  const decodeLength = Math.min(bytes.length, Math.max(0, declaredDataSize))
  const decodeBytes = bytes.subarray(0, decodeLength)
  const vid = readUint16Le(bytes, 0)
  const pid = readUint16Le(bytes, 2)
  const manufacturerStringBytes = decodeBytes.subarray(
    Math.min(decodeBytes.length, 4),
  )
  const manufacturerString = asciiBytesDisplay(manufacturerStringBytes)

  if (vid === 0xffff && pid !== 0x0000 && decodeBytes.length >= 4) {
    issues.push(
      createIssue(
        'PD_MANUFACTURER_INFO_PID_NONZERO_WITH_UNKNOWN_VID',
        'PID shall be 0x0000 when Manufacturer_Info VID is 0xFFFF.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:manufacturer-info`,
      'Manufacturer Info Data Block',
      'manufacturer_info_data_block',
      byteOffset,
      decodeBytes,
      [
        field('vid', 'VID', 0, 16, vid, vid, {
          displayValue: hex(vid, 4),
        }),
        field('pid', 'PID', 16, 16, pid, pid, {
          displayValue: hex(pid, 4),
        }),
        field(
          'manufacturer_string',
          'Manufacturer String',
          32,
          manufacturerStringBytes.length * 8,
          manufacturerStringBytes.length,
          manufacturerString,
          {
            displayValue: `"${manufacturerString}"`,
            note: 'Vendor-defined null-terminated ASCII string of 0..21 characters.',
          },
        ),
      ],
      issues,
    ),
  }
}

function buildCountryCodesDataBlock(
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
      'Country Codes Data Block',
      'country_codes_data_block',
      byteOffset,
      decodeBytes,
      fields,
      issues,
    ),
  }
}

function buildCountryInfoDataBlock(
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
      'Country Info Data Block',
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

export function explainExtendedDataBlocks(
  payloadBytes: Uint8Array,
  messageType: MessageTypeInfo,
  extendedHeader: ExtendedMessageHeader,
  sop: StartOfPacket,
  payloadSectionKey: string,
  payloadByteOffset: number,
  options: {
    rawOnly?: boolean
    payloadIsAssembled?: boolean
  } = {},
): Section[] {
  const declaredDataSize = extendedHeader.dataSize
  const decodeLength = Math.min(payloadBytes.length, declaredDataSize)
  const decodeBytes = payloadBytes.subarray(0, decodeLength)

  const buildRawSections = (): Section[] => {
    if (extendedHeader.requestChunk) {
      return [
        buildPaddingSection(payloadBytes, payloadSectionKey, payloadByteOffset)
          .section,
      ]
    }

    const rawDataLength =
      extendedHeader.chunked && !options.payloadIsAssembled
        ? Math.min(
            payloadBytes.length,
            Math.max(
              0,
              Math.min(
                MAX_EXTENDED_MESSAGE_CHUNK_LENGTH,
                declaredDataSize -
                  extendedHeader.chunkNumber *
                    MAX_EXTENDED_MESSAGE_CHUNK_LENGTH,
              ),
            ),
          )
        : decodeLength
    const rawDataBytes = payloadBytes.subarray(0, rawDataLength)
    const paddingBytes = extendedHeader.chunked
      ? payloadBytes.subarray(rawDataLength)
      : new Uint8Array(0)
    const sections: Section[] = []

    if (rawDataBytes.length > 0) {
      sections.push(
        buildRawExtendedDataBlock(
          rawDataBytes,
          messageType.name,
          payloadSectionKey,
          payloadByteOffset,
        ).section,
      )
    }
    if (paddingBytes.length > 0) {
      sections.push(
        buildPaddingSection(
          paddingBytes,
          payloadSectionKey,
          payloadByteOffset + rawDataLength,
        ).section,
      )
    }

    return sections
  }

  if (options.rawOnly) {
    return buildRawSections()
  }

  let built: BuiltSection | null = null

  switch (messageType.name) {
    case 'EPR_Source_Capabilities':
    case 'EPR_Sink_Capabilities':
      return explainDataObjects(
        decodeBytes,
        sop,
        messageType,
        payloadSectionKey,
        payloadByteOffset,
      )
    case 'Status':
      built = buildStatusDataBlock(
        decodeBytes,
        declaredDataSize,
        sop,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Source_Capabilities_Extended':
      built = buildSourceCapabilitiesExtendedDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Sink_Capabilities_Extended':
      built = buildSinkCapabilitiesExtendedDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Get_Battery_Cap':
      built = buildGetBatteryCapDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Get_Battery_Status':
      built = buildGetBatteryStatusDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Battery_Capabilities':
      built = buildBatteryCapabilitiesDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Get_Manufacturer_Info':
      built = buildGetManufacturerInfoDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Manufacturer_Info':
      built = buildManufacturerInfoDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'PPS_Status':
      built = buildPpsStatusDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Country_Codes':
      built = buildCountryCodesDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Country_Info':
      built = buildCountryInfoDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    case 'Extended_Control':
      built = buildExtendedControlDataBlock(
        decodeBytes,
        declaredDataSize,
        payloadSectionKey,
        payloadByteOffset,
      )
      break
    default:
      return buildRawSections()
  }

  const sections = [built.section]
  if (built.extraSections !== undefined) {
    sections.push(...built.extraSections)
  }
  return sections
}
