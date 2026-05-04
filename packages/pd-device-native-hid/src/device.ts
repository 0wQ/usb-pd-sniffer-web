import type {
  CaptureDevice as BaseCaptureDevice,
  CaptureDeviceState,
  CaptureEventType,
  CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import { CAPTURE_EVENT } from '@usb-pd-sniffer/pd-device-types'
import {
  encodeNativeHidTxCommandBody,
  NATIVE_HID_TX_CMD,
  NATIVE_HID_REPORT_BODY_SIZE,
  NATIVE_HID_REPORT_ID,
  NATIVE_HID_REPORT_TYPE,
  NATIVE_HID_PAYLOAD_MAX_LEN,
  nativeHidEventToCaptureEvent,
  parseNativeHidReportBody,
  type CCModeConfig,
  type NativeHidTxCommand,
  type NativeHidEventReport,
} from './nativeHidAdapter.js'

const DEVICE_FILTER = { vendorId: 0x1a86, productId: 0x2333 } as const
const STATUS_POLL_INTERVAL_MS = 500

type HidDeviceLike = {
  readonly vendorId: number
  readonly productId: number
  readonly productName?: string
  readonly opened: boolean
  open(): Promise<void>
  close(): Promise<void>
  sendReport(reportId: number, data: Uint8Array): Promise<void>
  addEventListener(
    type: 'inputreport',
    listener: (event: HidInputReportEventLike) => void,
  ): void
  removeEventListener(
    type: 'inputreport',
    listener: (event: HidInputReportEventLike) => void,
  ): void
}

type HidInputReportEventLike = {
  readonly reportId: number
  readonly data: DataView
}

type HidConnectionEventLike = {
  readonly device: HidDeviceLike
}

type HidLike = {
  getDevices(): Promise<HidDeviceLike[]>
  requestDevice(options: {
    filters: Array<typeof DEVICE_FILTER>
  }): Promise<HidDeviceLike[]>
  addEventListener(
    type: 'connect',
    listener: (event: HidConnectionEventLike) => void,
  ): void
  addEventListener(
    type: 'disconnect',
    listener: (event: HidConnectionEventLike) => void,
  ): void
  removeEventListener(
    type: 'connect',
    listener: (event: HidConnectionEventLike) => void,
  ): void
  removeEventListener(
    type: 'disconnect',
    listener: (event: HidConnectionEventLike) => void,
  ): void
}

type NavigatorWithHid = {
  readonly hid?: HidLike
}

type UfcsDirection = 'dp' | 'dm'

type PendingUfcsChunks = {
  dp: CaptureRecord | null
  dm: CaptureRecord | null
}

export type PdTxSop = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'

export type NativeHidDevice = BaseCaptureDevice & {
  sendRawPd(sop: PdTxSop, payload: Uint8Array): Promise<void>
  sendHardReset(): Promise<void>
  sendCableReset(): Promise<void>
  setCCMode(config: CCModeConfig): Promise<void>
}

export type CaptureRecordNormalizer = {
  push(record: CaptureRecord): CaptureRecord[]
  reset(): void
}

export function parsePdHexPayload(input: string): Uint8Array {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new Error('Raw PD payload is required.')
  }

  const compact = trimmed.replace(/0x/gi, '').replace(/[\s,_-]+/g, '')

  if (compact.length === 0) {
    throw new Error('Raw PD payload is required.')
  }

  if (compact.length % 2 !== 0) {
    throw new Error(
      `Raw PD payload hex length must be even, got ${compact.length}.`,
    )
  }

  if (!/^[0-9a-f]+$/i.test(compact)) {
    throw new Error('Raw PD payload contains non-hex characters.')
  }

  const bytes = new Uint8Array(compact.length / 2)
  for (let index = 0; index < compact.length; index += 2) {
    bytes[index / 2] = Number.parseInt(compact.slice(index, index + 2), 16)
  }

  return bytes
}

function getHid(): HidLike | null {
  const navigatorLike = (
    globalThis as unknown as { navigator?: NavigatorWithHid }
  ).navigator
  return navigatorLike?.hid ?? null
}

