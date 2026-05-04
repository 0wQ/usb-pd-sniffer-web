import type {
  CaptureDevice,
  CaptureDeviceState,
  CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import {
  NativeCdcFrameParser,
  NATIVE_CDC_FRAME_TYPE_EVENT,
  NATIVE_CDC_USB,
  nativeCdcEventToCaptureEvent,
  parseNativeCdcEventPayload,
} from './protocol.js'

const DEVICE_FILTER = {
  usbVendorId: NATIVE_CDC_USB.vendorId,
  usbProductId: NATIVE_CDC_USB.productId,
} as const

const DEFAULT_SERIAL_BUFFER_SIZE = 1 << 20
const HOTPLUG_OPEN_SETTLE_DELAY_MS = 300
const SERIAL_OPEN_TIMEOUT_MS = 10000
const SERIAL_SIGNAL_TIMEOUT_MS = 1500
const SERIAL_CLOSE_TIMEOUT_MS = 1500
const READ_LOOP_RESTART_DELAY_MS = 50

type SerialPortInfoLike = {
  readonly usbVendorId?: number
  readonly usbProductId?: number
}

type SerialPortOpenOptionsLike = {
  readonly baudRate: number
  readonly bufferSize?: number
}

type SerialPortSignalsLike = {
  readonly dataTerminalReady?: boolean
  readonly requestToSend?: boolean
}

type SerialPortLike = {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  readonly connected?: boolean
  getInfo(): SerialPortInfoLike
  open(options: SerialPortOpenOptionsLike): Promise<void>
  close(): Promise<void>
  setSignals?(signals: SerialPortSignalsLike): Promise<void>
}

type SerialConnectionEventLike = Event & {
  readonly port?: SerialPortLike
  readonly target: EventTarget | null
}

type SerialLike = {
  getPorts(): Promise<SerialPortLike[]>
  requestPort(options: {
    filters: Array<typeof DEVICE_FILTER>
  }): Promise<SerialPortLike>
  addEventListener(
    type: 'connect',
    listener: (event: SerialConnectionEventLike) => void,
  ): void
  addEventListener(
    type: 'disconnect',
    listener: (event: SerialConnectionEventLike) => void,
  ): void
  removeEventListener(
    type: 'connect',
    listener: (event: SerialConnectionEventLike) => void,
  ): void
  removeEventListener(
    type: 'disconnect',
    listener: (event: SerialConnectionEventLike) => void,
  ): void
}

type NavigatorWithSerial = {
  readonly serial?: SerialLike
}

export type NativeCdcDeviceOptions = {
  readonly baudRate?: number
  readonly bufferSize?: number
}

function getSerial(): SerialLike | null {
  const navigatorLike = (
    globalThis as unknown as { navigator?: NavigatorWithSerial }
  ).navigator
  return navigatorLike?.serial ?? null
}

function portFingerprint(port: SerialPortLike): string {
  const info = port.getInfo()
  return `${info.usbVendorId ?? ''}:${info.usbProductId ?? ''}`
}

function portDebugInfo(port: SerialPortLike): Record<string, unknown> {
  const info = port.getInfo()
  return {
    usbVendorId: info.usbVendorId,
    usbProductId: info.usbProductId,
    connected: port.connected,
    readable: port.readable !== null,
    writable: port.writable !== null,
    fingerprint: portFingerprint(port),
  }
}

function isSerialPortLike(value: unknown): value is SerialPortLike {
  return typeof value === 'object' && value !== null && 'getInfo' in value
}

function portFromConnectionEvent(
  event: SerialConnectionEventLike,
): SerialPortLike | null {
  if (event.port !== undefined) {
    return event.port
  }

  return isSerialPortLike(event.target) ? event.target : null
}

function matchesTargetPort(port: SerialPortLike): boolean {
  const info = port.getInfo()
  return (
    info.usbVendorId === NATIVE_CDC_USB.vendorId &&
    info.usbProductId === NATIVE_CDC_USB.productId
  )
}

function pickPreferredPort(
  ports: readonly SerialPortLike[],
  preferredFingerprint?: string | null,
): SerialPortLike | null {
  const candidates = ports.filter(matchesTargetPort)
  if (candidates.length === 0) return null

  if (preferredFingerprint) {
    const preferred = candidates.find(
      (port) => portFingerprint(port) === preferredFingerprint,
    )
    if (preferred) return preferred
  }

  return candidates[0] ?? null
}

function unsupportedError(): string {
  return 'Web Serial is not supported. Please use Chrome, Edge, or Opera.'
}

function debugLog(message: string, details?: Record<string, unknown>): void {
  const prefix = `[native-cdc ${new Date().toISOString()}] ${message}`
  if (details === undefined) {
    console.log(prefix)
    return
  }
  console.log(prefix, details)
}

function errorDetails(caught: unknown): Record<string, unknown> {
  if (caught instanceof Error) {
    return {
      name: caught.name,
      message: caught.message,
      stack: caught.stack,
    }
  }

  return { value: caught }
}

function isRecoverableReadError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === 'BreakError'
}

