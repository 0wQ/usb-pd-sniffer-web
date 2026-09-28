import type { DecodeIssue } from '../../types.js'
import { readUint16Le } from '../../utils/bits.js'
import { batteryReferenceDisplay } from './batteryDataBlocks.js'
import { buildDeclaredDataSizeIssues } from './dataBlockValidation.js'
import {
  asciiBytesDisplay,
  type BuiltSection,
  createDataBlockSection,
  createIssue,
  field,
  hex,
} from './sectionBuilders.js'

function manufacturerInfoTargetDisplay(value: number): string {
  if (value === 0) {
    return 'Port / Cable Plug'
  }
  if (value === 1) {
    return 'Battery'
  }
  return 'Reserved'
}

export function buildGetManufacturerInfoDataBlock(
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

export function buildManufacturerInfoDataBlock(
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
      'Manufacturer Info Data Block (MIDB)',
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
