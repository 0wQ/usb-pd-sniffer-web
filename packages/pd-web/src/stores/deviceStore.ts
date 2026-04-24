import { create } from 'zustand'
import { createCaptureBuffer, type CaptureBuffer } from '@/lib/buffers/captureBuffer'
import { createPowerSamplesBuffer, type PowerSamplesBuffer } from '@/lib/buffers/powerSamplesBuffer'
import {
  readDevicePreferences,
  writeAutoConnectOnLoad,
  writeAutoReconnectOnHotplug,
  writeDetailContextBacktrackRecords,
  writeLastDeviceFingerprint,
  writeManualDisconnect,
  writePowerCaptureEnabled,
} from '@/lib/preferences/devicePreferences'
import type { CaptureRecord, PowerSample } from '@/types/pd'

interface DeviceState {
  isConnected: boolean
  isConnecting: boolean
  manualDisconnect: boolean

  // Auto connect preferences (persisted)
  autoConnectOnLoad: boolean
  autoReconnectOnHotplug: boolean
  lastDeviceFingerprint: string | null
  detailContextBacktrackRecords: number | null
  powerCaptureEnabled: boolean
  protocolSelectedIndex: number | null

  captureBuffer: CaptureBuffer
  powerBuffer: PowerSamplesBuffer
  captureVersion: number
  powerVersion: number
  captureCount: number
  powerCount: number

  pendingRecords: CaptureRecord[]
  pendingPowerSamples: PowerSample[]
  captureUpdateTimer: number | null
  powerUpdateTimer: number | null

