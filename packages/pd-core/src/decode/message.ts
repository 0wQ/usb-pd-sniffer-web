import {
  decodeExtendedMessageHeader,
  explainExtendedMessageHeader,
} from './extendedMessageHeader.js'
import {
  explainDataObjects,
  type RdoKind,
  classifyRdoKindFromPdo,
} from './dataObjects.js'
import { explainExtendedDataBlocks } from './extendedDataBlocks.js'
import { decodeMessageHeader, explainMessageHeader } from './messageHeader.js'
import { lookupMessageTypeName } from '../registry/messageTypes.js'
import { extractBits, readUint32Le } from '../utils/bits.js'
import { calculatePdCrc32 } from '../utils/pdCrc32.js'
import type {
  DecodeContext,
  DecodeContextMessage,
  DecodedMessage,
  DecodedPacket,
  DecodeIssue,
  ExtendedMessageHeader,
  MessageFrame,
  MessageHeader,
  MessagePacket,
  MessageTypeInfo,
  PacketCrc,
  PacketLayout,
  Section,
} from '../types.js'

type SplitPacketResult = {
  message: MessageFrame
  packetLayout: PacketLayout
  crc: PacketCrc
}

type ExplainMode = 'single_frame' | 'sequence'

type ParsedChunkedExtendedFrame = {
  frame: MessageFrame
  header: MessageHeader
  messageType: MessageTypeInfo
  extendedHeader: ExtendedMessageHeader
  payloadBytes: Uint8Array
}

type ResolvedExtendedPayloadContext = {
  mode: ExplainMode
  notes: string[]
  payloadBytes: Uint8Array
  rawOnly: boolean
}

const PREFIX_DECODABLE_CHUNKED_EXTENDED_TYPES = new Set([
  'EPR_Source_Capabilities',
  'EPR_Sink_Capabilities',
])

const FULL_ASSEMBLE_ONLY_CHUNKED_EXTENDED_TYPES = new Set([
  'Vendor_Defined_Extended',
])

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

function buildMessageTypeInfo(header: MessageHeader): MessageTypeInfo {
  return {
    category: header.category,
    code: header.messageType,
    name: lookupMessageTypeName(header.category, header.messageType),
  }
}

function expectedMessageByteLength(messageBytes: Uint8Array): number | null {
  if (messageBytes.length < 2) {
    return null
  }

  const rawHeader = messageBytes[0] | (messageBytes[1] << 8)
  const extended = extractBits(rawHeader, 15, 1) === 1

  if (!extended) {
    return 2 + extractBits(rawHeader, 12, 3) * 4
  }

  if (messageBytes.length < 4) {
    return null
  }

  const rawExtendedHeader = messageBytes[2] | (messageBytes[3] << 8)
  const chunked = extractBits(rawExtendedHeader, 15, 1) === 1

  if (chunked) {
    return 2 + extractBits(rawHeader, 12, 3) * 4
  }

  return 4 + extractBits(rawExtendedHeader, 0, 9)
}

function splitMessagePacket(packet: MessagePacket): SplitPacketResult {
  const hasFullCrc = packet.bytes.length >= 6
  const messageBytes = hasFullCrc
    ? packet.bytes.subarray(0, packet.bytes.length - 4)
    : packet.bytes
  const crcBytes = hasFullCrc
    ? packet.bytes.subarray(packet.bytes.length - 4)
    : new Uint8Array(0)
  const expectedLength = expectedMessageByteLength(messageBytes)
  const rawCrc32 = crcBytes.length === 4 ? readUint32Le(crcBytes, 0) : null
  const expectedCrc32 = hasFullCrc ? calculatePdCrc32(messageBytes) : null

  return {
    message: {
      sop: packet.sop,
      bytes: messageBytes,
    },
    packetLayout: {
      expectedMessageByteLength: expectedLength,
      actualMessageByteLength: messageBytes.length,
      crcByteOffset: hasFullCrc ? messageBytes.length : null,
      crcByteLength: crcBytes.length,
    },
    crc: {
      raw32: rawCrc32,
      rawBytes: crcBytes,
      status: hasFullCrc ? 'present' : 'missing',
      checkStatus:
        rawCrc32 === null || expectedCrc32 === null
          ? 'not_applicable'
          : rawCrc32 === expectedCrc32
            ? 'valid'
            : 'invalid',
      expectedRaw32: expectedCrc32,
    },
  }
}

