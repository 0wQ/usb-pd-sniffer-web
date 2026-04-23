import { decodeMessage, type DecodedMessage, type MessageFrame } from '@usb-pd-sniffer/pd-core'
import {
  encodeNativeMonitorTxCommandBody,
  MONITOR_TX_CMD,
  NATIVE_HID_OUT_REPORT_ID,
  type NativeMonitorTxCommand,
} from '@usb-pd-sniffer/pd-monitor'

export type WebPdTxTarget = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'

function opcodeForTarget(target: WebPdTxTarget): typeof MONITOR_TX_CMD.SEND_RAW_SOP0 | typeof MONITOR_TX_CMD.SEND_RAW_SOP1 | typeof MONITOR_TX_CMD.SEND_RAW_SOP2 {
  switch (target) {
    case 'SOP':
      return MONITOR_TX_CMD.SEND_RAW_SOP0
    case 'SOP_PRIME':
      return MONITOR_TX_CMD.SEND_RAW_SOP1
    case 'SOP_DPRIME':
      return MONITOR_TX_CMD.SEND_RAW_SOP2
  }
}

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

export function parsePdHexPayload(input: string): Uint8Array {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new Error('Raw PD payload is required.')
  }

  const compact = trimmed
    .replace(/0x/gi, '')
    .replace(/[\s,_-]+/g, '')

  if (compact.length === 0) {
    throw new Error('Raw PD payload is required.')
  }

  if (compact.length % 2 !== 0) {
    throw new Error(`Raw PD payload hex length must be even, got ${compact.length}.`)
  }

  if (!/^[0-9a-f]+$/i.test(compact)) {
    throw new Error('Raw PD payload contains non-hex characters.')
  }

  const bytes = new Uint8Array(compact.length / 2)
  for (let index = 0; index < compact.length; index += 2) {
    bytes[index / 2] = Number.parseInt(compact.slice(index, index + 2), 16)
  }

  return bytes
}

export function buildRawPdTxCommand(target: WebPdTxTarget, hexPayload: string): NativeMonitorTxCommand {
  return {
    opcode: opcodeForTarget(target),
    payload: parsePdHexPayload(hexPayload),
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

export async function sendNativeMonitorCommand(
  device: HIDDevice,
  command: NativeMonitorTxCommand,
): Promise<void> {
  if (!device.opened) {
    throw new Error('HID device is not open.')
  }

  const body = encodeNativeMonitorTxCommandBody(command)
  await device.sendReport(NATIVE_HID_OUT_REPORT_ID, new Uint8Array(body))
}
