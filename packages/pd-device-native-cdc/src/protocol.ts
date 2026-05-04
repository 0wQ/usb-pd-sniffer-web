import {
  CAPTURE_EVENT,
  type CaptureEventType,
  type CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'

export const NATIVE_CDC_USB = {
  vendorId: 0x1a86,
  productId: 0x2334,
  baudRate: 115200,
} as const

export const NATIVE_CDC_FRAME_MAGIC = Uint8Array.from([0x0a, 0x55, 0x50, 0x53])
export const NATIVE_CDC_FRAME_TYPE_EVENT = 0x01
export const NATIVE_CDC_FRAME_HEADER_SIZE = 7
export const NATIVE_CDC_EVENT_HEADER_SIZE = 28
export const NATIVE_CDC_EVENT_DATA_MAX_LEN = 65
export const NATIVE_CDC_EVENT_PAYLOAD_MAX_LEN =
  NATIVE_CDC_EVENT_HEADER_SIZE + NATIVE_CDC_EVENT_DATA_MAX_LEN

export const NATIVE_CDC_EVENT = {
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

export type NativeCdcFrame = {
  type: number
  payload: Uint8Array
}

type RawNativeCdcEventRecord = Omit<CaptureRecord, 'event_type'> & {
  event_type: number
}

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

function putU16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >> 8) & 0xff
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0) return 0

  for (let start = 0; start <= haystack.length - needle.length; start++) {
    let matches = true
    for (let index = 0; index < needle.length; index++) {
      if (haystack[start + index] !== needle[index]) {
        matches = false
        break
      }
    }
    if (matches) return start
  }

  return -1
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length)
  merged.set(left, 0)
  merged.set(right, left.length)
  return merged
}

function maxPayloadLenForType(type: number): number | null {
  switch (type) {
    case NATIVE_CDC_FRAME_TYPE_EVENT:
      return NATIVE_CDC_EVENT_PAYLOAD_MAX_LEN
    default:
      return null
  }
}

function isKnownNativeCdcEvent(eventType: number): boolean {
  switch (eventType) {
    case NATIVE_CDC_EVENT.DISCONNECT:
    case NATIVE_CDC_EVENT.CC1_CONNECT:
    case NATIVE_CDC_EVENT.CC2_CONNECT:
    case NATIVE_CDC_EVENT.PD_SOP0:
    case NATIVE_CDC_EVENT.PD_SOP1:
    case NATIVE_CDC_EVENT.PD_SOP2:
    case NATIVE_CDC_EVENT.PD_SOP1_DEBUG:
    case NATIVE_CDC_EVENT.PD_SOP2_DEBUG:
    case NATIVE_CDC_EVENT.PD_HARD_RESET:
    case NATIVE_CDC_EVENT.PD_CABLE_RESET:
    case NATIVE_CDC_EVENT.PD_ERROR:
    case NATIVE_CDC_EVENT.UFCS_DP:
    case NATIVE_CDC_EVENT.UFCS_DM:
      return true
    default:
      return false
  }
}

function validateNativeCdcEventPayload(payload: Uint8Array): void {
  if (payload.length < NATIVE_CDC_EVENT_HEADER_SIZE) {
    throw new Error(
      `Native CDC event payload is too short: ${payload.length} bytes.`,
    )
  }
  if (payload.length > NATIVE_CDC_EVENT_PAYLOAD_MAX_LEN) {
    throw new Error(
      `Native CDC event payload is too long: ${payload.length} bytes.`,
    )
  }

  const eventType = payload[26] ?? 0
  if (!isKnownNativeCdcEvent(eventType)) {
    throw new Error(`Unknown native CDC event type ${eventType}.`)
  }

  const activeCC = payload[27] ?? 0
  if (activeCC > 2) {
    throw new Error(`Unexpected native CDC active CC value ${activeCC}.`)
  }
}