function normalizeContextMessage(input: DecodeContextMessage): MessageFrame {
  return input.kind === 'frame'
    ? input.frame
    : splitMessagePacket(input.packet).message
}

function parseChunkedExtendedFrame(
  frame: MessageFrame,
): ParsedChunkedExtendedFrame | null {
  if (frame.bytes.length < 4) {
    return null
  }

  const header = decodeMessageHeader(frame)
  if (!header.extended) {
    return null
  }

  const messageType = buildMessageTypeInfo(header)
  const extendedHeader = decodeExtendedMessageHeader(frame.bytes.subarray(2, 4))

  return {
    frame,
    header,
    messageType,
    extendedHeader,
    payloadBytes: frame.bytes.subarray(4),
  }
}

function concatPayloadBytes(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }

  return merged
}

function formatCrc32(raw32: number): string {
  return `0x${raw32.toString(16).toUpperCase().padStart(8, '0')}`
}

function buildCrcSection(layout: PacketLayout, crc: PacketCrc): Section {
  const issues: DecodeIssue[] = []

  if (crc.status === 'missing') {
    issues.push({
      severity: 'warning',
      code: 'PD_CRC32_MISSING',
      message:
        'Packet does not include the 4-byte CRC32 after the message bytes.',
    })
  }

  if (crc.checkStatus === 'invalid') {
    issues.push({
      severity: 'error',
      code: 'PD_CRC32_INVALID',
      message:
        crc.expectedRaw32 === null
          ? 'CRC32 does not match the message bytes.'
          : `CRC32 does not match the message bytes. Expected ${formatCrc32(crc.expectedRaw32)}.`,
    })
  }

  return {
    key: 'crc32',
    kind: 'crc32',
    title: 'CRC32',
    semanticKind: 'crc32',
    byteOffset: layout.crcByteOffset ?? layout.actualMessageByteLength,
    byteLength: crc.rawBytes.length,
    rawBytes: crc.rawBytes,
    rawValue: crc.raw32 ?? undefined,
    fields:
      crc.raw32 === null
        ? []
        : [
            {
              key: 'crc32',
              label: 'CRC32',
              bitStart: 0,
              bitLength: 32,
              rawValue: crc.raw32,
              decodedValue: crc.checkStatus,
              displayValue:
                crc.checkStatus === 'not_applicable' ? '' : crc.checkStatus,
            },
          ],
    issues,
  }
}

