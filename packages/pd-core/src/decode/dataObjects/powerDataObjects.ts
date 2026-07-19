import type { BitField, DecodeIssue, Section } from '../../types.js'
import { extractBits, readUint32Le } from '../../utils/bits.js'
import {
  type BuiltSection,
  createIssue,
  createSection,
  field,
  flagField,
  hex,
} from './sectionBuilders.js'

type PowerRole = 'source' | 'sink'

function powerObjectTitle(
  titleBase: string | undefined,
  index: number,
  suffix: string,
): string {
  return `${titleBase ?? `PDO ${index + 1}`} - ${suffix}`
}

function capabilityObjectTitle(
  messageTypeName: string | null,
  index: number,
): string | null {
  switch (messageTypeName) {
    case 'Source_Capabilities':
    case 'Sink_Capabilities':
      return `PDO ${index + 1}`
    case 'EPR_Source_Capabilities':
    case 'EPR_Sink_Capabilities':
      return index < 7 ? `SPR PDO ${index + 1}` : `EPR PDO ${index + 1}`
    default:
      return null
  }
}

function peakCurrentDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'IoC only'
    case 1:
      return '150%/1ms, 125%/2ms, 110%/10ms'
    case 2:
      return '200%/1ms, 150%/2ms, 125%/10ms'
    case 3:
      return '200%/1ms, 175%/2ms, 150%/10ms'
    default:
      return String(bits)
  }
}

function fastRoleSwapDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Not Supported'
    case 1:
      return 'Default USB Port'
    case 2:
      return '1.5A @ 5V'
    case 3:
      return '3.0A @ 5V'
    default:
      return String(bits)
  }
}

