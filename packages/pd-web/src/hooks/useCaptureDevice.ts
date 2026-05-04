import { useEffect, useCallback, useRef, useState } from 'react'
import { parsePdHexPayload } from '@usb-pd-sniffer/pd-device-native-hid'
import {
  getDeviceDriver,
  isNativeHidDevice,
  DEVICE_OPTIONS,
  type CCModeConfig,
  type DeviceKind,
  type PdTxSop,
} from '@/lib/devices/deviceDrivers'
import type {
  CaptureDevice,
  CaptureDeviceState,
} from '@usb-pd-sniffer/pd-device-types'
import useDeviceStore from '@/stores/deviceStore'

function shouldUseDeviceAutoReconnect(_kind: DeviceKind): boolean {
  return true
}

function logDevice(message: string, details?: Record<string, unknown>) {
  const prefix = `[device ${new Date().toISOString()}] ${message}`
  if (details === undefined) {
    console.log(prefix)
    return
  }
  console.log(prefix, details)
}

export function useCaptureDevice() {
  const setIsConnected = useDeviceStore((state) => state.setIsConnected)
  const setIsConnecting = useDeviceStore((state) => state.setIsConnecting)
  const autoConnectOnLoad = useDeviceStore((state) => state.autoConnectOnLoad)
  const autoReconnectOnHotplug = useDeviceStore(
    (state) => state.autoReconnectOnHotplug,
  )
  const selectedDeviceKind = useDeviceStore((state) => state.selectedDeviceKind)
  const setSelectedDeviceKind = useDeviceStore(
    (state) => state.setSelectedDeviceKind,
  )
  const lastDeviceFingerprints = useDeviceStore(
    (state) => state.lastDeviceFingerprints,
  )
  const setLastDeviceFingerprintForKind = useDeviceStore(
    (state) => state.setLastDeviceFingerprintForKind,
  )
  const addRecord = useDeviceStore((state) => state.addRecord)
  const resetDevice = useDeviceStore((state) => state.resetDevice)
  const selectedDriver = getDeviceDriver(selectedDeviceKind)
  const selectedFingerprint = lastDeviceFingerprints[selectedDeviceKind] ?? null
  const supportsTx = selectedDeviceKind === 'native'

  const deviceRef = useRef<CaptureDevice | null>(null)
  const latestAutoReconnect = useRef(autoReconnectOnHotplug)
  const latestFingerprint = useRef(selectedFingerprint)
  const autoConnectAttempted = useRef(false)
  const [isDeviceSupported, setIsDeviceSupported] = useState(true)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  const syncDeviceState = useCallback(
    (deviceState: CaptureDeviceState): void => {
      setIsDeviceSupported(deviceState.isSupported)
      setDeviceError(deviceState.error)
      setIsConnected(deviceState.isConnected)
      setIsConnecting(deviceState.isConnecting)
      setIsSending(deviceState.isSending)
      if (deviceState.fingerprint !== null) {
        setLastDeviceFingerprintForKind(
          selectedDeviceKind,
          deviceState.fingerprint,
        )
      }
    },
    [
      selectedDeviceKind,
      setIsConnected,
      setIsConnecting,
      setLastDeviceFingerprintForKind,
    ],
  )

  useEffect(() => {
    latestAutoReconnect.current = autoReconnectOnHotplug
    latestFingerprint.current = selectedFingerprint
    deviceRef.current?.setAutoReconnect(
      shouldUseDeviceAutoReconnect(selectedDeviceKind) &&
        autoReconnectOnHotplug,
      selectedFingerprint,
    )
  }, [autoReconnectOnHotplug, selectedFingerprint, selectedDeviceKind])

  useEffect(() => {
    const driver = getDeviceDriver(selectedDeviceKind)
    logDevice('create device', { kind: driver.kind, label: driver.label })
    const device = driver.createDevice()
    deviceRef.current = device
    autoConnectAttempted.current = false
    device.setAutoReconnect(
      shouldUseDeviceAutoReconnect(driver.kind) && latestAutoReconnect.current,
      latestFingerprint.current,
    )

    const offRecord = device.onRecord((record) => {
      addRecord(record)
    })
    const offState = device.onState(syncDeviceState)

    return () => {
      logDevice('dispose device', { kind: driver.kind })
      offState()
      offRecord()
      device.dispose()
      resetDevice()
      deviceRef.current = null
    }
  }, [
    addRecord,
    resetDevice,
    selectedDeviceKind,
    setIsConnected,
    setIsConnecting,
    syncDeviceState,
  ])

  const tryAutoConnectAuthorizedDevice = useCallback(async () => {
    logDevice('try auto connect authorized', { kind: selectedDeviceKind })
    if (autoConnectAttempted.current) return
    autoConnectAttempted.current = true
    try {
      await deviceRef.current?.connectAuthorized(selectedFingerprint)
    } catch (err) {
      if (err instanceof Error) {
        setDeviceError(err.message)
      }
    }
  }, [selectedFingerprint, selectedDeviceKind])

  const connectDevice = useCallback(async () => {
    const device = deviceRef.current
    logDevice('connect button invoked', {
      kind: selectedDeviceKind,
      supported: device?.isSupported ?? false,
    })
    if (device === null || !device.isSupported) {
      alert(
        `${selectedDriver.apiName} is not supported in your browser. Please use Chrome, Edge, or Opera.`,
      )
      return
    }

    try {
      logDevice('manual connect start', { kind: selectedDeviceKind })
      setIsConnecting(true)
      await device.connect()
      logDevice('manual connect resolved', { kind: selectedDeviceKind })
    } catch (err) {
      setIsConnecting(false)
      logDevice('manual connect failed', {
        kind: selectedDeviceKind,
        error: err instanceof Error ? err.message : String(err),
      })
      if (err instanceof Error) {
        if (err.name === 'NotFoundError') {
          return
        }

        setDeviceError(err.message)
        alert(`Failed to connect: ${err.message}`)
      }
    }
  }, [
    selectedDriver.apiName,
    selectedDeviceKind,
    setIsConnected,
    setIsConnecting,
  ])

  const disconnectDevice = useCallback(async () => {
    await deviceRef.current?.disconnect()
    resetDevice()
  }, [resetDevice, setIsConnected, setIsConnecting])

  const sendRawPdFrame = useCallback(
    async (sop: PdTxSop, hexPayload: string) => {
      const device = deviceRef.current
      if (device === null || !isNativeHidDevice(device, selectedDeviceKind)) {
        throw new Error(`${selectedDriver.label} does not support PD TX.`)
      }

      const payload = parsePdHexPayload(hexPayload)
      setIsSending(true)
      try {
        await device.sendRawPd(sop, payload)
      } finally {
        setIsSending(false)
      }
    },
    [selectedDriver, selectedDeviceKind],
  )

  const sendHardReset = useCallback(async () => {
    const device = deviceRef.current
    if (device === null || !isNativeHidDevice(device, selectedDeviceKind)) {
      throw new Error(`${selectedDriver.label} does not support PD TX.`)
    }

    setIsSending(true)
    try {
      await device.sendHardReset()
    } finally {
      setIsSending(false)
    }
  }, [selectedDriver, selectedDeviceKind])

  const sendCableReset = useCallback(async () => {
    const device = deviceRef.current
    if (device === null || !isNativeHidDevice(device, selectedDeviceKind)) {
      throw new Error(`${selectedDriver.label} does not support PD TX.`)
    }

    setIsSending(true)
    try {
      await device.sendCableReset()
    } finally {
      setIsSending(false)
    }
  }, [selectedDriver, selectedDeviceKind])

  const setCCMode = useCallback(
    async (config: CCModeConfig) => {
      const device = deviceRef.current
      if (device === null || !isNativeHidDevice(device, selectedDeviceKind)) {
        throw new Error(
          `${selectedDriver.label} does not support CC mode control.`,
        )
      }

      setIsSending(true)
      try {
        await device.setCCMode(config)
      } finally {
        setIsSending(false)
      }
    },
    [selectedDriver, selectedDeviceKind],
  )

  const selectDeviceKind = useCallback(
    (kind: DeviceKind) => {
      if (kind === selectedDeviceKind) return
      autoConnectAttempted.current = false
      void deviceRef.current?.disconnect().finally(() => {
        setSelectedDeviceKind(kind)
        resetDevice()
      })
    },
    [resetDevice, selectedDeviceKind, setSelectedDeviceKind],
  )

  useEffect(() => {
    if (!isDeviceSupported) return
    if (!autoConnectOnLoad) return
    void tryAutoConnectAuthorizedDevice()
  }, [autoConnectOnLoad, isDeviceSupported, tryAutoConnectAuthorizedDevice])

  return {
    selectedDeviceKind,
    selectedDeviceLabel: selectedDriver.label,
    deviceOptions: DEVICE_OPTIONS,
    supportsTx,
    selectDeviceKind,
    connectDevice,
    disconnectDevice,
    sendRawPdFrame,
    sendHardReset,
    sendCableReset,
    setCCMode,
    isSending,
    isDeviceSupported,
    deviceError,
  }
}
