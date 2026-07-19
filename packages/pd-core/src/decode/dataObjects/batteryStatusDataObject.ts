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

export function explainBatteryStatusDataObjects(
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
        ? buildBatteryStatusDataObject(
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
