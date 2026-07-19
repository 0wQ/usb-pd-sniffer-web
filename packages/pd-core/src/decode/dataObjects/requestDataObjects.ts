import type { BitField, DecodeIssue, Section } from '../../types.js'
import { extractBits, readUint32Le } from '../../utils/bits.js'
import { buildPowerDataObject } from './powerDataObjects.js'
import {
  type BuiltSection,
  boolDisplay,
  createIssue,
  createSection,
  field,
  flagField,
} from './sectionBuilders.js'

export type RdoKind = 'fixed_variable' | 'battery' | 'pps' | 'avs'

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
  const built = buildPowerDataObject(
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

export function explainRequestDataObjects(
  payloadBytes: Uint8Array,
  messageTypeName: 'Request' | 'EPR_Request',
  parentSectionKey: string,
  byteOffset: number,
  requestRdoKind: RdoKind | null = null,
): Section[] {
  const count = Math.floor(payloadBytes.length / 4)
  const firstObjectRaw32 = count > 0 ? readUint32Le(payloadBytes, 0) : null
  const eprRequestObjectPosition =
    messageTypeName === 'EPR_Request' && firstObjectRaw32 !== null
      ? extractBits(firstObjectRaw32, 28, 4)
      : null
  const eprRequestResolvedKind =
    messageTypeName === 'EPR_Request' && count > 1
      ? classifyRdoKindFromPdo(readUint32Le(payloadBytes, 4))
      : null
  const sections: Section[] = []

  for (let index = 0; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const objectByteOffset = byteOffset + index * 4
    let built: BuiltSection

    if (messageTypeName === 'Request') {
      built = buildRequestObject(
        raw32,
        index,
        parentSectionKey,
        objectByteOffset,
        {
          messageTypeName,
          objectCount: count,
          resolvedKind: requestRdoKind,
        },
      )
    } else if (index === 0) {
      built = buildRequestObject(
        raw32,
        index,
        parentSectionKey,
        objectByteOffset,
        {
          messageTypeName,
          objectCount: count,
          resolvedKind: eprRequestResolvedKind,
        },
      )
    } else if (index === 1) {
      built = buildCopyOfPdoObject(
        raw32,
        index,
        eprRequestObjectPosition ?? 0,
        parentSectionKey,
        objectByteOffset,
      )
    } else {
      built = {
        section: createSection(
          `${parentSectionKey}:object-${index}:unexpected_epr_request_data_object`,
          'data_object',
          `Unexpected EPR Request Data Object ${index + 1}`,
          'unexpected_epr_request_data_object',
          objectByteOffset,
          raw32,
          [
            field(
              'raw32',
              'Raw 32-bit Value',
              0,
              32,
              raw32,
              `0x${raw32.toString(16).toUpperCase().padStart(8, '0')}`,
            ),
          ],
          [],
          index,
        ),
      }
    }

    sections.push(built.section)
    if (built.extraSections !== undefined) {
      sections.push(...built.extraSections)
    }
  }

  return sections
}
