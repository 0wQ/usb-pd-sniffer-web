import type {
  BitField,
  DecodeIssue,
  ExtendedMessageHeader,
  MessageTypeInfo,
  Section,
  StartOfPacket,
} from '../types.js'
import { explainDataObjects } from './dataObjects/index.js'
import { buildDeclaredDataSizeIssues } from './extendedDataBlocks/dataBlockValidation.js'
import {
  type BuiltSection,
  boolDisplay,
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

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
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

function ppsTemperatureFlagDisplay(value: number): string {
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

function extendedControlTypeDisplay(value: number): string {
  switch (value) {
    case 0x01:
      return 'EPR_Get_Source_Cap'
    case 0x02:
      return 'EPR_Get_Sink_Cap'
    case 0x03:
      return 'EPR_KeepAlive'
    case 0x04:
      return 'EPR_KeepAlive_Ack'
    case 0x00:
      return 'Reserved'
    default:
      return 'Reserved'
  }
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

function buildSourceCapabilitiesExtendedDataBlock(
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

function buildSinkCapabilitiesExtendedDataBlock(
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

function buildPpsStatusDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues = buildDeclaredDataSizeIssues(
    'PPS_Status',
    4,
    declaredDataSize,
    bytes.length,
  )
  const outputVoltage = readUint16Le(bytes, 0)
  const outputCurrent = bytes[2] ?? 0
  const realTimeFlags = bytes[3] ?? 0
  const reservedBit0 = realTimeFlags & 0x01
  const ptf = (realTimeFlags >>> 1) & 0x03
  const omf = (realTimeFlags >>> 3) & 0x01
  const reservedHigh = (realTimeFlags >>> 4) & 0x0f

  if ((reservedBit0 | reservedHigh) !== 0 && bytes.length >= 4) {
    issues.push(
      createIssue(
        'PD_PPS_STATUS_RESERVED_REAL_TIME_FLAGS_NONZERO',
        'PPS Status Real Time Flags reserved bits are non-zero.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:pps-status`,
      'PPS Status Data Block',
      'pps_status_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 4)),
      [
        field(
          'output_voltage',
          'Output Voltage',
          0,
          16,
          outputVoltage,
          outputVoltage,
          {
            displayValue:
              outputVoltage === 0xffff
                ? 'Not Supported'
                : `${outputVoltage * 20} mV`,
            note: outputVoltage === 0xffff ? undefined : '20mV units.',
          },
        ),
        field(
          'output_current',
          'Output Current',
          16,
          8,
          outputCurrent,
          outputCurrent,
          {
            displayValue:
              outputCurrent === 0xff
                ? 'Not Supported'
                : `${outputCurrent * 50} mA`,
            note: outputCurrent === 0xff ? undefined : '50mA units.',
          },
        ),
        field('reserved_bit_0', 'Reserved', 24, 1, reservedBit0, reservedBit0, {
          note: 'Real Time Flags bit 0 shall be set to zero.',
        }),
        field('ptf', 'PTF', 25, 2, ptf, ptf, {
          displayValue: ppsTemperatureFlagDisplay(ptf),
          note: 'Present Temperature Flag.',
        }),
        field('omf', 'OMF', 27, 1, omf, omf === 1, {
          displayValue:
            omf === 1 ? 'Current Limit Mode' : 'Constant Voltage Mode',
          note: 'Operating Mode Flag.',
        }),
        field('reserved_high', 'Reserved', 28, 4, reservedHigh, reservedHigh, {
          note: 'Real Time Flags bits 7..4 shall be set to zero.',
        }),
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

function buildExtendedControlDataBlock(
  bytes: Uint8Array,
  declaredDataSize: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues = buildDeclaredDataSizeIssues(
    'Extended_Control',
    2,
    declaredDataSize,
    bytes.length,
  )
  const type = bytes[0] ?? 0
  const data = bytes[1] ?? 0

  if (type === 0x00 || type >= 0x05) {
    issues.push(
      createIssue(
        'PD_EXTENDED_CONTROL_TYPE_RESERVED',
        'Extended_Control Type value is reserved.',
      ),
    )
  }

  if (data !== 0 && bytes.length >= 2) {
    issues.push(
      createIssue(
        'PD_EXTENDED_CONTROL_DATA_NONZERO',
        'Extended_Control Data byte shall be zero when not used.',
      ),
    )
  }

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:extended-control`,
      'Extended Control Data Block',
      'extended_control_data_block',
      byteOffset,
      bytes.subarray(0, Math.min(bytes.length, 2)),
      [
        field('type', 'Type', 0, 8, type, type, {
          displayValue: extendedControlTypeDisplay(type),
        }),
        field('data', 'Data', 8, 8, data, data, {
          displayValue: hex(data, 2),
          note: 'Set to zero when unused.',
        }),
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