function buildFixedPowerObject(
  raw32: number,
  role: PowerRole,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  const reserved22 = extractBits(raw32, 22, 1)
  const highCapabilityBits =
    role === 'source' ? extractBits(raw32, 23, 7) : extractBits(raw32, 20, 10)
  const voltage = extractBits(raw32, 10, 10) * 50
  const current = extractBits(raw32, 0, 10) * 10
  const issues: DecodeIssue[] = []

  if (reserved22 !== 0) {
    issues.push(
      createIssue(
        'PD_FIXED_PDO_RESERVED_BIT_NONZERO',
        'Fixed Supply PDO reserved bit 22 is non-zero.',
      ),
    )
  }

  if (index > 0 && highCapabilityBits !== 0) {
    issues.push(
      createIssue(
        role === 'source'
          ? 'PD_SOURCE_FIXED_PDO_NONFIRST_CAPABILITY_BITS_NONZERO'
          : 'PD_SINK_FIXED_PDO_NONFIRST_CAPABILITY_BITS_NONZERO',
        role === 'source'
          ? 'Only the first Source Fixed PDO may use bits 29..23 for capabilities.'
          : 'Only the first Sink Fixed PDO may use bits 29..20 for capabilities.',
      ),
    )
  }

  const fields: BitField[] =
    role === 'source'
      ? [
          field('supply_type', 'Supply Type', 30, 2, 0b00, 'Fixed Supply'),
          flagField(
            'dual_role_power',
            'Dual-Role Power',
            29,
            extractBits(raw32, 29, 1),
          ),
          flagField(
            'usb_suspend_supported',
            'USB Suspend Supported',
            28,
            extractBits(raw32, 28, 1),
          ),
          flagField(
            'unconstrained_power',
            'Unconstrained Power',
            27,
            extractBits(raw32, 27, 1),
          ),
          flagField(
            'usb_communications_capable',
            'USB Communications Capable',
            26,
            extractBits(raw32, 26, 1),
          ),
          flagField(
            'dual_role_data',
            'Dual-Role Data',
            25,
            extractBits(raw32, 25, 1),
          ),
          flagField(
            'unchunked_extended_messages_supported',
            'Unchunked Extended Messages Supported',
            24,
            extractBits(raw32, 24, 1),
          ),
          flagField(
            'epr_mode_capable',
            'EPR Mode Capable',
            23,
            extractBits(raw32, 23, 1),
          ),
          field('reserved', 'Reserved', 22, 1, reserved22, reserved22),
          field(
            'peak_current',
            'Peak Current',
            20,
            2,
            extractBits(raw32, 20, 2),
            extractBits(raw32, 20, 2),
            {
              displayValue: peakCurrentDisplay(extractBits(raw32, 20, 2)),
            },
          ),
          field(
            'voltage',
            'Voltage',
            10,
            10,
            extractBits(raw32, 10, 10),
            voltage,
            {
              displayValue: `${voltage} mV`,
              unit: 'mV',
              note: '50mV units',
            },
          ),
          field(
            'maximum_current',
            'Maximum Current',
            0,
            10,
            extractBits(raw32, 0, 10),
            current,
            {
              displayValue: `${current} mA`,
              unit: 'mA',
              note: '10mA units',
            },
          ),
        ]
      : [
          field('supply_type', 'Supply Type', 30, 2, 0b00, 'Fixed Supply'),
          flagField(
            'dual_role_power',
            'Dual-Role Power',
            29,
            extractBits(raw32, 29, 1),
          ),
          flagField(
            'higher_capability',
            'Higher Capability',
            28,
            extractBits(raw32, 28, 1),
          ),
          flagField(
            'unconstrained_power',
            'Unconstrained Power',
            27,
            extractBits(raw32, 27, 1),
          ),
          flagField(
            'usb_communications_capable',
            'USB Communications Capable',
            26,
            extractBits(raw32, 26, 1),
          ),
          flagField(
            'dual_role_data',
            'Dual-Role Data',
            25,
            extractBits(raw32, 25, 1),
          ),
          field(
            'fast_role_swap_required_current',
            'Fast Role Swap Required USB Type-C Current',
            23,
            2,
            extractBits(raw32, 23, 2),
            extractBits(raw32, 23, 2),
            {
              displayValue: fastRoleSwapDisplay(extractBits(raw32, 23, 2)),
            },
          ),
          field(
            'reserved',
            'Reserved',
            20,
            3,
            extractBits(raw32, 20, 3),
            extractBits(raw32, 20, 3),
          ),
          field(
            'voltage',
            'Voltage',
            10,
            10,
            extractBits(raw32, 10, 10),
            voltage,
            {
              displayValue: `${voltage} mV`,
              unit: 'mV',
              note: '50mV units',
            },
          ),
          field(
            'operational_current',
            'Operational Current',
            0,
            10,
            extractBits(raw32, 0, 10),
            current,
            {
              displayValue: `${current} mA`,
              unit: 'mA',
              note: '10mA units',
            },
          ),
        ]

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:fixed-${role}-pdo`,
      'data_object',
      powerObjectTitle(titleBase, index, 'Fixed Supply'),
      `${role}_fixed_supply_pdo`,
      byteOffset,
      raw32,
      fields,
      issues,
      index,
    ),
  }
}

function buildBatteryPowerObject(
  raw32: number,
  role: PowerRole,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  const maximumVoltage = extractBits(raw32, 20, 10) * 50
  const minimumVoltage = extractBits(raw32, 10, 10) * 50
  const power = extractBits(raw32, 0, 10) * 250

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:battery-${role}-pdo`,
      'data_object',
      powerObjectTitle(titleBase, index, 'Battery'),
      `${role}_battery_pdo`,
      byteOffset,
      raw32,
      [
        field('supply_type', 'Supply Type', 30, 2, 0b01, 'Battery'),
        field(
          'maximum_voltage',
          'Maximum Voltage',
          20,
          10,
          extractBits(raw32, 20, 10),
          maximumVoltage,
          {
            displayValue: `${maximumVoltage} mV`,
            unit: 'mV',
            note: '50mV units',
          },
        ),
        field(
          'minimum_voltage',
          'Minimum Voltage',
          10,
          10,
          extractBits(raw32, 10, 10),
          minimumVoltage,
          {
            displayValue: `${minimumVoltage} mV`,
            unit: 'mV',
            note: '50mV units',
          },
        ),
        field(
          role === 'source' ? 'maximum_allowable_power' : 'operational_power',
          role === 'source' ? 'Maximum Allowable Power' : 'Operational Power',
          0,
          10,
          extractBits(raw32, 0, 10),
          power,
          {
            displayValue: `${power} mW`,
            unit: 'mW',
            note: '250mW units',
          },
        ),
      ],
      [],
      index,
    ),
  }
}

