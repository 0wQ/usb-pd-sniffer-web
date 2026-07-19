import {
  type DecodedPacket,
  decodePacket,
  type MessagePacket,
} from '@usb-pd-sniffer/pd-core'
import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { CAPTURE_EVENT } from '@usb-pd-sniffer/pd-device-types'

export function recordToMessagePacket(
  record: CaptureRecord,
): MessagePacket | null {
  const packetBytes = Uint8Array.from(record.data.slice(0, record.data_len))

  switch (record.event_type) {
    case CAPTURE_EVENT.PD_SOP0:
      return { sop: 'SOP', packetBytes }
    case CAPTURE_EVENT.PD_SOP1:
      return { sop: 'SOP_PRIME', packetBytes }
    case CAPTURE_EVENT.PD_SOP2:
      return { sop: 'SOP_DPRIME', packetBytes }
    case CAPTURE_EVENT.PD_SOP1_DEBUG:
      return { sop: 'SOP_PRIME_DEBUG', packetBytes }
    case CAPTURE_EVENT.PD_SOP2_DEBUG:
      return { sop: 'SOP_DPRIME_DEBUG', packetBytes }
    default:
      return null
  }
}

export function decodeSingleRecord(
  record: CaptureRecord,
): DecodedPacket | null {
  const packet = recordToMessagePacket(record)
  return packet === null ? null : decodePacket(packet)
}

type CaptureRecordSource = {
  get(index: number): CaptureRecord | undefined
  readonly length: number
}

function getRecordAt(
  records: readonly CaptureRecord[] | CaptureRecordSource,
  index: number,
): CaptureRecord | undefined {
  if ('get' in records) {
    return records.get(index)
  }

  return records[index]
}

type ContextLookupResult<T> = {
  value: T | undefined
  scannedRecords: number
}

export type DecodeRecordAtIndexResult = {
  decoded: DecodedPacket
  contextBacktrackUsed: number
}

function needsSourceCapabilitiesContext(decoded: DecodedPacket): boolean {
  return decoded.messageType.name === 'Request'
}

function isSoftResetForTargetSop(
  decoded: DecodedPacket,
  targetSop: MessagePacket['sop'],
): boolean {
  return (
    decoded.messageType.name === 'Soft_Reset' && decoded.frame.sop === targetSop
  )
}

function findPreviousChunkedExtendedPackets(
  records: readonly CaptureRecord[] | CaptureRecordSource,
  targetIndex: number,
  startIndex: number,
  targetDecoded: DecodedPacket,
): ContextLookupResult<MessagePacket[]> {
  const extendedHeader = targetDecoded.extendedHeader
  if (
    extendedHeader === null ||
    !extendedHeader.chunked ||
    extendedHeader.requestChunk ||
    extendedHeader.chunkNumber === 0
  ) {
    return { value: undefined, scannedRecords: 0 }
  }

  const previousChunks = new Array<MessagePacket | undefined>(
    extendedHeader.chunkNumber,
  )
  let scannedRecords = 0

  for (let index = targetIndex - 1; index >= startIndex; index -= 1) {
    scannedRecords = targetIndex - index
    const record = getRecordAt(records, index)

    if (
      record?.event_type === CAPTURE_EVENT.PD_HARD_RESET ||
      record?.event_type === CAPTURE_EVENT.PD_CABLE_RESET
    ) {
      break
    }

    if (record === undefined) {
      continue
    }

    const packet = recordToMessagePacket(record)
    if (packet === null) {
      continue
    }

    const decoded = decodePacket(packet)
    if (isSoftResetForTargetSop(decoded, targetDecoded.frame.sop)) {
      break
    }
    const candidateExtendedHeader = decoded.extendedHeader
    if (
      decoded.frame.sop !== targetDecoded.frame.sop ||
      decoded.messageType.name !== targetDecoded.messageType.name ||
      candidateExtendedHeader === null ||
      !candidateExtendedHeader.chunked ||
      candidateExtendedHeader.requestChunk ||
      candidateExtendedHeader.dataSize !== extendedHeader.dataSize
    ) {
      continue
    }

    const chunkNumber = candidateExtendedHeader.chunkNumber
    if (
      chunkNumber >= extendedHeader.chunkNumber ||
      previousChunks[chunkNumber] !== undefined
    ) {
      continue
    }

    previousChunks[chunkNumber] = packet

    if (previousChunks.every((chunk) => chunk !== undefined)) {
      return { value: previousChunks as MessagePacket[], scannedRecords }
    }
  }

  return { value: undefined, scannedRecords }
}

function findNearestSourceCapabilitiesFrame(
  records: readonly CaptureRecord[] | CaptureRecordSource,
  targetIndex: number,
  startIndex: number,
  targetSop: MessagePacket['sop'],
): ContextLookupResult<MessagePacket> {
  let scannedRecords = 0

  for (let index = targetIndex - 1; index >= startIndex; index -= 1) {
    scannedRecords = targetIndex - index
    const record = getRecordAt(records, index)

    if (
      record?.event_type === CAPTURE_EVENT.PD_HARD_RESET ||
      record?.event_type === CAPTURE_EVENT.PD_CABLE_RESET
    ) {
      break
    }

    if (record === undefined) {
      continue
    }

    const packet = recordToMessagePacket(record)
    if (packet === null) {
      continue
    }

    const decoded = decodePacket(packet)
    if (isSoftResetForTargetSop(decoded, targetSop)) {
      break
    }
    if (decoded.messageType.name === 'Source_Capabilities') {
      return { value: packet, scannedRecords }
    }
  }

  return { value: undefined, scannedRecords }
}

export function decodeRecordAtIndex(
  records: readonly CaptureRecord[] | CaptureRecordSource,
  targetIndex: number,
  backtrackRecords: number | null = null,
): DecodeRecordAtIndexResult | null {
  if (targetIndex < 0 || targetIndex >= records.length) {
    return null
  }

  const targetRecord = getRecordAt(records, targetIndex)
  if (targetRecord === undefined) {
    return null
  }

  const packet = recordToMessagePacket(targetRecord)
  if (packet === null) {
    return null
  }

  const singleFrameDecoded = decodePacket(packet)

  const startIndex =
    backtrackRecords === null ? 0 : Math.max(0, targetIndex - backtrackRecords)
  const sourceCapabilities = needsSourceCapabilitiesContext(singleFrameDecoded)
    ? findNearestSourceCapabilitiesFrame(
        records,
        targetIndex,
        startIndex,
        singleFrameDecoded.frame.sop,
      )
    : { value: undefined, scannedRecords: 0 }
  const previousChunkedExtendedPackets = findPreviousChunkedExtendedPackets(
    records,
    targetIndex,
    startIndex,
    singleFrameDecoded,
  )

  return {
    decoded: decodePacket(packet, {
      sourceCapabilities:
        sourceCapabilities.value === undefined
          ? undefined
          : {
              kind: 'packet',
              packet: sourceCapabilities.value,
            },
      chunkedExtendedMessage:
        previousChunkedExtendedPackets.value === undefined
          ? undefined
          : {
              previousChunks: previousChunkedExtendedPackets.value.map(
                (previousPacket) => ({
                  kind: 'packet' as const,
                  packet: previousPacket,
                }),
              ),
            },
    }),
    contextBacktrackUsed: Math.max(
      sourceCapabilities.scannedRecords,
      previousChunkedExtendedPackets.scannedRecords,
    ),
  }
}
