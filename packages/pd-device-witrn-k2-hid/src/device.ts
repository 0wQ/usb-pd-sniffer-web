import type {
  CaptureDevice,
  CaptureDeviceState,
  CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import {
  encodeWitrnK2ForceGeneralReportBody,
  inferWitrnK2ActiveCc,
  parseWitrnK2InputReport,
  WITRN_K2_HID_REPORT_ID,
  WITRN_K2_HID_REPORT_SIZE,
  WITRN_K2_HID_USB,
  type WitrnK2Snapshot,
} from './protocol.js'

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
    filters: Array<typeof WITRN_K2_HID_USB>
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

const EMPTY_SNAPSHOT: WitrnK2Snapshot = {
  vbusMv: 0,
  ibusMa: 0,
  cc1Mv: 0,
  cc2Mv: 0,
}

function unsupportedError(): string {
  return 'WebHID is not supported. Please use Chrome, Edge, or Opera.'
}

function getHid(): HidLike | null {
  const navigatorLike = (
    globalThis as unknown as { navigator?: NavigatorWithHid }
  ).navigator
  return navigatorLike?.hid ?? null
}

function nowMicros(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.round(performance.now() * 1000)
  }
  return Date.now() * 1000
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
    device.vendorId === WITRN_K2_HID_USB.vendorId &&
    device.productId === WITRN_K2_HID_USB.productId
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

function normalizeReportBody(reportId: number, data: DataView): Uint8Array {
  const bytes = copyDataViewBytes(data)

  if (reportId !== WITRN_K2_HID_REPORT_ID) {
    throw new Error(
      `Unexpected WITRN K2 input report ID ${reportId}; expected ${WITRN_K2_HID_REPORT_ID}.`,
    )
  }

  if (bytes.length !== WITRN_K2_HID_REPORT_SIZE) {
    throw new Error(
      `Unexpected WITRN K2 input report length ${bytes.length}; expected ${WITRN_K2_HID_REPORT_SIZE}.`,
    )
  }

  return bytes
}

export function createWitrnK2HidDevice(): CaptureDevice {
  const hid = getHid()
  const recordListeners = new Set<(record: CaptureRecord) => void>()
  const stateListeners = new Set<(state: CaptureDeviceState) => void>()

  let device: HidDeviceLike | null = null
  let isConnecting = false
  let isPrompting = false
  let error: string | null = hid === null ? unsupportedError() : null
  let autoReconnect = false
  let autoReconnectFingerprint: string | null = null
  let disposed = false
  let latestSnapshot = EMPTY_SNAPSHOT
  let latestActiveCc: 0 | 1 | 2 = 0
  let recordSeq = 0
  let queuedReportWrite: Promise<void> = Promise.resolve()

  const snapshotState = (): CaptureDeviceState => ({
    isSupported: hid !== null,
    isConnected: device?.opened ?? false,
    isConnecting,
    isSending: false,
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

  const resetSnapshot = (): void => {
    latestSnapshot = EMPTY_SNAPSHOT
    latestActiveCc = 0
  }

  const enqueueReportWrite = async (body: Uint8Array): Promise<void> => {
    const currentDevice = device
    if (currentDevice === null || !currentDevice.opened) {
      throw new Error('No WITRN K2 device connected.')
    }

    const writePromise = queuedReportWrite.then(async () => {
      if (disposed || device !== currentDevice || !currentDevice.opened) return
      await currentDevice.sendReport(WITRN_K2_HID_REPORT_ID, new Uint8Array(body))
    })
    queuedReportWrite = writePromise.catch(() => undefined)
    return writePromise
  }

  const requestGeneralReport = async (): Promise<void> => {
    try {
      await enqueueReportWrite(encodeWitrnK2ForceGeneralReportBody())
    } catch (caught) {
      if (!disposed && device !== null && device.opened) {
        error =
          caught instanceof Error
            ? caught.message
            : 'Failed to request WITRN K2 general report.'
        emitStatus()
      }
    }
  }

  const handleInputReport = (event: HidInputReportEventLike): void => {
    try {
      const report = parseWitrnK2InputReport(
        normalizeReportBody(event.reportId, event.data),
      )

      if (report.kind === 'general') {
        latestSnapshot = report.snapshot
        latestActiveCc = inferWitrnK2ActiveCc(report.snapshot)
        return
      }

      recordSeq += 1
      emitRecord({
        timestamp_us: nowMicros(),
        seq: recordSeq,
        vbus_mv: latestSnapshot.vbusMv,
        ibus_ma: latestSnapshot.ibusMa,
        cc1_mv: latestSnapshot.cc1Mv,
        cc2_mv: latestSnapshot.cc2Mv,
        dp_mv: 0,
        dm_mv: 0,
        event_type: report.eventType,
        active_cc: latestActiveCc,
        data_len: report.payload.length,
        data: Array.from(report.payload),
      })
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : 'Failed to parse WITRN K2 input report.'
      emitStatus()
    }
  }

  const setupDevice = async (nextDevice: HidDeviceLike): Promise<void> => {
    if (disposed) return

    if (nextDevice.opened) {
      device = nextDevice
      error = null
      resetSnapshot()
      recordSeq = 0
      nextDevice.addEventListener('inputreport', handleInputReport)
      emitStatus()
      void requestGeneralReport()
      return
    }

    if (isConnecting) return

    try {
      isConnecting = true
      emitStatus()
      await nextDevice.open()
      device = nextDevice
      error = null
      resetSnapshot()
      recordSeq = 0
      nextDevice.addEventListener('inputreport', handleInputReport)
      void requestGeneralReport()
    } catch (caught) {
      device = null
      error =
        caught instanceof Error
          ? caught.message
          : 'Failed to open WITRN K2 HID device.'
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
    ) {
      return
    }

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
        caught instanceof Error
          ? caught.message
          : 'WITRN K2 auto reconnect failed.'
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

    current.removeEventListener('inputreport', handleInputReport)
    device = null
    resetSnapshot()
    emitStatus()
  }

  if (hid !== null) {
    hid.addEventListener('connect', handleConnect)
    hid.addEventListener('disconnect', handleDisconnect)
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
      return false
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
        throw new Error(unsupportedError())
      }
      if (disposed || isConnecting || isPrompting) return

      try {
        isPrompting = true
        isConnecting = true
        emitStatus()
        const devices = await hid.requestDevice({ filters: [WITRN_K2_HID_USB] })
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
            : 'Failed to connect WITRN K2 HID device.'
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
        current.removeEventListener('inputreport', handleInputReport)
        if (current.opened) {
          await current.close()
        }
      } finally {
        device = null
        resetSnapshot()
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
      if (hid !== null) {
        hid.removeEventListener('connect', handleConnect)
        hid.removeEventListener('disconnect', handleDisconnect)
      }
      if (device !== null) {
        device.removeEventListener('inputreport', handleInputReport)
      }
      device = null
      resetSnapshot()
      emitStatus()
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
