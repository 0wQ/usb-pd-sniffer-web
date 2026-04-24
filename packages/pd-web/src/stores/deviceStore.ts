import { create } from 'zustand'
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

// 使用 Map 存储报告数据，按索引访问
class ReportsBuffer {
  private buffer: CaptureRecord[] = []
  private version: number = 0 // 用于触发更新

  add(report: CaptureRecord) {
    this.buffer.push(report)
    this.version++
  }

  // 批量添加
  addBatch(reports: CaptureRecord[]) {
    this.buffer.push(...reports)
    this.version++
  }

  get(index: number): CaptureRecord | undefined {
    return this.buffer[index]
  }

  get length(): number {
    return this.buffer.length
  }

  get currentVersion(): number {
    return this.version
  }

  clear() {
    this.buffer = []
    this.version++
  }

  // 获取所有数据的引用（注意：直接返回内部数组，不拷贝）
  getAll(): CaptureRecord[] {
    return this.buffer
  }
}

class PowerSamplesBuffer {
  private buffer: PowerSample[]
  private capacity: number
  private head: number = 0
  private count: number = 0
  private version: number = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array<PowerSample>(capacity)
  }

  add(sample: PowerSample) {
    this.buffer[this.head] = sample
    this.head = (this.head + 1) % this.capacity
    this.count = Math.min(this.count + 1, this.capacity)
    this.version++
  }

  addBatch(samples: PowerSample[]) {
    if (samples.length === 0) return

    for (const sample of samples) {
      this.buffer[this.head] = sample
      this.head = (this.head + 1) % this.capacity
      this.count = Math.min(this.count + 1, this.capacity)
    }

    this.version++
  }

  clear() {
    this.buffer = new Array<PowerSample>(this.capacity)
    this.head = 0
    this.count = 0
    this.version++
  }

  getRecent(limit: number): PowerSample[] {
    if (this.count === 0 || limit <= 0) return []

    const size = Math.min(limit, this.count)
    const start = (this.head - size + this.capacity) % this.capacity
    const result: PowerSample[] = []

    for (let index = 0; index < size; index += 1) {
      const sample = this.buffer[(start + index) % this.capacity]
      if (sample) {
        result.push(sample)
      }
    }

    return result
  }

  getLatest(): PowerSample | null {
    if (this.count === 0) return null
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity] ?? null
  }

  get length(): number {
    return this.count
  }

  get currentVersion(): number {
    return this.version
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
  reportsBuffer: ReportsBuffer
  powerBuffer: PowerSamplesBuffer
  // 用于触发组件更新的版本号
  reportsVersion: number
  powerVersion: number
  // 选择器：获取记录数量
  reportsCount: number
  powerCount: number

  // 批量更新相关
  pendingReports: CaptureRecord[]
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
  addReport: (report: CaptureRecord) => void
  addPowerSample: (sample: PowerSample) => void
  flushPendingReports: () => void
  flushPendingPowerSamples: () => void
  clearReports: () => void
  clearPowerSamples: () => void
  resetDevice: () => void
  importReports: (reports: CaptureRecord[], mode: 'replace' | 'append') => void
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
  reportsBuffer: new ReportsBuffer(),
  powerBuffer: new PowerSamplesBuffer(POWER_BUFFER_CAPACITY),
  reportsVersion: 0,
  powerVersion: 0,
  pendingReports: [],
  pendingPowerSamples: [],
  updateTimer: null,
  powerUpdateTimer: null,
  reportsCount: 0,
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
  addReport: (report) => {
    const { pendingReports, updateTimer } = get()

    // 添加到待处理队列
    pendingReports.push(report)

    // 检查是否达到批量更新阈值
    if (pendingReports.length >= BATCH_SIZE) {
      // 立即刷新
      get().flushPendingReports()
    } else if (updateTimer === null) {
      // 设置新的定时器
      const newTimer = window.setTimeout(() => {
        get().flushPendingReports()
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

  // 刷新待处理的报告
  flushPendingReports: () => {
    const { pendingReports, reportsBuffer, updateTimer } = get()

    if (pendingReports.length === 0) return

    // 批量添加到 buffer
    reportsBuffer.addBatch([...pendingReports])

    // 清除定时器
    if (updateTimer !== null) {
      clearTimeout(updateTimer)
    }

    const newCount = reportsBuffer.length

    // 更新状态 - 关键：使用对象解构确保只更新必要的字段
    set({
      reportsVersion: reportsBuffer.currentVersion,
      reportsCount: newCount, // 直接使用数字，不是对象
      pendingReports: [],
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

  clearReports: () => {
    const { reportsBuffer, updateTimer } = get()

    // 清除定时器
    if (updateTimer !== null) {
      clearTimeout(updateTimer)
    }

    reportsBuffer.clear()
    set({
      protocolSelectedIndex: null,
      reportsVersion: reportsBuffer.currentVersion,
      reportsCount: 0,
      pendingReports: [],
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

  importReports: (reports, mode) => {
    const { reportsBuffer, updateTimer } = get()

    // Flush any pending reports first
    get().flushPendingReports()

    // Clear timer if active
    if (updateTimer !== null) {
      clearTimeout(updateTimer)
    }

    // Replace or append based on mode
    if (mode === 'replace') {
      reportsBuffer.clear()
    }

    reportsBuffer.addBatch(reports)

    set({
      protocolSelectedIndex: mode === 'replace' ? null : get().protocolSelectedIndex,
      reportsVersion: reportsBuffer.currentVersion,
      reportsCount: reportsBuffer.length,
      pendingReports: [],
      updateTimer: null
    })
  }
}))

// 导出优化的选择器 - 使用浅比较
export const selectReportsCount = (state: DeviceState) => state.reportsCount
export const selectReportsVersion = (state: DeviceState) => state.reportsVersion
export const selectReportsBuffer = (state: DeviceState) => state.reportsBuffer
export const selectPowerCount = (state: DeviceState) => state.powerCount
export const selectPowerVersion = (state: DeviceState) => state.powerVersion
export const selectPowerBuffer = (state: DeviceState) => state.powerBuffer

export default useDeviceStore
