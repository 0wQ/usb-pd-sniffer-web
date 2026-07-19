import type {
  BitField,
  DecodeIssue,
  MessageTypeInfo,
  Section,
  StartOfPacket,
} from '../types.js'
import { extractBits, readUint32Le } from '../utils/bits.js'

type PowerRole = 'source' | 'sink'

type BuiltSection = {
  section: Section
  extraSections?: Section[]
}

type StructuredVdmHeaderInfo = {
  readonly svid: number
  readonly major: number
  readonly minor: number
  readonly objectPosition: number
  readonly commandType: number
  readonly reserved: number
  readonly command: number
}

type DiscoverIdentityIdHeaderInfo = {
  readonly usbHostCapable: boolean
  readonly usbDeviceCapable: boolean
  readonly productTypeUfp: number
  readonly modalOperationSupported: boolean
  readonly productTypeDfp: number
  readonly connectorType: number
  readonly reserved: number
  readonly usbVendorId: number
}

type BuiltDiscoverIdentityIdHeaderSection = {
  section: Section
  info: DiscoverIdentityIdHeaderInfo
}

type BuiltSvidVdoSection = {
  section: Section
  hasTerminator: boolean
  hasOddTerminator: boolean
  hasInvalidZeroPattern: boolean
}

export type RdoKind = 'fixed_variable' | 'battery' | 'pps' | 'avs'

function hex(value: number, width: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`
}

function raw32Bytes(raw32: number): Uint8Array {
  return new Uint8Array([
    raw32 & 0xff,
    (raw32 >>> 8) & 0xff,
    (raw32 >>> 16) & 0xff,
    (raw32 >>> 24) & 0xff,
  ])
}

function boolDisplay(
  value: boolean,
  whenTrue = 'Set',
  whenFalse = 'Clear',
): string {
  return value ? whenTrue : whenFalse
}

function asciiByteDisplay(value: number): string {
  if (value >= 0x20 && value <= 0x7e) {
    return `'${String.fromCharCode(value)}' (${hex(value, 2)})`
  }

  return hex(value, 2)
}

function field(
  key: string,
  label: string,
  bitStart: number,
  bitLength: number,
  rawValue: number,
  decodedValue: BitField['decodedValue'],
  options: {
    displayValue?: string
    unit?: string
    note?: string
  } = {},
): BitField {
  const displayValue =
    options.displayValue ??
    (options.unit !== undefined
      ? `${String(decodedValue)} ${options.unit}`
      : String(decodedValue))

  return {
    key,
    label,
    bitStart,
    bitLength,
    rawValue,
    decodedValue,
    displayValue,
    unit: options.unit,
    note: options.note,
  }
}

function flagField(
  key: string,
  label: string,
  bitStart: number,
  rawValue: number,
  whenTrue = 'Yes',
  whenFalse = 'No',
  note?: string,
): BitField {
  return field(key, label, bitStart, 1, rawValue, rawValue === 1, {
    displayValue: boolDisplay(rawValue === 1, whenTrue, whenFalse),
    note,
  })
}

function createIssue(code: string, message: string): DecodeIssue {
  return {
    severity: 'warning',
    code,
    message,
  }
}

function createSection(
  key: string,
  kind: Section['kind'],
  title: string,
  semanticKind: string,
  byteOffset: number,
  raw32: number,
  fields: BitField[],
  issues: DecodeIssue[],
  index?: number,
): Section {
  return {
    key,
    kind,
    title,
    index,
    semanticKind,
    byteOffset,
    byteLength: 4,
    rawBytes: raw32Bytes(raw32),
    fields,
    issues,
  }
}

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

function buildPowerObject(
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

function rdoKindLabel(kind: RdoKind): string {
  switch (kind) {
    case 'fixed_variable':
      return 'Fixed and Variable'
    case 'battery':
      return 'Battery'
    case 'pps':
      return 'PPS'
    case 'avs':
      return 'AVS'
  }
}

export function classifyRdoKindFromPdo(raw32: number): RdoKind | null {
  const supplyType = extractBits(raw32, 30, 2)

  if (supplyType === 0b00 || supplyType === 0b10) {
    return 'fixed_variable'
  }

  if (supplyType === 0b01) {
    return 'battery'
  }

  if (supplyType !== 0b11) {
    return null
  }

  const apdoType = extractBits(raw32, 28, 2)
  if (apdoType === 0b00) {
    return 'pps'
  }
  if (apdoType === 0b01 || apdoType === 0b10) {
    return 'avs'
  }
  return null
}

function buildRdoGiveBackField(raw32: number): BitField {
  const giveBack = extractBits(raw32, 27, 1)

  return field('giveback', 'Giveback', 27, 1, giveBack, giveBack === 1, {
    displayValue: boolDisplay(giveBack === 1),
    note: 'Deprecated and Shall be set to zero.',
  })
}

function buildRdoHeaderFields(raw32: number, bit27Field: BitField): BitField[] {
  return [
    field(
      'object_position',
      'Object Position',
      28,
      4,
      extractBits(raw32, 28, 4),
      extractBits(raw32, 28, 4),
    ),
    bit27Field,
    flagField(
      'capability_mismatch',
      'Capability Mismatch',
      26,
      extractBits(raw32, 26, 1),
      'Set',
      'Clear',
    ),
    flagField(
      'usb_communications_capable',
      'USB Communications Capable',
      25,
      extractBits(raw32, 25, 1),
      'Set',
      'Clear',
    ),
    flagField(
      'no_usb_suspend',
      'No USB Suspend',
      24,
      extractBits(raw32, 24, 1),
      'Set',
      'Clear',
    ),
    flagField(
      'unchunked_extended_messages_supported',
      'Unchunked Extended Messages Supported',
      23,
      extractBits(raw32, 23, 1),
      'Set',
      'Clear',
    ),
    flagField(
      'epr_capable',
      'EPR Capable',
      22,
      extractBits(raw32, 22, 1),
      'Set',
      'Clear',
    ),
  ]
}

function buildFixedVariableRdoFields(raw32: number): BitField[] {
  return [
    ...buildRdoHeaderFields(raw32, buildRdoGiveBackField(raw32)),
    field(
      'reserved',
      'Reserved',
      20,
      2,
      extractBits(raw32, 20, 2),
      extractBits(raw32, 20, 2),
    ),
    field(
      'operating_current',
      'Operating Current',
      10,
      10,
      extractBits(raw32, 10, 10),
      extractBits(raw32, 10, 10) * 10,
      {
        displayValue: `${extractBits(raw32, 10, 10) * 10} mA`,
        unit: 'mA',
        note: '10mA units.',
      },
    ),
    field(
      'maximum_operating_current',
      'Maximum Operating Current',
      0,
      10,
      extractBits(raw32, 0, 10),
      extractBits(raw32, 0, 10) * 10,
      {
        displayValue: `${extractBits(raw32, 0, 10) * 10} mA`,
        unit: 'mA',
        note: '10mA units.',
      },
    ),
  ]
}

function buildBatteryRdoFields(raw32: number): BitField[] {
  return [
    ...buildRdoHeaderFields(raw32, buildRdoGiveBackField(raw32)),
    field(
      'reserved',
      'Reserved',
      20,
      2,
      extractBits(raw32, 20, 2),
      extractBits(raw32, 20, 2),
    ),
    field(
      'operating_power',
      'Operating Power',
      10,
      10,
      extractBits(raw32, 10, 10),
      extractBits(raw32, 10, 10) * 250,
      {
        displayValue: `${extractBits(raw32, 10, 10) * 250} mW`,
        unit: 'mW',
        note: '250mW units.',
      },
    ),
    field(
      'maximum_operating_power',
      'Maximum Operating Power',
      0,
      10,
      extractBits(raw32, 0, 10),
      extractBits(raw32, 0, 10) * 250,
      {
        displayValue: `${extractBits(raw32, 0, 10) * 250} mW`,
        unit: 'mW',
        note: '250mW units.',
      },
    ),
  ]
}

function buildPpsRdoFields(raw32: number): BitField[] {
  const reserved27 = extractBits(raw32, 27, 1)

  return [
    ...buildRdoHeaderFields(
      raw32,
      field('reserved_27', 'Reserved', 27, 1, reserved27, reserved27),
    ),
    field(
      'reserved_21',
      'Reserved',
      21,
      1,
      extractBits(raw32, 21, 1),
      extractBits(raw32, 21, 1),
    ),
    field(
      'output_voltage',
      'Output Voltage',
      9,
      12,
      extractBits(raw32, 9, 12),
      extractBits(raw32, 9, 12) * 20,
      {
        displayValue: `${extractBits(raw32, 9, 12) * 20} mV`,
        unit: 'mV',
        note: '20mV units.',
      },
    ),
    field(
      'reserved_8_7',
      'Reserved',
      7,
      2,
      extractBits(raw32, 7, 2),
      extractBits(raw32, 7, 2),
    ),
    field(
      'operating_current',
      'Operating Current',
      0,
      7,
      extractBits(raw32, 0, 7),
      extractBits(raw32, 0, 7) * 50,
      {
        displayValue: `${extractBits(raw32, 0, 7) * 50} mA`,
        unit: 'mA',
        note: '50mA units.',
      },
    ),
  ]
}

function buildAvsRdoFields(raw32: number): BitField[] {
  const reserved27 = extractBits(raw32, 27, 1)

  return [
    ...buildRdoHeaderFields(
      raw32,
      field('reserved_27', 'Reserved', 27, 1, reserved27, reserved27),
    ),
    field(
      'reserved_21',
      'Reserved',
      21,
      1,
      extractBits(raw32, 21, 1),
      extractBits(raw32, 21, 1),
    ),
    field(
      'output_voltage',
      'Output Voltage',
      9,
      12,
      extractBits(raw32, 9, 12),
      extractBits(raw32, 9, 12) * 25,
      {
        displayValue: `${extractBits(raw32, 9, 12) * 25} mV`,
        unit: 'mV',
        note: '25mV units. The least two significant bits shall be set to zero, so the effective step is 100mV.',
      },
    ),
    field(
      'reserved_8_7',
      'Reserved',
      7,
      2,
      extractBits(raw32, 7, 2),
      extractBits(raw32, 7, 2),
    ),
    field(
      'operating_current',
      'Operating Current',
      0,
      7,
      extractBits(raw32, 0, 7),
      extractBits(raw32, 0, 7) * 50,
      {
        displayValue: `${extractBits(raw32, 0, 7) * 50} mA`,
        unit: 'mA',
        note: '50mA units.',
      },
    ),
  ]
}

function buildRdoFields(raw32: number, kind: RdoKind | null): BitField[] {
  if (kind === null) {
    const bit27 = extractBits(raw32, 27, 1)

    return buildRdoHeaderFields(
      raw32,
      field(
        'giveback_or_reserved',
        'GiveBack / Reserved',
        27,
        1,
        bit27,
        bit27,
        {
          displayValue: boolDisplay(bit27 === 1),
          note: 'GiveBack in the Fixed and Variable Request Data Object / Battery Request Data Object. Reserved in the PPS Request Data Object / AVS Request Data Object.',
        },
      ),
    )
  }

  switch (kind) {
    case 'fixed_variable':
      return buildFixedVariableRdoFields(raw32)
    case 'battery':
      return buildBatteryRdoFields(raw32)
    case 'pps':
      return buildPpsRdoFields(raw32)
    case 'avs':
      return buildAvsRdoFields(raw32)
  }
}

function buildRequestSectionTitle(
  messageTypeName: string,
  kind: RdoKind | null,
): string {
  if (messageTypeName === 'Request') {
    return kind === null ? 'RDO - Common' : `RDO - ${rdoKindLabel(kind)}`
  }

  return kind === null
    ? 'EPR Request Data Object'
    : `EPR Request Data Object - ${rdoKindLabel(kind)}`
}

function buildRequestSemanticKind(
  messageTypeName: string,
  kind: RdoKind | null,
): string {
  if (messageTypeName === 'Request') {
    return kind === null ? 'rdo_common' : `rdo_${kind}`
  }

  return kind === null ? 'epr_request_data_object' : `epr_request_${kind}_rdo`
}

function buildRequestObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
  options: {
    messageTypeName?: string
    objectCount?: number
    resolvedKind?: RdoKind | null
  } = {},
): BuiltSection {
  const objectPosition = extractBits(raw32, 28, 4)
  const issues: DecodeIssue[] = []
  const messageTypeName = options.messageTypeName ?? 'Request'

  if (objectPosition === 0 || objectPosition >= 14) {
    issues.push(
      createIssue(
        'PD_RDO_RESERVED_OBJECT_POSITION',
        'Object Position 0 and 14..15 are reserved in Request Data Objects.',
      ),
    )
  }

  if (
    messageTypeName === 'Request' &&
    objectPosition > 7 &&
    objectPosition < 14
  ) {
    issues.push(
      createIssue(
        'PD_REQUEST_SPR_OBJECT_POSITION_OUT_OF_RANGE',
        'Request Message object positions above 7 are reserved for EPR (A)PDOs.',
      ),
    )
  }

  if (options.objectCount !== undefined) {
    const expectedObjectCount = messageTypeName === 'EPR_Request' ? 2 : 1
    if (options.objectCount !== expectedObjectCount) {
      issues.push(
        createIssue(
          messageTypeName === 'EPR_Request'
            ? 'PD_EPR_REQUEST_OBJECT_COUNT_INVALID'
            : 'PD_REQUEST_OBJECT_COUNT_INVALID',
          `${messageTypeName} Message shall contain exactly ${expectedObjectCount} Data Object(s); found ${options.objectCount}.`,
        ),
      )
    }
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:rdo`,
      'request_data_object',
      buildRequestSectionTitle(messageTypeName, options.resolvedKind ?? null),
      buildRequestSemanticKind(messageTypeName, options.resolvedKind ?? null),
      byteOffset,
      raw32,
      buildRdoFields(raw32, options.resolvedKind ?? null),
      issues,
      index,
    ),
  }
}

