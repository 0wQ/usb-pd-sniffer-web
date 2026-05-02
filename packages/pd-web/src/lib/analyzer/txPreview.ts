import { decodeMessage, type DecodedMessage, type MessageFrame } from '@usb-pd-sniffer/pd-core'
import { parsePdHexPayload, type MonitorPdTxTarget } from '@usb-pd-sniffer/pd-device-native-hid'

export { parsePdHexPayload } from '@usb-pd-sniffer/pd-device-native-hid'

export function hasPdTxPayloadNewline(hexPayload: string): boolean {
  return /[\r\n]/.test(hexPayload)
}

export function splitPdTxPayloadLines(hexPayload: string): string[] {
  return hexPayload
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function sopForTarget(target: MonitorPdTxTarget): MessageFrame['sop'] {
  switch (target) {
    case 'SOP':
      return 'SOP'
    case 'SOP_PRIME':
      return 'SOP_PRIME'
    case 'SOP_DPRIME':
      return 'SOP_DPRIME'
  }
}

export function previewPdTxFrame(target: MonitorPdTxTarget, hexPayload: string): {
  frame: MessageFrame
  decoded: DecodedMessage
} {
  const payload = parsePdHexPayload(hexPayload)
  const frame: MessageFrame = {
    sop: sopForTarget(target),
    bytes: payload,
  }

  return {
    frame,
    decoded: decodeMessage(frame),
  }
}
