import { buildDeclaredDataSizeIssues } from './dataBlockValidation.js'
import {
  type BuiltSection,
  createDataBlockSection,
  createIssue,
  field,
  hex,
} from './sectionBuilders.js'

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

export function buildExtendedControlDataBlock(
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
      'Extended Control Data Block (ECDB)',
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
