import type {
  ExtendedMessageHeader,
  MessageTypeInfo,
  Section,
  StartOfPacket,
} from '../types.js'
import { explainDataObjects } from './dataObjects/index.js'
import {
  buildBatteryCapabilitiesDataBlock,
  buildGetBatteryCapDataBlock,
  buildGetBatteryStatusDataBlock,
} from './extendedDataBlocks/batteryDataBlocks.js'
import {
  buildSinkCapabilitiesExtendedDataBlock,
  buildSourceCapabilitiesExtendedDataBlock,
} from './extendedDataBlocks/capabilitiesDataBlocks.js'
import {
  buildCountryCodesDataBlock,
  buildCountryInfoDataBlock,
} from './extendedDataBlocks/countryDataBlocks.js'
import { buildExtendedControlDataBlock } from './extendedDataBlocks/extendedControlDataBlock.js'
import { buildExternalSpecificationDataBlock } from './extendedDataBlocks/externalSpecificationDataBlocks.js'
import {
  buildGetManufacturerInfoDataBlock,
  buildManufacturerInfoDataBlock,
} from './extendedDataBlocks/manufacturerInfoDataBlocks.js'
import { buildPpsStatusDataBlock } from './extendedDataBlocks/ppsStatusDataBlock.js'
import {
  type BuiltSection,
  buildPaddingSection,
  createDataBlockSection,
} from './extendedDataBlocks/sectionBuilders.js'
import { buildStatusDataBlock } from './extendedDataBlocks/statusDataBlock.js'
import { buildVendorDefinedExtendedDataBlock } from './extendedDataBlocks/vendorDefinedExtendedDataBlock.js'

const MAX_EXTENDED_MESSAGE_CHUNK_LENGTH = 26

function rawExtendedDataBlockInfo(messageTypeName: string | null): {
  title: string
  semanticKind: string
} {
  switch (messageTypeName) {
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
  const externalSpecificationDataBlock = buildExternalSpecificationDataBlock(
    bytes,
    messageTypeName,
    parentSectionKey,
    byteOffset,
  )
  if (externalSpecificationDataBlock !== null) {
    return externalSpecificationDataBlock
  }

  const vendorDefinedExtendedDataBlock = buildVendorDefinedExtendedDataBlock(
    bytes,
    messageTypeName,
    parentSectionKey,
    byteOffset,
  )
  if (vendorDefinedExtendedDataBlock !== null) {
    return vendorDefinedExtendedDataBlock
  }

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