function resolveRequestRdoKindFromContext(
  frame: MessageFrame,
  messageType: MessageTypeInfo,
  context: DecodeContext,
): {
  issues: DecodeIssue[]
  mode: ExplainMode
  notes: string[]
  resolvedKind: RdoKind | null
} {
  if (
    messageType.name !== 'Request' ||
    context.sourceCapabilities === undefined
  ) {
    return {
      issues: [],
      mode: 'single_frame',
      notes: [],
      resolvedKind: null,
    }
  }

  const issues: DecodeIssue[] = []
  const notes: string[] = []
  const sourceCapabilitiesFrame = normalizeContextMessage(
    context.sourceCapabilities,
  )

  if (frame.bytes.length < 6) {
    notes.push(
      'Source_Capabilities context was provided, but this Request frame is too short to resolve its RDO format.',
    )
    return {
      issues,
      mode: 'sequence',
      notes,
      resolvedKind: null,
    }
  }

  if (sourceCapabilitiesFrame.bytes.length < 2) {
    notes.push(
      'Source_Capabilities context was provided, but the frame is shorter than a PD Message Header.',
    )
    return {
      issues,
      mode: 'sequence',
      notes,
      resolvedKind: null,
    }
  }

  const sourceCapabilitiesHeader = decodeMessageHeader(sourceCapabilitiesFrame)
  const sourceCapabilitiesMessageTypeName = lookupMessageTypeName(
    sourceCapabilitiesHeader.category,
    sourceCapabilitiesHeader.messageType,
  )

  if (
    sourceCapabilitiesHeader.extended ||
    sourceCapabilitiesMessageTypeName !== 'Source_Capabilities'
  ) {
    notes.push(
      'Provided request context was ignored because it is not a Source_Capabilities message.',
    )
    return {
      issues,
      mode: 'sequence',
      notes,
      resolvedKind: null,
    }
  }

  const requestRaw32 = readUint32Le(frame.bytes, 2)
  const objectPosition = extractBits(requestRaw32, 28, 4)

  if (objectPosition === 0 || objectPosition >= 14) {
    notes.push(
      `Source_Capabilities context could not resolve Request object position ${objectPosition}, because the position is reserved.`,
    )
    return {
      issues,
      mode: 'sequence',
      notes,
      resolvedKind: null,
    }
  }

  if (objectPosition > 7) {
    issues.push({
      severity: 'warning',
      code: 'PD_REQUEST_SPR_OBJECT_POSITION_OUT_OF_RANGE',
      message:
        'Request Message object positions above 7 are reserved for EPR (A)PDOs.',
    })
  }

  if (objectPosition > sourceCapabilitiesHeader.numberOfDataObjects) {
    issues.push({
      severity: 'warning',
      code: 'PD_REQUEST_OBJECT_POSITION_OUT_OF_RANGE',
      message: `Object Position ${objectPosition} does not exist in the provided Source_Capabilities message.`,
    })
    notes.push(
      `Source_Capabilities context could not resolve Request object position ${objectPosition}, because the context message only exposes ${sourceCapabilitiesHeader.numberOfDataObjects} PDO(s).`,
    )
    return {
      issues,
      mode: 'sequence',
      notes,
      resolvedKind: null,
    }
  }

  const requestedPdoOffset = 2 + (objectPosition - 1) * 4
  if (sourceCapabilitiesFrame.bytes.length < requestedPdoOffset + 4) {
    notes.push(
      `Source_Capabilities context could not resolve Request object position ${objectPosition}, because the referenced PDO bytes are missing from the provided frame.`,
    )
    return {
      issues,
      mode: 'sequence',
      notes,
      resolvedKind: null,
    }
  }

  const referencedPdoRaw32 = readUint32Le(
    sourceCapabilitiesFrame.bytes,
    requestedPdoOffset,
  )
  const resolvedKind = classifyRdoKindFromPdo(referencedPdoRaw32)

  if (resolvedKind === null) {
    notes.push(
      `Source_Capabilities context could not classify Request object position ${objectPosition}, because the referenced PDO format is unknown.`,
    )
    return {
      issues,
      mode: 'sequence',
      notes,
      resolvedKind: null,
    }
  }

  notes.push(
    `Resolved Request object position ${objectPosition} using Source_Capabilities PDO ${objectPosition} as ${rdoKindLabel(resolvedKind)}.`,
  )

  return {
    issues,
    mode: 'sequence',
    notes,
    resolvedKind,
  }
}

