import { create } from 'zustand'
import { createBatchedQueue } from '@/lib/batching/batchedQueue'
import { createCaptureBuffer, type CaptureBuffer } from '@/lib/buffers/captureBuffer'
import type { DeviceKind } from '@/lib/devices/deviceDrivers'
import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { downloadCsv, exportToCsv, generateFilename } from '@/utils/csvHelper'

type LastDeviceFingerprints = Partial<Record<DeviceKind, string>>

interface DeviceState {
  isConnected: boolean
  isConnecting: boolean

  // Auto connect preferences (persisted)
  autoConnectOnLoad: boolean
  autoReconnectOnHotplug: boolean
  selectedDeviceKind: DeviceKind
  lastDeviceFingerprints: LastDeviceFingerprints
  detailContextBacktrackRecords: number | null
  protocolSelectedIndex: number | null

  captureBuffer: CaptureBuffer
  captureVersion: number
  captureCount: number

  setIsConnected: (isConnected: boolean) => void
  setIsConnecting: (isConnecting: boolean) => void
  setAutoConnectOnLoad: (autoConnectOnLoad: boolean) => void
  setAutoReconnectOnHotplug: (autoReconnectOnHotplug: boolean) => void
  setSelectedDeviceKind: (kind: DeviceKind) => void
  setLastDeviceFingerprintForKind: (kind: DeviceKind, fingerprint: string | null) => void
  setDetailContextBacktrackRecords: (detailContextBacktrackRecords: number | null) => void
  setProtocolSelectedIndex: (protocolSelectedIndex: number | null) => void
  addRecord: (record: CaptureRecord) => void
  flushPendingRecords: () => void
  clearRecords: () => void
  resetDevice: () => void
  importRecords: (records: CaptureRecord[], mode: 'replace' | 'append') => void
}

const CAPTURE_BATCH_SIZE = 1000
const CAPTURE_BATCH_TIMEOUT = 50
const CAPTURE_BUFFER_CAPACITY = 500_000
const CAPTURE_AUTO_EXPORT_RECORD_LIMIT = 100_000
const DEVICE_STORAGE_KEYS = {
  autoConnectOnLoad: 'usb-pd-device-autoConnectOnLoad',
  autoReconnectOnHotplug: 'usb-pd-device-autoReconnectOnHotplug',
  selectedDeviceKind: 'usb-pd-device-selected-kind',
  lastDeviceFingerprint: 'usb-pd-device-lastDeviceFingerprint',
  lastDeviceFingerprints: 'usb-pd-device-lastDeviceFingerprints',
  detailContextBacktrackRecords: 'usb-pd-detail-context-backtrack-records',
} as const

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

function isDeviceKind(value: string): value is DeviceKind {
  return value === 'native' || value === 'native-cdc' || value === 'atk-c2'
}

function readSelectedDeviceKind(): DeviceKind {
  const value = readString(DEVICE_STORAGE_KEYS.selectedDeviceKind, 'native')
  return value !== null && isDeviceKind(value) ? value : 'native'
}

