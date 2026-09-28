import { readUint16Le } from '../../utils/bits.js'
import { buildDeclaredDataSizeIssues } from './dataBlockValidation.js'
import {
  type BuiltSection,
  createDataBlockSection,
  createIssue,
  field,
  hex,
} from './sectionBuilders.js'

export function batteryReferenceDisplay(value: number): string {
  if (value <= 3) {
    return `Fixed Battery ${value}`
  }
  if (value <= 7) {
    return `Hot Swappable Battery ${value - 4}`
  }
  return 'Reserved'
}

export function buildGetBatteryCapDataBlock(
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
      'Get Battery Cap Data Block (GBCDB)',
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

export function buildGetBatteryStatusDataBlock(
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
      'Get Battery Status Data Block (GBSDB)',
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

export function buildBatteryCapabilitiesDataBlock(
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
      'Battery Capability Data Block (BCDB)',
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