function buildVariablePowerObject(
  raw32: number,
  role: PowerRole,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  const maximumVoltage = extractBits(raw32, 20, 10) * 50
  const minimumVoltage = extractBits(raw32, 10, 10) * 50
  const current = extractBits(raw32, 0, 10) * 10

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:variable-${role}-pdo`,
      'data_object',
      powerObjectTitle(titleBase, index, 'Variable Supply'),
      `${role}_variable_supply_pdo`,
      byteOffset,
      raw32,
      [
        field('supply_type', 'Supply Type', 30, 2, 0b10, 'Variable Supply'),
        field(
          'maximum_voltage',
          'Maximum Voltage',
          20,
          10,
          extractBits(raw32, 20, 10),
          maximumVoltage,
          {
            displayValue: `${maximumVoltage} mV`,
            unit: 'mV',
            note: '50mV units',
          },
        ),
        field(
          'minimum_voltage',
          'Minimum Voltage',
          10,
          10,
          extractBits(raw32, 10, 10),
          minimumVoltage,
          {
            displayValue: `${minimumVoltage} mV`,
            unit: 'mV',
            note: '50mV units',
          },
        ),
        field(
          role === 'source' ? 'maximum_current' : 'operational_current',
          role === 'source' ? 'Maximum Current' : 'Operational Current',
          0,
          10,
          extractBits(raw32, 0, 10),
          current,
          {
            displayValue: `${current} mA`,
            unit: 'mA',
            note: '10mA units',
          },
        ),
      ],
      [],
      index,
    ),
  }
}

function buildPpsPowerObject(
  raw32: number,
  role: PowerRole,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  const maximumVoltage = extractBits(raw32, 17, 8) * 100
  const minimumVoltage = extractBits(raw32, 8, 8) * 100
  const maximumCurrent = extractBits(raw32, 0, 7) * 50
  const reservedHigh =
    role === 'source' ? extractBits(raw32, 25, 2) : extractBits(raw32, 25, 3)
  const reservedMid = extractBits(raw32, 16, 1)
  const reservedLow = extractBits(raw32, 7, 1)
  const issues: DecodeIssue[] = []

  if (reservedHigh !== 0 || reservedMid !== 0 || reservedLow !== 0) {
    issues.push(
      createIssue(
        'PD_PPS_APDO_RESERVED_BITS_NONZERO',
        'SPR PPS APDO reserved bits are non-zero.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:spr-pps-${role}-apdo`,
      'data_object',
      powerObjectTitle(titleBase, index, 'SPR PPS APDO'),
      `${role}_spr_pps_apdo`,
      byteOffset,
      raw32,
      [
        field('supply_type', 'Supply Type', 30, 2, 0b11, 'Augmented PDO'),
        field('apdo_type', 'APDO Type', 28, 2, 0b00, 'SPR PPS'),
        ...(role === 'source'
          ? [
              flagField(
                'pps_power_limited',
                'PPS Power Limited',
                27,
                extractBits(raw32, 27, 1),
                'Power Limited',
                'Not Limited',
              ),
            ]
          : [
              field(
                'reserved',
                'Reserved',
                25,
                3,
                extractBits(raw32, 25, 3),
                extractBits(raw32, 25, 3),
              ),
            ]),
        ...(role === 'source'
          ? [
              field(
                'reserved_high',
                'Reserved',
                25,
                2,
                extractBits(raw32, 25, 2),
                extractBits(raw32, 25, 2),
              ),
            ]
          : []),
        field(
          'maximum_voltage',
          'Maximum Voltage',
          17,
          8,
          extractBits(raw32, 17, 8),
          maximumVoltage,
          {
            displayValue: `${maximumVoltage} mV`,
            unit: 'mV',
            note: '100mV units',
          },
        ),
        field('reserved_mid', 'Reserved', 16, 1, reservedMid, reservedMid),
        field(
          'minimum_voltage',
          'Minimum Voltage',
          8,
          8,
          extractBits(raw32, 8, 8),
          minimumVoltage,
          {
            displayValue: `${minimumVoltage} mV`,
            unit: 'mV',
            note: '100mV units',
          },
        ),
        field('reserved_low', 'Reserved', 7, 1, reservedLow, reservedLow),
        field(
          'maximum_current',
          'Maximum Current',
          0,
          7,
          extractBits(raw32, 0, 7),
          maximumCurrent,
          {
            displayValue: `${maximumCurrent} mA`,
            unit: 'mA',
            note: '50mA units',
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildSprAvsPowerObject(
  raw32: number,
  role: PowerRole,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  const issues: DecodeIssue[] = []

  if (role === 'source') {
    const reserved = extractBits(raw32, 20, 6)
    const current15V = extractBits(raw32, 10, 10) * 10
    const current20V = extractBits(raw32, 0, 10) * 10

    if (reserved !== 0) {
      issues.push(
        createIssue(
          'PD_SPR_AVS_SOURCE_RESERVED_BITS_NONZERO',
          'SPR AVS Source APDO reserved bits 25..20 are non-zero.',
        ),
      )
    }

    return {
      section: createSection(
        `${parentSectionKey}:object-${index}:spr-avs-source-apdo`,
        'data_object',
        powerObjectTitle(titleBase, index, 'SPR AVS APDO'),
        'source_spr_avs_apdo',
        byteOffset,
        raw32,
        [
          field('supply_type', 'Supply Type', 30, 2, 0b11, 'Augmented PDO'),
          field('apdo_type', 'APDO Type', 28, 2, 0b10, 'SPR AVS'),
          field(
            'peak_current',
            'Peak Current',
            26,
            2,
            extractBits(raw32, 26, 2),
            extractBits(raw32, 26, 2),
            {
              displayValue: peakCurrentDisplay(extractBits(raw32, 26, 2)),
            },
          ),
          field('reserved', 'Reserved', 20, 6, reserved, reserved),
          field(
            'maximum_current_15v',
            'Maximum Current 15V',
            10,
            10,
            extractBits(raw32, 10, 10),
            current15V,
            {
              displayValue: `${current15V} mA`,
              unit: 'mA',
              note: '9V..15V range, 10mA units',
            },
          ),
          field(
            'maximum_current_20v',
            'Maximum Current 20V',
            0,
            10,
            extractBits(raw32, 0, 10),
            current20V,
            {
              displayValue: `${current20V} mA`,
              unit: 'mA',
              note: '15V..20V range, set to 0 if max voltage is 15V',
            },
          ),
        ],
        issues,
        index,
      ),
    }
  }

  const reserved = extractBits(raw32, 20, 8)
  const current15V = extractBits(raw32, 10, 10) * 10
  const current20V = extractBits(raw32, 0, 10) * 10

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_SPR_AVS_SINK_RESERVED_BITS_NONZERO',
        'SPR AVS Sink APDO reserved bits 27..20 are non-zero.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:spr-avs-sink-apdo`,
      'data_object',
      powerObjectTitle(titleBase, index, 'SPR AVS APDO'),
      'sink_spr_avs_apdo',
      byteOffset,
      raw32,
      [
        field('supply_type', 'Supply Type', 30, 2, 0b11, 'Augmented PDO'),
        field('apdo_type', 'APDO Type', 28, 2, 0b10, 'SPR AVS'),
        field('reserved', 'Reserved', 20, 8, reserved, reserved),
        field(
          'maximum_current_15v',
          'Maximum Current 15V',
          10,
          10,
          extractBits(raw32, 10, 10),
          current15V,
          {
            displayValue: `${current15V} mA`,
            unit: 'mA',
            note: '9V..15V range, 10mA units',
          },
        ),
        field(
          'maximum_current_20v',
          'Maximum Current 20V',
          0,
          10,
          extractBits(raw32, 0, 10),
          current20V,
          {
            displayValue: `${current20V} mA`,
            unit: 'mA',
            note: '15V..20V range, set to 0 if max voltage is 15V',
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildEprAvsPowerObject(
  raw32: number,
  role: PowerRole,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  const maximumVoltage = extractBits(raw32, 17, 9) * 100
  const minimumVoltage = extractBits(raw32, 8, 8) * 100
  const pdp = extractBits(raw32, 0, 8)
  const reservedMid = extractBits(raw32, 16, 1)
  const issues: DecodeIssue[] = []

  if (reservedMid !== 0) {
    issues.push(
      createIssue(
        'PD_EPR_AVS_APDO_RESERVED_BIT_NONZERO',
        'EPR AVS APDO reserved bit 16 is non-zero.',
      ),
    )
  }

  if (role === 'source') {
    return {
      section: createSection(
        `${parentSectionKey}:object-${index}:epr-avs-source-apdo`,
        'data_object',
        powerObjectTitle(titleBase, index, 'EPR AVS APDO'),
        'source_epr_avs_apdo',
        byteOffset,
        raw32,
        [
          field('supply_type', 'Supply Type', 30, 2, 0b11, 'Augmented PDO'),
          field('apdo_type', 'APDO Type', 28, 2, 0b01, 'EPR AVS'),
          field(
            'peak_current',
            'Peak Current',
            26,
            2,
            extractBits(raw32, 26, 2),
            extractBits(raw32, 26, 2),
            {
              displayValue: peakCurrentDisplay(extractBits(raw32, 26, 2)),
            },
          ),
          field(
            'maximum_voltage',
            'Maximum Voltage',
            17,
            9,
            extractBits(raw32, 17, 9),
            maximumVoltage,
            {
              displayValue: `${maximumVoltage} mV`,
              unit: 'mV',
              note: '100mV units',
            },
          ),
          field('reserved_mid', 'Reserved', 16, 1, reservedMid, reservedMid),
          field(
            'minimum_voltage',
            'Minimum Voltage',
            8,
            8,
            extractBits(raw32, 8, 8),
            minimumVoltage,
            {
              displayValue: `${minimumVoltage} mV`,
              unit: 'mV',
              note: '100mV units',
            },
          ),
          field('pdp', 'PDP', 0, 8, pdp, pdp, {
            displayValue: `${pdp} W`,
            unit: 'W',
          }),
        ],
        issues,
        index,
      ),
    }
  }

  const reservedHigh = extractBits(raw32, 26, 2)
  if (reservedHigh !== 0) {
    issues.push(
      createIssue(
        'PD_EPR_AVS_SINK_RESERVED_BITS_NONZERO',
        'EPR AVS Sink APDO reserved bits 27..26 are non-zero.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:epr-avs-sink-apdo`,
      'data_object',
      powerObjectTitle(titleBase, index, 'EPR AVS APDO'),
      'sink_epr_avs_apdo',
      byteOffset,
      raw32,
      [
        field('supply_type', 'Supply Type', 30, 2, 0b11, 'Augmented PDO'),
        field('apdo_type', 'APDO Type', 28, 2, 0b01, 'EPR AVS'),
        field('reserved_high', 'Reserved', 26, 2, reservedHigh, reservedHigh),
        field(
          'maximum_voltage',
          'Maximum Voltage',
          17,
          9,
          extractBits(raw32, 17, 9),
          maximumVoltage,
          {
            displayValue: `${maximumVoltage} mV`,
            unit: 'mV',
            note: '100mV units',
          },
        ),
        field('reserved_mid', 'Reserved', 16, 1, reservedMid, reservedMid),
        field(
          'minimum_voltage',
          'Minimum Voltage',
          8,
          8,
          extractBits(raw32, 8, 8),
          minimumVoltage,
          {
            displayValue: `${minimumVoltage} mV`,
            unit: 'mV',
            note: '100mV units',
          },
        ),
        field('maximum_power', 'Maximum Power', 0, 8, pdp, pdp, {
          displayValue: `${pdp} W`,
          unit: 'W',
        }),
      ],
      issues,
      index,
    ),
  }
}

function buildReservedApdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:reserved-apdo`,
      'data_object',
      powerObjectTitle(titleBase, index, 'Reserved APDO'),
      'reserved_apdo',
      byteOffset,
      raw32,
      [
        field('supply_type', 'Supply Type', 30, 2, 0b11, 'Augmented PDO'),
        field('apdo_type', 'APDO Type', 28, 2, 0b11, 'Reserved'),
        field(
          'raw_payload',
          'Raw Payload',
          0,
          28,
          extractBits(raw32, 0, 28),
          hex(extractBits(raw32, 0, 28), 7),
        ),
      ],
      [createIssue('PD_RESERVED_APDO_TYPE', 'APDO subtype 11b is reserved.')],
      index,
    ),
  }
}

function buildEmptyPdoObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:empty-pdo`,
      'data_object',
      powerObjectTitle(titleBase, index, 'Empty PDO'),
      'empty_pdo',
      byteOffset,
      raw32,
      [
        field('empty_pdo', 'Empty PDO', 0, 32, raw32, 'Empty PDO', {
          displayValue: 'Empty PDO',
        }),
      ],
      [],
      index,
    ),
  }
}

export function buildPowerDataObject(
  raw32: number,
  role: PowerRole,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  titleBase?: string,
): BuiltSection {
  if (raw32 === 0) {
    return buildEmptyPdoObject(
      raw32,
      index,
      parentSectionKey,
      byteOffset,
      titleBase,
    )
  }

  const supplyType = extractBits(raw32, 30, 2)

  // Source priority for protocol terms and parser cross-checking is documented in
  // .docs/planning/pd-core-v2-reference-policy.md.
  // Table 6.7 is the reliable source here: 01b = Battery, 10b = Variable.
  // Some plain-text table extraction around 6.11/6.12 flips the labels.
  if (supplyType === 0b00) {
    return buildFixedPowerObject(
      raw32,
      role,
      index,
      parentSectionKey,
      byteOffset,
      titleBase,
    )
  }

  if (supplyType === 0b01) {
    return buildBatteryPowerObject(
      raw32,
      role,
      index,
      parentSectionKey,
      byteOffset,
      titleBase,
    )
  }

  if (supplyType === 0b10) {
    return buildVariablePowerObject(
      raw32,
      role,
      index,
      parentSectionKey,
      byteOffset,
      titleBase,
    )
  }

  const apdoType = extractBits(raw32, 28, 2)
  if (apdoType === 0b00) {
    return buildPpsPowerObject(
      raw32,
      role,
      index,
      parentSectionKey,
      byteOffset,
      titleBase,
    )
  }
  if (apdoType === 0b01) {
    return buildEprAvsPowerObject(
      raw32,
      role,
      index,
      parentSectionKey,
      byteOffset,
      titleBase,
    )
  }
  if (apdoType === 0b10) {
    return buildSprAvsPowerObject(
      raw32,
      role,
      index,
      parentSectionKey,
      byteOffset,
      titleBase,
    )
  }
  return buildReservedApdo(
    raw32,
    index,
    parentSectionKey,
    byteOffset,
    titleBase,
  )
}

export function explainPowerDataObjects(
  payloadBytes: Uint8Array,
  messageTypeName: string | null,
  parentSectionKey: string,
  byteOffset: number,
): Section[] {
  const role: PowerRole =
    messageTypeName === 'Sink_Capabilities' ||
    messageTypeName === 'EPR_Sink_Capabilities'
      ? 'sink'
      : 'source'
  const count = Math.floor(payloadBytes.length / 4)
  const sections: Section[] = []

  for (let index = 0; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    sections.push(
      buildPowerDataObject(
        raw32,
        role,
        index,
        parentSectionKey,
        byteOffset + index * 4,
        capabilityObjectTitle(messageTypeName, index) ?? undefined,
      ).section,
    )
  }

  return sections
}
