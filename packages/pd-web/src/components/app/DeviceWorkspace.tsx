import { useCallback, useMemo, useState } from 'react'
import ProtocolPage from '@/components/pages/ProtocolPage'
import PowerPage from '@/components/pages/PowerPage'
import { type AppView } from '@/components/app/ViewTabs'
import { DeviceWorkspaceProvider } from '@/components/app/DeviceWorkspaceContext'
import { useCaptureDevice } from '@/hooks/useCaptureDevice'
import useDeviceStore from '@/stores/deviceStore'
import type { CCModeConfig, PdTxSop } from '@/lib/devices/deviceDrivers'

type Props = {
  currentView: AppView
  onViewChange: (view: AppView) => void
}

const DeviceWorkspace = ({ currentView, onViewChange }: Props) => {
  const {
    selectedDeviceKind,
    deviceOptions,
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
  } = useCaptureDevice()

  const [isTxDialogOpen, setIsTxDialogOpen] = useState(false)

  const selectedIndex = useDeviceStore((state) => state.protocolSelectedIndex)
  const setSelectedIndex = useDeviceStore((state) => state.setProtocolSelectedIndex)
  const captureBuffer = useDeviceStore((state) => state.captureBuffer)
  const captureCount = useDeviceStore((state) => state.captureCount)
  const clearRecords = useDeviceStore((state) => state.clearRecords)
  const importRecords = useDeviceStore((state) => state.importRecords)
  const isConnected = useDeviceStore((state) => state.isConnected)
  const isConnecting = useDeviceStore((state) => state.isConnecting)
  const autoConnectOnLoad = useDeviceStore((state) => state.autoConnectOnLoad)
  const autoReconnectOnHotplug = useDeviceStore((state) => state.autoReconnectOnHotplug)
  const setAutoConnectOnLoad = useDeviceStore((state) => state.setAutoConnectOnLoad)
  const setAutoReconnectOnHotplug = useDeviceStore((state) => state.setAutoReconnectOnHotplug)

  const handleConnectBtnClick = useCallback(async () => {
    if (isConnecting) return
    if (isConnected) {
      await disconnectDevice()
      return
    }

    await connectDevice()
  }, [connectDevice, disconnectDevice, isConnected, isConnecting])

  const handleSendRawPdFrame = useCallback((sop: PdTxSop, hexPayload: string) => {
    return sendRawPdFrame(sop, hexPayload)
  }, [sendRawPdFrame])

  const handleSendHardReset = useCallback(() => sendHardReset(), [sendHardReset])

  const handleSendCableReset = useCallback(() => sendCableReset(), [sendCableReset])

  const handleSetCCMode = useCallback((config: CCModeConfig) => setCCMode(config), [setCCMode])

  const workspaceValue = useMemo(() => ({
    currentView,
    onViewChange,
    selectedIndex,
    setSelectedIndex,
    captureBuffer,
    captureCount,
    clearRecords,
    importRecords,
    isConnected,
    isConnecting,
    autoConnectOnLoad,
    autoReconnectOnHotplug,
    selectedDeviceKind,
    deviceOptions,
    supportsTx,
    isSending,
    isDeviceSupported,
    deviceError,
    selectDeviceKind,
    connectDevice: handleConnectBtnClick,
    disconnectDevice,
    sendRawPdFrame: handleSendRawPdFrame,
    sendHardReset: handleSendHardReset,
    sendCableReset: handleSendCableReset,
    setCCMode: handleSetCCMode,
    setAutoConnectOnLoad,
    setAutoReconnectOnHotplug,
  }), [
    autoConnectOnLoad,
    autoReconnectOnHotplug,
    captureBuffer,
    captureCount,
    clearRecords,
    currentView,
    deviceError,
    deviceOptions,
    disconnectDevice,
    handleConnectBtnClick,
    handleSendCableReset,
    handleSendHardReset,
    handleSendRawPdFrame,
    handleSetCCMode,
    importRecords,
    isConnected,
    isConnecting,
    isDeviceSupported,
    isSending,
    onViewChange,
    selectedDeviceKind,
    selectedIndex,
    selectDeviceKind,
    setAutoConnectOnLoad,
    setAutoReconnectOnHotplug,
    setSelectedIndex,
    supportsTx,
  ])

  return (
    <DeviceWorkspaceProvider
      value={workspaceValue}
      isTxDialogOpen={isTxDialogOpen}
      onOpenTxDialog={() => setIsTxDialogOpen(true)}
      onCloseTxDialog={() => setIsTxDialogOpen(false)}
    >
      {!isDeviceSupported && (
        <div className="mx-auto w-full max-w-4xl px-5 pt-5">
          <div role="alert" className="alert alert-error">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 shrink-0 stroke-current"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <h3 className="font-bold">Device API Not Supported</h3>
              <div className="text-sm">
                {deviceError || 'Your browser does not support the required device API. Please use Chrome, Edge, or Opera (version 89+).'}
              </div>
            </div>
          </div>
        </div>
      )}

      {currentView === 'protocol' ? <ProtocolPage /> : <PowerPage />}
    </DeviceWorkspaceProvider>
  )
}

export default DeviceWorkspace
