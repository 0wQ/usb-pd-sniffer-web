import type {
  CaptureDevice as BaseCaptureDevice,
  CaptureDeviceState,
  CaptureEventType,
  CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import { CAPTURE_EVENT } from '@usb-pd-sniffer/pd-device-types'
import {
  type CCPullConfig,
  encodeNativeWinusbTxCommandBody,
  NATIVE_WINUSB_PAYLOAD_MAX_LEN,
  NATIVE_WINUSB_REPORT_BODY_SIZE,
  NATIVE_WINUSB_REPORT_TYPE,
  NATIVE_WINUSB_TX_CMD,
  type NativeWinusbEventReport,
  type NativeWinusbTxCommand,
  nativeWinusbEventToCaptureEvent,
  parseNativeWinusbReportBody,
} from './protocol.js'

// native_winusb firmware: vendor-specific bulk interface, VID 0x1A86 / PID 0x2335.
// On Windows this interface is bound to WinUSB by the firmware's MS OS 2.0
// descriptors, which is what makes it reachable through WebUSB at all.
const DEVICE_FILTER = { vendorId: 0x1a86, productId: 0x2335 } as const
const USB_CONFIGURATION_VALUE = 1
const USB_INTERFACE_NUMBER = 0

// WebUSB's transferIn/transferOut take the endpoint NUMBER (0-15), not the
// endpoint address: the user agent supplies the direction bit itself. Passing
// the raw address 0x81 here makes Chrome reject every call with IndexSizeError
// ("endpoint number is out of range"), which kills the read pump, leaves the
// device's IN endpoint busy forever and makes the firmware's ring overflow.
//
// The firmware exposes one bidirectional endpoint: 0x01 OUT / 0x81 IN, so both
// directions are endpoint number 1.
const USB_IN_ENDPOINT = 1
const USB_OUT_ENDPOINT = 1

const STATUS_POLL_INTERVAL_MS = 500

// Number of bulk IN requests kept outstanding at all times.
//
// This is what makes the bulk transport actually faster than the HID one. With
// a single outstanding request the endpoint goes idle between the completion
// and the next submission, so the effective rate collapses to the host round
// trip and can end up no better than HID's 1ms interval. Keeping a window of
// reads pending lets the device push records back to back.
const DEFAULT_IN_FLIGHT_READS = 8

// Delay before re-issuing a bulk IN request that the user agent rejected. Keeps
// a permanently failing endpoint from spinning the CPU.
const READ_RETRY_DELAY_MS = 50

type UsbTransferStatus = 'ok' | 'stall' | 'babble'

type UsbInTransferResultLike = {
  readonly data?: DataView
  readonly status: UsbTransferStatus
}

type UsbOutTransferResultLike = {
  readonly bytesWritten: number
  readonly status: UsbTransferStatus
}

type UsbConfigurationLike = {
  readonly configurationValue: number
}

type UsbDeviceLike = {
  readonly vendorId: number
  readonly productId: number
  readonly productName?: string
  readonly opened: boolean
  readonly configuration: UsbConfigurationLike | null
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  releaseInterface(interfaceNumber: number): Promise<void>
  transferIn(
    endpointNumber: number,
    length: number,
  ): Promise<UsbInTransferResultLike>
  transferOut(
    endpointNumber: number,
    data: Uint8Array,
  ): Promise<UsbOutTransferResultLike>
}

type UsbConnectionEventLike = {
  readonly device: UsbDeviceLike
}

type UsbLike = {
  getDevices(): Promise<UsbDeviceLike[]>
  requestDevice(options: {
    filters: Array<{ vendorId: number; productId: number }>
  }): Promise<UsbDeviceLike>
  addEventListener(
    type: 'connect',
    listener: (event: UsbConnectionEventLike) => void,
  ): void
  addEventListener(
    type: 'disconnect',
    listener: (event: UsbConnectionEventLike) => void,
  ): void
  removeEventListener(
    type: 'connect',
    listener: (event: UsbConnectionEventLike) => void,
  ): void
  removeEventListener(
    type: 'disconnect',
    listener: (event: UsbConnectionEventLike) => void,
  ): void
}

type NavigatorWithUsb = {
  readonly usb?: UsbLike
}

type UfcsDirection = 'dp' | 'dm'

type PendingUfcsChunks = {
  dp: CaptureRecord | null
  dm: CaptureRecord | null
}

export type PdTxSop = 'SOP' | 'SOP_PRIME' | 'SOP_DPRIME'

/**
 * Counters carried by the firmware's STATUS report.
 *
 * `recvCount` is the device's monotonic event counter. If it advances while no
 * records appear, the firmware is producing events and the fault is in the
 * transport; if it stays put, the device has nothing to report.
 *
 * `dropCount` is how many events the monitor queue rejected, which is the only
 * signal for sizing MONITOR_EVENT_RB_SIZE.
 */
export type NativeWinusbStats = {
  recvCount: number
  dropCount: number
}

export type NativeWinusbDevice = BaseCaptureDevice & {
  sendRawPd(sop: PdTxSop, payload: Uint8Array): Promise<void>
  sendHardReset(): Promise<void>
  sendCableReset(): Promise<void>
  setCCPull(config: CCPullConfig): Promise<void>
  readStats(): NativeWinusbStats
  onStats(listener: (stats: NativeWinusbStats) => void): () => void
}

export type NativeWinusbDeviceOptions = {
  /** Bulk IN requests to keep outstanding. Defaults to 8. */
  readonly inFlightReads?: number
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

function getUsb(): UsbLike | null {
  const navigatorLike = (
    globalThis as unknown as { navigator?: NavigatorWithUsb }
  ).navigator
  return navigatorLike?.usb ?? null
}

function unsupportedError(): string {
  return 'WebUSB is not supported. Please use Chrome, Edge, or Opera.'
}

function copyDataViewBytes(data: DataView): Uint8Array {
  return Uint8Array.from(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  )
}

function deviceFingerprint(device: UsbDeviceLike): string {
  return `${device.vendorId}:${device.productId}:${device.productName ?? ''}`
}

function matchesTargetDevice(device: UsbDeviceLike): boolean {
  return (
    device.vendorId === DEVICE_FILTER.vendorId &&
    device.productId === DEVICE_FILTER.productId
  )
}

function pickPreferredDevice(
  devices: readonly UsbDeviceLike[],
  preferredFingerprint?: string | null,
): UsbDeviceLike | null {
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
  | typeof NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP0
  | typeof NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP1
  | typeof NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP2 {
  switch (sop) {
    case 'SOP':
      return NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP0
    case 'SOP_PRIME':
      return NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP1
    case 'SOP_DPRIME':
      return NATIVE_WINUSB_TX_CMD.SEND_RAW_SOP2
  }
}

function microampsToMilliamps(ibusUa: number): number {
  return ibusUa / 1000
}

function reportToRecord(report: NativeWinusbEventReport): CaptureRecord | null {
  const eventType = nativeWinusbEventToCaptureEvent(report.eventType)
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

function isPassthroughNativeWinusbRecordEvent(
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
        if (record.data_len >= NATIVE_WINUSB_PAYLOAD_MAX_LEN) {
          pending[direction] = cloneRecord(record)
          return output
        }

        output.push(record)
        return output
      }

      const output = flushPending(pending)
      if (isPassthroughNativeWinusbRecordEvent(record.event_type)) {
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

export function createNativeWinusbDevice(
  options: NativeWinusbDeviceOptions = {},
): NativeWinusbDevice {
  const usb = getUsb()
  const inFlightReads = Math.max(
    1,
    options.inFlightReads ?? DEFAULT_IN_FLIGHT_READS,
  )
  const recordListeners = new Set<(record: CaptureRecord) => void>()
  const stateListeners = new Set<(state: CaptureDeviceState) => void>()
  const statsListeners = new Set<(stats: NativeWinusbStats) => void>()
  const recordNormalizer = createCaptureRecordNormalizer()
  let latestStats: NativeWinusbStats = { recvCount: 0, dropCount: 0 }

  let device: UsbDeviceLike | null = null
  let claimed = false
  let isConnecting = false
  let isPrompting = false
  let isSending = false
  let error: string | null = usb === null ? unsupportedError() : null
  let autoReconnect = false
  let autoReconnectFingerprint: string | null = null
  let disposed = false
  let statusPollTimer: ReturnType<typeof setInterval> | null = null
  let statusPollInFlight = false
  let queuedCommandWrite: Promise<void> = Promise.resolve()

  // Bumped on every start/stop of the read pump. Callbacks captured by an older
  // pump compare their token and bail out, which keeps a stale in-flight read
  // from touching a device we have already let go.
  let readPumpToken = 0

  const snapshotState = (): CaptureDeviceState => ({
    isSupported: usb !== null,
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

  const enqueueCommandWrite = async (body: Uint8Array): Promise<void> => {
    const currentDevice = device
    if (currentDevice === null || !currentDevice.opened) {
      throw new Error('No WinUSB device connected.')
    }

    const writePromise = queuedCommandWrite.then(async () => {
      if (disposed || device !== currentDevice || !currentDevice.opened) return
      const result = await currentDevice.transferOut(
        USB_OUT_ENDPOINT,
        new Uint8Array(body),
      )
      if (result.status !== 'ok') {
        throw new Error(`Bulk OUT transfer failed: ${result.status}.`)
      }
    })
    queuedCommandWrite = writePromise.catch(() => undefined)
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
      await enqueueCommandWrite(
        encodeNativeWinusbTxCommandBody({
          opcode: NATIVE_WINUSB_TX_CMD.GET_STATUS,
        }),
      )
    } catch (caught) {
      if (!disposed && device !== null && device.opened) {
        error =
          caught instanceof Error
            ? caught.message
            : 'Failed to request native WinUSB status report.'
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

  const handleRecordBody = (body: Uint8Array): void => {
    try {
      const report = parseNativeWinusbReportBody(body)
      if (report.reportType === NATIVE_WINUSB_REPORT_TYPE.STATUS) {
        latestStats = {
          recvCount: report.recvCount,
          dropCount: report.dropCount,
        }
        for (const listener of statsListeners) listener(latestStats)
        return
      }

      const record = reportToRecord(report)
      if (record === null) {
        return
      }
      processRecord(record)
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : 'Failed to parse bulk IN record.'
      emitStatus()
    }
  }

  const handleInResult = (result: UsbInTransferResultLike): void => {
    if (result.status !== 'ok') {
      error = `Bulk IN transfer failed: ${result.status}.`
      emitStatus()
      return
    }

    const data = result.data
    if (
      data === undefined ||
      data.byteLength !== NATIVE_WINUSB_REPORT_BODY_SIZE
    ) {
      error = `Unexpected bulk IN length ${data?.byteLength ?? 0}; expected ${NATIVE_WINUSB_REPORT_BODY_SIZE}.`
      emitStatus()
      return
    }

    // A completed transfer proves the link recovered, so a previous read
    // failure should not stay pinned in the UI. A still-broken endpoint never
    // reaches this point, so its error remains visible.
    if (error !== null) {
      error = null
      emitStatus()
    }

    handleRecordBody(copyDataViewBytes(data))
  }

  const stopReadPump = (): void => {
    readPumpToken += 1
  }

  // Keeps `inFlightReads` bulk IN requests pending. Each completion immediately
  // issues the next one, so the window never drains — awaiting one transfer
  // before issuing the next would leave the endpoint idle between them.
  const startReadPump = (): void => {
    const currentDevice = device
    if (currentDevice === null || !currentDevice.opened) return

    readPumpToken += 1
    const token = readPumpToken

    const isStale = (): boolean =>
      disposed ||
      token !== readPumpToken ||
      device !== currentDevice ||
      !currentDevice.opened

    const reportReadFailure = (caught: unknown): void => {
      if (isStale()) return
      // A rejected request must NOT stop the pump. If the user agent refuses to
      // keep several requests outstanding on one endpoint, this degrades to
      // fewer reads in flight instead of silently stopping delivery altogether
      // (which leaves the device's IN endpoint permanently busy and the
      // firmware's ring overflowing).
      error =
        caught instanceof Error ? caught.message : 'Bulk IN transfer failed.'
      emitStatus()
      setTimeout(() => {
        if (!isStale()) issue()
      }, READ_RETRY_DELAY_MS)
    }

    const issue = (): void => {
      if (isStale()) return

      let transfer: Promise<UsbInTransferResultLike>
      try {
        transfer = currentDevice.transferIn(
          USB_IN_ENDPOINT,
          NATIVE_WINUSB_REPORT_BODY_SIZE,
        )
      } catch (caught) {
        // Some argument-validation failures surface synchronously rather than
        // as a rejected promise; both must be survivable.
        reportReadFailure(caught)
        return
      }

      transfer.then((result) => {
        if (isStale()) return
        handleInResult(result)
        issue()
      }, reportReadFailure)
    }

    for (let index = 0; index < inFlightReads; index += 1) {
      issue()
    }
  }

  const releaseClaimed = async (target: UsbDeviceLike): Promise<void> => {
    if (!claimed) return
    claimed = false
    try {
      await target.releaseInterface(USB_INTERFACE_NUMBER)
    } catch {
      // The device may already be gone; releasing is best effort.
    }
  }

  const attachDevice = async (nextDevice: UsbDeviceLike): Promise<void> => {
    if (disposed || isConnecting) return

    try {
      isConnecting = true
      emitStatus()

      if (!nextDevice.opened) {
        await nextDevice.open()
      }
      if (
        nextDevice.configuration?.configurationValue !== USB_CONFIGURATION_VALUE
      ) {
        await nextDevice.selectConfiguration(USB_CONFIGURATION_VALUE)
      }
      if (!claimed) {
        await nextDevice.claimInterface(USB_INTERFACE_NUMBER)
        claimed = true
      }

      device = nextDevice
      error = null
      recordNormalizer.reset()
      latestStats = { recvCount: 0, dropCount: 0 }
      startReadPump()
      startStatusPolling()
    } catch (caught) {
      await releaseClaimed(nextDevice)
      device = null
      error =
        caught instanceof Error
          ? caught.message
          : 'Failed to open WinUSB device.'
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
      usb === null ||
      disposed ||
      device?.opened ||
      isPrompting ||
      isConnecting
    )
      return

    const devices = await usb.getDevices()
    const preferred = pickPreferredDevice(
      devices,
      preferredFingerprint ?? autoReconnectFingerprint,
    )
    if (preferred === null) return
    await attachDevice(preferred)
  }

  const handleConnect = (): void => {
    if (!autoReconnect || disposed) return
    void connectAuthorized(autoReconnectFingerprint).catch((caught) => {
      error =
        caught instanceof Error ? caught.message : 'Auto reconnect failed.'
      emitStatus()
    })
  }

  const handleDisconnect = (event: UsbConnectionEventLike): void => {
    const current = device
    if (current === null) return

    const isCurrentDevice =
      event.device === current ||
      deviceFingerprint(event.device) === deviceFingerprint(current)
    if (!isCurrentDevice) return

    stopStatusPolling()
    stopReadPump()
    claimed = false
    recordNormalizer.reset()
    latestStats = { recvCount: 0, dropCount: 0 }
    device = null
    emitStatus()
  }

  if (usb !== null) {
    usb.addEventListener('connect', handleConnect)
    usb.addEventListener('disconnect', handleDisconnect)
  }

  const sendCommand = async (command: NativeWinusbTxCommand): Promise<void> => {
    if (device === null || !device.opened) {
      throw new Error('No WinUSB device connected.')
    }
    if (isSending) {
      throw new Error('A TX command is already in flight.')
    }

    try {
      isSending = true
      emitStatus()
      const body = encodeNativeWinusbTxCommandBody(command)
      await enqueueCommandWrite(body)
    } finally {
      isSending = false
      emitStatus()
    }
  }

  return {
    get isSupported() {
      return usb !== null
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
      if (usb === null) {
        throw new Error(unsupportedError())
      }
      if (disposed || isConnecting || isPrompting) return

      try {
        isPrompting = true
        isConnecting = true
        emitStatus()
        const selected = await usb.requestDevice({ filters: [DEVICE_FILTER] })
        isConnecting = false
        await attachDevice(selected)
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'NotFoundError') {
          error = null
          throw caught
        }

        error =
          caught instanceof Error
            ? caught.message
            : 'Failed to connect WinUSB device.'
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
        stopReadPump()
        await releaseClaimed(current)
        if (current.opened) {
          await current.close()
        }
      } finally {
        recordNormalizer.reset()
        latestStats = { recvCount: 0, dropCount: 0 }
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
      stopReadPump()
      if (usb !== null) {
        usb.removeEventListener('connect', handleConnect)
        usb.removeEventListener('disconnect', handleDisconnect)
      }

      const current = device
      device = null
      recordNormalizer.reset()
      latestStats = { recvCount: 0, dropCount: 0 }
      if (current?.opened) {
        void releaseClaimed(current).then(() =>
          current.close().catch(() => undefined),
        )
      }
      emitStatus()
    },
    async sendRawPd(sop: PdTxSop, payload: Uint8Array): Promise<void> {
      await sendCommand({ opcode: opcodeForSop(sop), payload })
    },
    async sendHardReset(): Promise<void> {
      await sendCommand({ opcode: NATIVE_WINUSB_TX_CMD.SEND_HARD_RESET })
    },
    async sendCableReset(): Promise<void> {
      await sendCommand({ opcode: NATIVE_WINUSB_TX_CMD.SEND_CABLE_RESET })
    },
    async setCCPull(config: CCPullConfig): Promise<void> {
      await sendCommand({
        opcode: NATIVE_WINUSB_TX_CMD.SET_CC_PULL,
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
    readStats(): NativeWinusbStats {
      return latestStats
    },
    onStats(listener: (stats: NativeWinusbStats) => void): () => void {
      statsListeners.add(listener)
      listener(latestStats)
      return () => statsListeners.delete(listener)
    },
  }
}