function copyDataViewBytes(data: DataView): Uint8Array {
  return Uint8Array.from(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  )
}

function deviceFingerprint(device: HidDeviceLike): string {
  return `${device.vendorId}:${device.productId}:${device.productName ?? ''}`
}

function matchesTargetDevice(device: HidDeviceLike): boolean {
  return (
    device.vendorId === DEVICE_FILTER.vendorId &&
    device.productId === DEVICE_FILTER.productId
  )
}

function pickPreferredDevice(
  devices: readonly HidDeviceLike[],
  preferredFingerprint?: string | null,
): HidDeviceLike | null {
  const candidates = devices.filter(matchesTargetDevice)
  if (candidates.length === 0) return null

  if (preferredFingerprint) {
    const preferred = candidates.find(
      (device) => deviceFingerprint(device) === preferredFingerprint,
    )
    if (preferred) return preferred
  }

  return candidates[0] ?? null
}

function opcodeForSop(
  sop: PdTxSop,
):
  | typeof NATIVE_HID_TX_CMD.SEND_RAW_SOP0
  | typeof NATIVE_HID_TX_CMD.SEND_RAW_SOP1
  | typeof NATIVE_HID_TX_CMD.SEND_RAW_SOP2 {
  switch (sop) {
    case 'SOP':
      return NATIVE_HID_TX_CMD.SEND_RAW_SOP0
    case 'SOP_PRIME':
      return NATIVE_HID_TX_CMD.SEND_RAW_SOP1
    case 'SOP_DPRIME':
      return NATIVE_HID_TX_CMD.SEND_RAW_SOP2
  }
}

function normalizeReportBody(reportId: number, data: DataView): Uint8Array {
  const bytes = copyDataViewBytes(data)

  if (reportId !== NATIVE_HID_REPORT_ID) {
    throw new Error(
      `Unexpected HID input report ID ${reportId}; expected ${NATIVE_HID_REPORT_ID}.`,
    )
  }

  if (bytes.length !== NATIVE_HID_REPORT_BODY_SIZE) {
    throw new Error(
      `Unexpected HID input report length ${bytes.length}; expected ${NATIVE_HID_REPORT_BODY_SIZE}.`,
    )
  }

  return bytes
}

function microampsToMilliamps(ibusUa: number): number {
  return ibusUa / 1000
}

function reportToRecord(report: NativeHidEventReport): CaptureRecord | null {
  const eventType = nativeHidEventToCaptureEvent(report.eventType)
  if (eventType === null) {
    return null
  }

  return {
    timestamp_us: report.timestampUs,
    seq: report.recvCount,
    vbus_mv: report.snapshot.vbusMv,
    ibus_ma: microampsToMilliamps(report.snapshot.ibusUa),
    cc1_mv: report.snapshot.cc1Mv,
    cc2_mv: report.snapshot.cc2Mv,
    dp_mv: report.snapshot.dpMv,
    dm_mv: report.snapshot.dmMv,
    event_type: eventType,
    active_cc: report.activeCC,
    data_len: report.payloadLen,
    data: Array.from(report.payload),
  }
}

function isPassthroughNativeHidRecordEvent(
  eventType: CaptureEventType,
): boolean {
  return (
    eventType === CAPTURE_EVENT.DISCONNECT ||
    eventType === CAPTURE_EVENT.CC1_CONNECT ||
    eventType === CAPTURE_EVENT.CC2_CONNECT ||
    eventType === CAPTURE_EVENT.PD_SOP0 ||
    eventType === CAPTURE_EVENT.PD_SOP1 ||
    eventType === CAPTURE_EVENT.PD_SOP2 ||
    eventType === CAPTURE_EVENT.PD_SOP1_DEBUG ||
    eventType === CAPTURE_EVENT.PD_SOP2_DEBUG ||
    eventType === CAPTURE_EVENT.PD_HARD_RESET ||
    eventType === CAPTURE_EVENT.PD_CABLE_RESET
  )
}

function ufcsDirection(eventType: CaptureEventType): UfcsDirection | null {
  switch (eventType) {
    case CAPTURE_EVENT.UFCS_DP:
      return 'dp'
    case CAPTURE_EVENT.UFCS_DM:
      return 'dm'
    default:
      return null
  }
}