  setIsConnected: (isConnected: boolean) => void
  setIsConnecting: (isConnecting: boolean) => void
  setManualDisconnect: (manualDisconnect: boolean) => void
  setAutoConnectOnLoad: (autoConnectOnLoad: boolean) => void
  setAutoReconnectOnHotplug: (autoReconnectOnHotplug: boolean) => void
  setLastDeviceFingerprint: (lastDeviceFingerprint: string | null) => void
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

const useDeviceStore = create<DeviceState>()((set, get) => ({
  isConnected: false,
  isConnecting: false,
  manualDisconnect: initialPreferences.manualDisconnect,
  autoConnectOnLoad: initialPreferences.autoConnectOnLoad,
  autoReconnectOnHotplug: initialPreferences.autoReconnectOnHotplug,
  lastDeviceFingerprint: initialPreferences.lastDeviceFingerprint,
  detailContextBacktrackRecords: initialPreferences.detailContextBacktrackRecords,
  powerCaptureEnabled: initialPreferences.powerCaptureEnabled,
  protocolSelectedIndex: null,
  captureBuffer: createCaptureBuffer(),
  powerBuffer: createPowerSamplesBuffer(POWER_BUFFER_CAPACITY),
  captureVersion: 0,
  powerVersion: 0,
  pendingRecords: [],
  pendingPowerSamples: [],
  captureUpdateTimer: null,
  powerUpdateTimer: null,
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

  setLastDeviceFingerprint: (lastDeviceFingerprint) => {
    writeLastDeviceFingerprint(lastDeviceFingerprint)
    set({ lastDeviceFingerprint })
  },

  setDetailContextBacktrackRecords: (detailContextBacktrackRecords) => {
    writeDetailContextBacktrackRecords(detailContextBacktrackRecords)
    set({ detailContextBacktrackRecords })
  },

  setPowerCaptureEnabled: (powerCaptureEnabled) => {
    const { powerUpdateTimer } = get()

    writePowerCaptureEnabled(powerCaptureEnabled)

    if (!powerCaptureEnabled && powerUpdateTimer !== null) {
      clearTimeout(powerUpdateTimer)
      set({
        powerCaptureEnabled,
        pendingPowerSamples: [],
        powerUpdateTimer: null,
      })
      return
    }

    set({ powerCaptureEnabled })
  },

  setProtocolSelectedIndex: (protocolSelectedIndex) => set({ protocolSelectedIndex }),

  addRecord: (record) => {
    const { pendingRecords, captureUpdateTimer } = get()

    pendingRecords.push(record)

    if (pendingRecords.length >= CAPTURE_BATCH_SIZE) {
      get().flushPendingRecords()
    } else if (captureUpdateTimer === null) {
      const newTimer = window.setTimeout(() => {
        get().flushPendingRecords()
      }, CAPTURE_BATCH_TIMEOUT)

      set({ captureUpdateTimer: newTimer })
    }
  },

  addPowerSample: (sample) => {
    const { pendingPowerSamples, powerUpdateTimer, powerCaptureEnabled } = get()

    if (!powerCaptureEnabled) {
      return
    }

    pendingPowerSamples.push(sample)

    if (pendingPowerSamples.length >= POWER_BATCH_SIZE) {
      get().flushPendingPowerSamples()
    } else if (powerUpdateTimer === null) {
      const newTimer = window.setTimeout(() => {
        get().flushPendingPowerSamples()
      }, POWER_BATCH_TIMEOUT)

      set({ powerUpdateTimer: newTimer })
    }
  },

  flushPendingRecords: () => {
    const { pendingRecords, captureBuffer, captureUpdateTimer } = get()

    if (pendingRecords.length === 0) return

    captureBuffer.addBatch([...pendingRecords])

    if (captureUpdateTimer !== null) {
      clearTimeout(captureUpdateTimer)
    }

    const newCount = captureBuffer.length

    set({
      captureVersion: captureBuffer.currentVersion,
      captureCount: newCount,
      pendingRecords: [],
      captureUpdateTimer: null
    })
  },

  flushPendingPowerSamples: () => {
    const { pendingPowerSamples, powerBuffer, powerUpdateTimer } = get()

    if (pendingPowerSamples.length === 0) return

    powerBuffer.addBatch([...pendingPowerSamples])

    if (powerUpdateTimer !== null) {
      clearTimeout(powerUpdateTimer)
    }

    set({
      powerVersion: powerBuffer.currentVersion,
      powerCount: powerBuffer.length,
      pendingPowerSamples: [],
      powerUpdateTimer: null,
    })
  },

  clearRecords: () => {
    const { captureBuffer, captureUpdateTimer } = get()

    if (captureUpdateTimer !== null) {
      clearTimeout(captureUpdateTimer)
    }

    captureBuffer.clear()
    set({
      protocolSelectedIndex: null,
      captureVersion: captureBuffer.currentVersion,
      captureCount: 0,
      pendingRecords: [],
      captureUpdateTimer: null
    })
  },

  clearPowerSamples: () => {
    const { powerBuffer, powerUpdateTimer } = get()

    if (powerUpdateTimer !== null) {
      clearTimeout(powerUpdateTimer)
    }

    powerBuffer.clear()
    set({
      powerVersion: powerBuffer.currentVersion,
      powerCount: 0,
      pendingPowerSamples: [],
      powerUpdateTimer: null,
    })
  },

  resetDevice: () => {
    const { captureUpdateTimer, powerUpdateTimer } = get()

    if (captureUpdateTimer !== null) {
      clearTimeout(captureUpdateTimer)
    }
    if (powerUpdateTimer !== null) {
      clearTimeout(powerUpdateTimer)
    }

    set({
      isConnected: false,
      isConnecting: false,
      captureUpdateTimer: null,
      powerUpdateTimer: null,
    })
  },

  importRecords: (records, mode) => {
    const { captureBuffer, captureUpdateTimer } = get()

    // Flush any pending records first
    get().flushPendingRecords()

    if (captureUpdateTimer !== null) {
      clearTimeout(captureUpdateTimer)
    }

    if (mode === 'replace') {
      captureBuffer.clear()
    }

    captureBuffer.addBatch(records)

    set({
      protocolSelectedIndex: mode === 'replace' ? null : get().protocolSelectedIndex,
      captureVersion: captureBuffer.currentVersion,
      captureCount: captureBuffer.length,
      pendingRecords: [],
      captureUpdateTimer: null
    })
  }
}))

export const selectCaptureCount = (state: DeviceState) => state.captureCount
export const selectCaptureVersion = (state: DeviceState) => state.captureVersion
export const selectCaptureBuffer = (state: DeviceState) => state.captureBuffer
export const selectPowerCount = (state: DeviceState) => state.powerCount
export const selectPowerVersion = (state: DeviceState) => state.powerVersion
export const selectPowerBuffer = (state: DeviceState) => state.powerBuffer

export default useDeviceStore
