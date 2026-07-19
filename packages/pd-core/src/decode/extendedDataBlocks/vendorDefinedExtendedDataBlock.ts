import { type BuiltSection, createDataBlockSection } from './sectionBuilders.js'

export function buildVendorDefinedExtendedDataBlock(
  bytes: Uint8Array,
  messageTypeName: string | null,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection | null {
  if (messageTypeName !== 'Vendor_Defined_Extended') return null

  return {
    section: createDataBlockSection(
      `${parentSectionKey}:vendor_defined_extended_data_block_raw`,
      'Vendor_Defined_Extended Data Block',
      'vendor_defined_extended_data_block_raw',
      byteOffset,
      bytes,
      [],
      [],
    ),
  }
}
