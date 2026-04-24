import { decodeMessage, type DecodedMessage, type MessageFrame } from '@usb-pd-sniffer/pd-core'
import { parsePdHexPayload } from '@usb-pd-sniffer/pd-monitor'

export { parsePdHexPayload } from '@usb-pd-sniffer/pd-monitor'

export type WebPdTxTarget = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'

function sopForTarget(target: WebPdTxTarget): MessageFrame['sop'] {
  switch (target) {
    case 'SOP':
      return 'SOP'
    case 'SOP_PRIME':
      return 'SOP_PRIME'
    case 'SOP_DPRIME':
      return 'SOP_DPRIME'
  }
}

export function previewPdTxFrame(target: WebPdTxTarget, hexPayload: string): {
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
