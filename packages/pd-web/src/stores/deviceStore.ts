import { create } from 'zustand'
import { createBatchedQueue } from '@/lib/batching/batchedQueue'
import { createCaptureBuffer, type CaptureBuffer } from '@/lib/buffers/captureBuffer'
import { createPowerSamplesBuffer, type PowerSamplesBuffer } from '@/lib/buffers/powerSamplesBuffer'
import {
  readDevicePreferences,
  writeAutoConnectOnLoad,
  writeAutoReconnectOnHotplug,
  writeDetailContextBacktrackRecords,
  writeLastDeviceFingerprints,
  writeManualDisconnect,
  writePowerCaptureEnabled,
  writeSelectedMonitorDeviceKind,
  type LastDeviceFingerprints,
} from '@/lib/preferences/devicePreferences'
import type { MonitorDeviceKind } from '@/lib/devices/monitorDrivers'
import type { CaptureRecord, PowerSample } from '@/types/pd'

interface DeviceState {
  isConnected: boolean
  isConnecting: boolean
  manualDisconnect: boolean

  // Auto connect preferences (persisted)
  autoConnectOnLoad: boolean
  autoReconnectOnHotplug: boolean
  selectedMonitorDeviceKind: MonitorDeviceKind
  lastDeviceFingerprints: LastDeviceFingerprints
  detailContextBacktrackRecords: number | null
  powerCaptureEnabled: boolean
  protocolSelectedIndex: number | null

  captureBuffer: CaptureBuffer
  powerBuffer: PowerSamplesBuffer
  captureVersion: number
  powerVersion: number
  captureCount: number
  powerCount: number

  setIsConnected: (isConnected: boolean) => void
  setIsConnecting: (isConnecting: boolean) => void
  setManualDisconnect: (manualDisconnect: boolean) => void
  setAutoConnectOnLoad: (autoConnectOnLoad: boolean) => void
  setAutoReconnectOnHotplug: (autoReconnectOnHotplug: boolean) => void
  setSelectedMonitorDeviceKind: (kind: MonitorDeviceKind) => void
  setLastDeviceFingerprintForKind: (kind: MonitorDeviceKind, fingerprint: string | null) => void
  setDetailContextBacktrackRecords: (detailContextBacktrackRecords: number | null) => void
  setPowerCaptureEnabled: (powerCaptureEnabled: boolean) => void
  setProtocolSelectedIndex: (protocolSelectedIndex: number | null) => void
  addRecord: (record: CaptureRecord) => void
  addPowerSample: (sample: PowerSample) => void
  flushPendingRecords: () => void
  flushPendingPowerSamples: () => void
  clearRecords: () => void
  clearPowerSamples: () => void
  resetDevice: () => void
  importRecords: (records: CaptureRecord[], mode: 'replace' | 'append') => void
}

const CAPTURE_BATCH_SIZE = 1000
const CAPTURE_BATCH_TIMEOUT = 50
const POWER_BUFFER_CAPACITY = 50_000
const POWER_BATCH_SIZE = 200
const POWER_BATCH_TIMEOUT = 50

const initialPreferences = readDevicePreferences()

