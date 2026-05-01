import {
  DEFAULT_MONITOR_DEVICE_KIND,
  isMonitorDeviceKind,
  type MonitorDeviceKind,
} from '@/lib/devices/monitorDrivers'

const DEVICE_STORAGE_KEYS = {
  autoConnectOnLoad: 'usb-pd-device-autoConnectOnLoad',
  autoReconnectOnHotplug: 'usb-pd-device-autoReconnectOnHotplug',
  manualDisconnect: 'usb-pd-device-manualDisconnect',
  selectedMonitorDeviceKind: 'usb-pd-device-selected-kind',
  lastDeviceFingerprint: 'usb-pd-device-lastDeviceFingerprint',
  lastDeviceFingerprints: 'usb-pd-device-lastDeviceFingerprints',
  detailContextBacktrackRecords: 'usb-pd-detail-context-backtrack-records',
} as const

export type LastDeviceFingerprints = Partial<Record<MonitorDeviceKind, string>>

export type DevicePreferences = {
  manualDisconnect: boolean
  autoConnectOnLoad: boolean
  autoReconnectOnHotplug: boolean
  selectedMonitorDeviceKind: MonitorDeviceKind
  lastDeviceFingerprints: LastDeviceFingerprints
  detailContextBacktrackRecords: number | null
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return fallback
    if (value === 'true') return true
    if (value === 'false') return false
    return fallback
  } catch {
    return fallback
  }
}

function readString(key: string, fallback: string | null): string | null {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return fallback
    if (value === '') return null
    return value
  } catch {
    return fallback
  }
}

function readNullableNumber(key: string, fallback: number | null): number | null {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return fallback
    if (value === 'unlimited') return null
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  } catch {
    return fallback
  }
}

function readSelectedMonitorDeviceKind(): MonitorDeviceKind {
  const value = readString(DEVICE_STORAGE_KEYS.selectedMonitorDeviceKind, DEFAULT_MONITOR_DEVICE_KIND)
  return value !== null && isMonitorDeviceKind(value) ? value : DEFAULT_MONITOR_DEVICE_KIND
}

function readLastDeviceFingerprints(): LastDeviceFingerprints {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEYS.lastDeviceFingerprints)
    const parsed = raw === null ? null : JSON.parse(raw)
    const result: LastDeviceFingerprints = {}

    if (parsed !== null && typeof parsed === 'object') {
      for (const [kind, fingerprint] of Object.entries(parsed)) {
        if (isMonitorDeviceKind(kind) && typeof fingerprint === 'string' && fingerprint.length > 0) {
          result[kind] = fingerprint
        }
      }
    }

    const legacyFingerprint = readString(DEVICE_STORAGE_KEYS.lastDeviceFingerprint, null)
    if (legacyFingerprint !== null && result.native === undefined) {
      result.native = legacyFingerprint
    }

    return result
  } catch {
    return {}
  }
}

function writeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export function readDevicePreferences(): DevicePreferences {
  return {
    manualDisconnect: readBool(DEVICE_STORAGE_KEYS.manualDisconnect, false),
    autoConnectOnLoad: readBool(DEVICE_STORAGE_KEYS.autoConnectOnLoad, true),
    autoReconnectOnHotplug: readBool(DEVICE_STORAGE_KEYS.autoReconnectOnHotplug, true),
    selectedMonitorDeviceKind: readSelectedMonitorDeviceKind(),
    lastDeviceFingerprints: readLastDeviceFingerprints(),
    detailContextBacktrackRecords: readNullableNumber(DEVICE_STORAGE_KEYS.detailContextBacktrackRecords, null),
  }
}

export function writeManualDisconnect(value: boolean): void {
  writeValue(DEVICE_STORAGE_KEYS.manualDisconnect, String(value))
}

export function writeAutoConnectOnLoad(value: boolean): void {
  writeValue(DEVICE_STORAGE_KEYS.autoConnectOnLoad, String(value))
}

export function writeAutoReconnectOnHotplug(value: boolean): void {
  writeValue(DEVICE_STORAGE_KEYS.autoReconnectOnHotplug, String(value))
}

export function writeSelectedMonitorDeviceKind(value: MonitorDeviceKind): void {
  writeValue(DEVICE_STORAGE_KEYS.selectedMonitorDeviceKind, value)
}

export function writeLastDeviceFingerprints(value: LastDeviceFingerprints): void {
  writeValue(DEVICE_STORAGE_KEYS.lastDeviceFingerprints, JSON.stringify(value))
}

export function writeDetailContextBacktrackRecords(value: number | null): void {
  writeValue(
    DEVICE_STORAGE_KEYS.detailContextBacktrackRecords,
    value === null ? 'unlimited' : String(value),
  )
}
