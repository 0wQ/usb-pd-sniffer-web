import { useEffect, useCallback, useRef, useState } from 'react'
import {
  createMonitorDevice,
  type MonitorDevice,
  type MonitorDeviceStatus,
} from '@usb-pd-sniffer/pd-monitor'
import useDeviceStore from '@/stores/deviceStore'
import { parsePdHexPayload, type WebPdTxTarget } from '@/lib/live/tx'

function statusError(status: MonitorDeviceStatus): string | null {
  if (!status.isSupported) {
    return 'WebHID is not supported. Please use Chrome, Edge, or Opera.'
  }

  return status.error
}

export function useWebHid() {
  const setIsConnected = useDeviceStore((state) => state.setIsConnected)
  const setIsConnecting = useDeviceStore((state) => state.setIsConnecting)
  const manualDisconnect = useDeviceStore((state) => state.manualDisconnect)
  const setManualDisconnect = useDeviceStore((state) => state.setManualDisconnect)
  const autoConnectOnLoad = useDeviceStore((state) => state.autoConnectOnLoad)
  const autoReconnectOnHotplug = useDeviceStore((state) => state.autoReconnectOnHotplug)
  const lastDeviceFingerprint = useDeviceStore((state) => state.lastDeviceFingerprint)
  const setLastDeviceFingerprint = useDeviceStore((state) => state.setLastDeviceFingerprint)
  const addReport = useDeviceStore((state) => state.addReport)
  const addPowerSample = useDeviceStore((state) => state.addPowerSample)
  const powerCaptureEnabled = useDeviceStore((state) => state.powerCaptureEnabled)
  const resetDevice = useDeviceStore((state) => state.resetDevice)

  const deviceRef = useRef<MonitorDevice | null>(null)
  const latestPowerCaptureEnabled = useRef(powerCaptureEnabled)
  const latestAutoReconnect = useRef(autoReconnectOnHotplug)
  const latestFingerprint = useRef(lastDeviceFingerprint)
  const [isWebHidSupported, setIsWebHidSupported] = useState(false)
  const [webHidError, setWebHidError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    latestPowerCaptureEnabled.current = powerCaptureEnabled
  }, [powerCaptureEnabled])

  useEffect(() => {
    latestAutoReconnect.current = autoReconnectOnHotplug
    latestFingerprint.current = lastDeviceFingerprint
    deviceRef.current?.setAutoReconnect(autoReconnectOnHotplug, lastDeviceFingerprint)
  }, [autoReconnectOnHotplug, lastDeviceFingerprint])

  useEffect(() => {
    const monitorDevice = createMonitorDevice()
    deviceRef.current = monitorDevice
    monitorDevice.setAutoReconnect(latestAutoReconnect.current, latestFingerprint.current)

    const offRecord = monitorDevice.onRecord((report) => {
      addReport(report)
    })

    const offPowerSample = monitorDevice.onPowerSample((sample) => {
      if (!latestPowerCaptureEnabled.current) {
        return
      }

      addPowerSample(sample)
    })

    const offStatus = monitorDevice.onStatus((status) => {
      setIsWebHidSupported(status.isSupported)
      setWebHidError(statusError(status))
      setIsConnected(status.isConnected)
      setIsConnecting(status.isConnecting)
      setIsSending(status.isSending)

      if (status.fingerprint !== null) {
        setLastDeviceFingerprint(status.fingerprint)
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
      deviceRef.current = null
    }
  }, [addPowerSample, addReport, resetDevice, setIsConnected, setIsConnecting, setLastDeviceFingerprint])

  const tryAutoConnectAuthorizedDevice = useCallback(async () => {
    if (manualDisconnect) return
    try {
      await deviceRef.current?.connectAuthorized(lastDeviceFingerprint)
    } catch (err) {
      if (err instanceof Error) {
        setWebHidError(err.message)
      }
    }
  }, [lastDeviceFingerprint, manualDisconnect])

  const connectHID = useCallback(async () => {
    const monitorDevice = deviceRef.current
    if (monitorDevice === null || !monitorDevice.isSupported) {
      alert('WebHID is not supported in your browser. Please use Chrome, Edge, or Opera (version 89+).')
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

        setWebHidError(err.message)
        alert(`Failed to connect: ${err.message}`)
      }
    }
  }, [setManualDisconnect])

  const disconnectHID = useCallback(async () => {
    setManualDisconnect(true)
    await deviceRef.current?.disconnect()
    resetDevice()
  }, [resetDevice, setManualDisconnect])

  const sendRawPdFrame = useCallback(async (target: WebPdTxTarget, hexPayload: string) => {
    const payload = parsePdHexPayload(hexPayload)
    await deviceRef.current?.sendRawPd(target, payload)
  }, [])

  const sendHardReset = useCallback(async () => {
    await deviceRef.current?.sendHardReset()
  }, [])

  const sendCableReset = useCallback(async () => {
    await deviceRef.current?.sendCableReset()
  }, [])

  useEffect(() => {
    if (!isWebHidSupported) return
    if (!autoConnectOnLoad) return
    void tryAutoConnectAuthorizedDevice()
  }, [autoConnectOnLoad, isWebHidSupported, tryAutoConnectAuthorizedDevice])

  return {
    connectHID,
    disconnectHID,
    sendRawPdFrame,
    sendHardReset,
    sendCableReset,
    isSending,
    isWebHidSupported,
    webHidError
  }
}
