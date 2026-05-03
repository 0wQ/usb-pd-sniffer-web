import type {
  CaptureDevice,
  CaptureDeviceStats,
  CaptureDeviceStatus,
  CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import { createMonitorDevice } from '@usb-pd-sniffer/pd-device-native-hid'
import type { MonitorActiveCCMode, MonitorCCMode, MonitorCCModeConfig } from '@usb-pd-sniffer/pd-device-native-hid'
import { createNativeCdcMonitorDevice } from '@usb-pd-sniffer/pd-device-native-cdc'
import { createAtkC2MonitorDevice } from '@usb-pd-sniffer/pd-device-atk-c2'

export type MonitorDeviceKind = 'native' | 'native-cdc' | 'atk-c2'

export type MonitorRecord = CaptureRecord

export type MonitorDeviceStatus = CaptureDeviceStatus
export type MonitorDeviceStats = CaptureDeviceStats

export type MonitorPdTxTarget = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'

export type { MonitorActiveCCMode, MonitorCCMode, MonitorCCModeConfig }

export type MonitorDevice = CaptureDevice & {
  sendRawPd(target: MonitorPdTxTarget, payload: Uint8Array): Promise<void>
  sendHardReset(): Promise<void>
  sendCableReset(): Promise<void>
  setCCMode(config: MonitorCCModeConfig): Promise<void>
  onStats(listener: (stats: MonitorDeviceStats) => void): () => void
}

export type MonitorDeviceCapabilities = {
  capture: boolean
  tx: boolean
  powerTelemetry: boolean
}

export type MonitorDeviceDriver = {
  kind: MonitorDeviceKind
  label: string
  shortLabel: string
  apiName: string
  createDevice: () => MonitorDevice
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
    },
  },
  'native-cdc': {
    kind: 'native-cdc',
    label: 'Native CDC',
    shortLabel: 'CDC',
    apiName: 'Web Serial',
    createDevice: createNativeCdcMonitorDevice,
    capabilities: {
      capture: true,
      tx: true,
      powerTelemetry: true,
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
    },
  },
}

export const MONITOR_DEVICE_OPTIONS = Object.values(MONITOR_DEVICE_DRIVERS)

export function getMonitorDeviceDriver(kind: MonitorDeviceKind): MonitorDeviceDriver {
  return MONITOR_DEVICE_DRIVERS[kind] ?? MONITOR_DEVICE_DRIVERS[DEFAULT_MONITOR_DEVICE_KIND]
}

export function isMonitorDeviceKind(value: string): value is MonitorDeviceKind {
  return value === 'native' || value === 'native-cdc' || value === 'atk-c2'
}