function timeoutError(message: string): Error {
  const error = new Error(message)
  error.name = 'TimeoutError'
  return error
}

function delayReject(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(timeoutError(message)), ms)
  })
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return Promise.race([promise, delayReject(ms, message)])
}

export function createNativeCdcDevice(
  options: NativeCdcDeviceOptions = {},
): CaptureDevice {
  const serial = getSerial()
  const baudRate = options.baudRate ?? NATIVE_CDC_USB.baudRate
  const bufferSize = options.bufferSize ?? DEFAULT_SERIAL_BUFFER_SIZE
  debugLog('create device', {
    hasSerial: serial !== null,
    baudRate,
    bufferSize,
  })
  const recordListeners = new Set<(record: CaptureRecord) => void>()
  const stateListeners = new Set<(state: CaptureDeviceState) => void>()
  const frameParser = new NativeCdcFrameParser()

  let port: SerialPortLike | null = null
  let isOpen = false
  let isConnecting = false
  let isPrompting = false
  let isSending = false
  let readLoopGeneration = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let readLoopPromise: Promise<void> | null = null
  let error: string | null = serial === null ? unsupportedError() : null
  let autoReconnect = false
  let autoReconnectFingerprint: string | null = null
  let hotplugTimer: ReturnType<typeof setTimeout> | null = null
  let hotplugCandidatePort: SerialPortLike | null = null
  let connectAttemptToken = 0
  let rxChunkCount = 0
  let rxByteCount = 0
  let rxStatsTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const snapshotState = (): CaptureDeviceState => ({
    isSupported: serial !== null,
    isConnected: isOpen,
    isConnecting,
    isSending,
    error,
    productName: null,
    fingerprint: port === null ? null : portFingerprint(port),
  })

  const emitState = (): void => {
    const state = snapshotState()
    for (const listener of stateListeners) listener(state)
  }

  const emitRecord = (record: CaptureRecord): void => {
    for (const listener of recordListeners) listener(record)
  }

  const cancelHotplugOpen = (): void => {
    if (hotplugTimer !== null) {
      clearTimeout(hotplugTimer)
      hotplugTimer = null
    }
    hotplugCandidatePort = null
  }

  const flushRxStats = (): void => {
    if (rxStatsTimer !== null) {
      clearTimeout(rxStatsTimer)
      rxStatsTimer = null
    }
    if (rxChunkCount === 0) return
    debugLog('rx stats', {
      chunks: rxChunkCount,
      bytes: rxByteCount,
    })
    rxChunkCount = 0
    rxByteCount = 0
  }

  const recordRxChunk = (bytes: number): void => {
    rxChunkCount += 1
    rxByteCount += bytes
    if (rxStatsTimer !== null) return
    rxStatsTimer = setTimeout(flushRxStats, 1000)
  }

  const emitRecordsFromChunk = (chunk: Uint8Array): void => {
    recordRxChunk(chunk.length)
    for (const frame of frameParser.push(chunk)) {
      if (frame.type !== NATIVE_CDC_FRAME_TYPE_EVENT) continue

      let rawRecord: ReturnType<typeof parseNativeCdcEventPayload>
      try {
        rawRecord = parseNativeCdcEventPayload(frame.payload)
      } catch (caught) {
        error =
          caught instanceof Error
            ? caught.message
            : 'Failed to parse native CDC event frame.'
        emitState()
        continue
      }

      const captureEventType = nativeCdcEventToCaptureEvent(
        rawRecord.event_type,
      )
      if (captureEventType === null) {
        continue
      }
      const record: CaptureRecord = {
        ...rawRecord,
        event_type: captureEventType,
      }
      emitRecord(record)
    }
  }

  const detachCurrentPort = (
    currentPort: SerialPortLike,
    nextError: string | null,
  ): void => {
    if (port !== currentPort) return
    debugLog('detach current port', {
      ...portDebugInfo(currentPort),
      error: nextError,
    })
    port = null
    isOpen = false
    isSending = false
    frameParser.reset()
    if (nextError !== null) {
      error = nextError
    }
    emitState()
  }

  const cancelCurrentReader = (): void => {
    debugLog('cancel current reader')
    void reader?.cancel().catch(() => {
      // The stream may already be closed after unplug or browser cleanup.
    })
  }

  const startReadLoop = (
    currentPort: SerialPortLike,
    options: { restartOnBreak?: boolean } = {},
  ): void => {
    const readable = currentPort.readable
    if (readable === null) {
      error = 'Native CDC serial port has no readable stream.'
      emitState()
      return
    }

    debugLog('read loop starting', portDebugInfo(currentPort))
    const loopGeneration = readLoopGeneration + 1
    readLoopGeneration = loopGeneration

    readLoopPromise = (async () => {
      const currentReader = readable.getReader()
      let streamClosed = false
      let loopFailed = false
      reader = currentReader
      debugLog('read loop reader acquired', { loopGeneration })

      try {
        while (
          readLoopGeneration === loopGeneration &&
          port === currentPort &&
          isOpen
        ) {
          const result = await currentReader.read()
          if (result.done) {
            streamClosed = true
            break
          }
          if (
            readLoopGeneration !== loopGeneration ||
            port !== currentPort ||
            !isOpen
          )
            break
          if (result.value !== undefined && result.value.length > 0) {
            emitRecordsFromChunk(result.value)
          }
        }
      } catch (caught) {
        if (
          readLoopGeneration === loopGeneration &&
          port === currentPort &&
          isOpen &&
          !disposed
        ) {
          if (options.restartOnBreak && isRecoverableReadError(caught)) {
            debugLog(
              'read loop recoverable break; restarting',
              errorDetails(caught),
            )
            setTimeout(() => {
              if (
                !disposed &&
                port === currentPort &&
                isOpen &&
                readLoopGeneration === loopGeneration
              ) {
                startReadLoop(currentPort, options)
              }
            }, READ_LOOP_RESTART_DELAY_MS)
            return
          }
          loopFailed = true
          error =
            caught instanceof Error
              ? caught.message
              : 'Native CDC read loop failed.'
          debugLog('read loop failed', errorDetails(caught))
        }
      } finally {
        debugLog('read loop ending', {
          loopGeneration,
          streamClosed,
          loopFailed,
          current: port === currentPort,
        })
        if (readLoopGeneration === loopGeneration && reader === currentReader) {
          reader = null
        }
        currentReader.releaseLock()

        if (
          (streamClosed || loopFailed) &&
          readLoopGeneration === loopGeneration &&
          !disposed &&
          port === currentPort
        ) {
          detachCurrentPort(
            currentPort,
            streamClosed && error === null
              ? 'Native CDC serial stream closed.'
              : null,
          )
          flushRxStats()

          try {
            await currentPort.close()
          } catch {
            // The browser may have already closed the port after device removal.
          }
        }
      }
    })()
  }

  const setupPort = async (nextPort: SerialPortLike): Promise<boolean> => {
    if (
      disposed ||
      isOpen ||
      isConnecting ||
      nextPort.connected === false ||
      !matchesTargetPort(nextPort)
    )
      return false

    const attemptToken = connectAttemptToken + 1
    connectAttemptToken = attemptToken
    let openPromise: Promise<void> | null = null
    let opened = false

    try {
      debugLog('setup start', {
        attemptToken,
        baudRate,
        bufferSize,
        ...portDebugInfo(nextPort),
      })
      isConnecting = true
      emitState()
      if (disposed) return false
      openPromise = nextPort.open({ baudRate, bufferSize })
      debugLog('serial open pending', { attemptToken })
      await withTimeout(
        openPromise,
        SERIAL_OPEN_TIMEOUT_MS,
        'Timed out opening native CDC serial port.',
      )
      debugLog('serial open resolved', {
        attemptToken,
        ...portDebugInfo(nextPort),
      })
      opened = true
      if (disposed || connectAttemptToken !== attemptToken) {
        debugLog('serial open stale; closing', {
          attemptToken,
          currentAttemptToken: connectAttemptToken,
          disposed,
        })
        await withTimeout(
          nextPort.close(),
          SERIAL_CLOSE_TIMEOUT_MS,
          'Timed out closing stale native CDC serial port.',
        )
        return false
      }
      port = nextPort
      isOpen = true
      cancelHotplugOpen()
      frameParser.reset()
      error = null
      startReadLoop(nextPort, { restartOnBreak: true })
      if (nextPort.setSignals !== undefined) {
        debugLog('assert DTR pending', { attemptToken })
        await withTimeout(
          nextPort.setSignals({ dataTerminalReady: true }),
          SERIAL_SIGNAL_TIMEOUT_MS,
          'Timed out asserting native CDC DTR.',
        )
        debugLog('assert DTR resolved', { attemptToken })
      }
      if (port !== nextPort || !isOpen) {
        throw new Error('Native CDC serial port disconnected during setup.')
      }
      debugLog('setup complete', { attemptToken })
      return true
    } catch (caught) {
      debugLog('setup failed', {
        attemptToken,
        opened,
        ...errorDetails(caught),
      })
      if (port === nextPort) {
        port = null
      }
      isOpen = false
      error =
        caught instanceof Error
          ? caught.message
          : 'Failed to open native CDC serial port.'
      if (opened) {
        try {
          debugLog('closing after setup failure', { attemptToken })
          await withTimeout(
            nextPort.close(),
            SERIAL_CLOSE_TIMEOUT_MS,
            'Timed out closing failed native CDC serial port.',
          )
        } catch {
          // Ignore cleanup failures after an open attempt.
        }
      } else if (openPromise !== null) {
        void openPromise.then(
          async () => {
            if (port !== nextPort) {
              try {
                debugLog('late open resolved; closing stale port', {
                  attemptToken,
                })
                await nextPort.close()
              } catch {
                // The browser may already have closed the late-opened port.
              }
            }
          },
          () => undefined,
        )
      }
      throw caught
    } finally {
      isConnecting = false
      emitState()
    }
  }

  const openAuthorizedPort = async (
    preferredFingerprint?: string | null,
  ): Promise<boolean> => {
    if (serial === null || disposed || isOpen || isPrompting || isConnecting)
      return false

    debugLog('connectAuthorized getPorts pending', { preferredFingerprint })
    const ports = await serial.getPorts()
    debugLog('connectAuthorized getPorts resolved', {
      count: ports.length,
      ports: ports.map(portDebugInfo),
      preferredFingerprint,
    })
    const preferred = pickPreferredPort(
      ports,
      preferredFingerprint ?? autoReconnectFingerprint,
    )
    if (preferred === null) return false
    return setupPort(preferred)
  }

  const connectAuthorized = async (
    preferredFingerprint?: string | null,
  ): Promise<void> => {
    await openAuthorizedPort(preferredFingerprint)
  }

  const scheduleHotplugOpen = (candidatePort: SerialPortLike): void => {
    if (
      serial === null ||
      disposed ||
      !autoReconnect ||
      isOpen ||
      isConnecting ||
      isPrompting
    )
      return
    if (candidatePort.connected === false || !matchesTargetPort(candidatePort))
      return

    debugLog('schedule hotplug open', portDebugInfo(candidatePort))
    hotplugCandidatePort = candidatePort
    if (hotplugTimer !== null) {
      clearTimeout(hotplugTimer)
    }

    hotplugTimer = setTimeout(() => {
      hotplugTimer = null
      const candidate = hotplugCandidatePort
      hotplugCandidatePort = null
      if (
        candidate === null ||
        disposed ||
        !autoReconnect ||
        isOpen ||
        isConnecting ||
        isPrompting
      )
        return

      void setupPort(candidate).catch((caught) => {
        if (disposed || port === candidate) return
        error =
          caught instanceof Error
            ? caught.message
            : 'Native CDC hotplug reconnect failed.'
        emitState()
      })
    }, HOTPLUG_OPEN_SETTLE_DELAY_MS)
  }

  const handleConnect = (event: SerialConnectionEventLike): void => {
    const connectedPort = portFromConnectionEvent(event)
    debugLog(
      'serial connect event',
      connectedPort === null
        ? { hasPort: false }
        : portDebugInfo(connectedPort),
    )
    if (connectedPort === null) return
    scheduleHotplugOpen(connectedPort)
  }

  const handleDisconnect = (event: SerialConnectionEventLike): void => {
    debugLog('serial disconnect event')
    const current = port
    if (current === null) return

    const disconnectedPort = portFromConnectionEvent(event)
    const isCurrentPort =
      disconnectedPort === null ||
      disconnectedPort === current ||
      portFingerprint(disconnectedPort) === portFingerprint(current)
    if (!isCurrentPort) return

    detachCurrentPort(current, null)
    cancelCurrentReader()
  }

  if (serial !== null) {
    serial.addEventListener('connect', handleConnect)
    serial.addEventListener('disconnect', handleDisconnect)
  }

  const shutdownCurrentPort = async (): Promise<void> => {
    const current = port
    const wasOpen = isOpen
    const currentReader = reader
    const currentReadLoopPromise = readLoopPromise
    readLoopGeneration += 1
    port = null
    isOpen = false
    isSending = false
    debugLog('shutdown start', {
      wasOpen,
      hasReader: currentReader !== null,
      hasReadLoop: currentReadLoopPromise !== null,
      port: current === null ? null : portDebugInfo(current),
    })

    try {
      if (currentReader !== null) {
        debugLog('reader cancel pending')
        await withTimeout(
          currentReader.cancel(),
          SERIAL_CLOSE_TIMEOUT_MS,
          'Timed out canceling native CDC reader.',
        )
        debugLog('reader cancel resolved')
      }
    } catch {
      // The stream may already be closed after unplug or browser cleanup.
    }

    try {
      if (currentReadLoopPromise !== null) {
        debugLog('read loop stop pending')
        await withTimeout(
          currentReadLoopPromise,
          SERIAL_CLOSE_TIMEOUT_MS,
          'Timed out waiting for native CDC read loop to stop.',
        )
        debugLog('read loop stop resolved')
      }
    } catch {
      // Read loop errors are reported through status.
    }
    if (reader === currentReader) {
      reader = null
    }
    if (readLoopPromise === currentReadLoopPromise) {
      readLoopPromise = null
    }

    if (current === null) {
      frameParser.reset()
      flushRxStats()
      emitState()
      return
    }

    try {
      if (wasOpen) {
        try {
          debugLog('deassert DTR pending')
          await current.setSignals?.({ dataTerminalReady: false })
          debugLog('deassert DTR resolved')
        } catch {
          // Best effort: closing the port is still the important cleanup.
        }
        try {
          debugLog('serial close pending')
          await withTimeout(
            current.close(),
            SERIAL_CLOSE_TIMEOUT_MS,
            'Timed out closing native CDC serial port.',
          )
          debugLog('serial close resolved')
        } catch {
          // The browser may already have closed the port, or close may be stuck after unplug.
        }
      }
    } finally {
      frameParser.reset()
      flushRxStats()
      debugLog('shutdown complete')
      emitState()
    }
  }

  return {
    get isSupported() {
      return serial !== null
    },
    get isConnected() {
      return isOpen
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
      return null
    },
    get fingerprint() {
      return port === null ? null : portFingerprint(port)
    },
    async connect(): Promise<void> {
      if (serial === null) {
        throw new Error(unsupportedError())
      }
      if (disposed || isConnecting || isPrompting) return

      try {
        isPrompting = true
        isConnecting = true
        emitState()
        const selected = await serial.requestPort({ filters: [DEVICE_FILTER] })
        isConnecting = false
        await setupPort(selected)
      } catch (caught) {
        if (caught instanceof Error && caught.name === 'NotFoundError') {
          error = null
          throw caught
        }

        error =
          caught instanceof Error
            ? caught.message
            : 'Failed to connect native CDC serial port.'
        throw caught
      } finally {
        isPrompting = false
        isConnecting = false
        emitState()
      }
    },
    connectAuthorized,
    async disconnect(): Promise<void> {
      cancelHotplugOpen()
      await shutdownCurrentPort()
    },
    setAutoReconnect(
      enabled: boolean,
      preferredFingerprint?: string | null,
    ): void {
      autoReconnect = enabled
      autoReconnectFingerprint = preferredFingerprint ?? null
      debugLog('set auto reconnect', {
        enabled,
        preferredFingerprint: autoReconnectFingerprint,
      })
      if (!enabled) {
        cancelHotplugOpen()
      }
    },
    dispose(): void {
      disposed = true
      cancelHotplugOpen()
      if (serial !== null) {
        serial.removeEventListener('connect', handleConnect)
        serial.removeEventListener('disconnect', handleDisconnect)
      }
      void shutdownCurrentPort()
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
