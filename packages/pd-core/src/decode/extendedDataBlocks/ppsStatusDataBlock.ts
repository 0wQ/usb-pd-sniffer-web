import { readUint16Le } from '../../utils/bits.js'
import { buildDeclaredDataSizeIssues } from './dataBlockValidation.js'
import {
  type BuiltSection,
  createDataBlockSection,
  createIssue,
  field,
} from './sectionBuilders.js'

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

export function buildPpsStatusDataBlock(
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
      'PPS Status Data Block (PPSSDB)',
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
