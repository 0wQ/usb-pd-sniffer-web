const DEVICE_STORAGE_KEYS = {
  autoConnectOnLoad: 'usb-pd-device-autoConnectOnLoad',
  autoReconnectOnHotplug: 'usb-pd-device-autoReconnectOnHotplug',
  manualDisconnect: 'usb-pd-device-manualDisconnect',
  lastDeviceFingerprint: 'usb-pd-device-lastDeviceFingerprint',
  detailContextBacktrackRecords: 'usb-pd-detail-context-backtrack-records',
  powerCaptureEnabled: 'usb-pd-power-capture-enabled',
} as const

export type DevicePreferences = {
  manualDisconnect: boolean
  autoConnectOnLoad: boolean
  autoReconnectOnHotplug: boolean
  lastDeviceFingerprint: string | null
  detailContextBacktrackRecords: number | null
  powerCaptureEnabled: boolean
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

function writeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function removeValue(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export function readDevicePreferences(): DevicePreferences {
  return {
    manualDisconnect: readBool(DEVICE_STORAGE_KEYS.manualDisconnect, false),
    autoConnectOnLoad: readBool(DEVICE_STORAGE_KEYS.autoConnectOnLoad, true),
    autoReconnectOnHotplug: readBool(DEVICE_STORAGE_KEYS.autoReconnectOnHotplug, true),
    lastDeviceFingerprint: readString(DEVICE_STORAGE_KEYS.lastDeviceFingerprint, null),
    detailContextBacktrackRecords: readNullableNumber(DEVICE_STORAGE_KEYS.detailContextBacktrackRecords, null),
    powerCaptureEnabled: readBool(DEVICE_STORAGE_KEYS.powerCaptureEnabled, false),
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

export function writeLastDeviceFingerprint(value: string | null): void {
  if (value === null) {
    removeValue(DEVICE_STORAGE_KEYS.lastDeviceFingerprint)
    return
  }

  writeValue(DEVICE_STORAGE_KEYS.lastDeviceFingerprint, value)
}

export function writeDetailContextBacktrackRecords(value: number | null): void {
  writeValue(
    DEVICE_STORAGE_KEYS.detailContextBacktrackRecords,
    value === null ? 'unlimited' : String(value),
  )
}

export function writePowerCaptureEnabled(value: boolean): void {
  writeValue(DEVICE_STORAGE_KEYS.powerCaptureEnabled, String(value))
}