export class NativeCdcFrameParser {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0)

  push(chunk: Uint8Array): NativeCdcFrame[] {
    this.buffer = appendBytes(this.buffer, chunk)

    const frames: NativeCdcFrame[] = []
    while (this.buffer.length > 0) {
      const magicOffset = indexOfBytes(this.buffer, NATIVE_CDC_FRAME_MAGIC)
      if (magicOffset < 0) {
        this.buffer = this.buffer.slice(
          Math.max(0, this.buffer.length - (NATIVE_CDC_FRAME_MAGIC.length - 1)),
        )
        break
      }

      if (magicOffset > 0) {
        this.buffer = this.buffer.slice(magicOffset)
      }

      if (this.buffer.length < NATIVE_CDC_FRAME_HEADER_SIZE) break

      const type = this.buffer[NATIVE_CDC_FRAME_MAGIC.length] ?? 0
      const len = getU16LE(this.buffer, NATIVE_CDC_FRAME_MAGIC.length + 1)
      const maxPayloadLen = maxPayloadLenForType(type)
      if (maxPayloadLen === null || len > maxPayloadLen) {
        this.buffer = this.buffer.slice(1)
        continue
      }

      const frameLen = NATIVE_CDC_FRAME_HEADER_SIZE + len
      if (this.buffer.length < frameLen) break

      const payload = this.buffer.slice(NATIVE_CDC_FRAME_HEADER_SIZE, frameLen)
      try {
        if (type === NATIVE_CDC_FRAME_TYPE_EVENT) {
          validateNativeCdcEventPayload(payload)
        }
      } catch {
        this.buffer = this.buffer.slice(1)
        continue
      }

      frames.push({
        type,
        payload,
      })
      this.buffer = this.buffer.slice(frameLen)
    }

    return frames
  }

  reset(): void {
    this.buffer = new Uint8Array(0)
  }
}

export function parseNativeCdcEventPayload(
  payload: Uint8Array,
): RawNativeCdcEventRecord {
  validateNativeCdcEventPayload(payload)

  const timestampUsLo = getU32LE(payload, 0)
  const timestampUsHi = getU32LE(payload, 4)
  const timestampUs = (BigInt(timestampUsHi) << 32n) | BigInt(timestampUsLo)
  const data = payload.slice(NATIVE_CDC_EVENT_HEADER_SIZE)

  return {
    timestamp_us: Number(timestampUs),
    seq: getU32LE(payload, 8),
    vbus_mv: getU16LE(payload, 12),
    ibus_ma: getI32LE(payload, 14) / 1000,
    cc1_mv: getU16LE(payload, 18),
    cc2_mv: getU16LE(payload, 20),
    dp_mv: getU16LE(payload, 22),
    dm_mv: getU16LE(payload, 24),
    event_type: payload[26] ?? 0,
    active_cc: payload[27] ?? 0,
    data_len: data.length,
    data: Array.from(data),
  }
}

export function nativeCdcEventToCaptureEvent(
  eventType: number,
): CaptureEventType | null {
  switch (eventType) {
    case NATIVE_CDC_EVENT.DISCONNECT:
      return CAPTURE_EVENT.DISCONNECT
    case NATIVE_CDC_EVENT.CC1_CONNECT:
      return CAPTURE_EVENT.CC1_CONNECT
    case NATIVE_CDC_EVENT.CC2_CONNECT:
      return CAPTURE_EVENT.CC2_CONNECT
    case NATIVE_CDC_EVENT.PD_SOP0:
      return CAPTURE_EVENT.PD_SOP0
    case NATIVE_CDC_EVENT.PD_SOP1:
      return CAPTURE_EVENT.PD_SOP1
    case NATIVE_CDC_EVENT.PD_SOP2:
      return CAPTURE_EVENT.PD_SOP2
    case NATIVE_CDC_EVENT.PD_SOP1_DEBUG:
      return CAPTURE_EVENT.PD_SOP1_DEBUG
    case NATIVE_CDC_EVENT.PD_SOP2_DEBUG:
      return CAPTURE_EVENT.PD_SOP2_DEBUG
    case NATIVE_CDC_EVENT.PD_HARD_RESET:
      return CAPTURE_EVENT.PD_HARD_RESET
    case NATIVE_CDC_EVENT.PD_CABLE_RESET:
      return CAPTURE_EVENT.PD_CABLE_RESET
    case NATIVE_CDC_EVENT.UFCS_DP:
      return CAPTURE_EVENT.UFCS_DP
    case NATIVE_CDC_EVENT.UFCS_DM:
      return CAPTURE_EVENT.UFCS_DM
    default:
      return null
  }
}

export function encodeNativeCdcFrame(
  type: number,
  payload: Uint8Array,
): Uint8Array {
  const maxPayloadLen = maxPayloadLenForType(type)
  if (maxPayloadLen === null) {
    throw new Error(`Unsupported native CDC frame type ${type}.`)
  }
  if (payload.length > maxPayloadLen) {
    throw new Error(
      `Native CDC frame payload is too long: ${payload.length} bytes.`,
    )
  }

  const frame = new Uint8Array(NATIVE_CDC_FRAME_HEADER_SIZE + payload.length)
  frame.set(NATIVE_CDC_FRAME_MAGIC, 0)
  frame[NATIVE_CDC_FRAME_MAGIC.length] = type
  putU16LE(frame, NATIVE_CDC_FRAME_MAGIC.length + 1, payload.length)
  frame.set(payload, NATIVE_CDC_FRAME_HEADER_SIZE)
  return frame
}
