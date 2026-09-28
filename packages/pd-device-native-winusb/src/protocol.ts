import {
  CAPTURE_EVENT,
  type CaptureEventType,
} from '@usb-pd-sniffer/pd-device-types'

export type Snapshot = {
  vbusMv: number
  ibusUa: number
  cc1Mv: number
  cc2Mv: number
  dpMv: number
  dmMv: number
}

export type FirmwareMeta = {
  recvCount: number
  pdActiveCc: 0 | 1 | 2
  snapshot: Snapshot
  rawEventType: number
  rawPayload: Uint8Array
  sopDebug?: boolean
}

export type PdFrameInput = {
  eventType: number
  payload: Uint8Array
}

export type PdSop =
  | 'SOP'
  | 'SOP_PRIME'
  | 'SOP_DPRIME'
  | 'SOP_PRIME_DEBUG'
  | 'SOP_DPRIME_DEBUG'

export type PdFrame = {
  sop: PdSop
  bytes: Uint8Array
}

export const NATIVE_WINUSB_EVENT = {
  DISCONNECT: 0,
  CC1_CONNECT: 1,
  CC2_CONNECT: 2,
  PD_SOP0: 20,
  PD_SOP1: 21,
  PD_SOP2: 22,
  PD_SOP1_DEBUG: 23,
  PD_SOP2_DEBUG: 24,
  PD_HARD_RESET: 25,
  PD_CABLE_RESET: 26,
  PD_ERROR: 30,
  UFCS_DP: 40,
  UFCS_DM: 41,
} as const

export const NATIVE_WINUSB_REPORT_BODY_SIZE = 64
export const NATIVE_WINUSB_PAYLOAD_MAX_LEN = 34
export const NATIVE_PD_TX_MESSAGE_MIN_LEN = 2
export const NATIVE_PD_TX_MESSAGE_MAX_LEN = 30
export const NATIVE_TX_PAYLOAD_MAX_LEN = 62
export const NATIVE_WINUSB_REPORT_TYPE = {
  EVENT: 0x01,
  STATUS: 0x02,
} as const

export const NATIVE_WINUSB_TX_CMD = {
  SEND_RAW_SOP0: 0x01,
  SEND_RAW_SOP1: 0x02,
  SEND_RAW_SOP2: 0x03,
  SEND_HARD_RESET: 0x04,
  SEND_CABLE_RESET: 0x05,
  SET_CC_PULL: 0x10,
  GET_STATUS: 0x20,
} as const

export type ActiveCCMode = 'auto' | 'cc1' | 'cc2'

// Mirrors bsp_pd_cc_pull_t in the firmware. Rp values follow USB Type-C spec
// Table 4-27 "Source CC Termination (Rp) Requirements": Default USB Power is
// the 80 uA source, 1.5 A @ 5 V is 180 uA and 3.0 A @ 5 V is 330 uA.
export const NATIVE_WINUSB_CC_PULL = {
  OPEN: 0x00,
  RD: 0x01,
  RA: 0x02,
  RP_DEFAULT_USB: 0x03,
  RP_1P5A: 0x04,
  RP_3A: 0x05,
} as const

export type CCPull =
  | 'open'
  | 'rd'
  | 'ra'
  | 'rp-default-usb'
  | 'rp-1p5a'
  | 'rp-3a'

export type CCPullConfig = {
  activeCC: ActiveCCMode
  cc1: CCPull
  cc2: CCPull
}

export type NativeWinusbTxOpcode =
  (typeof NATIVE_WINUSB_TX_CMD)[keyof typeof NATIVE_WINUSB_TX_CMD]

export type NativeWinusbTxCommand =
  | {
      opcode:
        | typeof NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP0
        | typeof NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP1
        | typeof NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP2
      payload: Uint8Array
    }
  | {
      opcode:
        | typeof NATIVE_WINUSB_TX_CMD.SEND_HARD_RESET
        | typeof NATIVE_WINUSB_TX_CMD.SEND_CABLE_RESET
      payload?: Uint8Array | null
    }
  | {
      opcode: typeof NATIVE_WINUSB_TX_CMD.SET_CC_PULL
      activeCC: ActiveCCMode
      cc1: CCPull
      cc2: CCPull
      payload?: Uint8Array | null
    }
  | {
      opcode: typeof NATIVE_WINUSB_TX_CMD.GET_STATUS
      payload?: Uint8Array | null
    }