function readLastDeviceFingerprints(): LastDeviceFingerprints {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEYS.lastDeviceFingerprints)
    const parsed = raw === null ? null : JSON.parse(raw)
    const result: LastDeviceFingerprints = {}

    if (parsed !== null && typeof parsed === 'object') {
      for (const [kind, fingerprint] of Object.entries(parsed)) {
        if (isDeviceKind(kind) && typeof fingerprint === 'string' && fingerprint.length > 0) {
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

function autoExportAndClearCaptureBuffer(captureBuffer: CaptureBuffer): boolean {
  if (captureBuffer.length < CAPTURE_AUTO_EXPORT_RECORD_LIMIT) return false

  const records = captureBuffer.getAll()
  if (records.length === 0) return false

  try {
    const filename = generateFilename()
    downloadCsv(exportToCsv(records), filename)
  } catch (error) {
    console.error('Auto export failed:', error)
  }

  captureBuffer.clear()
  return true
}

function addCaptureRecordsWithAutoExport(captureBuffer: CaptureBuffer, records: CaptureRecord[]): boolean {
  let exported = false
  let offset = 0

  while (offset < records.length) {
    if (captureBuffer.length >= CAPTURE_AUTO_EXPORT_RECORD_LIMIT) {
      const didExport = autoExportAndClearCaptureBuffer(captureBuffer)
      exported = didExport || exported
      if (!didExport) {
        captureBuffer.addBatch(records.slice(offset))
        break
      }
      continue
    }

    const remainingCapacity = CAPTURE_AUTO_EXPORT_RECORD_LIMIT - captureBuffer.length
    const chunkEnd = Math.min(records.length, offset + remainingCapacity)
    captureBuffer.addBatch(records.slice(offset, chunkEnd))
    offset = chunkEnd

    if (captureBuffer.length >= CAPTURE_AUTO_EXPORT_RECORD_LIMIT) {
      const didExport = autoExportAndClearCaptureBuffer(captureBuffer)
      exported = didExport || exported
      if (!didExport) {
        captureBuffer.addBatch(records.slice(offset))
        break
      }
    }
  }

  return exported
}

const useDeviceStore = create<DeviceState>()((set, get) => {
  const captureQueue = createBatchedQueue<CaptureRecord>({
    maxBatchSize: CAPTURE_BATCH_SIZE,
    timeoutMs: CAPTURE_BATCH_TIMEOUT,
    onFlush(records) {
      const { captureBuffer } = get()

      const autoExported = addCaptureRecordsWithAutoExport(captureBuffer, records)

      set({
        protocolSelectedIndex: autoExported ? null : get().protocolSelectedIndex,
        captureVersion: captureBuffer.currentVersion,
        captureCount: captureBuffer.length,
      })
    },
  })

  return {
    isConnected: false,
    isConnecting: false,
    autoConnectOnLoad: readBool(DEVICE_STORAGE_KEYS.autoConnectOnLoad, true),
    autoReconnectOnHotplug: readBool(DEVICE_STORAGE_KEYS.autoReconnectOnHotplug, true),
    selectedDeviceKind: readSelectedDeviceKind(),
    lastDeviceFingerprints: readLastDeviceFingerprints(),
    detailContextBacktrackRecords: readNullableNumber(DEVICE_STORAGE_KEYS.detailContextBacktrackRecords, null),
    protocolSelectedIndex: null,
    captureBuffer: createCaptureBuffer(CAPTURE_BUFFER_CAPACITY),
    captureVersion: 0,
    captureCount: 0,

    setIsConnected: (isConnected) => set({ isConnected }),

    setIsConnecting: (isConnecting) => set({ isConnecting }),

    setAutoConnectOnLoad: (autoConnectOnLoad) => {
      writeValue(DEVICE_STORAGE_KEYS.autoConnectOnLoad, String(autoConnectOnLoad))
      set({ autoConnectOnLoad })
    },

    setAutoReconnectOnHotplug: (autoReconnectOnHotplug) => {
      writeValue(DEVICE_STORAGE_KEYS.autoReconnectOnHotplug, String(autoReconnectOnHotplug))
      set({ autoReconnectOnHotplug })
    },

    setSelectedDeviceKind: (selectedDeviceKind) => {
      writeValue(DEVICE_STORAGE_KEYS.selectedDeviceKind, selectedDeviceKind)
      set({ selectedDeviceKind })
    },

    setLastDeviceFingerprintForKind: (kind, fingerprint) => {
      const lastDeviceFingerprints = { ...get().lastDeviceFingerprints }

      if (fingerprint === null) {
        delete lastDeviceFingerprints[kind]
      } else {
        lastDeviceFingerprints[kind] = fingerprint
      }

      writeValue(DEVICE_STORAGE_KEYS.lastDeviceFingerprints, JSON.stringify(lastDeviceFingerprints))
      set({ lastDeviceFingerprints })
    },

    setDetailContextBacktrackRecords: (detailContextBacktrackRecords) => {
      writeValue(
        DEVICE_STORAGE_KEYS.detailContextBacktrackRecords,
        detailContextBacktrackRecords === null ? 'unlimited' : String(detailContextBacktrackRecords),
      )
      set({ detailContextBacktrackRecords })
    },

    setProtocolSelectedIndex: (protocolSelectedIndex) => set({ protocolSelectedIndex }),

    addRecord: (record) => {
      captureQueue.push(record)
    },

    flushPendingRecords: () => {
      captureQueue.flush()
    },

    clearRecords: () => {
      const { captureBuffer } = get()

      captureQueue.clear()
      captureBuffer.clear()
      set({
        protocolSelectedIndex: null,
        captureVersion: captureBuffer.currentVersion,
        captureCount: 0,
      })
    },

    resetDevice: () => {
      captureQueue.clear()

      set({
        isConnected: false,
        isConnecting: false,
      })
    },

    importRecords: (records, mode) => {
      const { captureBuffer } = get()

      captureQueue.flush()

      if (mode === 'replace') {
        captureBuffer.clear()
      }

      captureBuffer.addBatch(records)

      set({
        protocolSelectedIndex: mode === 'replace' ? null : get().protocolSelectedIndex,
        captureVersion: captureBuffer.currentVersion,
        captureCount: captureBuffer.length,
      })
    }
  }
})

export const selectCaptureCount = (state: DeviceState) => state.captureCount
export const selectCaptureVersion = (state: DeviceState) => state.captureVersion
export const selectCaptureBuffer = (state: DeviceState) => state.captureBuffer

export default useDeviceStore