function cloneRecord(record: CaptureRecord): CaptureRecord {
  return {
    ...record,
    data: record.data.slice(0, record.data_len),
  }
}

function assembleUfcsRecord(
  chunk0: CaptureRecord,
  chunk1: CaptureRecord,
): CaptureRecord {
  const data = [
    ...chunk0.data.slice(0, chunk0.data_len),
    ...chunk1.data.slice(0, chunk1.data_len),
  ]

  return {
    ...chunk0,
    data_len: data.length,
    data: data,
  }
}

function flushPending(pending: PendingUfcsChunks): CaptureRecord[] {
  const flushed: CaptureRecord[] = []
  if (pending.dp !== null) {
    flushed.push(cloneRecord(pending.dp))
    pending.dp = null
  }
  if (pending.dm !== null) {
    flushed.push(cloneRecord(pending.dm))
    pending.dm = null
  }
  return flushed
}

export function createCaptureRecordNormalizer(): CaptureRecordNormalizer {
  const pending: PendingUfcsChunks = {
    dp: null,
    dm: null,
  }

  return {
    push(record: CaptureRecord): CaptureRecord[] {
      const direction = ufcsDirection(record.event_type)
      if (direction !== null) {
        const otherDirection: UfcsDirection = direction === 'dp' ? 'dm' : 'dp'
        const otherPrevious = pending[otherDirection]
        pending[otherDirection] = null
        const previous = pending[direction]
        pending[direction] = null

        if (
          otherPrevious === null &&
          previous !== null &&
          previous.seq === record.seq &&
          previous.event_type === record.event_type
        ) {
          return [assembleUfcsRecord(previous, record)]
        }

        const output = previous === null ? [] : [cloneRecord(previous)]
        if (otherPrevious !== null) {
          output.push(cloneRecord(otherPrevious))
        }
        if (record.data_len >= NATIVE_HID_PAYLOAD_MAX_LEN) {
          pending[direction] = cloneRecord(record)
          return output
        }

        output.push(record)
        return output
      }

      const output = flushPending(pending)
      if (isPassthroughNativeHidRecordEvent(record.event_type)) {
        output.push(record)
      }
      return output
    },
    reset(): void {
      pending.dp = null
      pending.dm = null
    },
  }
}