function resolveChunkedExtendedPayloadContext(
  frame: MessageFrame,
  messageType: MessageTypeInfo,
  extendedHeader: ExtendedMessageHeader,
  context: DecodeContext,
): ResolvedExtendedPayloadContext {
  const currentPayloadBytes = frame.bytes.subarray(4)
  const messageTypeName = messageType.name
  const isPrefixDecodable =
    messageTypeName !== null &&
    PREFIX_DECODABLE_CHUNKED_EXTENDED_TYPES.has(messageTypeName)
  const isFullAssembleOnly =
    messageTypeName !== null &&
    FULL_ASSEMBLE_ONLY_CHUNKED_EXTENDED_TYPES.has(messageTypeName)

  if (!extendedHeader.chunked || (!isPrefixDecodable && !isFullAssembleOnly)) {
    return {
      mode: 'single_frame',
      notes: [],
      payloadBytes: currentPayloadBytes,
      rawOnly: false,
    }
  }

  if (extendedHeader.requestChunk) {
    return {
      mode: 'single_frame',
      notes: [
        `${messageTypeName ?? 'Chunked Extended Message'} Request Chunk frame requests chunk ${extendedHeader.chunkNumber}; Data Size is zero and the remaining payload bytes are padding.`,
      ],
      payloadBytes: currentPayloadBytes,
      rawOnly: true,
    }
  }

  if (extendedHeader.chunkNumber === 0) {
    if (isFullAssembleOnly) {
      return {
        mode: 'single_frame',
        notes: [
          `${messageTypeName} remains raw-only until its complete assembled payload is available.`,
        ],
        payloadBytes: currentPayloadBytes,
        rawOnly: true,
      }
    }

    return {
      mode: 'single_frame',
      notes: [],
      payloadBytes: currentPayloadBytes,
      rawOnly: false,
    }
  }

  const previousChunks = context.chunkedExtendedMessage?.previousChunks ?? []
  if (previousChunks.length === 0) {
    return {
      mode: 'single_frame',
      notes: [
        `${messageTypeName} chunk ${extendedHeader.chunkNumber} requires previous chunk context 0..${extendedHeader.chunkNumber - 1}; showing current chunk raw bytes only.`,
      ],
      payloadBytes: currentPayloadBytes,
      rawOnly: true,
    }
  }

  const notes: string[] = []
  if (previousChunks.length !== extendedHeader.chunkNumber) {
    notes.push(
      `Provided chunked Extended context was ignored because ${messageTypeName} chunk ${extendedHeader.chunkNumber} requires ${extendedHeader.chunkNumber} previous chunk(s), but ${previousChunks.length} were supplied.`,
    )

    return {
      mode: 'sequence',
      notes,
      payloadBytes: currentPayloadBytes,
      rawOnly: true,
    }
  }

  const payloadParts: Uint8Array[] = []
  for (
    let expectedChunkNumber = 0;
    expectedChunkNumber < previousChunks.length;
    expectedChunkNumber += 1
  ) {
    const parsed = parseChunkedExtendedFrame(
      normalizeContextMessage(previousChunks[expectedChunkNumber]!),
    )
    if (parsed === null) {
      notes.push(
        `Provided chunked Extended context was ignored because previous chunk ${expectedChunkNumber} is shorter than the required Extended Message framing.`,
      )

      return {
        mode: 'sequence',
        notes,
        payloadBytes: currentPayloadBytes,
        rawOnly: true,
      }
    }

    if (parsed.frame.sop !== frame.sop) {
      notes.push(
        `Provided chunked Extended context was ignored because previous chunk ${expectedChunkNumber} uses SOP ${parsed.frame.sop}, expected ${frame.sop}.`,
      )

      return {
        mode: 'sequence',
        notes,
        payloadBytes: currentPayloadBytes,
        rawOnly: true,
      }
    }

    if (parsed.messageType.name !== messageTypeName) {
      notes.push(
        `Provided chunked Extended context was ignored because previous chunk ${expectedChunkNumber} is ${parsed.messageType.name ?? parsed.messageType.category}, expected ${messageTypeName ?? messageType.category}.`,
      )

      return {
        mode: 'sequence',
        notes,
        payloadBytes: currentPayloadBytes,
        rawOnly: true,
      }
    }

    if (!parsed.extendedHeader.chunked || parsed.extendedHeader.requestChunk) {
      notes.push(
        `Provided chunked Extended context was ignored because previous chunk ${expectedChunkNumber} is not a non-request chunked Extended Message data chunk.`,
      )

      return {
        mode: 'sequence',
        notes,
        payloadBytes: currentPayloadBytes,
        rawOnly: true,
      }
    }

    if (parsed.extendedHeader.chunkNumber !== expectedChunkNumber) {
      notes.push(
        `Provided chunked Extended context was ignored because previous chunk ${expectedChunkNumber} declares Chunk Number ${parsed.extendedHeader.chunkNumber}.`,
      )

      return {
        mode: 'sequence',
        notes,
        payloadBytes: currentPayloadBytes,
        rawOnly: true,
      }
    }

    if (parsed.extendedHeader.dataSize !== extendedHeader.dataSize) {
      notes.push(
        `Provided chunked Extended context was ignored because previous chunk ${expectedChunkNumber} declares Data Size ${parsed.extendedHeader.dataSize}, expected ${extendedHeader.dataSize}.`,
      )

      return {
        mode: 'sequence',
        notes,
        payloadBytes: currentPayloadBytes,
        rawOnly: true,
      }
    }

    payloadParts.push(parsed.payloadBytes)
  }

  payloadParts.push(currentPayloadBytes)
  const assembledPayloadBytes = concatPayloadBytes(payloadParts).subarray(
    0,
    extendedHeader.dataSize,
  )

  if (isPrefixDecodable) {
    notes.push(
      `Assembled ${messageTypeName} payload prefix from chunks 0..${extendedHeader.chunkNumber}; decoding complete PDO-sized units only.`,
    )

    return {
      mode: 'sequence',
      notes,
      payloadBytes: assembledPayloadBytes,
      rawOnly: false,
    }
  }

  if (assembledPayloadBytes.length < extendedHeader.dataSize) {
    notes.push(
      `Assembled ${messageTypeName} payload prefix from chunks 0..${extendedHeader.chunkNumber}; semantic decode is deferred until all ${extendedHeader.dataSize} data byte(s) are available.`,
    )
  } else {
    notes.push(
      `Complete assembled ${messageTypeName} payload is available, but dedicated semantic decode is not implemented yet; showing raw data block bytes.`,
    )
  }

  return {
    mode: 'sequence',
    notes,
    payloadBytes: assembledPayloadBytes,
    rawOnly: true,
  }
}

