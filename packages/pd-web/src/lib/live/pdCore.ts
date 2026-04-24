import {
  decodePacket,
  type DecodedPacket,
  type MessagePacket,
} from '@usb-pd-sniffer/pd-core'
import {
  MONITOR_EVENT,
  isPdMonitorEvent,
  monitorEventName,
  toPdObservedFrameFromMonitorEvent,
  type FirmwareMeta,
  type MonitorSnapshot,
} from '@usb-pd-sniffer/pd-monitor'
import type { CaptureRecord } from '@/types/pd'

export {
  MONITOR_EVENT,
  isPdMonitorEvent,
  monitorEventName,
}
export type {
  FirmwareMeta,
  MonitorSnapshot,
}

export function reportToObservedFrame(report: CaptureRecord) {
  const rawPayload = Uint8Array.from(report.data.slice(0, report.data_len))
  return toPdObservedFrameFromMonitorEvent({
    eventType: report.event_type,
    payload: rawPayload,
  })
}

export function decodeSingleReport(report: CaptureRecord): DecodedPacket | null {
  const packet = reportToObservedFrame(report)
  return packet === null ? null : decodePacket(packet)
}

function findPreviousChunkedExtendedPackets(
  reports: readonly CaptureRecord[],
  targetIndex: number,
  startIndex: number,
  targetDecoded: DecodedPacket,
): MessagePacket[] | undefined {
  const extendedHeader = targetDecoded.extendedHeader
  if (
    extendedHeader === null ||
    !extendedHeader.chunked ||
    extendedHeader.requestChunk ||
    extendedHeader.chunkNumber === 0
  ) {
    return undefined
  }

  const previousChunks = new Array<MessagePacket | undefined>(extendedHeader.chunkNumber)

  for (let index = targetIndex - 1; index >= startIndex; index -= 1) {
    if (
      reports[index]?.event_type === MONITOR_EVENT.HARD_RESET ||
      reports[index]?.event_type === MONITOR_EVENT.CABLE_RESET
    ) {
      break
    }

    const packet = reportToObservedFrame(reports[index])
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
      return previousChunks as MessagePacket[]
    }
  }

  return undefined
}

function findNearestSourceCapabilitiesFrame(
  reports: readonly CaptureRecord[],
  targetIndex: number,
  startIndex: number,
): MessagePacket | undefined {
  for (let index = targetIndex - 1; index >= startIndex; index -= 1) {
    if (
      reports[index]?.event_type === MONITOR_EVENT.HARD_RESET ||
      reports[index]?.event_type === MONITOR_EVENT.CABLE_RESET
    ) {
      break
    }

    const packet = reportToObservedFrame(reports[index])
    if (packet === null) {
      continue
    }

    const decoded = decodePacket(packet)
    if (decoded.messageType.name === 'Source_Capabilities') {
      return packet
    }
  }

  return undefined
}

export function decodeReportAtIndex(
  reports: readonly CaptureRecord[],
  targetIndex: number,
  backtrackRecords: number | null = null
): DecodedPacket | null {
  if (targetIndex < 0 || targetIndex >= reports.length) {
    return null
  }

  const packet = reportToObservedFrame(reports[targetIndex])
  if (packet === null) {
    return null
  }

  const singleFrameDecoded = decodePacket(packet)

  const startIndex = backtrackRecords === null
    ? 0
    : Math.max(0, targetIndex - backtrackRecords)
  const sourceCapabilities = findNearestSourceCapabilitiesFrame(reports, targetIndex, startIndex)
  const previousChunkedExtendedPackets = findPreviousChunkedExtendedPackets(
    reports,
    targetIndex,
    startIndex,
    singleFrameDecoded,
  )

  return decodePacket(packet, {
    sourceCapabilities: sourceCapabilities === undefined
      ? undefined
      : {
          kind: 'packet',
          packet: sourceCapabilities,
        },
    chunkedExtendedMessage: previousChunkedExtendedPackets === undefined
      ? undefined
      : {
          previousChunks: previousChunkedExtendedPackets.map((previousPacket) => ({
            kind: 'packet' as const,
            packet: previousPacket,
          })),
        },
  })
}
