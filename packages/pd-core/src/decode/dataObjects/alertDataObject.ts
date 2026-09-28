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
      'Alert Data Object (ADO)',
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

export function explainAlertDataObjects(
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
        ? buildAlertDataObject(
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
