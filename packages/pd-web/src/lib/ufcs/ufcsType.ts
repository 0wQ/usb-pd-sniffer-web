import { CAPTURE_EVENT } from '@usb-pd-sniffer/pd-device-types'
import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'

const UFCS_TRAINING_BYTE = 0xaa

const UFCS_MESSAGE_TYPE_NAMES = {
  0: 'CTRL',
  1: 'DATA',
  2: 'CUSTOM',
} as const

const UFCS_CTRL_COMMAND_NAMES = {
  0x00: 'PING',
  0x01: 'ACK',
  0x02: 'NCK',
  0x03: 'ACCEPT',
  0x04: 'SOFT_RESET',
  0x05: 'POWER_READY',
  0x06: 'GET_OUTPUT_CAP',
  0x07: 'GET_SOURCE_INFO',
  0x08: 'GET_SINK_INFO',
  0x09: 'GET_CABLE_INFO',
  0x0a: 'GET_DEVICE_INFO',
  0x0b: 'GET_ERROR_INFO',
  0x0c: 'DETECT_CABLE_INFO',
  0x0d: 'START_CABLE_DETECT',
  0x0e: 'END_CABLE_DETECT',
  0x0f: 'EXIT_UFCS_MODE',
} as const

const UFCS_DATA_COMMAND_NAMES = {
  0x01: 'OUTPUT_CAP',
  0x02: 'REQUEST',
  0x03: 'SOURCE_INFO',
  0x04: 'SINK_INFO',
  0x05: 'CABLE_INFO',
  0x06: 'DEVICE_INFO',
  0x07: 'ERROR_INFO',
  0x08: 'CONFIG_WDOG',
  0x09: 'REFUSE',
  0x0a: 'VERIFY_REQUEST',
  0x0b: 'VERIFY_RESPONSE',
  0x0c: 'POWER_CHANGE',
  0xff: 'TEST_REQUEST',
} as const

export type UfcsMessageTypeName = 'CTRL' | 'DATA' | 'CUSTOM' | 'RESERVED'

export type UfcsTypeDecode = {
  address: number
  messageNumber: number
  version: number
  type: number
  typeName: UfcsMessageTypeName
  commandId: number | null
  commandName: string | null
}

export function isUfcsRecord(record: CaptureRecord): boolean {
  return (
    record.event_type === CAPTURE_EVENT.UFCS_DP ||
    record.event_type === CAPTURE_EVENT.UFCS_DM
  )
}

function commandNameFor(type: number, commandId: number): string | null {
  if (type === 0) {
    return (
      UFCS_CTRL_COMMAND_NAMES[
        commandId as keyof typeof UFCS_CTRL_COMMAND_NAMES
      ] ?? null
    )
  }

  if (type === 1) {
    return (
      UFCS_DATA_COMMAND_NAMES[
        commandId as keyof typeof UFCS_DATA_COMMAND_NAMES
      ] ?? null
    )
  }

  return null
}

export function decodeUfcsType(
  bytes: readonly number[] | Uint8Array,
): UfcsTypeDecode | null {
  const frame = Array.from(bytes)
  const headerOffset = frame[0] === UFCS_TRAINING_BYTE ? 1 : 0
  if (frame.length < headerOffset + 2) return null

  const hi = frame[headerOffset] ?? 0
  const lo = frame[headerOffset + 1] ?? 0
  const address = hi >>> 5
  const rem = hi - address * 32
  const messageNumber = rem >>> 1
  const versionHi = rem - messageNumber * 2
  const versionLo = lo >>> 3
  const type = lo - versionLo * 8
  const version = versionHi * 32 + versionLo
  const typeName =
    UFCS_MESSAGE_TYPE_NAMES[type as keyof typeof UFCS_MESSAGE_TYPE_NAMES] ??
    'RESERVED'
  const commandOffset = headerOffset + 2
  const commandId =
    type === 0 || type === 1 ? (frame[commandOffset] ?? null) : null

  return {
    address,
    messageNumber,
    version,
    type,
    typeName,
    commandId,
    commandName: commandId === null ? null : commandNameFor(type, commandId),
  }
}

export function decodeUfcsRecordType(
  record: CaptureRecord,
): UfcsTypeDecode | null {
  if (!isUfcsRecord(record)) return null
  return decodeUfcsType(record.data.slice(0, record.data_len))
}

export function formatUfcsSignal(record: CaptureRecord): string | null {
  if (record.event_type === CAPTURE_EVENT.UFCS_DP) return 'D+'
  if (record.event_type === CAPTURE_EVENT.UFCS_DM) return 'D-'
  return null
}

export function formatUfcsTypeSummary(
  decoded: UfcsTypeDecode | null,
): string | null {
  if (decoded === null) return null
  if (decoded.commandName !== null) return decoded.commandName
  if (decoded.commandId !== null)
    return `CMD_0x${decoded.commandId.toString(16).toUpperCase().padStart(2, '0')}`
  if (decoded.typeName === 'RESERVED') return `TYPE_${decoded.type}`
  return decoded.typeName
}