export type NativeWinusbEventReport = {
  reportType: typeof NATIVE_WINUSB_REPORT_TYPE.EVENT
  timestampUs: number
  recvCount: number
  snapshot: Snapshot
  eventType: number
  activeCC: number
  payloadLen: number
  payload: Uint8Array
}

export type NativeWinusbStatusReport = {
  reportType: typeof NATIVE_WINUSB_REPORT_TYPE.STATUS
  statusType: number
  timestampUs: number
  recvCount: number
  snapshot: Snapshot
  activeCC: number
  payloadLen: number
  dropCount: number
}

export type NativeWinusbReport =
  | NativeWinusbEventReport
  | NativeWinusbStatusReport

function getU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function getI32LE(bytes: Uint8Array, offset: number): number {
  const value = getU32LE(bytes, offset)
  return value > 0x7fffffff ? value - 0x100000000 : value
}

function getU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function ccPullToByte(pull: CCPull): number {
  switch (pull) {
    case 'open':
      return NATIVE_WINUSB_CC_PULL.OPEN
    case 'rd':
      return NATIVE_WINUSB_CC_PULL.RD
    case 'ra':
      return NATIVE_WINUSB_CC_PULL.RA
    case 'rp-default-usb':
      return NATIVE_WINUSB_CC_PULL.RP_DEFAULT_USB
    case 'rp-1p5a':
      return NATIVE_WINUSB_CC_PULL.RP_1P5A
    case 'rp-3a':
      return NATIVE_WINUSB_CC_PULL.RP_3A
  }
}

function activeCCModeToByte(mode: ActiveCCMode): number {
  switch (mode) {
    case 'auto':
      return 0
    case 'cc1':
      return 1
    case 'cc2':
      return 2
  }
}

function isPdSopFrameEvent(eventType: number): boolean {
  return (
    eventType === NATIVE_WINUSB_EVENT.PD_SOP0 ||
    eventType === NATIVE_WINUSB_EVENT.PD_SOP1 ||
    eventType === NATIVE_WINUSB_EVENT.PD_SOP2 ||
    eventType === NATIVE_WINUSB_EVENT.PD_SOP1_DEBUG ||
    eventType === NATIVE_WINUSB_EVENT.PD_SOP2_DEBUG
  )
}

function isPdResetOrErrorEvent(eventType: number): boolean {
  return (
    eventType === NATIVE_WINUSB_EVENT.PD_HARD_RESET ||
    eventType === NATIVE_WINUSB_EVENT.PD_CABLE_RESET ||
    eventType === NATIVE_WINUSB_EVENT.PD_ERROR
  )
}

export function isUfcsNativeWinusbEvent(eventType: number): boolean {
  return (
    eventType === NATIVE_WINUSB_EVENT.UFCS_DP ||
    eventType === NATIVE_WINUSB_EVENT.UFCS_DM
  )
}

export function nativeWinusbEventName(eventType: number): string {
  switch (eventType) {
    case NATIVE_WINUSB_EVENT.DISCONNECT:
      return 'DISCONNECT'
    case NATIVE_WINUSB_EVENT.CC1_CONNECT:
      return 'CC1_CONNECT'
    case NATIVE_WINUSB_EVENT.CC2_CONNECT:
      return 'CC2_CONNECT'
    case NATIVE_WINUSB_EVENT.PD_SOP0:
      return 'PD_SOP0'
    case NATIVE_WINUSB_EVENT.PD_SOP1:
      return 'PD_SOP1'
    case NATIVE_WINUSB_EVENT.PD_SOP2:
      return 'PD_SOP2'
    case NATIVE_WINUSB_EVENT.PD_SOP1_DEBUG:
      return 'PD_SOP1_DEBUG'
    case NATIVE_WINUSB_EVENT.PD_SOP2_DEBUG:
      return 'PD_SOP2_DEBUG'
    case NATIVE_WINUSB_EVENT.PD_HARD_RESET:
      return 'PD_HARD_RESET'
    case NATIVE_WINUSB_EVENT.PD_CABLE_RESET:
      return 'PD_CABLE_RESET'
    case NATIVE_WINUSB_EVENT.PD_ERROR:
      return 'PD_ERROR'
    case NATIVE_WINUSB_EVENT.UFCS_DP:
      return 'UFCS_DP'
    case NATIVE_WINUSB_EVENT.UFCS_DM:
      return 'UFCS_DM'
    default:
      return `EVENT_${eventType}`
  }
}