export function createNativeHidDevice(): NativeHidDevice {
  const hid = getHid()
  const recordListeners = new Set<(record: CaptureRecord) => void>()
  const stateListeners = new Set<(state: CaptureDeviceState) => void>()
  const recordNormalizer = createCaptureRecordNormalizer()

  let device: HidDeviceLike | null = null
  let isConnecting = false
  let isPrompting = false
  let isSending = false
  let error: string | null =
    hid === null
      ? 'WebHID is not supported. Please use Chrome, Edge, or Opera.'
      : null
  let autoReconnect = false
  let autoReconnectFingerprint: string | null = null
  let disposed = false
  let latestStats = { recv_count: 0, drop_count: 0 }
  let statusPollTimer: ReturnType<typeof setInterval> | null = null
  let statusPollInFlight = false
  let queuedReportWrite: Promise<void> = Promise.resolve()

  const snapshotState = (): CaptureDeviceState => ({
    isSupported: hid !== null,
    isConnected: device?.opened ?? false,
    isConnecting,
    isSending,
    error,
    productName: device?.productName ?? null,
    fingerprint: device === null ? null : deviceFingerprint(device),
  })

  const emitStatus = (): void => {
    const state = snapshotState()
    for (const listener of stateListeners) listener(state)
  }

  const emitRecord = (record: CaptureRecord): void => {
    for (const listener of recordListeners) listener(record)
  }

  const emitStats = (_stats: typeof latestStats): void => {}

  const processRecord = (record: CaptureRecord): void => {
    for (const normalizedRecord of recordNormalizer.push(record)) {
      emitRecord(normalizedRecord)
    }
  }

  const stopStatusPolling = (): void => {
    if (statusPollTimer !== null) {
      clearInterval(statusPollTimer)
      statusPollTimer = null
    }
    statusPollInFlight = false
  }

  const enqueueReportWrite = async (body: Uint8Array): Promise<void> => {
    const currentDevice = device
    if (currentDevice === null || !currentDevice.opened) {
      throw new Error('No HID device connected.')
    }

    const writePromise = queuedReportWrite.then(async () => {
      if (disposed || device !== currentDevice || !currentDevice.opened) return
      await currentDevice.sendReport(NATIVE_HID_REPORT_ID, new Uint8Array(body))
    })
    queuedReportWrite = writePromise.catch(() => undefined)
    return writePromise
  }

  const requestStatusReport = async (): Promise<void> => {
    if (
      disposed ||
      device === null ||
      !device.opened ||
      isSending ||
      statusPollInFlight
    )
      return

    statusPollInFlight = true
    try {
      await enqueueReportWrite(
        encodeNativeHidTxCommandBody({
          opcode: NATIVE_HID_TX_CMD.GET_STATUS,
        }),
      )
    } catch (caught) {
      if (!disposed && device !== null && device.opened) {
        error =
          caught instanceof Error
            ? caught.message
            : 'Failed to request native HID status report.'
        emitStatus()
      }
    } finally {
      statusPollInFlight = false
    }
  }

  const startStatusPolling = (): void => {
    stopStatusPolling()
    if (device === null || !device.opened) return
    statusPollTimer = setInterval(() => {
      void requestStatusReport()
    }, STATUS_POLL_INTERVAL_MS)
    void requestStatusReport()
  }

  const handleInputReport = (event: HidInputReportEventLike): void => {
    try {
      const report = parseNativeHidReportBody(
        normalizeReportBody(event.reportId, event.data),
      )
      if (report.reportType === NATIVE_HID_REPORT_TYPE.STATUS) {
        latestStats = {
          recv_count: report.recvCount,
          drop_count: report.dropCount,
        }
        emitStats(latestStats)
        return
      }

      const record = reportToRecord(report)
      if (record === null) {
        return
      }
      latestStats = {
        recv_count: record.seq,
        drop_count: latestStats.drop_count,
      }
      emitStats(latestStats)
      processRecord(record)
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : 'Failed to parse HID input report.'
      emitStatus()
    }
  }

  const setupDevice = async (nextDevice: HidDeviceLike): Promise<void> => {
    if (disposed) return

    if (nextDevice.opened) {
      device = nextDevice
      error = null
      latestStats = { recv_count: 0, drop_count: 0 }
      nextDevice.addEventListener('inputreport', handleInputReport)
      startStatusPolling()
      emitStatus()
      return
    }

    if (isConnecting) return

    try {
      isConnecting = true
      emitStatus()
      await nextDevice.open()
      device = nextDevice
      error = null
      latestStats = { recv_count: 0, drop_count: 0 }
      nextDevice.addEventListener('inputreport', handleInputReport)
      startStatusPolling()
    } catch (caught) {
      device = null
      error =
        caught instanceof Error ? caught.message : 'Failed to open HID device.'
      throw caught
    } finally {
      isConnecting = false
      emitStatus()
    }
  }

  const connectAuthorized = async (
    preferredFingerprint?: string | null,
  ): Promise<void> => {
    if (
      hid === null ||
      disposed ||
      device?.opened ||
      isPrompting ||
      isConnecting
    )
      return

    const devices = await hid.getDevices()
    const preferred = pickPreferredDevice(
      devices,
      preferredFingerprint ?? autoReconnectFingerprint,
    )
    if (preferred === null) return
    await setupDevice(preferred)
  }

  const handleConnect = (): void => {
    if (!autoReconnect || disposed) return
    void connectAuthorized(autoReconnectFingerprint).catch((caught) => {
      error =
        caught instanceof Error ? caught.message : 'Auto reconnect failed.'
      emitStatus()
    })
  }

  const handleDisconnect = (event: HidConnectionEventLike): void => {
    const current = device
    if (current === null) return

    const isCurrentDevice =
      event.device === current ||
      deviceFingerprint(event.device) === deviceFingerprint(current)
    if (!isCurrentDevice) return

    stopStatusPolling()
    current.removeEventListener('inputreport', handleInputReport)
    recordNormalizer.reset()
    latestStats = { recv_count: 0, drop_count: 0 }
    device = null
    emitStatus()
  }

  if (hid !== null) {
    hid.addEventListener('connect', handleConnect)
    hid.addEventListener('disconnect', handleDisconnect)
  }

  const sendCommand = async (command: NativeHidTxCommand): Promise<void> => {
    if (device === null || !device.opened) {
      throw new Error('No HID device connected.')
    }
    if (isSending) {
      throw new Error('A TX command is already in flight.')
    }

    try {
      isSending = true
      emitStatus()
      const body = encodeNativeHidTxCommandBody(command)
      await enqueueReportWrite(body)
    } finally {
      isSending = false
      emitStatus()
    }
  }

  return {
    get isSupported() {
      return hid !== null
    },
    get isConnected() {
      return device?.opened ?? false
    },
    get isConnecting() {
      return isConnecting
    },
    get isSending() {
      return isSending
    },
    get error() {
      return error
    },
    get productName() {
      return device?.productName ?? null
    },
    get fingerprint() {
      return device === null ? null : deviceFingerprint(device)
    },
    async connect(): Promise<void> {
      if (hid === null) {
        throw new Error(
          'WebHID is not supported. Please use Chrome, Edge, or Opera.',
        )
      }
      if (disposed || isConnecting || isPrompting) return

      try {
        isPrompting = true
        isConnecting = true
        emitStatus()
        const devices = await hid.requestDevice({ filters: [DEVICE_FILTER] })
        const selected = devices[0] ?? null
        if (selected === null) return
        isConnecting = false
        await setupDevice(selected)
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'NotFoundError') {
          error = null
          throw caught
        }

        error =
          caught instanceof Error
            ? caught.message
            : 'Failed to connect HID device.'
        throw caught
      } finally {
        isPrompting = false
        isConnecting = false
        emitStatus()
      }
    },
    connectAuthorized,
    async disconnect(): Promise<void> {
      if (device === null) {
        emitStatus()
        return
      }

      const current = device
      try {
        stopStatusPolling()
        current.removeEventListener('inputreport', handleInputReport)
        if (current.opened) {
          await current.close()
        }
      } finally {
        recordNormalizer.reset()
        latestStats = { recv_count: 0, drop_count: 0 }
        device = null
        emitStatus()
      }
    },
    setAutoReconnect(
      enabled: boolean,
      preferredFingerprint?: string | null,
    ): void {
      autoReconnect = enabled
      autoReconnectFingerprint = preferredFingerprint ?? null
    },
    dispose(): void {
      disposed = true
      stopStatusPolling()
      if (hid !== null) {
        hid.removeEventListener('connect', handleConnect)
        hid.removeEventListener('disconnect', handleDisconnect)
      }
      if (device !== null) {
        device.removeEventListener('inputreport', handleInputReport)
      }
      recordNormalizer.reset()
      latestStats = { recv_count: 0, drop_count: 0 }
      device = null
      emitStatus()
    },
    async sendRawPd(sop: PdTxSop, payload: Uint8Array): Promise<void> {
      await sendCommand({ opcode: opcodeForSop(sop), payload })
    },
    async sendHardReset(): Promise<void> {
      await sendCommand({ opcode: NATIVE_HID_TX_CMD.SEND_HARD_RESET })
    },
    async sendCableReset(): Promise<void> {
      await sendCommand({ opcode: NATIVE_HID_TX_CMD.SEND_CABLE_RESET })
    },
    async setCCMode(config: CCModeConfig): Promise<void> {
      await sendCommand({
        opcode: NATIVE_HID_TX_CMD.SET_CC_MODE,
        activeCC: config.activeCC,
        cc1: config.cc1,
        cc2: config.cc2,
      })
    },
    onRecord(listener: (record: CaptureRecord) => void): () => void {
      recordListeners.add(listener)
      return () => recordListeners.delete(listener)
    },
    onState(listener: (state: CaptureDeviceState) => void): () => void {
      stateListeners.add(listener)
      listener(snapshotState())
      return () => stateListeners.delete(listener)
    },
  }
}