const useDeviceStore = create<DeviceState>()((set, get) => {
  const captureQueue = createBatchedQueue<CaptureRecord>({
    maxBatchSize: CAPTURE_BATCH_SIZE,
    timeoutMs: CAPTURE_BATCH_TIMEOUT,
    onFlush(records) {
      const { captureBuffer } = get()
      captureBuffer.addBatch(records)
      set({
        captureVersion: captureBuffer.currentVersion,
        captureCount: captureBuffer.length,
      })
    },
  })

  const powerQueue = createBatchedQueue<PowerSample>({
    maxBatchSize: POWER_BATCH_SIZE,
    timeoutMs: POWER_BATCH_TIMEOUT,
    onFlush(samples) {
      const { powerBuffer } = get()
      powerBuffer.addBatch(samples)
      set({
        powerVersion: powerBuffer.currentVersion,
        powerCount: powerBuffer.length,
      })
    },
  })

  return {
    isConnected: false,
    isConnecting: false,
    manualDisconnect: initialPreferences.manualDisconnect,
    autoConnectOnLoad: initialPreferences.autoConnectOnLoad,
    autoReconnectOnHotplug: initialPreferences.autoReconnectOnHotplug,
    selectedMonitorDeviceKind: initialPreferences.selectedMonitorDeviceKind,
    lastDeviceFingerprints: initialPreferences.lastDeviceFingerprints,
    detailContextBacktrackRecords: initialPreferences.detailContextBacktrackRecords,
    powerCaptureEnabled: initialPreferences.powerCaptureEnabled,
    protocolSelectedIndex: null,
    captureBuffer: createCaptureBuffer(),
    powerBuffer: createPowerSamplesBuffer(POWER_BUFFER_CAPACITY),
    captureVersion: 0,
    powerVersion: 0,
    captureCount: 0,
    powerCount: 0,

    setIsConnected: (isConnected) => set({ isConnected }),

    setIsConnecting: (isConnecting) => set({ isConnecting }),

    setManualDisconnect: (manualDisconnect) => {
      writeManualDisconnect(manualDisconnect)
      set({ manualDisconnect })
    },

    setAutoConnectOnLoad: (autoConnectOnLoad) => {
      writeAutoConnectOnLoad(autoConnectOnLoad)
      set({ autoConnectOnLoad })
    },

    setAutoReconnectOnHotplug: (autoReconnectOnHotplug) => {
      writeAutoReconnectOnHotplug(autoReconnectOnHotplug)
      set({ autoReconnectOnHotplug })
    },

    setSelectedMonitorDeviceKind: (selectedMonitorDeviceKind) => {
      writeSelectedMonitorDeviceKind(selectedMonitorDeviceKind)
      set({ selectedMonitorDeviceKind })
    },

    setLastDeviceFingerprintForKind: (kind, fingerprint) => {
      const lastDeviceFingerprints = { ...get().lastDeviceFingerprints }

      if (fingerprint === null) {
        delete lastDeviceFingerprints[kind]
      } else {
        lastDeviceFingerprints[kind] = fingerprint
      }

      writeLastDeviceFingerprints(lastDeviceFingerprints)
      set({ lastDeviceFingerprints })
    },

    setDetailContextBacktrackRecords: (detailContextBacktrackRecords) => {
      writeDetailContextBacktrackRecords(detailContextBacktrackRecords)
      set({ detailContextBacktrackRecords })
    },

    setPowerCaptureEnabled: (powerCaptureEnabled) => {
      writePowerCaptureEnabled(powerCaptureEnabled)

      if (!powerCaptureEnabled) {
        powerQueue.clear()
      }

      set({ powerCaptureEnabled })
    },

    setProtocolSelectedIndex: (protocolSelectedIndex) => set({ protocolSelectedIndex }),

    addRecord: (record) => {
      captureQueue.push(record)
    },

    addPowerSample: (sample) => {
      if (!get().powerCaptureEnabled) return
      powerQueue.push(sample)
    },

    flushPendingRecords: () => {
      captureQueue.flush()
    },

    flushPendingPowerSamples: () => {
      powerQueue.flush()
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

    clearPowerSamples: () => {
      const { powerBuffer } = get()

      powerQueue.clear()
      powerBuffer.clear()
      set({
        powerVersion: powerBuffer.currentVersion,
        powerCount: 0,
      })
    },

    resetDevice: () => {
      captureQueue.clear()
      powerQueue.clear()

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
export const selectPowerCount = (state: DeviceState) => state.powerCount
export const selectPowerVersion = (state: DeviceState) => state.powerVersion
export const selectPowerBuffer = (state: DeviceState) => state.powerBuffer

export default useDeviceStore