export function decodeMessage(
  frame: MessageFrame,
  context: DecodeContext = {},
): DecodedMessage {
  const issues: DecodeIssue[] = []
  const sections: Section[] = []

  if (frame.bytes.length < 2) {
    issues.push({
      severity: 'error',
      code: 'PD_SHORT_FRAME',
      message: 'PD frame is shorter than the 2-byte Message Header.',
    })

    return {
      frame,
      category: 'unknown',
      messageType: {
        category: 'unknown',
        code: null,
        name: null,
      },
      header: null,
      extendedHeader: null,
      explainContext: {
        mode: 'single_frame',
        notes: [],
      },
      sections,
      issues,
    }
  }

  const header = decodeMessageHeader(frame)
  const messageType = buildMessageTypeInfo(header)
  const requestRdoContext = resolveRequestRdoKindFromContext(
    frame,
    messageType,
    context,
  )
  issues.push(...requestRdoContext.issues)

  sections.push(explainMessageHeader(header, frame))

  if (header.extended) {
    if (frame.bytes.length < 4) {
      issues.push({
        severity: 'error',
        code: 'PD_SHORT_EXTENDED_FRAME',
        message:
          'Extended Message is shorter than the required 4-byte headers.',
      })

      return {
        frame,
        category: header.category,
        messageType,
        header,
        extendedHeader: null,
        explainContext: {
          mode: requestRdoContext.mode,
          notes: requestRdoContext.notes,
        },
        sections,
        issues,
      }
    }

    const extendedHeaderBytes = frame.bytes.slice(2, 4)
    const extendedHeader = decodeExtendedMessageHeader(extendedHeaderBytes)
    sections.push(
      explainExtendedMessageHeader(extendedHeader, extendedHeaderBytes),
    )

    const extendedPayloadContext = resolveChunkedExtendedPayloadContext(
      frame,
      messageType,
      extendedHeader,
      context,
    )
    const payloadBytes = extendedPayloadContext.payloadBytes
    const explainMode: ExplainMode =
      requestRdoContext.mode === 'sequence' ||
      extendedPayloadContext.mode === 'sequence'
        ? 'sequence'
        : 'single_frame'
    const explainNotes = [
      ...requestRdoContext.notes,
      ...extendedPayloadContext.notes,
    ]

    if (payloadBytes.length > 0) {
      sections.push(
        ...explainExtendedDataBlocks(
          payloadBytes,
          messageType,
          extendedHeader,
          frame.sop,
          'extended-message-payload',
          4,
          {
            rawOnly: extendedPayloadContext.rawOnly,
          },
        ),
      )
    }

    return {
      frame,
      category: header.category,
      messageType,
      header,
      extendedHeader,
      explainContext: {
        mode: explainMode,
        notes: explainNotes,
      },
      sections,
      issues,
    }
  }

  const payloadBytes = frame.bytes.slice(2)
  const expectedPayloadBytes = header.numberOfDataObjects * 4

  if (payloadBytes.length !== expectedPayloadBytes) {
    issues.push({
      severity: 'warning',
      code: 'PD_OBJECT_COUNT_LENGTH_MISMATCH',
      message: `Message Header indicates ${expectedPayloadBytes} payload bytes, but frame has ${payloadBytes.length}.`,
    })
  }

  if (payloadBytes.length > 0) {
    sections.push(
      ...explainDataObjects(
        payloadBytes,
        frame.sop,
        messageType,
        'data-message-payload',
        2,
        {
          requestRdoKind: requestRdoContext.resolvedKind,
        },
      ),
    )
  }

  return {
    frame,
    category: header.category,
    messageType,
    header,
    extendedHeader: null,
    explainContext: {
      mode: requestRdoContext.mode,
      notes: requestRdoContext.notes,
    },
    sections,
    issues,
  }
}

