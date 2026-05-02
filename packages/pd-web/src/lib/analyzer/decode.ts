import {
  decodePacket,
  type DecodedPacket,
  type MessagePacket,
} from '@usb-pd-sniffer/pd-core'
import {
  MONITOR_EVENT,
  toPdObservedFrameFromMonitorEvent,
} from '@usb-pd-sniffer/pd-device-native-hid'
import type { CaptureRecord } from '@/types/pd'

export function recordToMessagePacket(record: CaptureRecord) {
  const rawPayload = Uint8Array.from(record.data.slice(0, record.data_len))
  return toPdObservedFrameFromMonitorEvent({
    eventType: record.event_type,
    payload: rawPayload,
  })
}

export function decodeSingleRecord(record: CaptureRecord): DecodedPacket | null {
  const packet = recordToMessagePacket(record)
  return packet === null ? null : decodePacket(packet)
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

function findPreviousChunkedExtendedPackets(
  records: readonly CaptureRecord[],
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

  const previousChunks = new Array<MessagePacket | undefined>(extendedHeader.chunkNumber)
  let scannedRecords = 0

  for (let index = targetIndex - 1; index >= startIndex; index -= 1) {
    scannedRecords = targetIndex - index

    if (
      records[index]?.event_type === MONITOR_EVENT.HARD_RESET ||
      records[index]?.event_type === MONITOR_EVENT.CABLE_RESET
    ) {
      break
    }

    const packet = recordToMessagePacket(records[index])
    if (packet === null) {
      continue
    }

    const decoded = decodePacket(packet)
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
    if (chunkNumber >= extendedHeader.chunkNumber || previousChunks[chunkNumber] !== undefined) {
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
  records: readonly CaptureRecord[],
  targetIndex: number,
  startIndex: number,
): ContextLookupResult<MessagePacket> {
  let scannedRecords = 0

  for (let index = targetIndex - 1; index >= startIndex; index -= 1) {
    scannedRecords = targetIndex - index

    if (
      records[index]?.event_type === MONITOR_EVENT.HARD_RESET ||
      records[index]?.event_type === MONITOR_EVENT.CABLE_RESET
    ) {
      break
    }

    const packet = recordToMessagePacket(records[index])
    if (packet === null) {
      continue
    }

    const decoded = decodePacket(packet)
    if (decoded.messageType.name === 'Source_Capabilities') {
      return { value: packet, scannedRecords }
    }
  }

  return { value: undefined, scannedRecords }
}

export function decodeRecordAtIndex(
  records: readonly CaptureRecord[],
  targetIndex: number,
  backtrackRecords: number | null = null
): DecodeRecordAtIndexResult | null {
  if (targetIndex < 0 || targetIndex >= records.length) {
    return null
  }

  const packet = recordToMessagePacket(records[targetIndex])
  if (packet === null) {
    return null
  }

  const singleFrameDecoded = decodePacket(packet)

  const startIndex = backtrackRecords === null
    ? 0
    : Math.max(0, targetIndex - backtrackRecords)
  const sourceCapabilities = needsSourceCapabilitiesContext(singleFrameDecoded)
    ? findNearestSourceCapabilitiesFrame(records, targetIndex, startIndex)
    : { value: undefined, scannedRecords: 0 }
  const previousChunkedExtendedPackets = findPreviousChunkedExtendedPackets(
    records,
    targetIndex,
    startIndex,
    singleFrameDecoded,
  )

  return {
    decoded: decodePacket(packet, {
      sourceCapabilities: sourceCapabilities.value === undefined
      ? undefined
      : {
          kind: 'packet',
          packet: sourceCapabilities.value,
        },
      chunkedExtendedMessage: previousChunkedExtendedPackets.value === undefined
      ? undefined
      : {
          previousChunks: previousChunkedExtendedPackets.value.map((previousPacket) => ({
            kind: 'packet' as const,
            packet: previousPacket,
          })),
        },
    }),
    contextBacktrackUsed: Math.max(
      sourceCapabilities.scannedRecords,
      previousChunkedExtendedPackets.scannedRecords,
    ),
  }
}
