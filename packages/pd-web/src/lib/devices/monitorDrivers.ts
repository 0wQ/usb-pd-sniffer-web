import { createMonitorDevice } from '@usb-pd-sniffer/pd-monitor'
import { createAtkC2MonitorDevice } from '@usb-pd-sniffer/pd-monitor-atk-c2'

export type MonitorDeviceKind = 'native' | 'atk-c2'

export type MonitorRecordLike = {
  timestamp_us: number
  recv_counter: number
  drop_count?: number
  vbus_mv: number
  ibus_ma: number
  cc1_mv: number
  cc2_mv: number
  dp_mv: number
  dm_mv: number
  event_type: number
  active_cc: number
  data_len: number
  data: number[]
}

export type MonitorPowerSampleLike = {
  timestamp_us: number
  recv_counter: number
  vbus_mv: number
  ibus_ma: number
  cc1_mv: number
  cc2_mv: number
  dp_mv: number
  dm_mv: number
  active_cc: number
  event_type: number
}

export type MonitorDeviceStatusLike = {
  readonly isSupported: boolean
  readonly isConnected: boolean
  readonly isConnecting: boolean
  readonly isSending: boolean
  readonly error: string | null
  readonly productName: string | null
  readonly fingerprint: string | null
}

export type MonitorPdTxTarget = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'

export type MonitorDeviceLike = {
  readonly isSupported: boolean
  connect(): Promise<void>
  connectAuthorized(preferredFingerprint?: string | null): Promise<void>
  disconnect(): Promise<void>
  setAutoReconnect(enabled: boolean, preferredFingerprint?: string | null): void
  dispose(): void
  sendRawPd(target: MonitorPdTxTarget, payload: Uint8Array): Promise<void>
  sendHardReset(): Promise<void>
  sendCableReset(): Promise<void>
  onRecord(listener: (record: MonitorRecordLike) => void): () => void
  onPowerSample(listener: (sample: MonitorPowerSampleLike) => void): () => void
  onStatus(listener: (status: MonitorDeviceStatusLike) => void): () => void
}

export type MonitorDeviceCapabilities = {
  capture: boolean
  tx: boolean
  powerTelemetry: boolean
  ufcs: boolean
}

export type MonitorDeviceDriver = {
  kind: MonitorDeviceKind
  label: string
  shortLabel: string
  apiName: string
  createDevice: () => MonitorDeviceLike
  capabilities: MonitorDeviceCapabilities
}

export const DEFAULT_MONITOR_DEVICE_KIND: MonitorDeviceKind = 'native'

export const MONITOR_DEVICE_DRIVERS: Record<MonitorDeviceKind, MonitorDeviceDriver> = {
  native: {
    kind: 'native',
    label: 'Native HID',
    shortLabel: 'Native',
    apiName: 'WebHID',
    createDevice: createMonitorDevice,
    capabilities: {
      capture: true,
      tx: true,
      powerTelemetry: true,
      ufcs: true,
    },
  },
  'atk-c2': {
    kind: 'atk-c2',
    label: 'ATK C2',
    shortLabel: 'ATK C2',
    apiName: 'WebUSB',
    createDevice: createAtkC2MonitorDevice,
    capabilities: {
      capture: true,
      tx: false,
      powerTelemetry: false,
      ufcs: false,
    },
  },
}

export const MONITOR_DEVICE_OPTIONS = Object.values(MONITOR_DEVICE_DRIVERS)

export function getMonitorDeviceDriver(kind: MonitorDeviceKind): MonitorDeviceDriver {
  return MONITOR_DEVICE_DRIVERS[kind] ?? MONITOR_DEVICE_DRIVERS[DEFAULT_MONITOR_DEVICE_KIND]
}

export function isMonitorDeviceKind(value: string): value is MonitorDeviceKind {
  return value === 'native' || value === 'atk-c2'
}