function buildCopyOfPdoObject(
  raw32: number,
  payloadIndex: number,
  originalObjectPosition: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const originalIndex =
    originalObjectPosition >= 1 && originalObjectPosition <= 11
      ? originalObjectPosition - 1
      : 0
  const built = buildPowerObject(
    raw32,
    'source',
    originalIndex,
    parentSectionKey,
    byteOffset,
    'Copy of PDO',
  )

  return {
    section: {
      ...built.section,
      key: `${parentSectionKey}:object-${payloadIndex}:copy-of-pdo`,
      semanticKind: 'copy_of_pdo',
      index: payloadIndex,
    },
    extraSections: built.extraSections,
  }
}

function vdmCommandTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'REQ'
    case 1:
      return 'ACK'
    case 2:
      return 'NAK'
    case 3:
      return 'BUSY'
    default:
      return String(bits)
  }
}

function vdmCommandDisplay(command: number): string {
  switch (command) {
    case 0:
      return 'Reserved'
    case 1:
      return 'Discover Identity'
    case 2:
      return 'Discover SVIDs'
    case 3:
      return 'Discover Modes'
    case 4:
      return 'Enter Mode'
    case 5:
      return 'Exit Mode'
    case 6:
      return 'Attention'
    default:
      return command >= 16 ? 'SVID Specific Command' : 'Reserved'
  }
}

function structuredVdmVersionDisplay(
  major: number,
  minor: number,
  command: number,
): string {
  if (major === 0) {
    return '1.0 (Deprecated)'
  }
  if (major === 1 && command <= 15) {
    if (minor === 0) {
      return '2.0'
    }
    if (minor === 1) {
      return '2.1'
    }
    return 'Reserved'
  }
  if (major === 1) {
    return `2.x / SVID-specific minor (${minor})`
  }
  return 'Reserved'
}

function parseStructuredVdmHeader(
  raw32: number,
): StructuredVdmHeaderInfo | null {
  if (extractBits(raw32, 15, 1) === 0) {
    return null
  }

  return {
    svid: extractBits(raw32, 16, 16),
    major: extractBits(raw32, 13, 2),
    minor: extractBits(raw32, 11, 2),
    objectPosition: extractBits(raw32, 8, 3),
    commandType: extractBits(raw32, 6, 2),
    reserved: extractBits(raw32, 5, 1),
    command: extractBits(raw32, 0, 5),
  }
}

function usbHighestSpeedDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'USB 2.0 only'
    case 1:
      return 'USB 3.2 Gen1'
    case 2:
      return 'USB 3.2 / USB4 Gen2'
    case 3:
      return 'USB4 Gen3'
    case 4:
      return 'USB4 Gen4'
    default:
      return 'Reserved'
  }
}

function cablePlugDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'USB Type-A (Deprecated)'
    case 1:
      return 'USB Type-B (Deprecated)'
    case 2:
      return 'USB Type-C'
    case 3:
      return 'Captive'
    default:
      return 'Reserved'
  }
}

function connectorTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Unknown (Deprecated)'
    case 1:
      return 'Reserved'
    case 2:
      return 'USB Type-C Receptacle'
    case 3:
      return 'USB Type-C Plug'
    default:
      return 'Reserved'
  }
}

function ufpProductTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Not a UFP'
    case 1:
      return 'PDUSB Hub'
    case 2:
      return 'PDUSB Peripheral'
    case 3:
      return 'PSD'
    case 5:
      return 'Alternate Mode Adapter (AMA) (Deprecated)'
    default:
      return 'Reserved'
  }
}

function cableProductTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Not a Cable Plug / VPD'
    case 3:
      return 'Passive Cable'
    case 4:
      return 'Active Cable'
    case 6:
      return 'VCONN Powered USB Device (VPD)'
    default:
      return 'Reserved'
  }
}

function dfpProductTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Not a DFP'
    case 1:
      return 'PDUSB Hub'
    case 2:
      return 'PDUSB Host'
    case 3:
      return 'Power Brick'
    case 4:
      return 'Alternate Mode Controller (AMC) (Deprecated)'
    default:
      return 'Reserved'
  }
}

function parseDiscoverIdentityIdHeader(
  raw32: number,
): DiscoverIdentityIdHeaderInfo {
  return {
    usbHostCapable: extractBits(raw32, 31, 1) === 1,
    usbDeviceCapable: extractBits(raw32, 30, 1) === 1,
    productTypeUfp: extractBits(raw32, 27, 3),
    modalOperationSupported: extractBits(raw32, 26, 1) === 1,
    productTypeDfp: extractBits(raw32, 23, 3),
    connectorType: extractBits(raw32, 21, 2),
    reserved: extractBits(raw32, 16, 5),
    usbVendorId: extractBits(raw32, 0, 16),
  }
}

function vdoVersionDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Invalid'
    case 1:
      return 'Version 1.1 (Deprecated)'
    case 2:
      return 'Version 1.2 (Deprecated)'
    case 3:
      return 'Version 1.3'
    default:
      return 'Reserved'
  }
}

function dfpVdoVersionDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Invalid'
    case 1:
      return 'Version 1.1 (Deprecated)'
    case 2:
      return 'Version 1.2'
    default:
      return 'Reserved'
  }
}

function passiveCableLatencyDisplay(bits: number): string {
  switch (bits) {
    case 1:
      return '<10ns (~1m)'
    case 2:
      return '10ns to 20ns (~2m)'
    case 3:
      return '20ns to 30ns (~3m)'
    case 4:
      return '30ns to 40ns (~4m)'
    case 5:
      return '40ns to 50ns (~5m)'
    case 6:
      return '50ns to 60ns (~6m)'
    case 7:
      return '60ns to 70ns (~7m)'
    case 8:
      return '>70ns (>~7m)'
    default:
      return 'Reserved'
  }
}

function activeCableLatencyDisplay(bits: number): string {
  switch (bits) {
    case 1:
      return '<10ns (~1m)'
    case 2:
      return '10ns to 20ns (~2m)'
    case 3:
      return '20ns to 30ns (~3m)'
    case 4:
      return '30ns to 40ns (~4m)'
    case 5:
      return '40ns to 50ns (~5m)'
    case 6:
      return '50ns to 60ns (~6m)'
    case 7:
      return '60ns to 70ns (~7m)'
    case 8:
      return '1000ns (~100m)'
    case 9:
      return '2000ns (~200m)'
    case 10:
      return '3000ns (~300m)'
    default:
      return 'Reserved'
  }
}

function passiveCableTerminationDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'VCONN not required'
    case 1:
      return 'VCONN required'
    default:
      return 'Reserved'
  }
}

function activeCableTerminationDisplay(bits: number): string {
  switch (bits) {
    case 2:
      return 'One end Active, one end passive, VCONN required'
    case 3:
      return 'Both ends Active, VCONN required'
    default:
      return 'Reserved'
  }
}

function cableCurrentDisplay(bits: number): string {
  switch (bits) {
    case 1:
      return '3A'
    case 2:
      return '5A'
    default:
      return 'Reserved'
  }
}

function passiveCableMaxVbusDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return '20V'
    case 1:
      return '30V (Deprecated; treat as 20V)'
    case 2:
      return '40V (Deprecated; treat as 20V)'
    case 3:
      return '50V'
    default:
      return 'Reserved'
  }
}

function vpdMaxVbusDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return '20V'
    case 1:
      return '30V (Deprecated; treat as 20V)'
    case 2:
      return '40V (Deprecated; treat as 20V)'
    case 3:
      return '50V (Deprecated; treat as 20V)'
    default:
      return 'Reserved'
  }
}

function vconnPowerDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return '1W'
    case 1:
      return '1.5W'
    case 2:
      return '2W'
    case 3:
      return '3W'
    case 4:
      return '4W'
    case 5:
      return '5W'
    case 6:
      return '6W'
    default:
      return 'Reserved'
  }
}

function u3CldPowerDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return '>10mW'
    case 1:
      return '5mW to 10mW'
    case 2:
      return '1mW to 5mW'
    case 3:
      return '0.5mW to 1mW'
    case 4:
      return '0.2mW to 0.5mW'
    case 5:
      return '50uW to 200uW'
    case 6:
      return '<50uW'
    default:
      return 'Reserved'
  }
}

function buildVdmHeaderObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const svid = extractBits(raw32, 16, 16)
  const vdmType = extractBits(raw32, 15, 1)
  const issues: DecodeIssue[] = []

  if (vdmType === 0) {
    return {
      section: createSection(
        `${parentSectionKey}:object-${index}:unstructured-vdm-header`,
        'vdm_header',
        'VDM Header',
        'unstructured_vdm_header',
        byteOffset,
        raw32,
        [
          field('vid', 'Vendor ID (VID)', 16, 16, svid, hex(svid, 4)),
          field('vdm_type', 'VDM Type', 15, 1, 0, 'Unstructured'),
          field(
            'vendor_defined_payload',
            'Vendor Defined Payload',
            0,
            15,
            extractBits(raw32, 0, 15),
            hex(extractBits(raw32, 0, 15), 4),
          ),
        ],
        [],
        index,
      ),
    }
  }

  const major = extractBits(raw32, 13, 2)
  const minor = extractBits(raw32, 11, 2)
  const objectPosition = extractBits(raw32, 8, 3)
  const commandType = extractBits(raw32, 6, 2)
  const reserved = extractBits(raw32, 5, 1)
  const command = extractBits(raw32, 0, 5)

  if (major === 0) {
    issues.push(
      createIssue(
        'PD_VDM_VERSION_MAJOR_DEPRECATED',
        'Structured VDM version major 00b means Version 1.0, which is deprecated.',
      ),
    )
  } else if (major > 1) {
    issues.push(
      createIssue(
        'PD_VDM_VERSION_MAJOR_RESERVED',
        'Structured VDM version major values 10b and 11b are reserved.',
      ),
    )
  }

  if (command <= 15 && major === 1 && minor > 1) {
    issues.push(
      createIssue(
        'PD_VDM_VERSION_MINOR_RESERVED',
        'Structured VDM version minor values 10b and 11b are reserved for Commands 0..15.',
      ),
    )
  }

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_VDM_RESERVED_BIT_NONZERO',
        'Structured VDM Header reserved bit 5 is non-zero.',
      ),
    )
  }

  if (command === 0 || (command >= 7 && command <= 15)) {
    issues.push(
      createIssue(
        'PD_VDM_RESERVED_COMMAND',
        'Structured VDM command 0 and 7..15 are reserved.',
      ),
    )
  }

  if (command >= 1 && command <= 3 && objectPosition !== 0) {
    issues.push(
      createIssue(
        'PD_VDM_RESERVED_OBJECT_POSITION',
        'Structured VDM commands 1..3 shall use Object Position 000b.',
      ),
    )
  }

  if (
    (command === 4 || command === 5 || command === 6) &&
    objectPosition === 0
  ) {
    issues.push(
      createIssue(
        'PD_VDM_OBJECT_POSITION_ZERO_RESERVED',
        'Enter Mode, Exit Mode, and Attention use Object Position 000b as reserved.',
      ),
    )
  }

  if ((command === 1 || command === 2) && svid !== 0xff00) {
    issues.push(
      createIssue(
        'PD_VDM_PD_SID_REQUIRED',
        'Discover Identity and Discover SVIDs shall use the PD SID 0xFF00.',
      ),
    )
  }

  return {
    section: createSection(
      `${parentSectionKey}:object-${index}:structured-vdm-header`,
      'vdm_header',
      'VDM Header',
      'structured_vdm_header',
      byteOffset,
      raw32,
      [
        field(
          'svid',
          'Standard or Vendor ID (SVID)',
          16,
          16,
          svid,
          hex(svid, 4),
        ),
        field('vdm_type', 'VDM Type', 15, 1, 1, 'Structured'),
        field(
          'structured_vdm_version_major',
          'Structured VDM Version (Major)',
          13,
          2,
          major,
          major,
          {
            displayValue:
              major === 0
                ? '1.0 (Deprecated)'
                : major === 1
                  ? '2.x'
                  : 'Reserved',
          },
        ),
        field(
          'structured_vdm_version_minor',
          'Structured VDM Version (Minor)',
          11,
          2,
          minor,
          minor,
          {
            displayValue: structuredVdmVersionDisplay(major, minor, command),
          },
        ),
        field(
          'object_position',
          'Object Position',
          8,
          3,
          objectPosition,
          objectPosition,
          {
            displayValue:
              command === 5 && objectPosition === 0b111
                ? '7 (Exit all Active Modes)'
                : String(objectPosition),
          },
        ),
        field('command_type', 'Command Type', 6, 2, commandType, commandType, {
          displayValue: vdmCommandTypeDisplay(commandType),
        }),
        field('reserved', 'Reserved', 5, 1, reserved, reserved),
        field('command', 'Command', 0, 5, command, command, {
          displayValue: vdmCommandDisplay(command),
        }),
      ],
      issues,
      index,
    ),
  }
}

function createVendorSection(
  key: string,
  title: string,
  semanticKind: string,
  byteOffset: number,
  raw32: number,
  fields: BitField[],
  issues: DecodeIssue[],
  index: number,
): Section {
  return createSection(
    key,
    'vendor_data_object',
    title,
    semanticKind,
    byteOffset,
    raw32,
    fields,
    issues,
    index,
  )
}

function buildIdHeaderVdo(
  raw32: number,
  sop: StartOfPacket,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltDiscoverIdentityIdHeaderSection {
  const info = parseDiscoverIdentityIdHeader(raw32)
  const issues: DecodeIssue[] = []

  if (info.reserved !== 0) {
    issues.push(
      createIssue(
        'PD_ID_HEADER_RESERVED_BITS_NONZERO',
        'ID Header VDO reserved bits 20..16 are non-zero.',
      ),
    )
  }

  if (sop === 'SOP') {
    if ([4, 6, 7].includes(info.productTypeUfp)) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_UFP_PRODUCT_TYPE_RESERVED',
          'ID Header VDO SOP Product Type (UFP) uses a reserved value.',
        ),
      )
    }
    if (info.productTypeUfp === 5) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_UFP_PRODUCT_TYPE_DEPRECATED',
          'ID Header VDO SOP Product Type (UFP) Alternate Mode Adapter is deprecated.',
        ),
      )
    }
    if (info.productTypeDfp >= 5) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_DFP_PRODUCT_TYPE_RESERVED',
          'ID Header VDO SOP Product Type (DFP) uses a reserved value.',
        ),
      )
    }
    if (info.productTypeDfp === 4) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_DFP_PRODUCT_TYPE_DEPRECATED',
          'ID Header VDO SOP Product Type (DFP) Alternate Mode Controller is deprecated.',
        ),
      )
    }
  } else {
    if (![0, 3, 4, 6].includes(info.productTypeUfp)) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_CABLE_PRODUCT_TYPE_RESERVED',
          "ID Header VDO SOP' Product Type (Cable Plug / VPD) uses a reserved value.",
        ),
      )
    }
    if (info.productTypeDfp !== 0) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_SOP_PRIME_DFP_RESERVED',
          "ID Header VDO bits 25..23 are reserved in SOP' Discover Identity.",
        ),
      )
    }
  }

  if (info.connectorType === 1) {
    issues.push(
      createIssue(
        'PD_ID_HEADER_CONNECTOR_TYPE_RESERVED',
        'ID Header VDO Connector Type value 01b is reserved.',
      ),
    )
  }
  if (info.connectorType === 0) {
    issues.push(
      createIssue(
        'PD_ID_HEADER_CONNECTOR_TYPE_DEPRECATED',
        'ID Header VDO Connector Type Unknown is deprecated.',
      ),
    )
  }

  const productTypeLabel =
    sop === 'SOP' ? 'Product Type (UFP)' : 'Product Type (Cable Plug / VPD)'
  const productTypeDisplay =
    sop === 'SOP'
      ? ufpProductTypeDisplay(info.productTypeUfp)
      : cableProductTypeDisplay(info.productTypeUfp)

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:id-header-vdo`,
      'ID Header VDO',
      'discover_identity_id_header_vdo',
      byteOffset,
      raw32,
      [
        field(
          'usb_host_capable',
          'USB Communications Capable as USB Host',
          31,
          1,
          info.usbHostCapable ? 1 : 0,
          info.usbHostCapable,
          {
            displayValue: boolDisplay(
              info.usbHostCapable,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb_device_capable',
          'USB Communications Capable as USB Device',
          30,
          1,
          info.usbDeviceCapable ? 1 : 0,
          info.usbDeviceCapable,
          {
            displayValue: boolDisplay(
              info.usbDeviceCapable,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'product_type_ufp_or_cable',
          productTypeLabel,
          27,
          3,
          info.productTypeUfp,
          info.productTypeUfp,
          {
            displayValue: productTypeDisplay,
          },
        ),
        field(
          'modal_operation_supported',
          'Modal Operation Supported',
          26,
          1,
          info.modalOperationSupported ? 1 : 0,
          info.modalOperationSupported,
          {
            displayValue: boolDisplay(
              info.modalOperationSupported,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'product_type_dfp',
          sop === 'SOP' ? 'Product Type (DFP)' : 'Reserved',
          23,
          3,
          info.productTypeDfp,
          info.productTypeDfp,
          {
            displayValue:
              sop === 'SOP'
                ? dfpProductTypeDisplay(info.productTypeDfp)
                : 'Reserved',
            note:
              sop === 'SOP' ? undefined : "Reserved in SOP' Discover Identity.",
          },
        ),
        field(
          'connector_type',
          'Connector Type',
          21,
          2,
          info.connectorType,
          info.connectorType,
          {
            displayValue: connectorTypeDisplay(info.connectorType),
          },
        ),
        field('reserved', 'Reserved', 16, 5, info.reserved, info.reserved),
        field(
          'usb_vendor_id',
          'USB Vendor ID',
          0,
          16,
          info.usbVendorId,
          hex(info.usbVendorId, 4),
        ),
      ],
      issues,
      index,
    ),
    info,
  }
}

function buildCertStatVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:cert-stat-vdo`,
      'Cert Stat VDO',
      'discover_identity_cert_stat_vdo',
      byteOffset,
      raw32,
      [field('xid', 'XID', 0, 32, raw32, hex(raw32, 8))],
      [],
      index,
    ),
  }
}

function buildProductVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const productId = extractBits(raw32, 16, 16)
  const bcdDevice = extractBits(raw32, 0, 16)

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:product-vdo`,
      'Product VDO',
      'discover_identity_product_vdo',
      byteOffset,
      raw32,
      [
        field(
          'usb_product_id',
          'USB Product ID',
          16,
          16,
          productId,
          hex(productId, 4),
        ),
        field('bcd_device', 'bcdDevice', 0, 16, bcdDevice, hex(bcdDevice, 4)),
      ],
      [],
      index,
    ),
  }
}

function buildUfpVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 29, 3)
  const reserved28 = extractBits(raw32, 28, 1)
  const deviceCapability = extractBits(raw32, 24, 4)
  const connectorTypeLegacy = extractBits(raw32, 22, 2)
  const reserved = extractBits(raw32, 11, 11)
  const vconnPower = extractBits(raw32, 8, 3)
  const vconnRequired = extractBits(raw32, 7, 1)
  const vbusRequired = extractBits(raw32, 6, 1)
  const alternateModes = extractBits(raw32, 3, 3)
  const usbHighestSpeed = extractBits(raw32, 0, 3)
  const issues: DecodeIssue[] = []

  if (version === 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_VERSION_INVALID',
        'UFP VDO Version value 000b is invalid.',
      ),
    )
  } else if (version === 1 || version === 2) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_VERSION_DEPRECATED',
        'UFP VDO Version values 001b and 010b are deprecated.',
      ),
    )
  } else if (version >= 4) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_VERSION_RESERVED',
        'UFP VDO Version values 100b..111b are reserved.',
      ),
    )
  }
  if (reserved28 !== 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_RESERVED_BIT_NONZERO',
        'UFP VDO reserved bit 28 is non-zero.',
      ),
    )
  }
  if (connectorTypeLegacy !== 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_CONNECTOR_TYPE_LEGACY_NONZERO',
        'UFP VDO Connector Type (Legacy) shall be set to 00b.',
      ),
    )
  }
  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_RESERVED_BITS_NONZERO',
        'UFP VDO reserved bits 21..11 are non-zero.',
      ),
    )
  }
  if ((deviceCapability & 0b0011) === 0b0011) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_USB2_CAPABILITY_CONFLICT',
        'UFP VDO USB 2.0 Device Capable and Billboard-only bits shall not both be set.',
      ),
    )
  }
  if (alternateModes === 0) {
    if (vconnRequired !== 0) {
      issues.push(
        createIssue(
          'PD_UFP_VDO_VCONN_REQUIRED_RESERVED',
          'UFP VDO VCONN Required is reserved when no Alternate Modes are supported.',
        ),
      )
    }
    if (vbusRequired !== 0) {
      issues.push(
        createIssue(
          'PD_UFP_VDO_VBUS_REQUIRED_RESERVED',
          'UFP VDO VBUS Required is reserved when no Alternate Modes are supported.',
        ),
      )
    }
  }
  if (vconnRequired === 0 && vconnPower !== 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_VCONN_POWER_RESERVED',
        'UFP VDO VCONN Power is reserved when VCONN Required is zero.',
      ),
    )
  }
  if (usbHighestSpeed >= 5) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_USB_HIGHEST_SPEED_RESERVED',
        'UFP VDO USB Highest Speed values 101b..111b are reserved.',
      ),
    )
  }

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:ufp-vdo`,
      'UFP VDO',
      'discover_identity_ufp_vdo',
      byteOffset,
      raw32,
      [
        field('ufp_vdo_version', 'UFP VDO Version', 29, 3, version, version, {
          displayValue: vdoVersionDisplay(version),
        }),
        field('reserved_28', 'Reserved', 28, 1, reserved28, reserved28),
        field(
          'usb_2_device_capable',
          'USB 2.0 Device Capable',
          24,
          1,
          deviceCapability & 0x1,
          (deviceCapability & 0x1) === 1,
          {
            displayValue: boolDisplay(
              (deviceCapability & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb_2_billboard_only',
          'USB 2.0 Device Capable (Billboard only)',
          25,
          1,
          (deviceCapability >>> 1) & 0x1,
          ((deviceCapability >>> 1) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((deviceCapability >>> 1) & 0x1) === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'usb_3_device_capable',
          'USB 3.2 Device Capable',
          26,
          1,
          (deviceCapability >>> 2) & 0x1,
          ((deviceCapability >>> 2) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((deviceCapability >>> 2) & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb4_device_capable',
          'USB4 Device Capable',
          27,
          1,
          (deviceCapability >>> 3) & 0x1,
          ((deviceCapability >>> 3) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((deviceCapability >>> 3) & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'connector_type_legacy',
          'Connector Type (Legacy)',
          22,
          2,
          connectorTypeLegacy,
          connectorTypeLegacy,
          {
            displayValue:
              connectorTypeLegacy === 0
                ? 'Deprecated'
                : 'Deprecated / non-zero',
            note: 'Deprecated. Shall be set to 00b.',
          },
        ),
        field('reserved_21_11', 'Reserved', 11, 11, reserved, reserved),
        field('vconn_power', 'VCONN Power', 8, 3, vconnPower, vconnPower, {
          displayValue:
            vconnRequired === 1 ? vconnPowerDisplay(vconnPower) : 'Reserved',
          note:
            vconnRequired === 1
              ? undefined
              : 'Reserved when VCONN Required is zero.',
        }),
        field(
          'vconn_required',
          'VCONN Required',
          7,
          1,
          vconnRequired,
          vconnRequired === 1,
          {
            displayValue: boolDisplay(vconnRequired === 1, 'Yes', 'No'),
          },
        ),
        field(
          'vbus_required',
          'VBUS Required',
          6,
          1,
          vbusRequired,
          vbusRequired === 0,
          {
            displayValue: vbusRequired === 0 ? 'Yes' : 'No',
          },
        ),
        field(
          'supports_tbt3',
          'Supports TBT3 Alternate Mode',
          3,
          1,
          alternateModes & 0x1,
          (alternateModes & 0x1) === 1,
          {
            displayValue: boolDisplay(
              (alternateModes & 0x1) === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'supports_typec_reconfig_modes',
          'Supports reconfiguring Alternate Modes',
          4,
          1,
          (alternateModes >>> 1) & 0x1,
          ((alternateModes >>> 1) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((alternateModes >>> 1) & 0x1) === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'supports_typec_nonreconfig_modes',
          'Supports non-reconfiguring Alternate Modes',
          5,
          1,
          (alternateModes >>> 2) & 0x1,
          ((alternateModes >>> 2) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((alternateModes >>> 2) & 0x1) === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'usb_highest_speed',
          'USB Highest Speed',
          0,
          3,
          usbHighestSpeed,
          usbHighestSpeed,
          {
            displayValue: usbHighestSpeedDisplay(usbHighestSpeed),
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildDfpVdo(
  raw32: number,
  dfpProductType: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 29, 3)
  const reserved = extractBits(raw32, 27, 2)
  const hostCapability = extractBits(raw32, 24, 3)
  const connectorTypeLegacy = extractBits(raw32, 22, 2)
  const reservedLow = extractBits(raw32, 5, 17)
  const portNumber = extractBits(raw32, 0, 5)
  const issues: DecodeIssue[] = []

  if (version === 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_VERSION_INVALID',
        'DFP VDO Version value 000b is invalid.',
      ),
    )
  } else if (version === 1) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_VERSION_DEPRECATED',
        'DFP VDO Version value 001b is deprecated.',
      ),
    )
  } else if (version >= 3) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_VERSION_RESERVED',
        'DFP VDO Version values 011b..111b are reserved.',
      ),
    )
  }
  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_RESERVED_BITS_NONZERO',
        'DFP VDO reserved bits 28..27 are non-zero.',
      ),
    )
  }
  if (connectorTypeLegacy !== 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_CONNECTOR_TYPE_LEGACY_NONZERO',
        'DFP VDO Connector Type (Legacy) shall be set to 00b.',
      ),
    )
  }
  if (reservedLow !== 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_RESERVED_LOW_BITS_NONZERO',
        'DFP VDO reserved bits 21..5 are non-zero.',
      ),
    )
  }
  if ((dfpProductType === 1 || dfpProductType === 3) && hostCapability !== 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_HOST_CAPABILITY_NONZERO',
        'DFP VDO Host Capability bits shall be zero for PDUSB Hubs and Power Bricks.',
      ),
    )
  }

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:dfp-vdo`,
      'DFP VDO',
      'discover_identity_dfp_vdo',
      byteOffset,
      raw32,
      [
        field('dfp_vdo_version', 'DFP VDO Version', 29, 3, version, version, {
          displayValue: dfpVdoVersionDisplay(version),
        }),
        field('reserved_28_27', 'Reserved', 27, 2, reserved, reserved),
        field(
          'usb_2_host_capable',
          'USB 2.0 Host Capable',
          24,
          1,
          hostCapability & 0x1,
          (hostCapability & 0x1) === 1,
          {
            displayValue: boolDisplay(
              (hostCapability & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb_3_host_capable',
          'USB 3.2 Host Capable',
          25,
          1,
          (hostCapability >>> 1) & 0x1,
          ((hostCapability >>> 1) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((hostCapability >>> 1) & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb4_host_capable',
          'USB4 Host Capable',
          26,
          1,
          (hostCapability >>> 2) & 0x1,
          ((hostCapability >>> 2) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((hostCapability >>> 2) & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'connector_type_legacy',
          'Connector Type (Legacy)',
          22,
          2,
          connectorTypeLegacy,
          connectorTypeLegacy,
          {
            displayValue:
              connectorTypeLegacy === 0
                ? 'Deprecated'
                : 'Deprecated / non-zero',
            note: 'Deprecated. Shall be set to 00b.',
          },
        ),
        field('reserved_21_5', 'Reserved', 5, 17, reservedLow, reservedLow),
        field('port_number', 'Port Number', 0, 5, portNumber, portNumber),
      ],
      issues,
      index,
    ),
  }
}

function buildPassiveCableVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 21, 3)
  const reserved20 = extractBits(raw32, 20, 1)
  const plug = extractBits(raw32, 18, 2)
  const latency = extractBits(raw32, 13, 4)
  const termination = extractBits(raw32, 11, 2)
  const maxVbus = extractBits(raw32, 9, 2)
  const reserved8_7 = extractBits(raw32, 7, 2)
  const current = extractBits(raw32, 5, 2)
  const reserved4_3 = extractBits(raw32, 3, 2)
  const usbHighestSpeed = extractBits(raw32, 0, 3)
  const issues: DecodeIssue[] = []

  if (version !== 0) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_VERSION_RESERVED',
        'Passive Cable VDO Version values 001b..111b are reserved.',
      ),
    )
  }
  if (reserved20 !== 0) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_RESERVED_BIT_NONZERO',
        'Passive Cable VDO reserved bit 20 is non-zero.',
      ),
    )
  }
  if (plug < 2) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_PLUG_TYPE_DEPRECATED',
        'Passive Cable VDO USB Type-A and USB Type-B plug types are deprecated.',
      ),
    )
  }
  if (latency === 0 || latency >= 9) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_LATENCY_RESERVED',
        'Passive Cable VDO cable latency uses a reserved value.',
      ),
    )
  }
  if (termination >= 2) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_TERMINATION_RESERVED',
        'Passive Cable VDO cable termination type values 10b and 11b are reserved.',
      ),
    )
  }
  if (maxVbus === 1 || maxVbus === 2) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_MAX_VBUS_DEPRECATED',
        'Passive Cable VDO Maximum VBUS Voltage values 01b and 10b are deprecated and treated as 20V.',
      ),
    )
  }
  if (reserved8_7 !== 0) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_RESERVED_8_7_NONZERO',
        'Passive Cable VDO reserved bits 8..7 are non-zero.',
      ),
    )
  }
  if (current === 0 || current === 3) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_CURRENT_RESERVED',
        'Passive Cable VDO current handling value is reserved.',
      ),
    )
  }
  if (reserved4_3 !== 0) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_RESERVED_4_3_NONZERO',
        'Passive Cable VDO reserved bits 4..3 are non-zero.',
      ),
    )
  }
  if (usbHighestSpeed >= 5) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_USB_HIGHEST_SPEED_RESERVED',
        'Passive Cable VDO USB Highest Speed values 101b..111b are reserved.',
      ),
    )
  }

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:passive-cable-vdo`,
      'Passive Cable VDO',
      'discover_identity_passive_cable_vdo',
      byteOffset,
      raw32,
      [
        field(
          'hw_version',
          'HW Version',
          28,
          4,
          extractBits(raw32, 28, 4),
          extractBits(raw32, 28, 4),
        ),
        field(
          'firmware_version',
          'Firmware Version',
          24,
          4,
          extractBits(raw32, 24, 4),
          extractBits(raw32, 24, 4),
        ),
        field('vdo_version', 'VDO Version', 21, 3, version, version, {
          displayValue: version === 0 ? 'Version 1.0' : 'Reserved',
        }),
        field('reserved_20', 'Reserved', 20, 1, reserved20, reserved20),
        field(
          'plug_to_plug_or_captive',
          'USB Type-C plug to USB Type-C / Captive',
          18,
          2,
          plug,
          plug,
          {
            displayValue: cablePlugDisplay(plug),
          },
        ),
        field(
          'epr_capable',
          'EPR Capable',
          17,
          1,
          extractBits(raw32, 17, 1),
          extractBits(raw32, 17, 1) === 1,
          {
            displayValue: boolDisplay(
              extractBits(raw32, 17, 1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field('cable_latency', 'Cable Latency', 13, 4, latency, latency, {
          displayValue: passiveCableLatencyDisplay(latency),
        }),
        field(
          'cable_termination_type',
          'Cable Termination Type',
          11,
          2,
          termination,
          termination,
          {
            displayValue: passiveCableTerminationDisplay(termination),
          },
        ),
        field(
          'maximum_vbus_voltage',
          'Maximum VBUS Voltage',
          9,
          2,
          maxVbus,
          maxVbus,
          {
            displayValue: passiveCableMaxVbusDisplay(maxVbus),
          },
        ),
        field('reserved_8_7', 'Reserved', 7, 2, reserved8_7, reserved8_7),
        field(
          'vbus_current_handling_capability',
          'VBUS Current Handling Capability',
          5,
          2,
          current,
          current,
          {
            displayValue: cableCurrentDisplay(current),
          },
        ),
        field('reserved_4_3', 'Reserved', 3, 2, reserved4_3, reserved4_3),
        field(
          'usb_highest_speed',
          'USB Highest Speed',
          0,
          3,
          usbHighestSpeed,
          usbHighestSpeed,
          {
            displayValue: usbHighestSpeedDisplay(usbHighestSpeed),
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildActiveCableVdo1(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 21, 3)
  const reserved20 = extractBits(raw32, 20, 1)
  const plug = extractBits(raw32, 18, 2)
  const latency = extractBits(raw32, 13, 4)
  const termination = extractBits(raw32, 11, 2)
  const maxVbus = extractBits(raw32, 9, 2)
  const sbuSupported = extractBits(raw32, 8, 1)
  const sbuType = extractBits(raw32, 7, 1)
  const current = extractBits(raw32, 5, 2)
  const vbusThrough = extractBits(raw32, 4, 1)
  const sopDoublePrimeController = extractBits(raw32, 3, 1)
  const usbHighestSpeed = extractBits(raw32, 0, 3)
  const issues: DecodeIssue[] = []

  if (version === 0 || version === 2) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_VERSION_DEPRECATED',
        'Active Cable VDO1 Version values 000b and 010b are deprecated.',
      ),
    )
  } else if (version === 1) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_VERSION_INVALID',
        'Active Cable VDO1 Version value 001b is invalid.',
      ),
    )
  } else if (version >= 4) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_VERSION_RESERVED',
        'Active Cable VDO1 Version values 100b..111b are reserved.',
      ),
    )
  }
  if (reserved20 !== 0) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_RESERVED_BIT_NONZERO',
        'Active Cable VDO1 reserved bit 20 is non-zero.',
      ),
    )
  }
  if (plug < 2) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_PLUG_TYPE_DEPRECATED',
        'Active Cable VDO1 USB Type-A and USB Type-B plug types are deprecated.',
      ),
    )
  }
  if (latency === 0 || latency >= 11) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_LATENCY_RESERVED',
        'Active Cable VDO1 cable latency uses a reserved value.',
      ),
    )
  }
  if (termination <= 1) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_TERMINATION_RESERVED',
        'Active Cable VDO1 cable termination type values 00b and 01b are reserved.',
      ),
    )
  }
  if (maxVbus === 1 || maxVbus === 2) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_MAX_VBUS_DEPRECATED',
        'Active Cable VDO1 Maximum VBUS Voltage values 01b and 10b are deprecated and treated as 20V.',
      ),
    )
  }
  if (vbusThrough === 1 && (current === 0 || current === 3)) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_CURRENT_RESERVED',
        'Active Cable VDO1 current handling capability uses a reserved value when VBUS Through Cable is set.',
      ),
    )
  }
  if (usbHighestSpeed >= 5) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_USB_HIGHEST_SPEED_RESERVED',
        'Active Cable VDO1 USB Highest Speed values 101b..111b are reserved.',
      ),
    )
  }

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:active-cable-vdo1`,
      'Active Cable VDO1',
      'discover_identity_active_cable_vdo1',
      byteOffset,
      raw32,
      [
        field(
          'hw_version',
          'HW Version',
          28,
          4,
          extractBits(raw32, 28, 4),
          extractBits(raw32, 28, 4),
        ),
        field(
          'firmware_version',
          'Firmware Version',
          24,
          4,
          extractBits(raw32, 24, 4),
          extractBits(raw32, 24, 4),
        ),
        field('vdo_version', 'VDO Version', 21, 3, version, version, {
          displayValue:
            version === 0
              ? 'Version 1.0 (Deprecated)'
              : version === 1
                ? 'Invalid'
                : version === 2
                  ? 'Version 1.2 (Deprecated)'
                  : version === 3
                    ? 'Version 1.3'
                    : 'Reserved',
        }),
        field('reserved_20', 'Reserved', 20, 1, reserved20, reserved20),
        field(
          'plug_to_plug_or_captive',
          'USB Type-C plug to USB Type-C / Captive',
          18,
          2,
          plug,
          plug,
          {
            displayValue: cablePlugDisplay(plug),
          },
        ),
        field(
          'epr_capable',
          'EPR Capable',
          17,
          1,
          extractBits(raw32, 17, 1),
          extractBits(raw32, 17, 1) === 1,
          {
            displayValue: boolDisplay(
              extractBits(raw32, 17, 1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field('cable_latency', 'Cable Latency', 13, 4, latency, latency, {
          displayValue: activeCableLatencyDisplay(latency),
        }),
        field(
          'cable_termination_type',
          'Cable Termination Type',
          11,
          2,
          termination,
          termination,
          {
            displayValue: activeCableTerminationDisplay(termination),
          },
        ),
        field(
          'maximum_vbus_voltage',
          'Maximum VBUS Voltage',
          9,
          2,
          maxVbus,
          maxVbus,
          {
            displayValue: passiveCableMaxVbusDisplay(maxVbus),
          },
        ),
        field(
          'sbu_supported',
          'SBU Supported',
          8,
          1,
          sbuSupported,
          sbuSupported === 0,
          {
            displayValue:
              sbuSupported === 0
                ? 'SBU connections supported'
                : 'SBU connections not supported',
          },
        ),
        field(
          'sbu_type',
          'SBU Type',
          7,
          1,
          sbuType,
          sbuType === 1 ? 'Active' : 'Passive',
          {
            displayValue:
              sbuSupported === 0
                ? sbuType === 1
                  ? 'SBU is active'
                  : 'SBU is passive'
                : 'Ignored',
            note:
              sbuSupported === 0
                ? undefined
                : 'Ignored when SBU Supported = 1.',
          },
        ),
        field(
          'vbus_current_handling_capability',
          'VBUS Current Handling Capability',
          5,
          2,
          current,
          current,
          {
            displayValue:
              vbusThrough === 1 ? cableCurrentDisplay(current) : 'Ignored',
            note:
              vbusThrough === 1
                ? undefined
                : 'Ignored when VBUS Through Cable = 0.',
          },
        ),
        field(
          'vbus_through_cable',
          'VBUS Through Cable',
          4,
          1,
          vbusThrough,
          vbusThrough === 1,
          {
            displayValue: boolDisplay(vbusThrough === 1, 'Yes', 'No'),
          },
        ),
        field(
          'sop_dprime_controller_present',
          "SOP'' Controller Present",
          3,
          1,
          sopDoublePrimeController,
          sopDoublePrimeController === 1,
          {
            displayValue: boolDisplay(
              sopDoublePrimeController === 1,
              'Present',
              'Not Present',
            ),
          },
        ),
        field(
          'usb_highest_speed',
          'USB Highest Speed',
          0,
          3,
          usbHighestSpeed,
          usbHighestSpeed,
          {
            displayValue: usbHighestSpeedDisplay(usbHighestSpeed),
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildActiveCableVdo2(
  raw32: number,
  activeCableVdo1Raw32: number | null,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const reserved15 = extractBits(raw32, 15, 1)
  const u3CldPower = extractBits(raw32, 12, 3)
  const usb4SupportedBit = extractBits(raw32, 8, 1)
  const hubHops = extractBits(raw32, 6, 2)
  const usb2SupportedBit = extractBits(raw32, 5, 1)
  const opticallyIsolated = extractBits(raw32, 2, 1)
  const asymmetricModeSupported = extractBits(raw32, 1, 1)
  const issues: DecodeIssue[] = []

  if (reserved15 !== 0) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_RESERVED_BIT_NONZERO',
        'Active Cable VDO2 reserved bit 15 is non-zero.',
      ),
    )
  }
  if (u3CldPower === 0b111) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_U3_CLD_POWER_RESERVED',
        'Active Cable VDO2 U3/CLd Power value 111b is reserved.',
      ),
    )
  }
  if (usb2SupportedBit === 1 && hubHops !== 0) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_HUB_HOPS_NONZERO',
        'Active Cable VDO2 Hub Hops shall be zero when USB 2.0 is not supported.',
      ),
    )
  }
  if (usb4SupportedBit === 1 && asymmetricModeSupported === 1) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_ASYMMETRY_WITHOUT_USB4',
        'Active Cable VDO2 USB4 Asymmetric Mode Supported cannot be set when USB4 is not supported.',
      ),
    )
  }
  if (opticallyIsolated === 1 && usb2SupportedBit === 0) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_OPTICAL_USB2_CONFLICT',
        'Optically isolated Active Cables do not support USB 2.0.',
      ),
    )
  }
  if (
    activeCableVdo1Raw32 !== null &&
    opticallyIsolated === 1 &&
    extractBits(activeCableVdo1Raw32, 4, 1) === 1
  ) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_OPTICAL_VBUS_CONFLICT',
        'Optically isolated Active Cables do not carry VBUS through the cable.',
      ),
    )
  }

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:active-cable-vdo2`,
      'Active Cable VDO2',
      'discover_identity_active_cable_vdo2',
      byteOffset,
      raw32,
      [
        field(
          'maximum_operating_temperature',
          'Maximum Operating Temperature',
          24,
          8,
          extractBits(raw32, 24, 8),
          extractBits(raw32, 24, 8),
          {
            displayValue: `${extractBits(raw32, 24, 8)} °C`,
            unit: '°C',
          },
        ),
        field(
          'shutdown_temperature',
          'Shutdown Temperature',
          16,
          8,
          extractBits(raw32, 16, 8),
          extractBits(raw32, 16, 8),
          {
            displayValue: `${extractBits(raw32, 16, 8)} °C`,
            unit: '°C',
          },
        ),
        field('reserved_15', 'Reserved', 15, 1, reserved15, reserved15),
        field('u3_cld_power', 'U3 / CLd Power', 12, 3, u3CldPower, u3CldPower, {
          displayValue: u3CldPowerDisplay(u3CldPower),
        }),
        field(
          'u3_to_u0_transition_mode',
          'U3 to U0 transition mode',
          11,
          1,
          extractBits(raw32, 11, 1),
          extractBits(raw32, 11, 1) === 1
            ? 'U3 to U0 through U3S'
            : 'U3 to U0 direct',
          {
            displayValue:
              extractBits(raw32, 11, 1) === 1
                ? 'U3 to U0 through U3S'
                : 'U3 to U0 direct',
          },
        ),
        field(
          'physical_connection',
          'Physical connection',
          10,
          1,
          extractBits(raw32, 10, 1),
          extractBits(raw32, 10, 1) === 1 ? 'Optical' : 'Copper',
          {
            displayValue:
              extractBits(raw32, 10, 1) === 1 ? 'Optical' : 'Copper',
          },
        ),
        field(
          'active_element',
          'Active element',
          9,
          1,
          extractBits(raw32, 9, 1),
          extractBits(raw32, 9, 1) === 1
            ? 'Active Re-timer'
            : 'Active Re-driver',
          {
            displayValue:
              extractBits(raw32, 9, 1) === 1
                ? 'Active Re-timer'
                : 'Active Re-driver',
          },
        ),
        field(
          'usb4_supported',
          'USB4 Supported',
          8,
          1,
          usb4SupportedBit,
          usb4SupportedBit === 0,
          {
            displayValue: usb4SupportedBit === 0 ? 'Yes' : 'No',
          },
        ),
        field(
          'usb_2_hub_hops_consumed',
          'USB 2.0 Hub Hops Consumed',
          6,
          2,
          hubHops,
          hubHops,
        ),
        field(
          'usb_2_supported',
          'USB 2.0 Supported',
          5,
          1,
          usb2SupportedBit,
          usb2SupportedBit === 0,
          {
            displayValue: usb2SupportedBit === 0 ? 'Yes' : 'No',
          },
        ),
        field(
          'usb_3_supported',
          'USB 3.2 Supported',
          4,
          1,
          extractBits(raw32, 4, 1),
          extractBits(raw32, 4, 1) === 0,
          {
            displayValue: extractBits(raw32, 4, 1) === 0 ? 'Yes' : 'No',
          },
        ),
        field(
          'usb_lanes_supported',
          'USB Lanes Supported',
          3,
          1,
          extractBits(raw32, 3, 1),
          extractBits(raw32, 3, 1) === 1 ? 'Two lanes' : 'One lane',
          {
            displayValue:
              extractBits(raw32, 3, 1) === 1 ? 'Two lanes' : 'One lane',
          },
        ),
        field(
          'optically_isolated_active_cable',
          'Optically Isolated Active Cable',
          2,
          1,
          opticallyIsolated,
          opticallyIsolated === 1,
          {
            displayValue: boolDisplay(opticallyIsolated === 1, 'Yes', 'No'),
          },
        ),
        field(
          'usb4_asymmetric_mode_supported',
          'USB4 Asymmetric Mode Supported',
          1,
          1,
          asymmetricModeSupported,
          asymmetricModeSupported === 1,
          {
            displayValue: boolDisplay(
              asymmetricModeSupported === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'usb_gen',
          'USB Gen',
          0,
          1,
          extractBits(raw32, 0, 1),
          extractBits(raw32, 0, 1) === 1 ? 'Gen 2 or higher' : 'Gen 1',
          {
            displayValue:
              extractBits(raw32, 0, 1) === 1 ? 'Gen 2 or higher' : 'Gen 1',
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildVpdVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 21, 3)
  const reserved20_17 = extractBits(raw32, 17, 4)
  const maxVbus = extractBits(raw32, 15, 2)
  const chargeThroughCurrentSupport = extractBits(raw32, 14, 1)
  const reserved13 = extractBits(raw32, 13, 1)
  const vbusImpedance = extractBits(raw32, 7, 6)
  const groundImpedance = extractBits(raw32, 1, 6)
  const chargeThroughSupport = extractBits(raw32, 0, 1)
  const issues: DecodeIssue[] = []

  if (version !== 0) {
    issues.push(
      createIssue(
        'PD_VPD_VDO_VERSION_RESERVED',
        'VPD VDO Version values 001b..111b are reserved.',
      ),
    )
  }
  if (reserved20_17 !== 0) {
    issues.push(
      createIssue(
        'PD_VPD_VDO_RESERVED_HIGH_BITS_NONZERO',
        'VPD VDO reserved bits 20..17 are non-zero.',
      ),
    )
  }
  if (reserved13 !== 0) {
    issues.push(
      createIssue(
        'PD_VPD_VDO_RESERVED_13_NONZERO',
        'VPD VDO reserved bit 13 is non-zero.',
      ),
    )
  }
  if (maxVbus !== 0) {
    issues.push(
      createIssue(
        'PD_VPD_VDO_MAX_VBUS_DEPRECATED',
        'VPD VDO Maximum VBUS Voltage non-zero values are deprecated and treated as 20V.',
      ),
    )
  }
  if (chargeThroughSupport === 0) {
    if (
      chargeThroughCurrentSupport !== 0 ||
      vbusImpedance !== 0 ||
      groundImpedance !== 0
    ) {
      issues.push(
        createIssue(
          'PD_VPD_VDO_CHARGE_THROUGH_RESERVED',
          'VPD VDO charge-through dependent fields shall be zero when Charge Through Support is zero.',
        ),
      )
    }
  } else {
    if (vbusImpedance > 0 && vbusImpedance < 5) {
      issues.push(
        createIssue(
          'PD_VPD_VDO_VBUS_IMPEDANCE_RESERVED',
          'VPD VDO VBUS Impedance values below 10mohm are reserved.',
        ),
      )
    }
    if (groundImpedance > 0 && groundImpedance < 10) {
      issues.push(
        createIssue(
          'PD_VPD_VDO_GROUND_IMPEDANCE_RESERVED',
          'VPD VDO Ground Impedance values below 10mohm are reserved.',
        ),
      )
    }
  }

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:vpd-vdo`,
      'VPD VDO',
      'discover_identity_vpd_vdo',
      byteOffset,
      raw32,
      [
        field(
          'hw_version',
          'HW Version',
          28,
          4,
          extractBits(raw32, 28, 4),
          extractBits(raw32, 28, 4),
        ),
        field(
          'firmware_version',
          'Firmware Version',
          24,
          4,
          extractBits(raw32, 24, 4),
          extractBits(raw32, 24, 4),
        ),
        field('vdo_version', 'VDO Version', 21, 3, version, version, {
          displayValue: version === 0 ? 'Version 1.0' : 'Reserved',
        }),
        field(
          'reserved_20_17',
          'Reserved',
          17,
          4,
          reserved20_17,
          reserved20_17,
        ),
        field(
          'maximum_vbus_voltage',
          'Maximum VBUS Voltage',
          15,
          2,
          maxVbus,
          maxVbus,
          {
            displayValue: vpdMaxVbusDisplay(maxVbus),
          },
        ),
        field(
          'charge_through_current_support',
          'Charge Through Current Support',
          14,
          1,
          chargeThroughCurrentSupport,
          chargeThroughCurrentSupport === 1,
          {
            displayValue:
              chargeThroughSupport === 1
                ? chargeThroughCurrentSupport === 1
                  ? '5A capable'
                  : '3A capable'
                : 'Reserved',
            note:
              chargeThroughSupport === 1
                ? undefined
                : 'Reserved when Charge Through Support = 0.',
          },
        ),
        field('reserved_13', 'Reserved', 13, 1, reserved13, reserved13),
        field(
          'vbus_impedance',
          'VBUS Impedance',
          7,
          6,
          vbusImpedance,
          vbusImpedance * 2,
          {
            displayValue:
              chargeThroughSupport === 1
                ? `${vbusImpedance * 2} mohm`
                : 'Reserved',
            unit: 'mohm',
            note:
              chargeThroughSupport === 1
                ? '2mohm increments.'
                : 'Reserved when Charge Through Support = 0.',
          },
        ),
        field(
          'ground_impedance',
          'Ground Impedance',
          1,
          6,
          groundImpedance,
          groundImpedance,
          {
            displayValue:
              chargeThroughSupport === 1
                ? `${groundImpedance} mohm`
                : 'Reserved',
            unit: 'mohm',
            note:
              chargeThroughSupport === 1
                ? '1mohm increments.'
                : 'Reserved when Charge Through Support = 0.',
          },
        ),
        field(
          'charge_through_support',
          'Charge Through Support',
          0,
          1,
          chargeThroughSupport,
          chargeThroughSupport === 1,
          {
            displayValue: boolDisplay(chargeThroughSupport === 1, 'Yes', 'No'),
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildDrdPadObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues =
    raw32 === 0
      ? []
      : [
          createIssue(
            'PD_DISCOVER_IDENTITY_DRD_PAD_NONZERO',
            'Discover Identity DRD Pad Object shall be all zeros.',
          ),
        ]

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:drd-pad-object`,
      'DRD Pad Object',
      'discover_identity_drd_pad_object',
      byteOffset,
      raw32,
      [
        field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8), {
          note: 'Shall be all zeros.',
        }),
      ],
      issues,
      index,
    ),
  }
}

function buildDiscoverSvidVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSvidVdoSection {
  const upperSvid = extractBits(raw32, 16, 16)
  const lowerSvid = extractBits(raw32, 0, 16)
  const hasTerminator = upperSvid === 0 || lowerSvid === 0
  const hasOddTerminator = upperSvid !== 0 && lowerSvid === 0
  const hasInvalidZeroPattern = upperSvid === 0 && lowerSvid !== 0
  const issues: DecodeIssue[] = []

  if (hasInvalidZeroPattern) {
    issues.push(
      createIssue(
        'PD_DISCOVER_SVIDS_INVALID_ZERO_PATTERN',
        'Discover SVIDs VDO uses 0x0000 in the upper SVID slot while the lower SVID slot is non-zero.',
      ),
    )
  }

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:discover-svids-vdo`,
      `Discover SVIDs VDO ${index}`,
      'discover_svids_vdo',
      byteOffset,
      raw32,
      [
        field('svid_upper', 'SVID n', 16, 16, upperSvid, hex(upperSvid, 4), {
          displayValue: upperSvid === 0 ? 'End of list' : hex(upperSvid, 4),
        }),
        field('svid_lower', 'SVID n+1', 0, 16, lowerSvid, hex(lowerSvid, 4), {
          displayValue: lowerSvid === 0 ? 'End of list' : hex(lowerSvid, 4),
        }),
      ],
      issues,
      index,
    ),
    hasTerminator,
    hasOddTerminator,
    hasInvalidZeroPattern,
  }
}

function buildDiscoverModeVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:discover-mode-vdo`,
      `Mode VDO ${index}`,
      'discover_modes_vdo',
      byteOffset,
      raw32,
      [
        field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8), {
          note: 'Mode VDO structure is defined by the corresponding SVID owner.',
        }),
      ],
      [],
      index,
    ),
  }
}

