import type { StartOfPacket } from '../../types.js'
import { buildDeclaredDataSizeIssues } from './dataBlockValidation.js'
import {
  type BuiltSection,
  boolDisplay,
  createDataBlockSection,
  createIssue,
  field,
} from './sectionBuilders.js'

function statusInternalTemperatureDisplay(value: number): string {
  if (value === 0) {
    return 'Not Supported'
  }
  if (value === 1) {
    return 'Less than 2°C'
  }
  return `${value} °C`
}

function statusTemperatureStatusDisplay(value: number): string {
  switch (value) {
    case 0:
      return 'Not Supported'
    case 1:
      return 'Normal'
    case 2:
      return 'Warning'
    case 3:
      return 'Over Temperature'
    default:
      return 'Reserved'
  }
}

function statusPowerStateDisplay(value: number): string {
  switch (value) {
    case 0:
      return 'Status Not Supported'
    case 1:
      return 'S0'
    case 2:
      return 'Modern Standby'
    case 3:
      return 'S3'
    case 4:
      return 'S4'
    case 5:
      return 'S5'
    case 6:
      return 'G3'
    default:
      return 'Reserved'
  }
}

function statusPowerStateIndicatorDisplay(value: number): string {
  switch (value) {
    case 0:
      return 'Off LED'
    case 1:
      return 'On LED'
    case 2:
      return 'Blinking LED'
    case 3:
      return 'Breathing LED'
    default:
      return 'Reserved'
  }
}

function batteryBitmapDisplay(value: number, baseIndex: number): string {
  const batteries: number[] = []
  for (let bit = 0; bit < 4; bit += 1) {
    if (((value >>> bit) & 0x01) === 1) {
      batteries.push(baseIndex + bit)
    }
  }
  return batteries.length === 0 ? 'None' : batteries.join(', ')
}

