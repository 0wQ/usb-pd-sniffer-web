import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createBatchedQueue } from '@/lib/batching/batchedQueue'
import {
  createCaptureBuffer,
  type CaptureBuffer,
} from '@/lib/buffers/captureBuffer'
import type { DeviceKind } from '@/lib/devices/deviceDrivers'
import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { downloadCsv, exportToCsv, generateFilename } from '@/utils/csvHelper'

type LastDeviceFingerprints = Partial<Record<DeviceKind, string>>

interface DeviceState {
  isConnected: boolean
  isConnecting: boolean
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
  setLastDeviceFingerprintForKind: (
    kind: DeviceKind,
    fingerprint: string | null,
  ) => void
  setDetailContextBacktrackRecords: (
    detailContextBacktrackRecords: number | null,
  ) => void
  setProtocolSelectedIndex: (protocolSelectedIndex: number | null) => void
  addRecord: (record: CaptureRecord) => void
  flushPendingRecords: () => void
  clearRecords: () => void
  resetDevice: () => void
  importRecords: (records: CaptureRecord[], mode: 'replace' | 'append') => void
}

type DevicePersistedState = Pick<
  DeviceState,
  | 'autoConnectOnLoad'
  | 'autoReconnectOnHotplug'
  | 'selectedDeviceKind'
  | 'lastDeviceFingerprints'
  | 'detailContextBacktrackRecords'
>

const CAPTURE_BATCH_SIZE = 1000
const CAPTURE_BATCH_TIMEOUT = 50
const CAPTURE_BUFFER_CAPACITY = 500_000
const CAPTURE_AUTO_EXPORT_RECORD_LIMIT = 100_000
const DEVICE_STORE_STORAGE_KEY = 'usb-pd-device-store'

const DEFAULT_DEVICE_PERSISTED_STATE: DevicePersistedState = {
  autoConnectOnLoad: true,
  autoReconnectOnHotplug: true,
  selectedDeviceKind: 'native',
  lastDeviceFingerprints: {},
  detailContextBacktrackRecords: null,
}

function autoExportAndClearCaptureBuffer(
  captureBuffer: CaptureBuffer,
): boolean {
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

function addCaptureRecordsWithAutoExport(
  captureBuffer: CaptureBuffer,
  records: CaptureRecord[],
): boolean {
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

    const remainingCapacity =
      CAPTURE_AUTO_EXPORT_RECORD_LIMIT - captureBuffer.length
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

const useDeviceStore = create<DeviceState>()(
  persist(
    (set, get) => {
      const captureQueue = createBatchedQueue<CaptureRecord>({
        maxBatchSize: CAPTURE_BATCH_SIZE,
        timeoutMs: CAPTURE_BATCH_TIMEOUT,
        onFlush(records) {
          const { captureBuffer } = get()

          const autoExported = addCaptureRecordsWithAutoExport(
            captureBuffer,
            records,
          )

          set({
            protocolSelectedIndex: autoExported
              ? null
              : get().protocolSelectedIndex,
            captureVersion: captureBuffer.currentVersion,
            captureCount: captureBuffer.length,
          })
        },
      })

      return {
        isConnected: false,
        isConnecting: false,
        ...DEFAULT_DEVICE_PERSISTED_STATE,
        protocolSelectedIndex: null,
        captureBuffer: createCaptureBuffer(CAPTURE_BUFFER_CAPACITY),
        captureVersion: 0,
        captureCount: 0,

        setIsConnected: (isConnected) => set({ isConnected }),

        setIsConnecting: (isConnecting) => set({ isConnecting }),

        setAutoConnectOnLoad: (autoConnectOnLoad) => set({ autoConnectOnLoad }),

        setAutoReconnectOnHotplug: (autoReconnectOnHotplug) =>
          set({ autoReconnectOnHotplug }),

        setSelectedDeviceKind: (selectedDeviceKind) =>
          set({ selectedDeviceKind }),

        setLastDeviceFingerprintForKind: (kind, fingerprint) => {
          const lastDeviceFingerprints = { ...get().lastDeviceFingerprints }

          if (fingerprint === null) {
            delete lastDeviceFingerprints[kind]
          } else {
            lastDeviceFingerprints[kind] = fingerprint
          }

          set({ lastDeviceFingerprints })
        },

        setDetailContextBacktrackRecords: (detailContextBacktrackRecords) =>
          set({ detailContextBacktrackRecords }),

        setProtocolSelectedIndex: (protocolSelectedIndex) =>
          set({ protocolSelectedIndex }),

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
            protocolSelectedIndex:
              mode === 'replace' ? null : get().protocolSelectedIndex,
            captureVersion: captureBuffer.currentVersion,
            captureCount: captureBuffer.length,
          })
        },
      }
    },
    {
      name: DEVICE_STORE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        autoConnectOnLoad: state.autoConnectOnLoad,
        autoReconnectOnHotplug: state.autoReconnectOnHotplug,
        selectedDeviceKind: state.selectedDeviceKind,
        lastDeviceFingerprints: state.lastDeviceFingerprints,
        detailContextBacktrackRecords: state.detailContextBacktrackRecords,
      }),
    },
  ),
)

export const selectCaptureCount = (state: DeviceState) => state.captureCount
export const selectCaptureVersion = (state: DeviceState) => state.captureVersion
export const selectCaptureBuffer = (state: DeviceState) => state.captureBuffer

export default useDeviceStore