function buildAlternateModeCommandVdo(
  raw32: number,
  index: number,
  title: string,
  semanticKind: string,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:${semanticKind}`,
      title,
      semanticKind,
      byteOffset,
      raw32,
      [
        field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8), {
          note: 'VDO contents are defined by the corresponding Alternate Mode.',
        }),
      ],
      [],
      index,
    ),
  }
}

function dpSignalingDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'DP Gen1'
    case 1:
      return 'DP Gen2'
    case 8:
      return 'DP Gen3'
    default:
      return 'Reserved'
  }
}

function dpConnectedDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Disconnected'
    case 1:
      return 'DFP_D'
    case 2:
      return 'UFP_D'
    case 3:
      return 'Both'
    default:
      return 'Reserved'
  }
}

function buildDisplayPortModeVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const ufpDPinAssign = extractBits(raw32, 0, 4)
  const receptacle = extractBits(raw32, 6, 1)
  const usb20NotUsed = extractBits(raw32, 7, 1)
  const dfpDPinAssign = extractBits(raw32, 8, 4)
  const dpSignaling = extractBits(raw32, 16, 4)

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:displayport-mode-vdo`,
      `DisplayPort Mode VDO ${index}`,
      'displayport_mode_vdo',
      byteOffset,
      raw32,
      [
        field(
          'ufp_d_pin_assign',
          'UFP_D Pin Assign',
          0,
          4,
          ufpDPinAssign,
          hex(ufpDPinAssign, 1),
          {
            displayValue: hex(ufpDPinAssign, 1),
            note: 'DisplayPort pin assignment bitmask as defined by the DisplayPort Alt Mode standard.',
          },
        ),
        field(
          'receptacle_indication',
          'Receptacle Indication',
          6,
          1,
          receptacle,
          receptacle === 1,
          {
            displayValue: receptacle === 1 ? 'Receptacle' : 'Plug',
          },
        ),
        field(
          'usb_2_signaling_not_used',
          'USB 2.0 Signaling Not Used',
          7,
          1,
          usb20NotUsed,
          usb20NotUsed === 1,
          {
            displayValue: boolDisplay(usb20NotUsed === 1, 'Yes', 'No'),
          },
        ),
        field(
          'dfp_d_pin_assign',
          'DFP_D Pin Assign',
          8,
          4,
          dfpDPinAssign,
          hex(dfpDPinAssign, 1),
          {
            displayValue: hex(dfpDPinAssign, 1),
            note: 'DisplayPort pin assignment bitmask as defined by the DisplayPort Alt Mode standard.',
          },
        ),
        field('dp_signaling', 'DP Signaling', 16, 4, dpSignaling, dpSignaling, {
          displayValue: dpSignalingDisplay(dpSignaling),
        }),
      ],
      [],
      index,
    ),
  }
}

function buildDisplayPortStatusVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const connected = extractBits(raw32, 0, 2)
  const powerDirectionIndication = extractBits(raw32, 2, 1)
  const powerLow = extractBits(raw32, 3, 1)
  const enabled = extractBits(raw32, 4, 1)
  const multiFunctionPreferred = extractBits(raw32, 5, 1)
  const usbConfigRequest = extractBits(raw32, 6, 1)
  const exitDpModeRequest = extractBits(raw32, 7, 1)
  const hpdState = extractBits(raw32, 8, 1)
  const irqHpd = extractBits(raw32, 9, 1)
  const reserved = extractBits(raw32, 10, 22)
  const issues: DecodeIssue[] = []

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_DP_STATUS_VDO_RESERVED_BITS_NONZERO',
        'DisplayPort Status VDO reserved bits 31..10 are non-zero.',
      ),
    )
  }

  return {
    section: createVendorSection(
      `${parentSectionKey}:object-${index}:displayport-status-vdo`,
      'DisplayPort Status VDO',
      'displayport_status_vdo',
      byteOffset,
      raw32,
      [
        field('connected', 'Connected', 0, 2, connected, connected, {
          displayValue: dpConnectedDisplay(connected),
        }),
        field(
          'power_direction_indication',
          'Power Direction Indication',
          2,
          1,
          powerDirectionIndication,
          powerDirectionIndication === 1,
          {
            displayValue: boolDisplay(
              powerDirectionIndication === 1,
              'Adaptor',
              'Normal',
            ),
          },
        ),
        field('power_low', 'Power Low', 3, 1, powerLow, powerLow === 1, {
          displayValue: boolDisplay(powerLow === 1, 'Yes', 'No'),
        }),
        field('enabled', 'Enabled', 4, 1, enabled, enabled === 1, {
          displayValue: boolDisplay(enabled === 1, 'Yes', 'No'),
        }),
        field(
          'multi_function_preferred',
          'Multi-Function Preferred',
          5,
          1,
          multiFunctionPreferred,
          multiFunctionPreferred === 1,
          {
            displayValue: boolDisplay(
              multiFunctionPreferred === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'usb_config_request',
          'USB Config Request',
          6,
          1,
          usbConfigRequest,
          usbConfigRequest === 1,
          {
            displayValue: boolDisplay(
              usbConfigRequest === 1,
              'Requested',
              'Not Requested',
            ),
          },
        ),
        field(
          'exit_dp_mode_request',
          'Exit DP Mode Request',
          7,
          1,
          exitDpModeRequest,
          exitDpModeRequest === 1,
          {
            displayValue: boolDisplay(
              exitDpModeRequest === 1,
              'Requested',
              'Not Requested',
            ),
          },
        ),
        field('hpd_state', 'HPD State', 8, 1, hpdState, hpdState === 1, {
          displayValue: hpdState === 1 ? 'High' : 'Low',
        }),
        field('irq_hpd', 'IRQ HPD', 9, 1, irqHpd, irqHpd === 1, {
          displayValue: boolDisplay(irqHpd === 1, 'Asserted', 'Not Asserted'),
        }),
        field('reserved', 'Reserved', 10, 22, reserved, reserved),
      ],
      issues,
      index,
    ),
  }
}

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

function appendGenericVendorObjects(
  sections: Section[],
  payloadBytes: Uint8Array,
  startIndex: number,
  payloadSectionKey: string,
  payloadByteOffset: number,
): void {
  const count = Math.floor(payloadBytes.length / 4)
  for (let index = startIndex; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4
    sections.push(
      buildGenericObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        'vendor_data_object',
        `Vendor Data Object ${index + 1}`,
        'vendor_data_object',
      ).section,
    )
  }
}

function explainDiscoverIdentityObjects(
  payloadBytes: Uint8Array,
  sop: StartOfPacket,
  payloadSectionKey: string,
  payloadByteOffset: number,
  headerBuilt: BuiltSection,
  structured: StructuredVdmHeaderInfo,
): Section[] {
  const sections: Section[] = [headerBuilt.section]
  const count = Math.floor(payloadBytes.length / 4)

  if (structured.commandType === 0) {
    if (count !== 1) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_DISCOVER_IDENTITY_REQ_OBJECT_COUNT_INVALID',
          'Discover Identity REQ shall contain only the VDM Header and no VDOs.',
        ),
      )
    }
    appendGenericVendorObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (structured.commandType === 2 || structured.commandType === 3) {
    if (count !== 1) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_DISCOVER_IDENTITY_NON_ACK_OBJECT_COUNT_INVALID',
          'Discover Identity NAK and BUSY shall contain only the VDM Header and no VDOs.',
        ),
      )
    }
    appendGenericVendorObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (count < 4) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_IDENTITY_ACK_TOO_SHORT',
        'Discover Identity ACK shall contain at least ID Header VDO, Cert Stat VDO, and Product VDO.',
      ),
    )
  }

  let idHeaderInfo: DiscoverIdentityIdHeaderInfo | null = null

  if (count >= 2) {
    const built = buildIdHeaderVdo(
      readUint32Le(payloadBytes, 4),
      sop,
      1,
      payloadSectionKey,
      payloadByteOffset + 4,
    )
    sections.push(built.section)
    idHeaderInfo = built.info
  }
  if (count >= 3) {
    sections.push(
      buildCertStatVdo(
        readUint32Le(payloadBytes, 8),
        2,
        payloadSectionKey,
        payloadByteOffset + 8,
      ).section,
    )
  }
  if (count >= 4) {
    sections.push(
      buildProductVdo(
        readUint32Le(payloadBytes, 12),
        3,
        payloadSectionKey,
        payloadByteOffset + 12,
      ).section,
    )
  }

  if (idHeaderInfo === null) {
    appendGenericVendorObjects(
      sections,
      payloadBytes,
      4,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  let expectedCount = 4
  let nextIndex = 4
  let activeCableVdo1Raw32: number | null = null

  if (sop === 'SOP') {
    const needsUfpVdo =
      idHeaderInfo.productTypeUfp === 1 || idHeaderInfo.productTypeUfp === 2
    const needsDfpVdo =
      idHeaderInfo.productTypeDfp === 1 ||
      idHeaderInfo.productTypeDfp === 2 ||
      idHeaderInfo.productTypeDfp === 3

    if (needsUfpVdo && needsDfpVdo) {
      expectedCount = 7
      if (count >= 5) {
        sections.push(
          buildUfpVdo(
            readUint32Le(payloadBytes, 16),
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      if (count >= 6) {
        sections.push(
          buildDrdPadObject(
            readUint32Le(payloadBytes, 20),
            5,
            payloadSectionKey,
            payloadByteOffset + 20,
          ).section,
        )
      }
      if (count >= 7) {
        sections.push(
          buildDfpVdo(
            readUint32Le(payloadBytes, 24),
            idHeaderInfo.productTypeDfp,
            6,
            payloadSectionKey,
            payloadByteOffset + 24,
          ).section,
        )
      }
      nextIndex = 7
    } else if (needsUfpVdo) {
      expectedCount = 5
      if (count >= 5) {
        sections.push(
          buildUfpVdo(
            readUint32Le(payloadBytes, 16),
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      nextIndex = 5
    } else if (needsDfpVdo) {
      expectedCount = 5
      if (count >= 5) {
        sections.push(
          buildDfpVdo(
            readUint32Le(payloadBytes, 16),
            idHeaderInfo.productTypeDfp,
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      nextIndex = 5
    }
  } else {
    if (idHeaderInfo.productTypeUfp === 3) {
      expectedCount = 5
      if (count >= 5) {
        sections.push(
          buildPassiveCableVdo(
            readUint32Le(payloadBytes, 16),
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      nextIndex = 5
    } else if (idHeaderInfo.productTypeUfp === 4) {
      expectedCount = 6
      if (count >= 5) {
        activeCableVdo1Raw32 = readUint32Le(payloadBytes, 16)
        sections.push(
          buildActiveCableVdo1(
            activeCableVdo1Raw32,
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      if (count >= 6) {
        sections.push(
          buildActiveCableVdo2(
            readUint32Le(payloadBytes, 20),
            activeCableVdo1Raw32,
            5,
            payloadSectionKey,
            payloadByteOffset + 20,
          ).section,
        )
      }
      nextIndex = 6
    } else if (idHeaderInfo.productTypeUfp === 6) {
      expectedCount = 5
      if (count >= 5) {
        sections.push(
          buildVpdVdo(
            readUint32Le(payloadBytes, 16),
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      nextIndex = 5
    }
  }

  if (count < expectedCount) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_IDENTITY_ACK_MISSING_VDOS',
        `Discover Identity ACK is missing one or more required Product Type VDOs; expected ${expectedCount} objects including the VDM Header, found ${count}.`,
      ),
    )
  }
  if (count > expectedCount) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_IDENTITY_ACK_EXTRA_VDOS',
        `Discover Identity ACK contains additional VDOs beyond the defined response shape; expected ${expectedCount} objects including the VDM Header, found ${count}.`,
      ),
    )
  }

  appendGenericVendorObjects(
    sections,
    payloadBytes,
    nextIndex,
    payloadSectionKey,
    payloadByteOffset,
  )
  return sections
}

function explainDiscoverSvidsObjects(
  payloadBytes: Uint8Array,
  payloadSectionKey: string,
  payloadByteOffset: number,
  headerBuilt: BuiltSection,
  structured: StructuredVdmHeaderInfo,
): Section[] {
  const sections: Section[] = [headerBuilt.section]
  const count = Math.floor(payloadBytes.length / 4)
  const svidVdoCount = Math.max(0, count - 1)

  if (
    structured.commandType === 0 ||
    structured.commandType === 2 ||
    structured.commandType === 3
  ) {
    if (count !== 1) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_DISCOVER_SVIDS_NON_ACK_OBJECT_COUNT_INVALID',
          `Discover SVIDs ${vdmCommandTypeDisplay(structured.commandType)} shall contain only the VDM Header and no VDOs.`,
        ),
      )
    }
    appendGenericVendorObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (svidVdoCount === 0) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_SVIDS_ACK_TOO_SHORT',
        'Discover SVIDs ACK shall contain at least one SVID VDO.',
      ),
    )
    return sections
  }

  let terminatorIndex = -1

  for (let index = 1; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4
    const built = buildDiscoverSvidVdo(
      raw32,
      index,
      payloadSectionKey,
      byteOffset,
    )
    sections.push(built.section)

    if (built.hasTerminator && terminatorIndex === -1) {
      terminatorIndex = index
    }
  }

  if (terminatorIndex !== -1 && terminatorIndex !== count - 1) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_SVIDS_TERMINATOR_NOT_LAST',
        'Discover SVIDs terminator VDO shall appear only in the last VDO of the ACK message.',
      ),
    )
  }

  if (terminatorIndex === -1 && svidVdoCount < 6) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_SVIDS_TERMINATOR_MISSING',
        'Final Discover SVIDs ACK messages with fewer than 6 SVID VDOs shall terminate with one or two 0x0000 SVID values.',
      ),
    )
  }

  return sections
}

function explainDiscoverModesObjects(
  payloadBytes: Uint8Array,
  payloadSectionKey: string,
  payloadByteOffset: number,
  headerBuilt: BuiltSection,
  structured: StructuredVdmHeaderInfo,
): Section[] {
  const sections: Section[] = [headerBuilt.section]
  const count = Math.floor(payloadBytes.length / 4)

  if (
    structured.commandType === 0 ||
    structured.commandType === 2 ||
    structured.commandType === 3
  ) {
    if (count !== 1) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_DISCOVER_MODES_NON_ACK_OBJECT_COUNT_INVALID',
          `Discover Modes ${vdmCommandTypeDisplay(structured.commandType)} shall contain only the VDM Header and no VDOs.`,
        ),
      )
    }
    appendGenericVendorObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (count < 2) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_MODES_ACK_TOO_SHORT',
        'Discover Modes ACK shall contain at least one Mode VDO.',
      ),
    )
    return sections
  }

  if (count > 7) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_MODES_ACK_TOO_LONG',
        `Discover Modes ACK shall contain 2 to 7 objects including the VDM Header; found ${count}.`,
      ),
    )
  }

  for (let index = 1; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4
    if (structured.svid === 0xff01 && index === 1) {
      sections.push(
        buildDisplayPortModeVdo(raw32, index, payloadSectionKey, byteOffset)
          .section,
      )
      continue
    }
    sections.push(
      buildDiscoverModeVdo(raw32, index, payloadSectionKey, byteOffset).section,
    )
  }

  return sections
}

