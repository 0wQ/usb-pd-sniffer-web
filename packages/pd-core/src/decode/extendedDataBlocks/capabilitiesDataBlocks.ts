import type { BitField } from '../../types.js'
import { readUint16Le } from '../../utils/bits.js'
import { buildDeclaredDataSizeIssues } from './dataBlockValidation.js'
import {
  type BuiltSection,
  boolDisplay,
  createDataBlockSection,
  createIssue,
  field,
  hex,
} from './sectionBuilders.js'

function loadStepDisplay(value: number): string {
  switch (value) {
    case 0:
      return '150mA/μs'
    case 1:
      return '500mA/μs'
    default:
      return 'Reserved'
  }
}

function touchTempDisplay(value: number, source: 'source' | 'sink'): string {
  if (source === 'source') {
    switch (value) {
      case 0:
        return '[IEC 60950-1]'
      case 1:
        return '[IEC 62368-1] TS1'
      case 2:
        return '[IEC 62368-1] TS2'
      default:
        return 'Reserved'
    }
  }

  switch (value) {
    case 0:
      return 'Not Applicable'
    case 1:
      return '[IEC 60950-1]'
    case 2:
      return '[IEC 62368-1] TS1'
    case 3:
      return '[IEC 62368-1] TS2'
    default:
      return 'Reserved'
  }
}

export function buildSourceCapabilitiesExtendedDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues = buildDeclaredDataSizeIssues(
    'Source_Capabilities_Extended',
    25,
    declaredDataSize,
    bytes.length,
  )
  const vid = readUint16Le(bytes, 0)
  const pid = readUint16Le(bytes, 2)
  const xid =
    ((bytes[4] ?? 0) |
      ((bytes[5] ?? 0) << 8) |
      ((bytes[6] ?? 0) << 16) |
      ((bytes[7] ?? 0) << 24)) >>>
    0
  const fwVersion = bytes[8] ?? 0
  const hwVersion = bytes[9] ?? 0

  const voltageRegulation = bytes[10] ?? 0
  const loadStepSlewRate = voltageRegulation & 0x03
  const loadStepMagnitude = (voltageRegulation >>> 2) & 0x01
  const voltageRegulationReserved = (voltageRegulation >>> 3) & 0x1f

  const holdupTime = bytes[11] ?? 0

  const compliance = bytes[12] ?? 0
  const complianceReserved = (compliance >>> 3) & 0x1f

  const touchCurrent = bytes[13] ?? 0
  const lowTouchCurrent = touchCurrent & 0x01
  const groundPinSupported = (touchCurrent >>> 1) & 0x01
  const groundPinProtectiveEarth = (touchCurrent >>> 2) & 0x01
  const touchCurrentReserved = (touchCurrent >>> 3) & 0x1f

  const touchTemp = bytes[20] ?? 0

  const sourceInputs = bytes[21] ?? 0
  const externalSupplyPresent = sourceInputs & 0x01
  const externalSupplyUnconstrained = (sourceInputs >>> 1) & 0x01
  const internalBatteryPresent = (sourceInputs >>> 2) & 0x01
  const sourceInputsReserved = (sourceInputs >>> 3) & 0x1f

  const batteryInfo = bytes[22] ?? 0
  const fixedBatteries = batteryInfo & 0x0f
  const hotSwappableBatterySlots = (batteryInfo >>> 4) & 0x0f

  const sprSourcePdpRating = bytes[23] ?? 0
  const sprSourcePdpReserved = (sprSourcePdpRating >>> 7) & 0x01
  const sprSourcePdp = sprSourcePdpRating & 0x7f
  const eprSourcePdp = bytes[24] ?? 0

  if (loadStepSlewRate >= 0x02 && bytes.length >= 11) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_LOAD_STEP_RESERVED',
        'Voltage Regulation Load Step Slew Rate values 10b..11b are reserved.',
      ),
    )
  }

  if (voltageRegulationReserved !== 0 && bytes.length >= 11) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_VOLTAGE_REGULATION_RESERVED_BITS_NONZERO',
        'Voltage Regulation reserved bits 7..3 are non-zero.',
      ),
    )
  }

  if (complianceReserved !== 0 && bytes.length >= 13) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_COMPLIANCE_RESERVED_BITS_NONZERO',
        'Compliance reserved bits 7..3 are non-zero.',
      ),
    )
  }

  if (touchCurrentReserved !== 0 && bytes.length >= 14) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_TOUCH_CURRENT_RESERVED_BITS_NONZERO',
        'Touch Current reserved bits 7..3 are non-zero.',
      ),
    )
  }

  if (
    groundPinProtectiveEarth === 1 &&
    groundPinSupported === 0 &&
    bytes.length >= 14
  ) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_PROTECTIVE_EARTH_WITHOUT_GROUND_PIN',
        'Ground Pin Intended for Protective Earth requires Ground Pin Supported to be set.',
      ),
    )
  }

  if (touchTemp >= 0x03 && bytes.length >= 21) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_TOUCH_TEMP_RESERVED',
        'Touch Temp values 3..255 are reserved.',
      ),
    )
  }

  if (sourceInputsReserved !== 0 && bytes.length >= 22) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_SOURCE_INPUTS_RESERVED_BITS_NONZERO',
        'Source Inputs reserved bits 7..3 are non-zero.',
      ),
    )
  }

  if (
    externalSupplyPresent === 0 &&
    externalSupplyUnconstrained === 1 &&
    bytes.length >= 22
  ) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_SOURCE_INPUTS_INVALID',
        'Source Inputs bit 1 shall be zero when External Supply is not present.',
      ),
    )
  }

  if (fixedBatteries > 4 && bytes.length >= 23) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_FIXED_BATTERIES_OUT_OF_RANGE',
        'Number of Fixed Batteries shall not exceed 4.',
      ),
    )
  }

  if (hotSwappableBatterySlots > 4 && bytes.length >= 23) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_HOT_SWAP_BATTERIES_OUT_OF_RANGE',
        'Number of Hot Swappable Battery Slots shall not exceed 4.',
      ),
    )
  }

  if (sprSourcePdpReserved !== 0 && bytes.length >= 24) {
    issues.push(
      createIssue(
        'PD_SOURCE_CAPABILITIES_EXTENDED_SPR_PDP_RESERVED_BIT_NONZERO',
        'SPR Source PDP Rating reserved bit 7 is non-zero.',
      ),
    )
  }

  const fields: BitField[] = [
    field('vid', 'VID', 0, 16, vid, vid, {
      displayValue: hex(vid, 4),
    }),
    field('pid', 'PID', 16, 16, pid, pid, {
      displayValue: hex(pid, 4),
    }),
    field('xid', 'XID', 32, 32, xid, xid, {
      displayValue: hex(xid, 8),
    }),
    field('fw_version', 'FW Version', 64, 8, fwVersion, fwVersion, {
      displayValue: hex(fwVersion, 2),
    }),
    field('hw_version', 'HW Version', 72, 8, hwVersion, hwVersion, {
      displayValue: hex(hwVersion, 2),
    }),
    field(
      'load_step_slew_rate',
      'Load Step Slew Rate',
      80,
      2,
      loadStepSlewRate,
      loadStepSlewRate,
      {
        displayValue: loadStepDisplay(loadStepSlewRate),
      },
    ),
    field(
      'load_step_magnitude',
      'Load Step Magnitude',
      82,
      1,
      loadStepMagnitude,
      loadStepMagnitude === 1,
      {
        displayValue: loadStepMagnitude === 1 ? '90% IoC' : '25% IoC',
      },
    ),
    field(
      'voltage_regulation_reserved',
      'Voltage Regulation Reserved Bits 7..3',
      83,
      5,
      voltageRegulationReserved,
      voltageRegulationReserved,
      {
        note: 'Reserved and shall not be used.',
      },
    ),
    field('holdup_time', 'Holdup Time', 88, 8, holdupTime, holdupTime, {
      displayValue: holdupTime === 0 ? 'Not Supported' : `${holdupTime} ms`,
    }),
    field(
      'lps_compliant',
      'LPS Compliant',
      96,
      1,
      compliance & 0x01,
      (compliance & 0x01) === 1,
      {
        displayValue: boolDisplay((compliance & 0x01) === 1),
      },
    ),
    field(
      'ps1_compliant',
      'PS1 Compliant',
      97,
      1,
      (compliance >>> 1) & 0x01,
      ((compliance >>> 1) & 0x01) === 1,
      {
        displayValue: boolDisplay(((compliance >>> 1) & 0x01) === 1),
      },
    ),
    field(
      'ps2_compliant',
      'PS2 Compliant',
      98,
      1,
      (compliance >>> 2) & 0x01,
      ((compliance >>> 2) & 0x01) === 1,
      {
        displayValue: boolDisplay(((compliance >>> 2) & 0x01) === 1),
      },
    ),
    field(
      'compliance_reserved',
      'Compliance Reserved Bits 7..3',
      99,
      5,
      complianceReserved,
      complianceReserved,
      {
        note: 'Reserved and shall not be used.',
      },
    ),
    field(
      'low_touch_current_eps',
      'Low Touch Current EPS',
      104,
      1,
      lowTouchCurrent,
      lowTouchCurrent === 1,
      {
        displayValue: boolDisplay(lowTouchCurrent === 1),
      },
    ),
    field(
      'ground_pin_supported',
      'Ground Pin Supported',
      105,
      1,
      groundPinSupported,
      groundPinSupported === 1,
      {
        displayValue: boolDisplay(groundPinSupported === 1),
      },
    ),
    field(
      'ground_pin_protective_earth',
      'Ground Pin Intended for Protective Earth',
      106,
      1,
      groundPinProtectiveEarth,
      groundPinProtectiveEarth === 1,
      {
        displayValue: boolDisplay(groundPinProtectiveEarth === 1),
      },
    ),
    field(
      'touch_current_reserved',
      'Touch Current Reserved Bits 7..3',
      107,
      5,
      touchCurrentReserved,
      touchCurrentReserved,
      {
        note: 'Reserved and shall not be used.',
      },
    ),
  ]

  for (let index = 0; index < 3; index += 1) {
    const byteIndex = 14 + index * 2
    const peakCurrent = readUint16Le(bytes, byteIndex)
    const percentageOverloadRaw = peakCurrent & 0x1f
    const overloadPeriod = (peakCurrent >>> 5) & 0x3f
    const dutyCycle = (peakCurrent >>> 11) & 0x0f
    const vbusDroop = (peakCurrent >>> 15) & 0x01

    fields.push(
      field(
        `peak_current_${index + 1}_percentage_overload`,
        `Peak Current ${index + 1} - Percentage Overload`,
        byteIndex * 8,
        5,
        percentageOverloadRaw,
        percentageOverloadRaw,
        {
          displayValue: `${Math.min(25, percentageOverloadRaw) * 10}%`,
          note:
            percentageOverloadRaw > 25
              ? 'Clipped to 250% per specification.'
              : undefined,
        },
      ),
      field(
        `peak_current_${index + 1}_overload_period`,
        `Peak Current ${index + 1} - Overload Period`,
        byteIndex * 8 + 5,
        6,
        overloadPeriod,
        overloadPeriod,
        {
          displayValue: `${overloadPeriod * 20} ms`,
        },
      ),
      field(
        `peak_current_${index + 1}_duty_cycle`,
        `Peak Current ${index + 1} - Duty Cycle`,
        byteIndex * 8 + 11,
        4,
        dutyCycle,
        dutyCycle,
        {
          displayValue: `${dutyCycle * 5}%`,
        },
      ),
      field(
        `peak_current_${index + 1}_vbus_droop`,
        `Peak Current ${index + 1} - VBUS Droop`,
        byteIndex * 8 + 15,
        1,
        vbusDroop,
        vbusDroop === 1,
        {
          displayValue: boolDisplay(vbusDroop === 1),
        },
      ),
    )
  }

  fields.push(
    field('touch_temp', 'Touch Temp', 160, 8, touchTemp, touchTemp, {
      displayValue: touchTempDisplay(touchTemp, 'source'),
    }),
    field(
      'external_supply_present',
      'External Supply Present',
      168,
      1,
      externalSupplyPresent,
      externalSupplyPresent === 1,
      {
        displayValue: boolDisplay(
          externalSupplyPresent === 1,
          'Present',
          'Not Present',
        ),
      },
    ),
    field(
      'external_supply_type',
      'External Supply Type',
      169,
      1,
      externalSupplyUnconstrained,
      externalSupplyUnconstrained === 1,
      {
        displayValue:
          externalSupplyPresent === 1
            ? externalSupplyUnconstrained === 1
              ? 'Unconstrained'
              : 'Constrained'
            : 'Reserved',
        note: 'Valid only when External Supply Present is set.',
      },
    ),
    field(
      'internal_battery_present',
      'Internal Battery Present',
      170,
      1,
      internalBatteryPresent,
      internalBatteryPresent === 1,
      {
        displayValue: boolDisplay(
          internalBatteryPresent === 1,
          'Present',
          'Not Present',
        ),
      },
    ),
    field(
      'source_inputs_reserved',
      'Source Inputs Reserved Bits 7..3',
      171,
      5,
      sourceInputsReserved,
      sourceInputsReserved,
      {
        note: 'Reserved and shall be set to zero.',
      },
    ),
    field(
      'fixed_batteries',
      'Number of Fixed Batteries',
      176,
      4,
      fixedBatteries,
      fixedBatteries,
      {
        displayValue: String(fixedBatteries),
      },
    ),
    field(
      'hot_swappable_battery_slots',
      'Number of Hot Swappable Battery Slots',
      180,
      4,
      hotSwappableBatterySlots,
      hotSwappableBatterySlots,
      {
        displayValue: String(hotSwappableBatterySlots),
      },
    ),
    field(
      'spr_source_pdp',
      'SPR Source PDP Rating',
      184,
      7,
      sprSourcePdp,
      sprSourcePdp,
      {
        displayValue: `${sprSourcePdp} W`,
      },
    ),
    field(
      'spr_source_pdp_reserved',
      'SPR Source PDP Rating Reserved Bit 7',
      191,
      1,
      sprSourcePdpReserved,
      sprSourcePdpReserved,
      {
        note: 'Reserved and shall be set to zero.',
      },
    ),
    field(
      'epr_source_pdp',
      'EPR Source PDP Rating',
      192,
      8,
      eprSourcePdp,
      eprSourcePdp,
      {
        displayValue: `${eprSourcePdp} W`,
      },
    ),
  )

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:source-capabilities-extended`,
      'Source Capabilities Extended Data Block',
      'source_capabilities_extended_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 25)),
      fields,
      issues,
    ),
  }
}

export function buildSinkCapabilitiesExtendedDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues = buildDeclaredDataSizeIssues(
    'Sink_Capabilities_Extended',
    24,
    declaredDataSize,
    bytes.length,
  )
  const vid = readUint16Le(bytes, 0)
  const pid = readUint16Le(bytes, 2)
  const xid =
    ((bytes[4] ?? 0) |
      ((bytes[5] ?? 0) << 8) |
      ((bytes[6] ?? 0) << 16) |
      ((bytes[7] ?? 0) << 24)) >>>
    0
  const fwVersion = bytes[8] ?? 0
  const hwVersion = bytes[9] ?? 0
  const skedbVersion = bytes[10] ?? 0

  const loadStep = bytes[11] ?? 0
  const loadStepSlewRate = loadStep & 0x03
  const loadStepReserved = (loadStep >>> 2) & 0x3f

  const sinkLoadCharacteristics = readUint16Le(bytes, 12)
  const percentOverloadRaw = sinkLoadCharacteristics & 0x1f
  const overloadPeriod = (sinkLoadCharacteristics >>> 5) & 0x3f
  const dutyCycle = (sinkLoadCharacteristics >>> 11) & 0x0f
  const canTolerateVbusDroop = (sinkLoadCharacteristics >>> 15) & 0x01

  const compliance = bytes[14] ?? 0
  const complianceReserved = (compliance >>> 3) & 0x1f

  const touchTemp = bytes[15] ?? 0

  const batteryInfo = bytes[16] ?? 0
  const fixedBatteries = batteryInfo & 0x0f
  const hotSwappableBatterySlots = (batteryInfo >>> 4) & 0x0f

  const sinkModes = bytes[17] ?? 0
  const sinkModesReserved = (sinkModes >>> 6) & 0x03

  const sprSinkMinimumPdpRaw = bytes[18] ?? 0
  const sprSinkOperationalPdpRaw = bytes[19] ?? 0
  const sprSinkMaximumPdpRaw = bytes[20] ?? 0
  const sprSinkMinimumPdpReserved = (sprSinkMinimumPdpRaw >>> 7) & 0x01
  const sprSinkOperationalPdpReserved = (sprSinkOperationalPdpRaw >>> 7) & 0x01
  const sprSinkMaximumPdpReserved = (sprSinkMaximumPdpRaw >>> 7) & 0x01
  const sprSinkMinimumPdp = sprSinkMinimumPdpRaw & 0x7f
  const sprSinkOperationalPdp = sprSinkOperationalPdpRaw & 0x7f
  const sprSinkMaximumPdp = sprSinkMaximumPdpRaw & 0x7f

  const eprSinkMinimumPdp = bytes[21] ?? 0
  const eprSinkOperationalPdp = bytes[22] ?? 0
  const eprSinkMaximumPdp = bytes[23] ?? 0

  if (skedbVersion !== 1 && bytes.length >= 11) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_VERSION_RESERVED',
        'SKEDB Version values 0 and 2..255 are reserved; Version 1.0 shall be encoded as 1.',
      ),
    )
  }

  if (loadStepSlewRate >= 0x02 && bytes.length >= 12) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_LOAD_STEP_RESERVED',
        'Load Step Slew Rate values 10b..11b are reserved.',
      ),
    )
  }

  if (loadStepReserved !== 0 && bytes.length >= 12) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_LOAD_STEP_RESERVED_BITS_NONZERO',
        'Load Step reserved bits 7..2 are non-zero.',
      ),
    )
  }

  if (complianceReserved !== 0 && bytes.length >= 15) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_COMPLIANCE_RESERVED_BITS_NONZERO',
        'Compliance reserved bits 7..3 are non-zero.',
      ),
    )
  }

  if (touchTemp >= 0x04 && bytes.length >= 16) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_TOUCH_TEMP_RESERVED',
        'Touch Temp values 4..255 are reserved.',
      ),
    )
  }

  if (fixedBatteries > 4 && bytes.length >= 17) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_FIXED_BATTERIES_OUT_OF_RANGE',
        'Number of Fixed Batteries shall not exceed 4.',
      ),
    )
  }

  if (hotSwappableBatterySlots > 4 && bytes.length >= 17) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_HOT_SWAP_BATTERIES_OUT_OF_RANGE',
        'Number of Hot Swappable Battery Slots shall not exceed 4.',
      ),
    )
  }

  if (sinkModesReserved !== 0 && bytes.length >= 18) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_SINK_MODES_RESERVED_BITS_NONZERO',
        'Sink Modes reserved bits 7..6 are non-zero.',
      ),
    )
  }

  if (
    (sprSinkMinimumPdpReserved |
      sprSinkOperationalPdpReserved |
      sprSinkMaximumPdpReserved) !==
      0 &&
    bytes.length >= 21
  ) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_SPR_PDP_RESERVED_BITS_NONZERO',
        'SPR Sink PDP reserved bit 7 is non-zero.',
      ),
    )
  }

  if (sprSinkMinimumPdp > sprSinkOperationalPdp && bytes.length >= 20) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_SPR_MIN_GT_OPERATIONAL',
        'SPR Sink Minimum PDP shall be less than or equal to SPR Sink Operational PDP.',
      ),
    )
  }

  if (sprSinkOperationalPdp > sprSinkMaximumPdp && bytes.length >= 21) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_SPR_OPERATIONAL_GT_MAX',
        'SPR Sink Operational PDP shall be less than or equal to SPR Sink Maximum PDP.',
      ),
    )
  }

  if (eprSinkMinimumPdp > eprSinkOperationalPdp && bytes.length >= 23) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_EPR_MIN_GT_OPERATIONAL',
        'EPR Sink Minimum PDP shall be less than or equal to EPR Sink Operational PDP.',
      ),
    )
  }

  if (eprSinkOperationalPdp > eprSinkMaximumPdp && bytes.length >= 24) {
    issues.push(
      createIssue(
        'PD_SINK_CAPABILITIES_EXTENDED_EPR_OPERATIONAL_GT_MAX',
        'EPR Sink Operational PDP shall be less than or equal to EPR Sink Maximum PDP.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:sink-capabilities-extended`,
      'Sink Capabilities Extended Data Block',
      'sink_capabilities_extended_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 24)),
      [
        field('vid', 'VID', 0, 16, vid, vid, {
          displayValue: hex(vid, 4),
        }),
        field('pid', 'PID', 16, 16, pid, pid, {
          displayValue: hex(pid, 4),
        }),
        field('xid', 'XID', 32, 32, xid, xid, {
          displayValue: hex(xid, 8),
        }),
        field('fw_version', 'FW Version', 64, 8, fwVersion, fwVersion, {
          displayValue: hex(fwVersion, 2),
        }),
        field('hw_version', 'HW Version', 72, 8, hwVersion, hwVersion, {
          displayValue: hex(hwVersion, 2),
        }),
        field(
          'skedb_version',
          'SKEDB Version',
          80,
          8,
          skedbVersion,
          skedbVersion,
          {
            displayValue: skedbVersion === 1 ? 'Version 1.0' : 'Reserved',
          },
        ),
        field(
          'load_step_slew_rate',
          'Load Step Slew Rate',
          88,
          2,
          loadStepSlewRate,
          loadStepSlewRate,
          {
            displayValue: loadStepDisplay(loadStepSlewRate),
          },
        ),
        field(
          'load_step_reserved',
          'Load Step Reserved Bits 7..2',
          90,
          6,
          loadStepReserved,
          loadStepReserved,
          {
            note: 'Reserved and shall not be used.',
          },
        ),
        field(
          'sink_load_characteristics_percentage_overload',
          'Sink Load Characteristics - Percentage Overload',
          96,
          5,
          percentOverloadRaw,
          percentOverloadRaw,
          {
            displayValue: `${Math.min(25, percentOverloadRaw) * 10}%`,
            note:
              percentOverloadRaw > 25
                ? 'Clipped to 250% per specification.'
                : undefined,
          },
        ),
        field(
          'sink_load_characteristics_overload_period',
          'Sink Load Characteristics - Overload Period',
          101,
          6,
          overloadPeriod,
          overloadPeriod,
          {
            displayValue: `${overloadPeriod * 20} ms`,
            note:
              percentOverloadRaw === 0
                ? 'Relevant only when Percentage Overload is non-zero.'
                : undefined,
          },
        ),
        field(
          'sink_load_characteristics_duty_cycle',
          'Sink Load Characteristics - Duty Cycle',
          107,
          4,
          dutyCycle,
          dutyCycle,
          {
            displayValue: `${dutyCycle * 5}%`,
            note:
              percentOverloadRaw === 0
                ? 'Relevant only when Percentage Overload is non-zero.'
                : undefined,
          },
        ),
        field(
          'sink_load_characteristics_vbus_droop',
          'Sink Load Characteristics - Can Tolerate VBUS Droop',
          111,
          1,
          canTolerateVbusDroop,
          canTolerateVbusDroop === 1,
          {
            displayValue: boolDisplay(canTolerateVbusDroop === 1),
          },
        ),
        field(
          'requires_lps_source',
          'Requires LPS Source',
          112,
          1,
          compliance & 0x01,
          (compliance & 0x01) === 1,
          {
            displayValue: boolDisplay((compliance & 0x01) === 1),
          },
        ),
        field(
          'requires_ps1_source',
          'Requires PS1 Source',
          113,
          1,
          (compliance >>> 1) & 0x01,
          ((compliance >>> 1) & 0x01) === 1,
          {
            displayValue: boolDisplay(((compliance >>> 1) & 0x01) === 1),
          },
        ),
        field(
          'requires_ps2_source',
          'Requires PS2 Source',
          114,
          1,
          (compliance >>> 2) & 0x01,
          ((compliance >>> 2) & 0x01) === 1,
          {
            displayValue: boolDisplay(((compliance >>> 2) & 0x01) === 1),
          },
        ),
        field(
          'compliance_reserved',
          'Compliance Reserved Bits 7..3',
          115,
          5,
          complianceReserved,
          complianceReserved,
          {
            note: 'Reserved and shall be set to zero.',
          },
        ),
        field('touch_temp', 'Touch Temp', 120, 8, touchTemp, touchTemp, {
          displayValue: touchTempDisplay(touchTemp, 'sink'),
        }),
        field(
          'fixed_batteries',
          'Number of Fixed Batteries',
          128,
          4,
          fixedBatteries,
          fixedBatteries,
          {
            displayValue: String(fixedBatteries),
          },
        ),
        field(
          'hot_swappable_battery_slots',
          'Number of Hot Swappable Battery Slots',
          132,
          4,
          hotSwappableBatterySlots,
          hotSwappableBatterySlots,
          {
            displayValue: String(hotSwappableBatterySlots),
          },
        ),
        field(
          'pps_charging_supported',
          'PPS Charging Supported',
          136,
          1,
          sinkModes & 0x01,
          (sinkModes & 0x01) === 1,
          {
            displayValue: boolDisplay((sinkModes & 0x01) === 1),
          },
        ),
        field(
          'vbus_powered',
          'VBUS Powered',
          137,
          1,
          (sinkModes >>> 1) & 0x01,
          ((sinkModes >>> 1) & 0x01) === 1,
          {
            displayValue: boolDisplay(((sinkModes >>> 1) & 0x01) === 1),
          },
        ),
        field(
          'ac_supply_powered',
          'AC Supply Powered',
          138,
          1,
          (sinkModes >>> 2) & 0x01,
          ((sinkModes >>> 2) & 0x01) === 1,
          {
            displayValue: boolDisplay(((sinkModes >>> 2) & 0x01) === 1),
          },
        ),
        field(
          'battery_powered',
          'Battery Powered',
          139,
          1,
          (sinkModes >>> 3) & 0x01,
          ((sinkModes >>> 3) & 0x01) === 1,
          {
            displayValue: boolDisplay(((sinkModes >>> 3) & 0x01) === 1),
          },
        ),
        field(
          'battery_essentially_unlimited',
          'Battery Essentially Unlimited',
          140,
          1,
          (sinkModes >>> 4) & 0x01,
          ((sinkModes >>> 4) & 0x01) === 1,
          {
            displayValue: boolDisplay(((sinkModes >>> 4) & 0x01) === 1),
          },
        ),
        field(
          'avs_support',
          'AVS Support',
          141,
          1,
          (sinkModes >>> 5) & 0x01,
          ((sinkModes >>> 5) & 0x01) === 1,
          {
            displayValue: boolDisplay(((sinkModes >>> 5) & 0x01) === 1),
          },
        ),
        field(
          'sink_modes_reserved',
          'Sink Modes Reserved Bits 7..6',
          142,
          2,
          sinkModesReserved,
          sinkModesReserved,
          {
            note: 'Reserved and shall be set to zero.',
          },
        ),
        field(
          'spr_sink_minimum_pdp',
          'SPR Sink Minimum PDP',
          144,
          7,
          sprSinkMinimumPdp,
          sprSinkMinimumPdp,
          {
            displayValue: `${sprSinkMinimumPdp} W`,
          },
        ),
        field(
          'spr_sink_minimum_pdp_reserved',
          'SPR Sink Minimum PDP Reserved Bit 7',
          151,
          1,
          sprSinkMinimumPdpReserved,
          sprSinkMinimumPdpReserved,
          {
            note: 'Reserved and shall be set to zero.',
          },
        ),
        field(
          'spr_sink_operational_pdp',
          'SPR Sink Operational PDP',
          152,
          7,
          sprSinkOperationalPdp,
          sprSinkOperationalPdp,
          {
            displayValue: `${sprSinkOperationalPdp} W`,
          },
        ),
        field(
          'spr_sink_operational_pdp_reserved',
          'SPR Sink Operational PDP Reserved Bit 7',
          159,
          1,
          sprSinkOperationalPdpReserved,
          sprSinkOperationalPdpReserved,
          {
            note: 'Reserved and shall be set to zero.',
          },
        ),
        field(
          'spr_sink_maximum_pdp',
          'SPR Sink Maximum PDP',
          160,
          7,
          sprSinkMaximumPdp,
          sprSinkMaximumPdp,
          {
            displayValue: `${sprSinkMaximumPdp} W`,
          },
        ),
        field(
          'spr_sink_maximum_pdp_reserved',
          'SPR Sink Maximum PDP Reserved Bit 7',
          167,
          1,
          sprSinkMaximumPdpReserved,
          sprSinkMaximumPdpReserved,
          {
            note: 'Reserved and shall be set to zero.',
          },
        ),
        field(
          'epr_sink_minimum_pdp',
          'EPR Sink Minimum PDP',
          168,
          8,
          eprSinkMinimumPdp,
          eprSinkMinimumPdp,
          {
            displayValue: `${eprSinkMinimumPdp} W`,
          },
        ),
        field(
          'epr_sink_operational_pdp',
          'EPR Sink Operational PDP',
          176,
          8,
          eprSinkOperationalPdp,
          eprSinkOperationalPdp,
          {
            displayValue: `${eprSinkOperationalPdp} W`,
          },
        ),
        field(
          'epr_sink_maximum_pdp',
          'EPR Sink Maximum PDP',
          184,
          8,
          eprSinkMaximumPdp,
          eprSinkMaximumPdp,
          {
            displayValue: `${eprSinkMaximumPdp} W`,
          },
        ),
      ],
      issues,
    ),
  }
}