export function nativeWinusbEventToCaptureEvent(
  eventType: number,
): CaptureEventType | null {
  switch (eventType) {
    case NATIVE_WINUSB_EVENT.DISCONNECT:
      return CAPTURE_EVENT.DISCONNECT
    case NATIVE_WINUSB_EVENT.CC1_CONNECT:
      return CAPTURE_EVENT.CC1_CONNECT
    case NATIVE_WINUSB_EVENT.CC2_CONNECT:
      return CAPTURE_EVENT.CC2_CONNECT
    case NATIVE_WINUSB_EVENT.PD_SOP0:
      return CAPTURE_EVENT.PD_SOP0
    case NATIVE_WINUSB_EVENT.PD_SOP1:
      return CAPTURE_EVENT.PD_SOP1
    case NATIVE_WINUSB_EVENT.PD_SOP2:
      return CAPTURE_EVENT.PD_SOP2
    case NATIVE_WINUSB_EVENT.PD_SOP1_DEBUG:
      return CAPTURE_EVENT.PD_SOP1_DEBUG
    case NATIVE_WINUSB_EVENT.PD_SOP2_DEBUG:
      return CAPTURE_EVENT.PD_SOP2_DEBUG
    case NATIVE_WINUSB_EVENT.PD_HARD_RESET:
      return CAPTURE_EVENT.PD_HARD_RESET
    case NATIVE_WINUSB_EVENT.PD_CABLE_RESET:
      return CAPTURE_EVENT.PD_CABLE_RESET
    case NATIVE_WINUSB_EVENT.UFCS_DP:
      return CAPTURE_EVENT.UFCS_DP
    case NATIVE_WINUSB_EVENT.UFCS_DM:
      return CAPTURE_EVENT.UFCS_DM
    default:
      return null
  }
}

export function isPdNativeWinusbEvent(eventType: number): boolean {
  return isPdSopFrameEvent(eventType) || isPdResetOrErrorEvent(eventType)
}

export function nativeWinusbEventSop(eventType: number): PdSop {
  switch (eventType) {
    case NATIVE_WINUSB_EVENT.PD_SOP0:
      return 'SOP'
    case NATIVE_WINUSB_EVENT.PD_SOP1:
      return 'SOP_PRIME'
    case NATIVE_WINUSB_EVENT.PD_SOP1_DEBUG:
      return 'SOP_PRIME_DEBUG'
    case NATIVE_WINUSB_EVENT.PD_SOP2:
      return 'SOP_DPRIME'
    case NATIVE_WINUSB_EVENT.PD_SOP2_DEBUG:
      return 'SOP_DPRIME_DEBUG'
    default:
      throw new Error(
        `Event ${eventType} does not map to a PD Start Of Packet.`,
      )
  }
}

export function normalizePdPayloadForNativeWinusbEvent(
  eventType: number,
  payload: Uint8Array,
): Uint8Array {
  if (!isPdSopFrameEvent(eventType)) {
    return payload
  }

  return payload
}

