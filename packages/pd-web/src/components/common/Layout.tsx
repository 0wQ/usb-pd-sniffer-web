import TableCard from '@/components/card/TableCard'
import DecodeCard from '@/components/card/DecodeCard'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import useDeviceStore from '@/stores/deviceStore'
import type { AppView } from '@/components/common/ViewTabs'
import type { WebPdTxTarget } from '@/lib/live/tx'

const DEFAULT_TOP_SIZE = 88
const MIN_TOP_SIZE = 28
const MIN_BOTTOM_SIZE = 12

type Props = {
  isConnected: boolean
  isConnecting: boolean
  manualDisconnect: boolean
  autoConnectOnLoad: boolean
  autoReconnectOnHotplug: boolean
  onAutoConnectOnLoadChange: (value: boolean) => void
  onAutoReconnectOnHotplugChange: (value: boolean) => void
  onConnectBtnClick: () => void
  onSendRawPdFrame: (target: WebPdTxTarget, hexPayload: string) => Promise<void>
  onSendHardReset: () => Promise<void>
  onSendCableReset: () => Promise<void>
  isSendingCommand: boolean
  isWebHidSupported: boolean
  currentView: AppView
  onViewChange: (view: AppView) => void
}

const Layout = ({
  isConnected,
  isConnecting,
  manualDisconnect,
  autoConnectOnLoad,
  autoReconnectOnHotplug,
  onAutoConnectOnLoadChange,
  onAutoReconnectOnHotplugChange,
  onConnectBtnClick,
  onSendRawPdFrame,
  onSendHardReset,
  onSendCableReset,
  isSendingCommand,
  isWebHidSupported,
  currentView,
  onViewChange,
}: Props) => {
  const selectedIndex = useDeviceStore((state) => state.protocolSelectedIndex)
  const setSelectedIndex = useDeviceStore((state) => state.setProtocolSelectedIndex)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'pd-web-main-layout',
    panelIds: ['table', 'decode'],
  })

  return (
    <main
      className="
        flex-1 min-h-0
        z-10
        p-5
        overflow-visible
      "
    >
      <Group
        id="pd-web-main-layout"
        orientation="vertical"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <Panel
          id="table"
          defaultSize={`${DEFAULT_TOP_SIZE}%`}
          minSize={`${MIN_TOP_SIZE}%`}
          className="min-h-0 min-w-0 overflow-visible pb-1.5"
        >
          <TableCard
            className="card bg-base-100 h-full min-h-0 min-w-0"
            onRowClick={setSelectedIndex}
            selectedIndex={selectedIndex}
            isConnected={isConnected}
            isConnecting={isConnecting}
            manualDisconnect={manualDisconnect}
            autoConnectOnLoad={autoConnectOnLoad}
            autoReconnectOnHotplug={autoReconnectOnHotplug}
            onAutoConnectOnLoadChange={onAutoConnectOnLoadChange}
            onAutoReconnectOnHotplugChange={onAutoReconnectOnHotplugChange}
            onConnectBtnClick={onConnectBtnClick}
            onSendRawPdFrame={onSendRawPdFrame}
            onSendHardReset={onSendHardReset}
            onSendCableReset={onSendCableReset}
            isSendingCommand={isSendingCommand}
            isWebHidSupported={isWebHidSupported}
            currentView={currentView}
            onViewChange={onViewChange}
          />
        </Panel>

        <Separator className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center outline-none focus:outline-none focus-visible:outline-none">
          <span className="h-1.5 w-24 rounded-full bg-base-300 transition-colors group-hover:bg-primary/50 group-data-[active]:bg-primary/70" />
        </Separator>

        <Panel id="decode" minSize={`${MIN_BOTTOM_SIZE}%`} className="min-h-0 min-w-0 pt-1.5">
          <DecodeCard className="card bg-base-100 h-full min-h-0" selectedIndex={selectedIndex} />
        </Panel>
      </Group>
    </main>
  )
}

export default Layout
