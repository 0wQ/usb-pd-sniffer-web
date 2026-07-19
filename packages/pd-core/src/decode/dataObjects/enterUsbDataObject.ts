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

export function explainEnterUsbDataObjects(
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
        ? buildEnterUsbDataObject(
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
