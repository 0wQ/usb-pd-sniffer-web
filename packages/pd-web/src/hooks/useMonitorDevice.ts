import { useEffect, useCallback, useRef, useState } from 'react'
import { parsePdHexPayload } from '@usb-pd-sniffer/pd-monitor'
import {
  getMonitorDeviceDriver,
  MONITOR_DEVICE_OPTIONS,
  type MonitorDeviceLike,
  type MonitorDeviceStatusLike,
  type MonitorDeviceKind,
  type MonitorPdTxTarget,
} from '@/lib/devices/monitorDrivers'
import useDeviceStore from '@/stores/deviceStore'

function statusError(status: MonitorDeviceStatusLike, apiName: string): string | null {
  if (!status.isSupported) {
    return `${apiName} is not supported. Please use Chrome, Edge, or Opera.`
  }

  return status.error
}

export function useMonitorDevice() {
  const setIsConnected = useDeviceStore((state) => state.setIsConnected)
  const setIsConnecting = useDeviceStore((state) => state.setIsConnecting)
  const manualDisconnect = useDeviceStore((state) => state.manualDisconnect)
  const setManualDisconnect = useDeviceStore((state) => state.setManualDisconnect)
  const autoConnectOnLoad = useDeviceStore((state) => state.autoConnectOnLoad)
  const autoReconnectOnHotplug = useDeviceStore((state) => state.autoReconnectOnHotplug)
  const selectedMonitorDeviceKind = useDeviceStore((state) => state.selectedMonitorDeviceKind)
  const setSelectedMonitorDeviceKind = useDeviceStore((state) => state.setSelectedMonitorDeviceKind)
  const lastDeviceFingerprints = useDeviceStore((state) => state.lastDeviceFingerprints)
  const setLastDeviceFingerprintForKind = useDeviceStore((state) => state.setLastDeviceFingerprintForKind)
  const addRecord = useDeviceStore((state) => state.addRecord)
  const addPowerSample = useDeviceStore((state) => state.addPowerSample)
  const powerCaptureEnabled = useDeviceStore((state) => state.powerCaptureEnabled)
  const resetDevice = useDeviceStore((state) => state.resetDevice)
  const selectedDriver = getMonitorDeviceDriver(selectedMonitorDeviceKind)
  const selectedFingerprint = lastDeviceFingerprints[selectedMonitorDeviceKind] ?? null

  const deviceRef = useRef<MonitorDeviceLike | null>(null)
  const latestPowerCaptureEnabled = useRef(powerCaptureEnabled)
  const latestAutoReconnect = useRef(autoReconnectOnHotplug)
  const latestFingerprint = useRef(selectedFingerprint)
  const [isDeviceSupported, setIsDeviceSupported] = useState(false)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    latestPowerCaptureEnabled.current = powerCaptureEnabled
  }, [powerCaptureEnabled])

  useEffect(() => {
    latestAutoReconnect.current = autoReconnectOnHotplug
    latestFingerprint.current = selectedFingerprint
    deviceRef.current?.setAutoReconnect(autoReconnectOnHotplug, selectedFingerprint)
  }, [autoReconnectOnHotplug, selectedFingerprint])

  useEffect(() => {
    const driver = getMonitorDeviceDriver(selectedMonitorDeviceKind)
    const monitorDevice = driver.createDevice()
    deviceRef.current = monitorDevice
    monitorDevice.setAutoReconnect(latestAutoReconnect.current, latestFingerprint.current)

    const offRecord = monitorDevice.onRecord((record) => {
      addRecord(record)
    })

    const offPowerSample = monitorDevice.onPowerSample((sample) => {
      if (!latestPowerCaptureEnabled.current) {
        return
      }

      addPowerSample(sample)
    })

    const offStatus = monitorDevice.onStatus((status) => {
      setIsDeviceSupported(status.isSupported)
      setDeviceError(statusError(status, driver.apiName))
      setIsConnected(status.isConnected)
      setIsConnecting(status.isConnecting)
      setIsSending(status.isSending)

      if (status.fingerprint !== null) {
        setLastDeviceFingerprintForKind(driver.kind, status.fingerprint)
      }

      if (!status.isConnected && !status.isConnecting) {
        resetDevice()
      }
    })

    return () => {
      offRecord()
      offPowerSample()
      offStatus()
      monitorDevice.dispose()
      resetDevice()
      deviceRef.current = null
    }
  }, [
    addPowerSample,
    addRecord,
    resetDevice,
    selectedMonitorDeviceKind,
    setIsConnected,
    setIsConnecting,
    setLastDeviceFingerprintForKind,
  ])

  const tryAutoConnectAuthorizedDevice = useCallback(async () => {
    if (manualDisconnect) return
    try {
      await deviceRef.current?.connectAuthorized(selectedFingerprint)
    } catch (err) {
      if (err instanceof Error) {
        setDeviceError(err.message)
      }
    }
  }, [manualDisconnect, selectedFingerprint])

  const connectDevice = useCallback(async () => {
    const monitorDevice = deviceRef.current
    if (monitorDevice === null || !monitorDevice.isSupported) {
      alert(`${selectedDriver.apiName} is not supported in your browser. Please use Chrome, Edge, or Opera.`)
      return
    }

    try {
      await monitorDevice.connect()
      setManualDisconnect(false)
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotFoundError') {
          return
        }

        setDeviceError(err.message)
        alert(`Failed to connect: ${err.message}`)
      }
    }
  }, [selectedDriver.apiName, setManualDisconnect])

  const disconnectDevice = useCallback(async () => {
    setManualDisconnect(true)
    await deviceRef.current?.disconnect()
    resetDevice()
  }, [resetDevice, setManualDisconnect])

  const sendRawPdFrame = useCallback(async (target: MonitorPdTxTarget, hexPayload: string) => {
    if (!selectedDriver.capabilities.tx) {
      throw new Error(`${selectedDriver.label} does not support PD TX.`)
    }

    const payload = parsePdHexPayload(hexPayload)
    await deviceRef.current?.sendRawPd(target, payload)
  }, [selectedDriver])

  const sendHardReset = useCallback(async () => {
    if (!selectedDriver.capabilities.tx) {
      throw new Error(`${selectedDriver.label} does not support PD TX.`)
    }

    await deviceRef.current?.sendHardReset()
  }, [selectedDriver])

  const sendCableReset = useCallback(async () => {
    if (!selectedDriver.capabilities.tx) {
      throw new Error(`${selectedDriver.label} does not support PD TX.`)
    }

    await deviceRef.current?.sendCableReset()
  }, [selectedDriver])

  const selectMonitorDeviceKind = useCallback((kind: MonitorDeviceKind) => {
    if (kind === selectedMonitorDeviceKind) return
    setManualDisconnect(true)
    void deviceRef.current?.disconnect().finally(() => {
      setSelectedMonitorDeviceKind(kind)
      resetDevice()
    })
  }, [resetDevice, selectedMonitorDeviceKind, setManualDisconnect, setSelectedMonitorDeviceKind])

  useEffect(() => {
    if (!isDeviceSupported) return
    if (!autoConnectOnLoad) return
    void tryAutoConnectAuthorizedDevice()
  }, [autoConnectOnLoad, isDeviceSupported, tryAutoConnectAuthorizedDevice])

  return {
    selectedMonitorDeviceKind,
    selectedMonitorDeviceLabel: selectedDriver.label,
    monitorDeviceOptions: MONITOR_DEVICE_OPTIONS,
    monitorDeviceCapabilities: selectedDriver.capabilities,
    selectMonitorDeviceKind,
    connectDevice,
    disconnectDevice,
    sendRawPdFrame,
    sendHardReset,
    sendCableReset,
    isSending,
    isDeviceSupported,
    deviceError
  }
}
