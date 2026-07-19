export type StartOfPacket =
  | 'SOP'
  | 'SOP_PRIME'
  | 'SOP_DPRIME'
  | 'SOP_PRIME_DEBUG'
  | 'SOP_DPRIME_DEBUG'

export type MessagePacket = {
  sop: StartOfPacket
  bytes: Uint8Array
}

export type MessageFrame = {
  sop: StartOfPacket
  bytes: Uint8Array
}

export type DecodeContextMessage =
  | {
      kind: 'frame'
      frame: MessageFrame
    }
  | {
      kind: 'packet'
      packet: MessagePacket
    }

export type ChunkedExtendedMessageContext = {
  previousChunks: readonly DecodeContextMessage[]
}

export type DecodeContext = {
  sourceCapabilities?: DecodeContextMessage
  chunkedExtendedMessage?: ChunkedExtendedMessageContext
}

export type SpecificationRevision = '1.0' | '2.0' | '3.x' | 'reserved'

export type MessageCategory = 'control' | 'data' | 'extended' | 'unknown'

export type MessageTypeInfo = {
  category: MessageCategory
  code: number | null
  name: string | null
}

export type DecodeIssue = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
}

export type BitField = {
  key: string
  label: string
  bitStart: number
  bitLength: number
  rawValue: number | bigint
  decodedValue: string | number | boolean | null
  displayValue?: string
  unit?: string
  note?: string
}

export type MessageHeader = {
  raw16: number
  extended: boolean
  numberOfDataObjects: number
  messageId: number
  portPowerRoleOrCablePlugBit: 0 | 1
  portPowerRoleOrCablePlugMeaning:
    | 'Sink'
    | 'Source'
    | 'DFP/UFP Port'
    | 'Cable Plug / VPD'
  specificationRevisionBits: 0 | 1 | 2 | 3
  specificationRevision: SpecificationRevision
  portDataRoleBit: 0 | 1
  portDataRoleMeaning: 'UFP' | 'DFP' | null
  messageType: number
  category: MessageCategory
}

export type ExtendedMessageHeader = {
  raw16: number
  chunked: boolean
  chunkNumber: number
  requestChunk: boolean
  dataSize: number
}

export type SectionKind =
  | 'message_header'
  | 'extended_message_header'
  | 'crc32'
  | 'data_object'
  | 'request_data_object'
  | 'vdm_header'
  | 'vendor_data_object'
  | 'data_block'
  | 'raw_payload'

export type Section = {
  key: string
  kind: SectionKind
  title: string
  index?: number
  semanticKind?: string
  byteOffset: number
  byteLength: number
  rawBytes: Uint8Array
  fields: BitField[]
  issues: DecodeIssue[]
}

export type ExplainContext = {
  mode: 'single_frame' | 'sequence'
  notes: string[]
}

export type DecodedMessage = {
  frame: MessageFrame
  category: MessageCategory
  messageType: MessageTypeInfo
  header: MessageHeader | null
  extendedHeader: ExtendedMessageHeader | null
  explainContext: ExplainContext
  sections: Section[]
  issues: DecodeIssue[]
}

export type PacketLayout = {
  expectedMessageByteLength: number | null
  actualMessageByteLength: number
  crcByteOffset: number | null
  crcByteLength: number
}

export type PacketCrc = {
  raw32: number | null
  rawBytes: Uint8Array
  status: 'present' | 'missing'
  checkStatus: 'valid' | 'invalid' | 'not_applicable'
  expectedRaw32: number | null
}

export type DecodedPacket = DecodedMessage & {
  packet: MessagePacket
  packetLayout: PacketLayout
  crc: PacketCrc
}
