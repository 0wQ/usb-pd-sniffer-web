import { create } from 'zustand'
import { CaptureBuffer } from '@/lib/buffers/captureBuffer'
import { PowerSamplesBuffer } from '@/lib/buffers/powerSamplesBuffer'
import type { CaptureRecord, PowerSample } from '@/types/pd'

const DEVICE_STORAGE_KEYS = {
  autoConnectOnLoad: 'usb-pd-device-autoConnectOnLoad',
  autoReconnectOnHotplug: 'usb-pd-device-autoReconnectOnHotplug',
  manualDisconnect: 'usb-pd-device-manualDisconnect',
  lastDeviceFingerprint: 'usb-pd-device-lastDeviceFingerprint',
  detailContextBacktrackRecords: 'usb-pd-detail-context-backtrack-records',
  powerCaptureEnabled: 'usb-pd-power-capture-enabled',
} as const

const readBool = (key: string, fallback: boolean): boolean => {
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

const readString = (key: string, fallback: string | null): string | null => {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return fallback
    if (value === '') return null
    return value
  } catch {
    return fallback
  }
}

const readNullableNumber = (key: string, fallback: number | null): number | null => {
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

const writeValue = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

const removeValue = (key: string): void => {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}


interface DeviceState {
  // 设备状态
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

  // 数据缓冲区（不可变引用）
  captureBuffer: CaptureBuffer
  powerBuffer: PowerSamplesBuffer
  // 用于触发组件更新的版本号
  captureVersion: number
  powerVersion: number
  // 选择器：获取记录数量
  captureCount: number
  powerCount: number

  // 批量更新相关
  pendingRecords: CaptureRecord[]
  pendingPowerSamples: PowerSample[]
  updateTimer: number | null
  powerUpdateTimer: number | null

  // Actions
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

// 批量更新配置
const BATCH_SIZE = 1000 // 累积多少条数据触发更新
const BATCH_TIMEOUT = 50 // 多少毫秒触发更新
const POWER_BUFFER_CAPACITY = 50_000
const POWER_BATCH_SIZE = 200
const POWER_BATCH_TIMEOUT = 50

const useDeviceStore = create<DeviceState>()((set, get) => ({
  // Initial state
  isConnected: false,
  isConnecting: false,
  manualDisconnect: readBool(DEVICE_STORAGE_KEYS.manualDisconnect, false),
  autoConnectOnLoad: readBool(DEVICE_STORAGE_KEYS.autoConnectOnLoad, true),
  autoReconnectOnHotplug: readBool(DEVICE_STORAGE_KEYS.autoReconnectOnHotplug, true),
  lastDeviceFingerprint: readString(DEVICE_STORAGE_KEYS.lastDeviceFingerprint, null),
  detailContextBacktrackRecords: readNullableNumber(DEVICE_STORAGE_KEYS.detailContextBacktrackRecords, null),
  powerCaptureEnabled: readBool(DEVICE_STORAGE_KEYS.powerCaptureEnabled, false),
  protocolSelectedIndex: null,
  captureBuffer: new CaptureBuffer(),
  powerBuffer: new PowerSamplesBuffer(POWER_BUFFER_CAPACITY),
  captureVersion: 0,
  powerVersion: 0,
  pendingRecords: [],
  pendingPowerSamples: [],
  updateTimer: null,
  powerUpdateTimer: null,
  captureCount: 0,
  powerCount: 0,

  // Actions
  setIsConnected: (isConnected) => set({ isConnected }),

  setIsConnecting: (isConnecting) => set({ isConnecting }),

  setManualDisconnect: (manualDisconnect) => {
    writeValue(DEVICE_STORAGE_KEYS.manualDisconnect, String(manualDisconnect))
    set({ manualDisconnect })
  },

  setAutoConnectOnLoad: (autoConnectOnLoad) => {
    writeValue(DEVICE_STORAGE_KEYS.autoConnectOnLoad, String(autoConnectOnLoad))
    set({ autoConnectOnLoad })
  },

  setAutoReconnectOnHotplug: (autoReconnectOnHotplug) => {
    writeValue(DEVICE_STORAGE_KEYS.autoReconnectOnHotplug, String(autoReconnectOnHotplug))
    set({ autoReconnectOnHotplug })
  },

  setLastDeviceFingerprint: (lastDeviceFingerprint) => {
    if (lastDeviceFingerprint === null) {
      removeValue(DEVICE_STORAGE_KEYS.lastDeviceFingerprint)
      set({ lastDeviceFingerprint: null })
      return
    }

    writeValue(DEVICE_STORAGE_KEYS.lastDeviceFingerprint, lastDeviceFingerprint)
    set({ lastDeviceFingerprint })
  },

  setDetailContextBacktrackRecords: (detailContextBacktrackRecords) => {
    writeValue(
      DEVICE_STORAGE_KEYS.detailContextBacktrackRecords,
      detailContextBacktrackRecords === null ? 'unlimited' : String(detailContextBacktrackRecords)
    )
    set({ detailContextBacktrackRecords })
  },

  setPowerCaptureEnabled: (powerCaptureEnabled) => {
    const { powerUpdateTimer } = get()

    writeValue(DEVICE_STORAGE_KEYS.powerCaptureEnabled, String(powerCaptureEnabled))

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

  // 批量更新：收集数据，达到阈值或超时后统一更新
  addRecord: (record) => {
    const { pendingRecords, updateTimer } = get()

    // 添加到待处理队列
    pendingRecords.push(record)

    // 检查是否达到批量更新阈值
    if (pendingRecords.length >= BATCH_SIZE) {
      // 立即刷新
      get().flushPendingRecords()
    } else if (updateTimer === null) {
      // 设置新的定时器
      const newTimer = window.setTimeout(() => {
        get().flushPendingRecords()
      }, BATCH_TIMEOUT)

      set({ updateTimer: newTimer })
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

  // 刷新待处理的记录
  flushPendingRecords: () => {
    const { pendingRecords, captureBuffer, updateTimer } = get()

    if (pendingRecords.length === 0) return

    // 批量添加到 buffer
    captureBuffer.addBatch([...pendingRecords])

    // 清除定时器
    if (updateTimer !== null) {
      clearTimeout(updateTimer)
    }

    const newCount = captureBuffer.length

    // 更新状态 - 关键：使用对象解构确保只更新必要的字段
    set({
      captureVersion: captureBuffer.currentVersion,
      captureCount: newCount, // 直接使用数字，不是对象
      pendingRecords: [],
      updateTimer: null
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
    const { captureBuffer, updateTimer } = get()

    // 清除定时器
    if (updateTimer !== null) {
      clearTimeout(updateTimer)
    }

    captureBuffer.clear()
    set({
      protocolSelectedIndex: null,
      captureVersion: captureBuffer.currentVersion,
      captureCount: 0,
      pendingRecords: [],
      updateTimer: null
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
    const { updateTimer, powerUpdateTimer } = get()

    // 清除定时器
    if (updateTimer !== null) {
      clearTimeout(updateTimer)
    }
    if (powerUpdateTimer !== null) {
      clearTimeout(powerUpdateTimer)
    }

    // 只重置设备状态，不清除数据
    set({
      isConnected: false,
      isConnecting: false,
      updateTimer: null,
      powerUpdateTimer: null,
    })
  },

  importRecords: (records, mode) => {
    const { captureBuffer, updateTimer } = get()

    // Flush any pending records first
    get().flushPendingRecords()

    // Clear timer if active
    if (updateTimer !== null) {
      clearTimeout(updateTimer)
    }

    // Replace or append based on mode
    if (mode === 'replace') {
      captureBuffer.clear()
    }

    captureBuffer.addBatch(records)

    set({
      protocolSelectedIndex: mode === 'replace' ? null : get().protocolSelectedIndex,
      captureVersion: captureBuffer.currentVersion,
      captureCount: captureBuffer.length,
      pendingRecords: [],
      updateTimer: null
    })
  }
}))

// 导出优化的选择器 - 使用浅比较
export const selectCaptureCount = (state: DeviceState) => state.captureCount
export const selectCaptureVersion = (state: DeviceState) => state.captureVersion
export const selectCaptureBuffer = (state: DeviceState) => state.captureBuffer
export const selectPowerCount = (state: DeviceState) => state.powerCount
export const selectPowerVersion = (state: DeviceState) => state.powerVersion
export const selectPowerBuffer = (state: DeviceState) => state.powerBuffer

export default useDeviceStore