function explainEnterExitAttentionObjects(
  payloadBytes: Uint8Array,
  payloadSectionKey: string,
  payloadByteOffset: number,
  headerBuilt: BuiltSection,
  structured: StructuredVdmHeaderInfo,
): Section[] {
  const sections: Section[] = [headerBuilt.section]
  const count = Math.floor(payloadBytes.length / 4)
  const command = structured.command
  const objectPosition = structured.objectPosition

  if (command === 4 && objectPosition === 0b111) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_ENTER_MODE_OBJECT_POSITION_INVALID',
        'Enter Mode Object Position 111b is not defined; use the referenced Mode VDO position from Discover Modes.',
      ),
    )
  }

  if (command === 6 && objectPosition === 0b111) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_ATTENTION_OBJECT_POSITION_INVALID',
        'Attention shall not use Object Position 111b.',
      ),
    )
  }

  if (command === 4) {
    if (structured.commandType === 3) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_ENTER_MODE_BUSY_NOT_ALLOWED',
          'Enter Mode responders shall not return BUSY.',
        ),
      )
    }

    if (structured.commandType === 0) {
      if (count < 1 || count > 2) {
        headerBuilt.section.issues.push(
          createIssue(
            'PD_ENTER_MODE_REQ_OBJECT_COUNT_INVALID',
            'Enter Mode REQ shall contain the VDM Header and at most one additional VDO.',
          ),
        )
      }
      if (count === 2) {
        const raw32 = readUint32Le(payloadBytes, 4)
        sections.push(
          structured.svid === 0xff01
            ? buildDisplayPortStatusVdo(
                raw32,
                1,
                payloadSectionKey,
                payloadByteOffset + 4,
              ).section
            : buildAlternateModeCommandVdo(
                raw32,
                1,
                'Enter Mode VDO',
                'enter_mode_vdo',
                payloadSectionKey,
                payloadByteOffset + 4,
              ).section,
        )
      }
      if (count > 2) {
        appendGenericVendorObjects(
          sections,
          payloadBytes,
          1,
          payloadSectionKey,
          payloadByteOffset,
        )
      }
      return sections
    }

    if (structured.commandType === 1 || structured.commandType === 2) {
      if (count !== 1) {
        headerBuilt.section.issues.push(
          createIssue(
            'PD_ENTER_MODE_RESPONSE_OBJECT_COUNT_INVALID',
            'Enter Mode ACK and NAK shall contain only the VDM Header and no VDOs.',
          ),
        )
        appendGenericVendorObjects(
          sections,
          payloadBytes,
          1,
          payloadSectionKey,
          payloadByteOffset,
        )
      }
      return sections
    }

    appendGenericVendorObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (command === 5) {
    if (structured.commandType === 3) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_EXIT_MODE_BUSY_NOT_ALLOWED',
          'Exit Mode responders shall not return BUSY.',
        ),
      )
    }

    if (count !== 1) {
      headerBuilt.section.issues.push(
        createIssue(
          structured.commandType === 0
            ? 'PD_EXIT_MODE_REQ_OBJECT_COUNT_INVALID'
            : 'PD_EXIT_MODE_RESPONSE_OBJECT_COUNT_INVALID',
          structured.commandType === 0
            ? 'Exit Mode REQ shall contain only the VDM Header and no VDOs.'
            : 'Exit Mode ACK and NAK shall contain only the VDM Header and no VDOs.',
        ),
      )
      appendGenericVendorObjects(
        sections,
        payloadBytes,
        1,
        payloadSectionKey,
        payloadByteOffset,
      )
    }
    return sections
  }

  if (structured.commandType !== 0) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_ATTENTION_RESPONSE_NOT_ALLOWED',
        'Attention is a request-only command and shall not have a command response.',
      ),
    )
  }

  if (count < 1 || count > 2) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_ATTENTION_REQ_OBJECT_COUNT_INVALID',
        'Attention shall contain the VDM Header and at most one additional VDO.',
      ),
    )
  }

  if (count === 2) {
    const raw32 = readUint32Le(payloadBytes, 4)
    sections.push(
      structured.svid === 0xff01
        ? buildDisplayPortStatusVdo(
            raw32,
            1,
            payloadSectionKey,
            payloadByteOffset + 4,
          ).section
        : buildAlternateModeCommandVdo(
            raw32,
            1,
            'Attention VDO',
            'attention_vdo',
            payloadSectionKey,
            payloadByteOffset + 4,
          ).section,
    )
  }

  if (count > 2) {
    appendGenericVendorObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  return sections
}

function explainVendorDefinedObjects(
  payloadBytes: Uint8Array,
  sop: StartOfPacket,
  payloadSectionKey: string,
  payloadByteOffset: number,
): Section[] {
  const count = Math.floor(payloadBytes.length / 4)

  if (count === 0) {
    return []
  }

  const headerRaw32 = readUint32Le(payloadBytes, 0)
  const headerBuilt = buildVdmHeaderObject(
    headerRaw32,
    0,
    payloadSectionKey,
    payloadByteOffset,
  )
  const structured = parseStructuredVdmHeader(headerRaw32)

  if (structured === null) {
    const sections: Section[] = [headerBuilt.section]
    appendGenericVendorObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (structured.command === 1) {
    return explainDiscoverIdentityObjects(
      payloadBytes,
      sop,
      payloadSectionKey,
      payloadByteOffset,
      headerBuilt,
      structured,
    )
  }

  if (structured.command === 2) {
    return explainDiscoverSvidsObjects(
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
      headerBuilt,
      structured,
    )
  }

  if (structured.command === 3) {
    return explainDiscoverModesObjects(
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
      headerBuilt,
      structured,
    )
  }

  if (
    structured.command === 4 ||
    structured.command === 5 ||
    structured.command === 6
  ) {
    return explainEnterExitAttentionObjects(
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
      headerBuilt,
      structured,
    )
  }

  const sections: Section[] = [headerBuilt.section]
  appendGenericVendorObjects(
    sections,
    payloadBytes,
    1,
    payloadSectionKey,
    payloadByteOffset,
  )
  return sections
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
  if (messageType.name === 'Vendor_Defined') {
    const sections = explainVendorDefinedObjects(
      payloadBytes,
      sop,
      payloadSectionKey,
      payloadByteOffset,
    )
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

  const sections: Section[] = []
  const count = Math.floor(payloadBytes.length / 4)
  const firstObjectRaw32 = count > 0 ? readUint32Le(payloadBytes, 0) : null
  const eprRequestObjectPosition =
    messageType.name === 'EPR_Request' && firstObjectRaw32 !== null
      ? extractBits(firstObjectRaw32, 28, 4)
      : null
  const eprRequestResolvedKind =
    messageType.name === 'EPR_Request' && count > 1
      ? classifyRdoKindFromPdo(readUint32Le(payloadBytes, 4))
      : null

  for (let index = 0; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4
    const capabilityTitle =
      capabilityObjectTitle(messageType.name, index) ?? undefined

    let built: BuiltSection

    if (
      messageType.name === 'Source_Capabilities' ||
      messageType.name === 'EPR_Source_Capabilities'
    ) {
      built = buildPowerObject(
        raw32,
        'source',
        index,
        payloadSectionKey,
        byteOffset,
        capabilityTitle,
      )
    } else if (
      messageType.name === 'Sink_Capabilities' ||
      messageType.name === 'EPR_Sink_Capabilities'
    ) {
      built = buildPowerObject(
        raw32,
        'sink',
        index,
        payloadSectionKey,
        byteOffset,
        capabilityTitle,
      )
    } else if (messageType.name === 'BIST' && index === 0) {
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
    } else if (messageType.name === 'Request') {
      built = buildRequestObject(raw32, index, payloadSectionKey, byteOffset, {
        messageTypeName: 'Request',
        objectCount: count,
        resolvedKind: options.requestRdoKind ?? null,
      })
    } else if (messageType.name === 'EPR_Request' && index === 0) {
      built = buildRequestObject(raw32, index, payloadSectionKey, byteOffset, {
        messageTypeName: 'EPR_Request',
        objectCount: count,
        resolvedKind: eprRequestResolvedKind,
      })
    } else if (messageType.name === 'EPR_Request' && index === 1) {
      built = buildCopyOfPdoObject(
        raw32,
        index,
        eprRequestObjectPosition ?? 0,
        payloadSectionKey,
        byteOffset,
      )
    } else if (messageType.name === 'EPR_Request') {
      built = buildGenericObject(
        raw32,
        index,
        payloadSectionKey,
        byteOffset,
        'data_object',
        `Unexpected EPR Request Data Object ${index + 1}`,
        'unexpected_epr_request_data_object',
      )
    } else {
      built = buildGenericObject(raw32, index, payloadSectionKey, byteOffset)
    }

    sections.push(built.section)
    if (built.extraSections !== undefined) {
      sections.push(...built.extraSections)
    }
  }

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
