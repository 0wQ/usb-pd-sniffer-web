import type {
  DecodeIssue,
  MessageTypeInfo,
  Section,
  StartOfPacket,
} from '../types.js'
import { extractBits, readUint32Le } from '../utils/bits.js'
import { explainAlertDataObjects } from './dataObjects/alertDataObject.js'
import { explainBatteryStatusDataObjects } from './dataObjects/batteryStatusDataObject.js'
import { explainBistDataObjects } from './dataObjects/bistDataObject.js'
import { explainPowerDataObjects } from './dataObjects/powerDataObjects.js'
import {
  explainRequestDataObjects,
  type RdoKind,
} from './dataObjects/requestDataObjects.js'
import {
  asciiByteDisplay,
  type BuiltSection,
  boolDisplay,
  buildGenericDataObject,
  createIssue,
  createSection,
  field,
} from './dataObjects/sectionBuilders.js'
import { explainVendorDefinedMessage } from './dataObjects/vendorDefinedMessages/index.js'

export type { RdoKind } from './dataObjects/requestDataObjects.js'
export { classifyRdoKindFromPdo } from './dataObjects/requestDataObjects.js'

function enterUsbModeDisplay(raw3: number): string {
  switch (raw3) {
    case 0:
      return 'USB 2.0'
    case 1:
      return 'USB 3.2'
    case 2:
      return 'USB4'
    default:
      return 'Reserved'
  }
}

function enterUsbCableSpeedDisplay(raw3: number): string {
  switch (raw3) {
    case 0:
      return 'USB 2.0 only'
    case 1:
      return 'USB 3.2 Gen1'
    case 2:
      return 'USB 3.2 Gen2 and USB4 Gen2'
    case 3:
      return 'USB4 Gen3'
    case 4:
      return 'USB4 Gen4'
    default:
      return 'Reserved'
  }
}

function enterUsbCableTypeDisplay(raw2: number): string {
  switch (raw2) {
    case 0:
      return 'Passive'
    case 1:
      return 'Active Re-timer'
    case 2:
      return 'Active Re-driver'
    case 3:
      return 'Optically Isolated'
    default:
      return 'Reserved'
  }
}

function enterUsbCableCurrentDisplay(raw2: number): string {
  switch (raw2) {
    case 0:
      return 'VBUS not supported'
    case 1:
      return 'Reserved'
    case 2:
      return '3A'
    case 3:
      return '5A'
    default:
      return 'Reserved'
  }
}

function buildEnterUsbDataObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  objectCount: number,
): BuiltSection {
  const reserved31 = extractBits(raw32, 31, 1)
  const usbMode = extractBits(raw32, 28, 3)
  const reserved27 = extractBits(raw32, 27, 1)
  const usb4Drd = extractBits(raw32, 26, 1)
  const usb3Drd = extractBits(raw32, 25, 1)
  const reserved24 = extractBits(raw32, 24, 1)
  const cableSpeed = extractBits(raw32, 21, 3)
  const cableType = extractBits(raw32, 19, 2)
  const cableCurrent = extractBits(raw32, 17, 2)
  const pcieSupport = extractBits(raw32, 16, 1)
  const dpSupport = extractBits(raw32, 15, 1)
  const tbtSupport = extractBits(raw32, 14, 1)
  const hostPresent = extractBits(raw32, 13, 1)
  const reservedLow = extractBits(raw32, 0, 13)
  const issues: DecodeIssue[] = []

  if (objectCount !== 1) {
    issues.push(
      createIssue(
        'PD_ENTER_USB_OBJECT_COUNT_INVALID',
        `Enter_USB Message shall contain exactly one Enter USB Data Object; found ${objectCount}.`,
      ),
    )
  }

  if (
    reserved31 !== 0 ||
    reserved27 !== 0 ||
    reserved24 !== 0 ||
    reservedLow !== 0
  ) {
    issues.push(
      createIssue(
        'PD_ENTER_USB_RESERVED_BITS_NONZERO',
        'Enter USB Data Object reserved bits are non-zero.',
      ),
    )
  }

  if (usbMode >= 0b011) {
    issues.push(
      createIssue(
        'PD_ENTER_USB_MODE_RESERVED',
        'Enter USB Data Object USB Mode values 011b..111b are reserved.',
      ),
    )
  }

  if (cableSpeed >= 0b101) {
    issues.push(
      createIssue(
        'PD_ENTER_USB_CABLE_SPEED_RESERVED',
        'Enter USB Data Object Cable Speed values 101b..111b are reserved.',
      ),
    )
  }

  if (cableCurrent === 0b01) {
    issues.push(
      createIssue(
        'PD_ENTER_USB_CABLE_CURRENT_RESERVED',
        'Enter USB Data Object Cable Current value 01b is reserved.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:enter_usb_data_object`,
      'data_object',
      'Enter USB Data Object',
      'enter_usb_data_object',
      byteOffset,
      raw32,
      [
        field('reserved_31', 'Reserved', 31, 1, reserved31, reserved31),
        field('usb_mode', 'USB Mode', 28, 3, usbMode, usbMode, {
          displayValue: enterUsbModeDisplay(usbMode),
        }),
        field('reserved_27', 'Reserved', 27, 1, reserved27, reserved27),
        field('usb4_drd', 'USB4 DRD', 26, 1, usb4Drd, usb4Drd === 1, {
          displayValue: boolDisplay(usb4Drd === 1, 'Capable', 'Not Capable'),
        }),
        field('usb3_drd', 'USB3 DRD', 25, 1, usb3Drd, usb3Drd === 1, {
          displayValue: boolDisplay(usb3Drd === 1, 'Capable', 'Not Capable'),
        }),
        field('reserved_24', 'Reserved', 24, 1, reserved24, reserved24),
        field('cable_speed', 'Cable Speed', 21, 3, cableSpeed, cableSpeed, {
          displayValue: enterUsbCableSpeedDisplay(cableSpeed),
        }),
        field('cable_type', 'Cable Type', 19, 2, cableType, cableType, {
          displayValue: enterUsbCableTypeDisplay(cableType),
        }),
        field(
          'cable_current',
          'Cable Current',
          17,
          2,
          cableCurrent,
          cableCurrent,
          {
            displayValue: enterUsbCableCurrentDisplay(cableCurrent),
          },
        ),
        field(
          'pcie_support',
          'PCIe Support',
          16,
          1,
          pcieSupport,
          pcieSupport === 1,
          {
            displayValue: boolDisplay(pcieSupport === 1, 'Yes', 'No'),
          },
        ),
        field('dp_support', 'DP Support', 15, 1, dpSupport, dpSupport === 1, {
          displayValue: boolDisplay(dpSupport === 1, 'Yes', 'No'),
        }),
        field(
          'tbt_support',
          'TBT Support',
          14,
          1,
          tbtSupport,
          tbtSupport === 1,
          {
            displayValue: boolDisplay(tbtSupport === 1, 'Yes', 'No'),
          },
        ),
        field(
          'host_present',
          'Host Present',
          13,
          1,
          hostPresent,
          hostPresent === 1,
          {
            displayValue: boolDisplay(
              hostPresent === 1,
              'Present',
              'Not Present',
            ),
          },
        ),
        field('reserved_low', 'Reserved', 0, 13, reservedLow, reservedLow),
      ],
      issues,
      index,
    ),
  }
}

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
      'Revision Message Data Object',
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
      'EPR Mode Data Object',
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

function appendTrailingRawPayload(
  sections: Section[],
  payloadBytes: Uint8Array,
  payloadSectionKey: string,
  payloadByteOffset: number,
): Section[] {
  const count = Math.floor(payloadBytes.length / 4)

  if (payloadBytes.length % 4 !== 0) {
    sections.push({
      key: `${payloadSectionKey}:raw-tail`,
      kind: 'raw_payload',
      title: 'Trailing Raw Payload',
      semanticKind: 'trailing_raw_payload',
      byteOffset: payloadByteOffset + count * 4,
      byteLength: payloadBytes.length - count * 4,
      rawBytes: payloadBytes.slice(count * 4),
      fields: [],
      issues: [
        {
          severity: 'warning',
          code: 'PD_PAYLOAD_NOT_32BIT_ALIGNED',
          message:
            'Payload has trailing bytes that do not form a complete 32-bit object.',
        },
      ],
    })
  }

  return sections
}

export function explainDataObjects(
  payloadBytes: Uint8Array,
  sop: StartOfPacket,
  messageType: MessageTypeInfo,
  payloadSectionKey: string,
  payloadByteOffset: number,
  options: {
    requestRdoKind?: RdoKind | null
  } = {},
): Section[] {
  const count = Math.floor(payloadBytes.length / 4)

  if (messageType.name === 'Vendor_Defined') {
    return appendTrailingRawPayload(
      explainVendorDefinedMessage(
        payloadBytes,
        sop,
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (
    messageType.name === 'Source_Capabilities' ||
    messageType.name === 'Sink_Capabilities' ||
    messageType.name === 'EPR_Source_Capabilities' ||
    messageType.name === 'EPR_Sink_Capabilities'
  ) {
    return appendTrailingRawPayload(
      explainPowerDataObjects(
        payloadBytes.subarray(0, count * 4),
        messageType.name,
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Request' || messageType.name === 'EPR_Request') {
    return appendTrailingRawPayload(
      explainRequestDataObjects(
        payloadBytes.subarray(0, count * 4),
        messageType.name,
        payloadSectionKey,
        payloadByteOffset,
        options.requestRdoKind ?? null,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'BIST') {
    return appendTrailingRawPayload(
      explainBistDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Battery_Status') {
    return appendTrailingRawPayload(
      explainBatteryStatusDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Alert') {
    return appendTrailingRawPayload(
      explainAlertDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  const sections: Section[] = []

  for (let index = 0; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4

    let built: BuiltSection

    if (messageType.name === 'Enter_USB' && index === 0) {
      built = buildEnterUsbDataObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        count,
      )
    } else if (messageType.name === 'Source_Info' && index === 0) {
      built = buildSourceInfoDataObject1(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        count,
      )
    } else if (messageType.name === 'Source_Info' && index === 1) {
      built = buildSourceInfoDataObject2(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
      )
    } else if (messageType.name === 'Revision' && index === 0) {
      built = buildRevisionDataObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        count,
      )
    } else if (messageType.name === 'Get_Country_Info' && index === 0) {
      built = buildGetCountryInfoDataObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        count,
      )
    } else if (messageType.name === 'EPR_Mode' && index === 0) {
      built = buildEprModeDataObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        count,
      )
    } else {
      built = buildGenericDataObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
      )
    }

    sections.push(built.section)
    if (built.extraSections !== undefined) {
      sections.push(...built.extraSections)
    }
  }

  return appendTrailingRawPayload(
    sections,
    payloadBytes,
    payloadSectionKey,
    payloadByteOffset,
  )
}
