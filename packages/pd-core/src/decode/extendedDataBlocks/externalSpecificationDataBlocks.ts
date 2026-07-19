import type { BuiltSection } from './sectionBuilders.js'
import { createDataBlockSection } from './sectionBuilders.js'

const EXTERNAL_SPECIFICATION_DATA_BLOCKS = {
  Security_Request: {
    title: 'Security Request Data Block (SRQDB)',
    semanticKind: 'security_request_data_block_raw',
  },
  Security_Response: {
    title: 'Security Response Data Block (SRPDB)',
    semanticKind: 'security_response_data_block_raw',
  },
  Firmware_Update_Request: {
    title: 'Firmware Update Request Data Block (FRQDB)',
    semanticKind: 'firmware_update_request_data_block_raw',
  },
  Firmware_Update_Response: {
    title: 'Firmware Update Response Data Block (FRPDB)',
    semanticKind: 'firmware_update_response_data_block_raw',
  },
} as const

type ExternalSpecificationMessageName =
  keyof typeof EXTERNAL_SPECIFICATION_DATA_BLOCKS

function isExternalSpecificationMessageName(
  messageTypeName: string | null,
): messageTypeName is ExternalSpecificationMessageName {
  return (
    messageTypeName !== null &&
    Object.getOwnPropertyDescriptor(
      EXTERNAL_SPECIFICATION_DATA_BLOCKS,
      messageTypeName,
    ) !== undefined
  )
}

export function buildExternalSpecificationDataBlock(
  bytes: Uint8Array,
  messageTypeName: string | null,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection | null {
  if (!isExternalSpecificationMessageName(messageTypeName)) return null

  const info = EXTERNAL_SPECIFICATION_DATA_BLOCKS[messageTypeName]
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