export function decodePacket(
  packet: MessagePacket,
  context: DecodeContext = {},
): DecodedPacket {
  const split = splitMessagePacket(packet)
  const decodedMessage = decodeMessage(split.message, context)
  const issues = [...decodedMessage.issues]
  const sections = [...decodedMessage.sections]

  if (packet.bytes.length < 6) {
    issues.push({
      severity: 'error',
      code: 'PD_PACKET_TOO_SHORT',
      message:
        'PD packet is shorter than 6 bytes, so it cannot contain both a 2-byte Message Header and a 4-byte CRC32.',
    })
  }

  if (split.crc.checkStatus === 'invalid') {
    issues.push({
      severity: 'error',
      code: 'PD_CRC32_INVALID',
      message:
        split.crc.expectedRaw32 === null
          ? 'CRC32 does not match the message bytes.'
          : `CRC32 does not match the message bytes. Expected ${formatCrc32(split.crc.expectedRaw32)}.`,
    })
  }

  if (
    split.packetLayout.expectedMessageByteLength !== null &&
    split.packetLayout.actualMessageByteLength !==
      split.packetLayout.expectedMessageByteLength
  ) {
    issues.push({
      severity: 'warning',
      code: 'PD_MESSAGE_LENGTH_MISMATCH',
      message: `Message Header indicates ${split.packetLayout.expectedMessageByteLength} message byte(s), but packet includes ${split.packetLayout.actualMessageByteLength} byte(s) before CRC32.`,
    })
  }

  sections.push(buildCrcSection(split.packetLayout, split.crc))

  return {
    ...decodedMessage,
    packet,
    packetLayout: split.packetLayout,
    crc: split.crc,
    sections,
    issues,
  }
}
