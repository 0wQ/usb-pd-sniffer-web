import { useEffect, useCallback, useRef, useState } from 'react'
import { MONITOR_TX_CMD } from '@usb-pd-sniffer/pd-monitor'
import useDeviceStore from '@/stores/deviceStore'
import { parseWebHidPdReport } from '@/lib/live/hidReport'
import { isPdMonitorEvent, MONITOR_EVENT } from '@/lib/live/pdCore'
import { buildRawPdTxCommand, sendNativeMonitorCommand, type WebPdTxTarget } from '@/lib/live/tx'

const DEVICE_FILTER = { vendorId: 0x1a86, productId: 0x2333 } as const

const deviceFingerprint = (hidDevice: HIDDevice): string =>
  `${hidDevice.vendorId}:${hidDevice.productId}:${hidDevice.productName ?? ''}`

const matchesTargetDevice = (hidDevice: HIDDevice): boolean =>
  hidDevice.vendorId === DEVICE_FILTER.vendorId && hidDevice.productId === DEVICE_FILTER.productId

export function useWebHid() {
  const device = useDeviceStore((state) => state.device)
  const setDevice = useDeviceStore((state) => state.setDevice)
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

  const isConnecting = useRef(false)
  const isPrompting = useRef(false)
  const isSendingCommand = useRef(false)
  const [isWebHidSupported, setIsWebHidSupported] = useState(false)
  const [webHidError, setWebHidError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  // 检查 WebHID API 是否可用
  useEffect(() => {
    if (!('hid' in navigator)) {
      setIsWebHidSupported(false)
      setWebHidError('WebHID is not supported. Please use Chrome, Edge, or Opera.')
      return
    }

    setIsWebHidSupported(true)
    setWebHidError(null)
    console.log('✅ WebHID API is available')
  }, [])

  const handleInputReport = useCallback((event: HIDInputReportEvent) => {
    try {
      const report = parseWebHidPdReport(event.reportId, event.data)
      if (report.event_type === MONITOR_EVENT.POWER_TELEMETRY) {
        if (!powerCaptureEnabled) {
          return
        }

        addPowerSample({
          timestamp_us: report.timestamp_us,
          recv_counter: report.recv_counter,
          vbus_mv: report.vbus_mv,
          ibus_ma: report.ibus_ma,
          cc1_mv: report.cc1_mv,
          cc2_mv: report.cc2_mv,
          dp_mv: report.dp_mv ?? 0,
          dm_mv: report.dm_mv ?? 0,
          active_cc: report.active_cc,
          event_type: report.event_type,
        })
        return
      }

      if (!isPdMonitorEvent(report.event_type)) {
        return
      }

      addReport(report)
    } catch (error) {
      console.error('Failed to parse HID input report:', error)
      if (error instanceof Error) {
        setWebHidError(error.message)
      }
    }
  }, [addPowerSample, addReport, powerCaptureEnabled])

  const setupDevice = useCallback(async (hidDevice: HIDDevice) => {
    if (hidDevice.opened) {
      setDevice(hidDevice)
      setIsConnected(true)
      setLastDeviceFingerprint(deviceFingerprint(hidDevice))
      return
    }

    if (isConnecting.current) {
      return
    }

    try {
      isConnecting.current = true
      setIsConnecting(true)

      await hidDevice.open()

      setDevice(hidDevice)
      setIsConnected(true)
      setManualDisconnect(false)
      setLastDeviceFingerprint(deviceFingerprint(hidDevice))
      console.log('✅ HID device connected successfully')
    } catch (err) {
      console.error('❌ Error opening HID:', err)
      setIsConnected(false)

      // 提供更详细的错误信息
      if (err instanceof Error) {
        setWebHidError(err.message)
      }
    } finally {
      isConnecting.current = false
      setIsConnecting(false)
    }
  }, [setDevice, setIsConnected, setIsConnecting, setManualDisconnect, setLastDeviceFingerprint])

  const pickPreferredDevice = useCallback((devices: HIDDevice[]): HIDDevice | null => {
    const candidates = devices.filter(matchesTargetDevice)
    if (candidates.length === 0) return null

    if (lastDeviceFingerprint) {
      const preferred = candidates.find(d => deviceFingerprint(d) === lastDeviceFingerprint)
      if (preferred) return preferred
    }

    return candidates[0] ?? null
  }, [lastDeviceFingerprint])

  const tryAutoConnectAuthorizedDevice = useCallback(async () => {
    if (!isWebHidSupported) return
    if (manualDisconnect) return
    if (device?.opened) return
    if (isPrompting.current) return
    if (isConnecting.current) return

    try {
      const devices = await navigator.hid.getDevices()
      const preferred = pickPreferredDevice(devices)
      if (!preferred) return

      console.log('Auto-connecting to previously authorized device...')
      await setupDevice(preferred)
    } catch (err) {
      console.warn('Auto-connect failed:', err)
    }
  }, [device, isWebHidSupported, manualDisconnect, pickPreferredDevice, setupDevice])

  const connectHID = useCallback(async () => {
    if (!isWebHidSupported) {
      console.error('Cannot connect: WebHID is not supported')
      alert('WebHID is not supported in your browser. Please use Chrome, Edge, or Opera (version 89+).')
      return
    }

    try {
      if (isConnecting.current || isPrompting.current) return
      isPrompting.current = true
      setIsConnecting(true)

      const devices = await navigator.hid.requestDevice({
        filters: [DEVICE_FILTER],
      })

      if (!devices || devices.length === 0) {
        console.log('No device selected')
        setIsConnecting(false)
        return
      }

      console.log('Device selected:', devices[0].productName)
      await setupDevice(devices[0])
    } catch (err) {
      console.error('❌ Error connecting HID:', err)

      if (err instanceof Error) {
        // 处理用户取消选择的情况
        if (err.name === 'NotFoundError') {
          console.log('User cancelled device selection')
          setIsConnecting(false)
        } else {
          setWebHidError(err.message)
          alert(`Failed to connect: ${err.message}`)
          setIsConnecting(false)
        }
      }
    } finally {
      isPrompting.current = false
    }
  }, [isWebHidSupported, setIsConnecting, setupDevice])

  const disconnectHID = useCallback(async () => {
    if (device) {
      try {
        setManualDisconnect(true)
        await device.close()
        console.log('✅ HID device disconnected')
      } catch (err) {
        console.error('❌ Error closing HID:', err)
      } finally {
        resetDevice()
      }
    }
  }, [device, resetDevice, setManualDisconnect])

  const sendCommand = useCallback(async (command: Parameters<typeof sendNativeMonitorCommand>[1]) => {
    if (device === null) {
      throw new Error('No HID device connected.')
    }

    if (isSendingCommand.current) {
      throw new Error('A TX command is already in flight.')
    }

    try {
      isSendingCommand.current = true
      setIsSending(true)
      await sendNativeMonitorCommand(device, command)
    } finally {
      isSendingCommand.current = false
      setIsSending(false)
    }
  }, [device])

  const sendRawPdFrame = useCallback(async (target: WebPdTxTarget, hexPayload: string) => {
    await sendCommand(buildRawPdTxCommand(target, hexPayload))
  }, [sendCommand])

  const sendHardReset = useCallback(async () => {
    await sendCommand({ opcode: MONITOR_TX_CMD.SEND_HARD_RESET })
  }, [sendCommand])

  const sendCableReset = useCallback(async () => {
    await sendCommand({ opcode: MONITOR_TX_CMD.SEND_CABLE_RESET })
  }, [sendCommand])

  // Auto-connect on load (previously authorized devices only)
  useEffect(() => {
    if (!isWebHidSupported) return
    if (!autoConnectOnLoad) return
    void tryAutoConnectAuthorizedDevice()
  }, [autoConnectOnLoad, isWebHidSupported, tryAutoConnectAuthorizedDevice])

  // Manage event listeners
  useEffect(() => {
    if (!isWebHidSupported) return

    const onDisconnect = (e: HIDConnectionEvent) => {
      const current = device
      const disconnectedDevice = e.device
      const isCurrentDevice =
        (current && disconnectedDevice === current) ||
        (current && deviceFingerprint(disconnectedDevice) === deviceFingerprint(current)) ||
        (lastDeviceFingerprint && deviceFingerprint(disconnectedDevice) === lastDeviceFingerprint)

      if (isCurrentDevice) {
        console.log('⚠️ Device disconnected')
        resetDevice()
      }
    }

    const onConnect = () => {
      if (!autoReconnectOnHotplug) return
      void tryAutoConnectAuthorizedDevice()
    }

    navigator.hid.addEventListener('connect', onConnect)
    navigator.hid.addEventListener('disconnect', onDisconnect)

    if (device?.opened) {
      device.addEventListener('inputreport', handleInputReport)
    }

    return () => {
      navigator.hid.removeEventListener('connect', onConnect)
      navigator.hid.removeEventListener('disconnect', onDisconnect)
      if (device?.opened) {
        device.removeEventListener('inputreport', handleInputReport)
      }
    }
  }, [autoReconnectOnHotplug, device, handleInputReport, isWebHidSupported, lastDeviceFingerprint, resetDevice, tryAutoConnectAuthorizedDevice])

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
