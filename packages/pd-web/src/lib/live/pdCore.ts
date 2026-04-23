import {
  createSequenceDecoder,
  decodeMessage,
  type DecodedMessage,
} from '@usb-pd-sniffer/pd-core'
import {
  MONITOR_EVENT,
  isPdMonitorEvent,
  monitorEventName,
  toPdObservedFrameFromMonitorEvent,
  type FirmwareMeta,
  type MonitorSnapshot,
} from '@usb-pd-sniffer/pd-monitor'
import type { PDReport } from '@/types/pd'

export {
  MONITOR_EVENT,
  isPdMonitorEvent,
  monitorEventName,
}
export type {
  FirmwareMeta,
  MonitorSnapshot,
}

export function reportToObservedFrame(report: PDReport) {
  const rawPayload = Uint8Array.from(report.pd_raw)
  return toPdObservedFrameFromMonitorEvent({
    eventType: report.event_type,
    payload: rawPayload,
  })
}

export function decodeSingleReport(report: PDReport): DecodedMessage | null {
  const frame = reportToObservedFrame(report)
  return frame === null ? null : decodeMessage(frame)
}

export function decodeReportAtIndex(
  reports: readonly PDReport[],
  targetIndex: number,
  backtrackRecords: number | null = null
): DecodedMessage | null {
  if (targetIndex < 0 || targetIndex >= reports.length) {
    return null
  }

  const decoder = createSequenceDecoder()
  let decoded: DecodedMessage | null = null
  const startIndex = backtrackRecords === null
    ? 0
    : Math.max(0, targetIndex - backtrackRecords)

  for (let index = startIndex; index <= targetIndex; index += 1) {
    const frame = reportToObservedFrame(reports[index])
    if (frame === null) {
      continue
    }

    const next = decoder.push(frame)
    if (index === targetIndex) {
      decoded = next
    }
  }

  return decoded
}