export function parseNativeWinusbReportBody(
  body: Uint8Array,
): NativeWinusbReport {
  if (body.length !== NATIVE_WINUSB_REPORT_BODY_SIZE) {
    throw new Error(
      `Unexpected native WinUSB input report length ${body.length}; expected ${NATIVE_WINUSB_REPORT_BODY_SIZE}.`,
    )
  }

  const reportType = body[0] ?? 0
  const timestampUsLo = getU32LE(body, 4)
  const timestampUsHi = getU32LE(body, 8)
  const timestampUs = (BigInt(timestampUsHi) << 32n) | BigInt(timestampUsLo)
  const snapshot = {
    vbusMv: getU16LE(body, 16),
    ibusUa: getI32LE(body, 18),
    cc1Mv: getU16LE(body, 22),
    cc2Mv: getU16LE(body, 24),
    dpMv: getU16LE(body, 26),
    dmMv: getU16LE(body, 28),
  }

  if (reportType === NATIVE_WINUSB_REPORT_TYPE.EVENT) {
    const payloadLen = Math.min(body[2] ?? 0, NATIVE_WINUSB_PAYLOAD_MAX_LEN)
    return {
      reportType,
      timestampUs: Number(timestampUs),
      recvCount: getU32LE(body, 12),
      snapshot,
      eventType: body[1] ?? 0,
      activeCC: body[3] ?? 0,
      payloadLen,
      payload: body.slice(30, 30 + payloadLen),
    }
  }

  if (reportType === NATIVE_WINUSB_REPORT_TYPE.STATUS) {
    return {
      reportType,
      statusType: body[1] ?? 0,
      timestampUs: Number(timestampUs),
      recvCount: getU32LE(body, 12),
      snapshot,
      activeCC: body[3] ?? 0,
      payloadLen: body[2] ?? 0,
      dropCount: getU32LE(body, 30),
    }
  }

  throw new Error(`Unexpected native WinUSB report type ${reportType}.`)
}

export function encodeNativeWinusbCommandPayload(
  command: NativeWinusbTxCommand,
): Uint8Array {
  const payload = command.payload ?? new Uint8Array(0)

  switch (command.opcode) {
    case NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP0:
    case NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP1:
    case NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP2:
      if (
        payload.length < NATIVE_PD_TX_MESSAGE_MIN_LEN ||
        payload.length > NATIVE_PD_TX_MESSAGE_MAX_LEN
      ) {
        throw new Error(
          `Raw PD TX payload length must be ${NATIVE_PD_TX_MESSAGE_MIN_LEN}..${NATIVE_PD_TX_MESSAGE_MAX_LEN} bytes without CRC, got ${payload.length}.`,
        )
      }
      return Uint8Array.from([command.opcode, ...payload])
    case NATIVE_WINUSB_TX_CMD.SEND_HARD_RESET:
    case NATIVE_WINUSB_TX_CMD.SEND_CABLE_RESET:
    case NATIVE_WINUSB_TX_CMD.GET_STATUS:
      if (payload.length !== 0) {
        throw new Error(
          `Command payload length must be 0 bytes, got ${payload.length}.`,
        )
      }
      return Uint8Array.from([command.opcode])
    case NATIVE_WINUSB_TX_CMD.SET_CC_PULL:
      if (payload.length !== 0) {
        throw new Error(
          `CC pull command payload must be encoded from activeCC/cc1/cc2, got ${payload.length} raw bytes.`,
        )
      }
      return Uint8Array.from([
        command.opcode,
        activeCCModeToByte(command.activeCC),
        ccPullToByte(command.cc1),
        ccPullToByte(command.cc2),
      ])
  }

  throw new Error('Unsupported native WinUSB TX command.')
}

export function encodeNativeWinusbTxCommandBody(
  command: NativeWinusbTxCommand,
): Uint8Array {
  const body = new Uint8Array(NATIVE_WINUSB_REPORT_BODY_SIZE)
  const commandPayload = encodeNativeWinusbCommandPayload(command)
  const payloadLen = commandPayload.length - 1

  if (payloadLen > NATIVE_TX_PAYLOAD_MAX_LEN) {
    throw new Error(
      `native WinUSB command payload is too long: ${payloadLen} bytes.`,
    )
  }

  body[0] = commandPayload[0] ?? 0
  body[1] = payloadLen
  body.set(commandPayload.subarray(1), 2)
  return body
}

export function toPdObservedFrameFromNativeWinusbEvent(
  input: PdFrameInput,
): PdFrame | null {
  if (!isPdSopFrameEvent(input.eventType)) {
    return null
  }

  return {
    sop: nativeWinusbEventSop(input.eventType),
    bytes: normalizePdPayloadForNativeWinusbEvent(
      input.eventType,
      input.payload,
    ),
  }
}
