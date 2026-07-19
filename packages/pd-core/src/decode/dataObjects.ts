import type {
  DecodeIssue,
  MessageTypeInfo,
  Section,
  StartOfPacket,
} from '../types.js'
import { extractBits, readUint32Le } from '../utils/bits.js'
import { explainPowerDataObjects } from './dataObjects/powerDataObjects.js'
import {
  explainRequestDataObjects,
  type RdoKind,
} from './dataObjects/requestDataObjects.js'
import {
  asciiByteDisplay,
  type BuiltSection,
  boolDisplay,
  createIssue,
  createSection,
  field,
  hex,
} from './dataObjects/sectionBuilders.js'
import { explainVendorDefinedMessage } from './dataObjects/vendorDefinedMessages/index.js'

export type { RdoKind } from './dataObjects/requestDataObjects.js'
export { classifyRdoKindFromPdo } from './dataObjects/requestDataObjects.js'

function alertBatteryBitmapDisplay(raw4: number, offset: number): string {
  if (raw4 === 0) {
    return 'None'
  }

  const batteries: string[] = []
  for (let bit = 0; bit < 4; bit += 1) {
    if ((raw4 & (1 << bit)) !== 0) {
      batteries.push(`Battery ${offset + bit}`)
    }
  }
  return batteries.join(', ')
}

function alertExtendedEventTypeDisplay(raw4: number): string {
  switch (raw4) {
    case 0:
      return 'Reserved'
    case 1:
      return 'Power State Change'
    case 2:
      return 'Power Button Press'
    case 3:
      return 'Power Button Release'
    case 4:
      return 'Controller Initiated Wake'
    case 5:
      return 'Source is about to reduce Source Capabilities'
    default:
      return 'Reserved'
  }
}

function buildAlertDataObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  objectCount: number,
): BuiltSection {
  const extendedAlertEvent = extractBits(raw32, 31, 1)
  const ovpEvent = extractBits(raw32, 30, 1)
  const sourceInputChangeEvent = extractBits(raw32, 29, 1)
  const operatingConditionChange = extractBits(raw32, 28, 1)
  const otpEvent = extractBits(raw32, 27, 1)
  const ocpEvent = extractBits(raw32, 26, 1)
  const batteryStatusChangeEvent = extractBits(raw32, 25, 1)
  const reservedTypeBit = extractBits(raw32, 24, 1)
  const fixedBatteries = extractBits(raw32, 20, 4)
  const hotSwappableBatteries = extractBits(raw32, 16, 4)
  const reserved = extractBits(raw32, 4, 12)
  const extendedAlertEventType = extractBits(raw32, 0, 4)
  const issues: DecodeIssue[] = []

  if (objectCount !== 1) {
    issues.push(
      createIssue(
        'PD_ALERT_OBJECT_COUNT_INVALID',
        `Alert Message shall contain exactly one Alert Data Object; found ${objectCount}.`,
      ),
    )
  }

  if (reservedTypeBit !== 0) {
    issues.push(
      createIssue(
        'PD_ALERT_TYPE_RESERVED_BIT_NONZERO',
        'Alert Data Object Type of Alert reserved bit 0 (B24) is non-zero.',
      ),
    )
  }

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_ALERT_RESERVED_BITS_NONZERO',
        'Alert Data Object reserved bits 15..4 are non-zero.',
      ),
    )
  }

  if (extendedAlertEvent === 0 && extendedAlertEventType !== 0) {
    issues.push(
      createIssue(
        'PD_ALERT_EXTENDED_TYPE_WITHOUT_FLAG',
        'Extended Alert Event Type shall be zero when Extended Alert Event is not set.',
      ),
    )
  }

  if (extendedAlertEvent === 1 && extendedAlertEventType === 0) {
    issues.push(
      createIssue(
        'PD_ALERT_EXTENDED_TYPE_RESERVED',
        'Extended Alert Event Type 0000b is reserved when Extended Alert Event is set.',
      ),
    )
  }

  if (extendedAlertEvent === 1 && extendedAlertEventType >= 6) {
    issues.push(
      createIssue(
        'PD_ALERT_EXTENDED_TYPE_RESERVED',
        'Extended Alert Event Type values 0110b..1111b are reserved.',
      ),
    )
  }

  if (
    batteryStatusChangeEvent === 0 &&
    (fixedBatteries !== 0 || hotSwappableBatteries !== 0)
  ) {
    issues.push(
      createIssue(
        'PD_ALERT_BATTERY_BITMAP_WITHOUT_EVENT',
        'Battery bitmaps should be zero when Battery Status Change Event is not set.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:alert_data_object`,
      'data_object',
      'Alert Data Object',
      'alert_data_object',
      byteOffset,
      raw32,
      [
        field(
          'extended_alert_event',
          'Extended Alert Event',
          31,
          1,
          extendedAlertEvent,
          extendedAlertEvent === 1,
          {
            displayValue: boolDisplay(extendedAlertEvent === 1, 'Set', 'Clear'),
          },
        ),
        field('ovp_event', 'OVP Event', 30, 1, ovpEvent, ovpEvent === 1, {
          displayValue: boolDisplay(ovpEvent === 1, 'Set', 'Clear'),
        }),
        field(
          'source_input_change_event',
          'Source Input Change Event',
          29,
          1,
          sourceInputChangeEvent,
          sourceInputChangeEvent === 1,
          {
            displayValue: boolDisplay(
              sourceInputChangeEvent === 1,
              'Set',
              'Clear',
            ),
          },
        ),
        field(
          'operating_condition_change',
          'Operating Condition Change',
          28,
          1,
          operatingConditionChange,
          operatingConditionChange === 1,
          {
            displayValue: boolDisplay(
              operatingConditionChange === 1,
              'Set',
              'Clear',
            ),
          },
        ),
        field('otp_event', 'OTP Event', 27, 1, otpEvent, otpEvent === 1, {
          displayValue: boolDisplay(otpEvent === 1, 'Set', 'Clear'),
        }),
        field('ocp_event', 'OCP Event', 26, 1, ocpEvent, ocpEvent === 1, {
          displayValue: boolDisplay(ocpEvent === 1, 'Set', 'Clear'),
          note: 'Reserved for Sink-originated Alert Messages.',
        }),
        field(
          'battery_status_change_event',
          'Battery Status Change Event',
          25,
          1,
          batteryStatusChangeEvent,
          batteryStatusChangeEvent === 1,
          {
            displayValue: boolDisplay(
              batteryStatusChangeEvent === 1,
              'Set',
              'Clear',
            ),
          },
        ),
        field(
          'reserved_type_bit',
          'Reserved',
          24,
          1,
          reservedTypeBit,
          reservedTypeBit,
        ),
        field(
          'fixed_batteries',
          'Fixed Batteries',
          20,
          4,
          fixedBatteries,
          fixedBatteries,
          {
            displayValue: alertBatteryBitmapDisplay(fixedBatteries, 0),
          },
        ),
        field(
          'hot_swappable_batteries',
          'Hot Swappable Batteries',
          16,
          4,
          hotSwappableBatteries,
          hotSwappableBatteries,
          {
            displayValue: alertBatteryBitmapDisplay(hotSwappableBatteries, 4),
          },
        ),
        field('reserved', 'Reserved', 4, 12, reserved, reserved),
        field(
          'extended_alert_event_type',
          'Extended Alert Event Type',
          0,
          4,
          extendedAlertEventType,
          extendedAlertEventType,
          {
            displayValue: alertExtendedEventTypeDisplay(extendedAlertEventType),
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function batteryChargingStatusDisplay(
  raw2: number,
  batteryPresent: number,
): string {
  if (batteryPresent === 0) {
    return 'Reserved'
  }

  switch (raw2) {
    case 0:
      return 'Charging'
    case 1:
      return 'Discharging'
    case 2:
      return 'Idle'
    default:
      return 'Reserved'
  }
}

function buildBatteryStatusDataObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  objectCount: number,
): BuiltSection {
  const batteryPresentCapacity = extractBits(raw32, 16, 16)
  const reservedHigh = extractBits(raw32, 12, 4)
  const batteryChargingStatus = extractBits(raw32, 10, 2)
  const batteryPresent = extractBits(raw32, 9, 1)
  const invalidBatteryReference = extractBits(raw32, 8, 1)
  const reservedLow = extractBits(raw32, 0, 8)
  const issues: DecodeIssue[] = []

  if (objectCount !== 1) {
    issues.push(
      createIssue(
        'PD_BATTERY_STATUS_OBJECT_COUNT_INVALID',
        `Battery_Status Message shall contain exactly one Battery Status Data Object; found ${objectCount}.`,
      ),
    )
  }

  if (reservedHigh !== 0) {
    issues.push(
      createIssue(
        'PD_BATTERY_STATUS_RESERVED_HIGH_NONZERO',
        'Battery Status Data Object reserved bits 15..12 are non-zero.',
      ),
    )
  }

  if (reservedLow !== 0) {
    issues.push(
      createIssue(
        'PD_BATTERY_STATUS_RESERVED_LOW_NONZERO',
        'Battery Status Data Object reserved bits 7..0 are non-zero.',
      ),
    )
  }

  if (batteryPresent === 0 && batteryChargingStatus !== 0) {
    issues.push(
      createIssue(
        'PD_BATTERY_STATUS_CHARGING_STATUS_WITHOUT_BATTERY',
        'Battery Charging Status shall be zero when Battery Present is zero.',
      ),
    )
  }

  if (batteryPresent === 1 && batteryChargingStatus === 0b11) {
    issues.push(
      createIssue(
        'PD_BATTERY_STATUS_CHARGING_STATUS_RESERVED',
        'Battery Charging Status value 11b is reserved when Battery Present is set.',
      ),
    )
  }

  const capacityDisplay =
    batteryPresentCapacity === 0xffff
      ? 'Unknown'
      : `${(batteryPresentCapacity / 10).toFixed(1)} Wh`

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:battery_status_data_object`,
      'data_object',
      'Battery Status Data Object',
      'battery_status_data_object',
      byteOffset,
      raw32,
      [
        field(
          'battery_present_capacity',
          'Battery Present Capacity',
          16,
          16,
          batteryPresentCapacity,
          batteryPresentCapacity,
          {
            displayValue: capacityDisplay,
            note:
              batteryPresentCapacity === 0xffff
                ? '0xFFFF indicates Battery SoC unknown.'
                : 'State of Charge in 0.1 Wh increments.',
          },
        ),
        field('reserved_high', 'Reserved', 12, 4, reservedHigh, reservedHigh),
        field(
          'battery_charging_status',
          'Battery Charging Status',
          10,
          2,
          batteryChargingStatus,
          batteryChargingStatus,
          {
            displayValue: batteryChargingStatusDisplay(
              batteryChargingStatus,
              batteryPresent,
            ),
          },
        ),
        field(
          'battery_present',
          'Battery Present',
          9,
          1,
          batteryPresent,
          batteryPresent === 1,
          {
            displayValue: boolDisplay(
              batteryPresent === 1,
              'Present',
              'Not Present',
            ),
          },
        ),
        field(
          'invalid_battery_reference',
          'Invalid Battery Reference',
          8,
          1,
          invalidBatteryReference,
          invalidBatteryReference === 1,
          {
            displayValue: boolDisplay(
              invalidBatteryReference === 1,
              'Invalid',
              'Valid',
            ),
          },
        ),
        field('reserved_low', 'Reserved', 0, 8, reservedLow, reservedLow),
      ],
      issues,
      index,
    ),
  }
}

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
      'BIST Data Object',
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

function buildGenericObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  kind: Section['kind'] = 'data_object',
  title = `Data Object ${index + 1}`,
  semanticKind = 'raw_data_object',
): BuiltSection {
  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:${semanticKind}`,
      kind,
      title,
      semanticKind,
      byteOffset,
      raw32,
      [field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8))],
      [],
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

  const sections: Section[] = []

  for (let index = 0; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4

    let built: BuiltSection

    if (messageType.name === 'BIST' && index === 0) {
      built = buildBistDataObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        count,
      )
    } else if (messageType.name === 'BIST') {
      built = buildGenericObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        'data_object',
        `BIST Test Data Object ${index + 1}`,
        'bist_test_data_object',
      )
    } else if (messageType.name === 'Enter_USB' && index === 0) {
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
    } else if (messageType.name === 'Battery_Status' && index === 0) {
      built = buildBatteryStatusDataObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        count,
      )
    } else if (messageType.name === 'Alert' && index === 0) {
      built = buildAlertDataObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        count,
      )
    } else {
      built = buildGenericObject(raw32, index, payloadSectionKey, byteOffset)
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
