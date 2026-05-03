import { Toaster } from 'sonner'
import Layout from '@/components/common/Layout'
import { type AppView } from '@/components/common/ViewTabs'
import PowerPage from '@/components/pages/PowerPage'
import { useMonitorDevice } from '@/hooks/useMonitorDevice'
import { useBeforeUnloadWarning } from '@/hooks/useBeforeUnloadWarning'
import useDeviceStore from '@/stores/deviceStore'
import { useState } from 'react'
import type { MonitorCCModeConfig, MonitorPdTxTarget } from '@/lib/devices/monitorDrivers'

function App() {
  const [currentView, setCurrentView] = useState<AppView>('protocol')
  // 数据丢失警告
  useBeforeUnloadWarning()

  // 初始化 monitor device hook
  const {
    selectedMonitorDeviceKind,
    monitorDeviceOptions,
    monitorDeviceCapabilities,
    selectMonitorDeviceKind,
    connectDevice,
    disconnectDevice,
    sendRawPdFrame,
    sendHardReset,
    sendCableReset,
    setCCMode,
    isSending,
    isDeviceSupported,
    deviceError,
  } = useMonitorDevice()

  // 从 store 读取连接状态
  const isConnected = useDeviceStore((state) => state.isConnected)
  const isConnecting = useDeviceStore((state) => state.isConnecting)
  const manualDisconnect = useDeviceStore((state) => state.manualDisconnect)
  const autoConnectOnLoad = useDeviceStore((state) => state.autoConnectOnLoad)
  const autoReconnectOnHotplug = useDeviceStore((state) => state.autoReconnectOnHotplug)
  const setAutoConnectOnLoad = useDeviceStore((state) => state.setAutoConnectOnLoad)
  const setAutoReconnectOnHotplug = useDeviceStore((state) => state.setAutoReconnectOnHotplug)

  // 处理连接/断开按钮点击
  const handleConnectBtnClick = () => {
    if (isConnecting) return
    if (isConnected) {
      disconnectDevice()
    } else {
      connectDevice()
    }
  }

  const handleSendRawPdFrame = (target: MonitorPdTxTarget, hexPayload: string) => sendRawPdFrame(target, hexPayload)

  const handleSendHardReset = () => sendHardReset()

  const handleSendCableReset = () => sendCableReset()

  const handleSetCCMode = (config: MonitorCCModeConfig) => setCCMode(config)

  return (
    <div className="app bg-base-200 w-full h-screen min-h-200 flex flex-col">
      <Toaster
        position="top-right"
        duration={10000}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: 'bg-base-100 text-base-content/80 text-sm font-mono rounded-lg shadow-xl p-3 flex items-center gap-2 select-none',
          },
        }}
      />

      {/* Monitor device API 不支持时显示警告 */}
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
              <h3 className="font-bold">Monitor Device API Not Supported</h3>
              <div className="text-sm">
                {deviceError || 'Your browser does not support the required monitor device API. Please use Chrome, Edge, or Opera (version 89+).'}
              </div>
            </div>
          </div>
        </div>
      )}
      {currentView === 'protocol' ? (
        <Layout
          isConnected={isConnected}
          isConnecting={isConnecting}
          manualDisconnect={manualDisconnect}
          autoConnectOnLoad={autoConnectOnLoad}
          autoReconnectOnHotplug={autoReconnectOnHotplug}
          onAutoConnectOnLoadChange={setAutoConnectOnLoad}
          onAutoReconnectOnHotplugChange={setAutoReconnectOnHotplug}
          selectedMonitorDeviceKind={selectedMonitorDeviceKind}
          monitorDeviceOptions={monitorDeviceOptions}
          monitorDeviceCapabilities={monitorDeviceCapabilities}
          onMonitorDeviceKindChange={selectMonitorDeviceKind}
          onConnectBtnClick={handleConnectBtnClick}
          onSendRawPdFrame={handleSendRawPdFrame}
          onSendHardReset={handleSendHardReset}
          onSendCableReset={handleSendCableReset}
          onSetCCMode={handleSetCCMode}
          isSendingCommand={isSending}
          isDeviceSupported={isDeviceSupported}
          currentView={currentView}
          onViewChange={setCurrentView}
        />
      ) : (
        <PowerPage
          isConnected={isConnected}
          isConnecting={isConnecting}
          onConnectBtnClick={handleConnectBtnClick}
          isDeviceSupported={isDeviceSupported}
          currentView={currentView}
          onViewChange={setCurrentView}
        />
      )}
    </div>
  )
}

export default App