export function buildStatusDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  sop: StartOfPacket,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  if (sop === 'SOP') {
    const issues = buildDeclaredDataSizeIssues(
      'Status',
      7,
      declaredDataSize,
      bytes.length,
    )
    const internalTemp = bytes[0] ?? 0
    const presentInput = bytes[1] ?? 0
    const presentBatteryInput = bytes[2] ?? 0
    const eventFlags = bytes[3] ?? 0
    const temperatureStatus = bytes[4] ?? 0
    const powerStatus = bytes[5] ?? 0
    const powerStateChange = bytes[6] ?? 0

    const presentInputReservedBit0 = presentInput & 0x01
    const presentInputExternalPower = (presentInput >>> 1) & 0x01
    const presentInputExternalPowerType = (presentInput >>> 2) & 0x01
    const presentInputInternalBattery = (presentInput >>> 3) & 0x01
    const presentInputInternalNonBattery = (presentInput >>> 4) & 0x01
    const presentInputReservedHigh = (presentInput >>> 5) & 0x07

    const eventFlagsReservedBit0 = eventFlags & 0x01
    const eventFlagsReservedHigh = (eventFlags >>> 5) & 0x07

    const temperatureStatusReservedBit0 = temperatureStatus & 0x01
    const temperatureStatusValue = (temperatureStatus >>> 1) & 0x03
    const temperatureStatusReservedHigh = (temperatureStatus >>> 3) & 0x1f

    const powerStatusReservedBit0 = powerStatus & 0x01
    const powerStatusReservedHigh = (powerStatus >>> 6) & 0x03

    const powerStateValue = powerStateChange & 0x07
    const powerStateIndicator = (powerStateChange >>> 3) & 0x07
    const powerStateReservedHigh = (powerStateChange >>> 6) & 0x03

    if (
      (presentInputReservedBit0 | presentInputReservedHigh) !== 0 &&
      bytes.length >= 2
    ) {
      issues.push(
        createIssue(
          'PD_STATUS_PRESENT_INPUT_RESERVED_BITS_NONZERO',
          'Status Present Input reserved bits are non-zero.',
        ),
      )
    }

    if (
      presentInputExternalPower === 0 &&
      presentInputExternalPowerType !== 0 &&
      bytes.length >= 2
    ) {
      issues.push(
        createIssue(
          'PD_STATUS_PRESENT_INPUT_EXTERNAL_POWER_TYPE_INVALID',
          'Present Input External Power Type bit shall be zero when External Power is not set.',
        ),
      )
    }

    if (
      presentInputInternalBattery === 0 &&
      presentBatteryInput !== 0 &&
      bytes.length >= 3
    ) {
      issues.push(
        createIssue(
          'PD_STATUS_PRESENT_BATTERY_INPUT_NONZERO',
          'Present Battery Input shall be zero when Internal Power from Battery is not set.',
        ),
      )
    }

    if (
      (eventFlagsReservedBit0 | eventFlagsReservedHigh) !== 0 &&
      bytes.length >= 4
    ) {
      issues.push(
        createIssue(
          'PD_STATUS_EVENT_FLAGS_RESERVED_BITS_NONZERO',
          'Status Event Flags reserved bits are non-zero.',
        ),
      )
    }

    if (
      (temperatureStatusReservedBit0 | temperatureStatusReservedHigh) !== 0 &&
      bytes.length >= 5
    ) {
      issues.push(
        createIssue(
          'PD_STATUS_TEMPERATURE_STATUS_RESERVED_BITS_NONZERO',
          'Status Temperature Status reserved bits are non-zero.',
        ),
      )
    }

    if (
      (powerStatusReservedBit0 | powerStatusReservedHigh) !== 0 &&
      bytes.length >= 6
    ) {
      issues.push(
        createIssue(
          'PD_STATUS_POWER_STATUS_RESERVED_BITS_NONZERO',
          'Status Power Status reserved bits are non-zero.',
        ),
      )
    }

    if (powerStateValue === 0x07 && bytes.length >= 7) {
      issues.push(
        createIssue(
          'PD_STATUS_POWER_STATE_RESERVED',
          'Status New Power State value 111b is reserved.',
        ),
      )
    }

    if (powerStateIndicator >= 0x04 && bytes.length >= 7) {
      issues.push(
        createIssue(
          'PD_STATUS_POWER_STATE_INDICATOR_RESERVED',
          'Status New Power State indicator values 100b..111b are reserved.',
        ),
      )
    }

    if (powerStateReservedHigh !== 0 && bytes.length >= 7) {
      issues.push(
        createIssue(
          'PD_STATUS_POWER_STATE_RESERVED_BITS_NONZERO',
          'Status Power State Change reserved bits 7..6 are non-zero.',
        ),
      )
    }

    if (
      ((eventFlags >>> 2) & 0x01) === 1 &&
      temperatureStatusValue !== 0x03 &&
      bytes.length >= 5
    ) {
      issues.push(
        createIssue(
          'PD_STATUS_OTP_EVENT_MISMATCH',
          'Temperature Status should be Over Temperature when OTP Event is set.',
        ),
      )
    }

    if (
      temperatureStatusValue === 0x03 &&
      ((eventFlags >>> 2) & 0x01) === 0 &&
      bytes.length >= 5
    ) {
      issues.push(
        createIssue(
          'PD_STATUS_TEMPERATURE_STATUS_MISMATCH',
          'OTP Event should be set when Temperature Status is Over Temperature.',
        ),
      )
    }

    return {
      section: createDataBlockSection(
        `${parentSectionKey}:status-sop`,
        'SOP Status Data Block',
        'sop_status_data_block',
        byteOffset,
        bytes.subarray(0, Math.min(bytes.length, 7)),
        [
          field(
            'internal_temp',
            'Internal Temp',
            0,
            8,
            internalTemp,
            internalTemp,
            {
              displayValue: statusInternalTemperatureDisplay(internalTemp),
            },
          ),
          field(
            'present_input_reserved_bit_0',
            'Present Input Reserved Bit 0',
            8,
            1,
            presentInputReservedBit0,
            presentInputReservedBit0,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
          field(
            'external_power',
            'External Power',
            9,
            1,
            presentInputExternalPower,
            presentInputExternalPower === 1,
            {
              displayValue: boolDisplay(
                presentInputExternalPower === 1,
                'Present',
                'Not Present',
              ),
            },
          ),
          field(
            'external_power_type',
            'External Power Type',
            10,
            1,
            presentInputExternalPowerType,
            presentInputExternalPowerType === 1,
            {
              displayValue:
                presentInputExternalPower === 1
                  ? presentInputExternalPowerType === 1
                    ? 'AC'
                    : 'DC'
                  : 'Reserved',
              note: 'Valid only when External Power is set.',
            },
          ),
          field(
            'internal_power_from_battery',
            'Internal Power from Battery',
            11,
            1,
            presentInputInternalBattery,
            presentInputInternalBattery === 1,
            {
              displayValue: boolDisplay(
                presentInputInternalBattery === 1,
                'Present',
                'Not Present',
              ),
            },
          ),
          field(
            'internal_power_from_non_battery',
            'Internal Power from non-Battery',
            12,
            1,
            presentInputInternalNonBattery,
            presentInputInternalNonBattery === 1,
            {
              displayValue: boolDisplay(
                presentInputInternalNonBattery === 1,
                'Present',
                'Not Present',
              ),
            },
          ),
          field(
            'present_input_reserved_high',
            'Present Input Reserved Bits 7..5',
            13,
            3,
            presentInputReservedHigh,
            presentInputReservedHigh,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
          field(
            'present_battery_input_fixed',
            'Present Battery Input - Fixed Batteries',
            16,
            4,
            presentBatteryInput & 0x0f,
            presentBatteryInput & 0x0f,
            {
              displayValue: batteryBitmapDisplay(presentBatteryInput & 0x0f, 0),
              note: 'Valid only when Internal Power from Battery is set.',
            },
          ),
          field(
            'present_battery_input_hot_swap',
            'Present Battery Input - Hot Swappable Batteries',
            20,
            4,
            (presentBatteryInput >>> 4) & 0x0f,
            (presentBatteryInput >>> 4) & 0x0f,
            {
              displayValue: batteryBitmapDisplay(
                (presentBatteryInput >>> 4) & 0x0f,
                4,
              ),
              note: 'Valid only when Internal Power from Battery is set.',
            },
          ),
          field(
            'event_flags_reserved_bit_0',
            'Event Flags Reserved Bit 0',
            24,
            1,
            eventFlagsReservedBit0,
            eventFlagsReservedBit0,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
          field(
            'ocp_event',
            'OCP Event',
            25,
            1,
            (eventFlags >>> 1) & 0x01,
            ((eventFlags >>> 1) & 0x01) === 1,
            {
              displayValue: boolDisplay(((eventFlags >>> 1) & 0x01) === 1),
            },
          ),
          field(
            'otp_event',
            'OTP Event',
            26,
            1,
            (eventFlags >>> 2) & 0x01,
            ((eventFlags >>> 2) & 0x01) === 1,
            {
              displayValue: boolDisplay(((eventFlags >>> 2) & 0x01) === 1),
            },
          ),
          field(
            'ovp_event',
            'OVP Event',
            27,
            1,
            (eventFlags >>> 3) & 0x01,
            ((eventFlags >>> 3) & 0x01) === 1,
            {
              displayValue: boolDisplay(((eventFlags >>> 3) & 0x01) === 1),
            },
          ),
          field(
            'cl_cv_mode',
            'CL/CV Mode',
            28,
            1,
            (eventFlags >>> 4) & 0x01,
            (eventFlags >>> 4) & 0x01,
            {
              displayValue:
                ((eventFlags >>> 4) & 0x01) === 1 ? 'CL Mode' : 'CV Mode',
              note: 'In PPS Mode only: CL mode when set, CV mode when cleared.',
            },
          ),
          field(
            'event_flags_reserved_high',
            'Event Flags Reserved Bits 7..5',
            29,
            3,
            eventFlagsReservedHigh,
            eventFlagsReservedHigh,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
          field(
            'temperature_status_reserved_bit_0',
            'Temperature Status Reserved Bit 0',
            32,
            1,
            temperatureStatusReservedBit0,
            temperatureStatusReservedBit0,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
          field(
            'temperature_status',
            'Temperature Status',
            33,
            2,
            temperatureStatusValue,
            temperatureStatusValue,
            {
              displayValue: statusTemperatureStatusDisplay(
                temperatureStatusValue,
              ),
            },
          ),
          field(
            'temperature_status_reserved_high',
            'Temperature Status Reserved Bits 7..3',
            35,
            5,
            temperatureStatusReservedHigh,
            temperatureStatusReservedHigh,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
          field(
            'power_status_reserved_bit_0',
            'Power Status Reserved Bit 0',
            40,
            1,
            powerStatusReservedBit0,
            powerStatusReservedBit0,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
          field(
            'source_power_limited_by_cable_current',
            'Source Power Limited by Cable Current',
            41,
            1,
            (powerStatus >>> 1) & 0x01,
            ((powerStatus >>> 1) & 0x01) === 1,
            {
              displayValue: boolDisplay(((powerStatus >>> 1) & 0x01) === 1),
            },
          ),
          field(
            'source_power_limited_by_other_ports',
            'Source Power Limited by Other Ports',
            42,
            1,
            (powerStatus >>> 2) & 0x01,
            ((powerStatus >>> 2) & 0x01) === 1,
            {
              displayValue: boolDisplay(((powerStatus >>> 2) & 0x01) === 1),
            },
          ),
          field(
            'source_power_limited_by_external_power',
            'Source Power Limited by External Power',
            43,
            1,
            (powerStatus >>> 3) & 0x01,
            ((powerStatus >>> 3) & 0x01) === 1,
            {
              displayValue: boolDisplay(((powerStatus >>> 3) & 0x01) === 1),
            },
          ),
          field(
            'source_power_limited_by_event_flags',
            'Source Power Limited by Event Flags',
            44,
            1,
            (powerStatus >>> 4) & 0x01,
            ((powerStatus >>> 4) & 0x01) === 1,
            {
              displayValue: boolDisplay(((powerStatus >>> 4) & 0x01) === 1),
            },
          ),
          field(
            'source_power_limited_by_temperature',
            'Source Power Limited by Temperature',
            45,
            1,
            (powerStatus >>> 5) & 0x01,
            ((powerStatus >>> 5) & 0x01) === 1,
            {
              displayValue: boolDisplay(((powerStatus >>> 5) & 0x01) === 1),
            },
          ),
          field(
            'power_status_reserved_high',
            'Power Status Reserved Bits 7..6',
            46,
            2,
            powerStatusReservedHigh,
            powerStatusReservedHigh,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
          field(
            'new_power_state',
            'New Power State',
            48,
            3,
            powerStateValue,
            powerStateValue,
            {
              displayValue: statusPowerStateDisplay(powerStateValue),
            },
          ),
          field(
            'new_power_state_indicator',
            'New Power State Indicator',
            51,
            3,
            powerStateIndicator,
            powerStateIndicator,
            {
              displayValue:
                statusPowerStateIndicatorDisplay(powerStateIndicator),
            },
          ),
          field(
            'power_state_change_reserved_high',
            'Power State Change Reserved Bits 7..6',
            54,
            2,
            powerStateReservedHigh,
            powerStateReservedHigh,
            {
              note: 'Reserved and shall be set to zero.',
            },
          ),
        ],
        issues,
      ),
    }
  }

  const issues = buildDeclaredDataSizeIssues(
    'Status',
    2,
    declaredDataSize,
    bytes.length,
  )
  const internalTemp = bytes[0] ?? 0
  const flags = bytes[1] ?? 0
  const thermalShutdown = flags & 0x01
  const reservedFlags = (flags >>> 1) & 0x7f

  if (reservedFlags !== 0 && bytes.length >= 2) {
    issues.push(
      createIssue(
        'PD_CABLE_STATUS_RESERVED_FLAGS_NONZERO',
        'Cable Plug Status Flags reserved bits 7..1 are non-zero.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:status-cable-plug`,
      'Cable Plug Status Data Block',
      'cable_plug_status_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 2)),
      [
        field(
          'internal_temp',
          'Internal Temp',
          0,
          8,
          internalTemp,
          internalTemp,
          {
            displayValue: statusInternalTemperatureDisplay(internalTemp),
          },
        ),
        field(
          'thermal_shutdown',
          'Thermal Shutdown',
          8,
          1,
          thermalShutdown,
          thermalShutdown === 1,
          {
            displayValue: boolDisplay(thermalShutdown === 1),
          },
        ),
        field(
          'flags_reserved_high',
          'Flags Reserved Bits 7..1',
          9,
          7,
          reservedFlags,
          reservedFlags,
          {
            note: 'Reserved and shall be set to zero.',
          },
        ),
      ],
      issues,
    ),
  }
}
