import TableCard from '@/components/card/TableCard'
import DecodeCard from '@/components/card/DecodeCard'
import { Group, Panel, Separator, useDefaultLayout, usePanelCallbackRef, type PanelSize } from 'react-resizable-panels'
import useDeviceStore from '@/stores/deviceStore'
import type { AppView } from '@/components/common/ViewTabs'
import type {
  MonitorDeviceCapabilities,
  MonitorDeviceDriver,
  MonitorCCModeConfig,
  MonitorDeviceKind,
  MonitorPdTxTarget,
} from '@/lib/devices/monitorDrivers'
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'

type DecodeLayoutMode = 'vertical' | 'horizontal'

const DECODE_LAYOUT_MODE_STORAGE_KEY = 'usb-pd-layout-decode-mode'
const DECODE_COLLAPSED_STORAGE_KEY = 'usb-pd-layout-decode-collapsed'
const DEFAULT_TABLE_SIZE = {
  vertical: 88,
  horizontal: 70,
} satisfies Record<DecodeLayoutMode, number>
const MIN_TABLE_SIZE = {
  vertical: 28,
  horizontal: 35,
} satisfies Record<DecodeLayoutMode, number>
const MIN_DECODE_SIZE = {
  vertical: '11%',
  horizontal: '25%',
} satisfies Record<DecodeLayoutMode, string>
const MAX_DECODE_SIZE = {
  vertical: '100%',
  horizontal: '50%',
} satisfies Record<DecodeLayoutMode, string>

type Props = {
  isConnected: boolean
  isConnecting: boolean
  manualDisconnect: boolean
  autoConnectOnLoad: boolean
  autoReconnectOnHotplug: boolean
  onAutoConnectOnLoadChange: (value: boolean) => void
  onAutoReconnectOnHotplugChange: (value: boolean) => void
  selectedMonitorDeviceKind: MonitorDeviceKind
  monitorDeviceOptions: MonitorDeviceDriver[]
  monitorDeviceCapabilities: MonitorDeviceCapabilities
  onMonitorDeviceKindChange: (kind: MonitorDeviceKind) => void
  onConnectBtnClick: () => void
  onSendRawPdFrame: (target: MonitorPdTxTarget, hexPayload: string) => Promise<void>
  onSendHardReset: () => Promise<void>
  onSendCableReset: () => Promise<void>
  onSetCCMode: (config: MonitorCCModeConfig) => Promise<void>
  isSendingCommand: boolean
  isDeviceSupported: boolean
  currentView: AppView
  onViewChange: (view: AppView) => void
}

function readDecodeLayoutMode(): DecodeLayoutMode {
  try {
    const value = localStorage.getItem(DECODE_LAYOUT_MODE_STORAGE_KEY)
    return value === 'horizontal' ? 'horizontal' : 'vertical'
  } catch {
    return 'vertical'
  }
}

function readDecodeCollapsed(): boolean {
  try {
    return localStorage.getItem(DECODE_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeDecodeLayoutMode(value: DecodeLayoutMode): void {
  try {
    localStorage.setItem(DECODE_LAYOUT_MODE_STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

function writeDecodeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(DECODE_COLLAPSED_STORAGE_KEY, String(value))
  } catch {
    // ignore
  }
}

const Layout = ({
  isConnected,
  isConnecting,
  manualDisconnect,
  autoConnectOnLoad,
  autoReconnectOnHotplug,
  onAutoConnectOnLoadChange,
  onAutoReconnectOnHotplugChange,
  selectedMonitorDeviceKind,
  monitorDeviceOptions,
  monitorDeviceCapabilities,
  onMonitorDeviceKindChange,
  onConnectBtnClick,
  onSendRawPdFrame,
  onSendHardReset,
  onSendCableReset,
  onSetCCMode,
  isSendingCommand,
  isDeviceSupported,
  currentView,
  onViewChange,
}: Props) => {
  const selectedIndex = useDeviceStore((state) => state.protocolSelectedIndex)
  const setSelectedIndex = useDeviceStore((state) => state.setProtocolSelectedIndex)
  const [decodeLayoutMode, setDecodeLayoutMode] = useState<DecodeLayoutMode>(() => readDecodeLayoutMode())
  const [decodeCollapsed, setDecodeCollapsed] = useState(() => readDecodeCollapsed())
  const [decodePanel, setDecodePanel] = usePanelCallbackRef()
  const layoutId = `pd-web-main-layout-${decodeLayoutMode}`
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutId,
    panelIds: ['table', 'decode'],
  })
  const tablePanelClassName = clsx('min-h-0 min-w-0 overflow-visible', {
    'pb-1.5': decodeLayoutMode === 'vertical',
    'pr-1.5': decodeLayoutMode === 'horizontal',
  })
  const decodePanelClassName = clsx('min-h-0 min-w-0', {
    'pt-1.5': decodeLayoutMode === 'vertical',
    'pl-1.5': decodeLayoutMode === 'horizontal',
  })
  const groupClassName = clsx('flex h-full min-h-0 gap-0', {
    'flex-col': decodeLayoutMode === 'vertical',
    'flex-row': decodeLayoutMode === 'horizontal',
  })
  const separatorClassName = clsx(
    'group relative flex shrink-0 items-center justify-center outline-none focus:outline-none focus-visible:outline-none',
    {
      'h-3 cursor-row-resize': decodeLayoutMode === 'vertical',
      'w-3 cursor-col-resize': decodeLayoutMode === 'horizontal',
    },
  )
  const separatorTrackClassName = clsx(
    'rounded-full bg-base-300 transition-colors group-hover:bg-primary/50 group-data-[active]:bg-primary/70',
    {
      'h-1.5 w-24': decodeLayoutMode === 'vertical',
      'h-24 w-1.5': decodeLayoutMode === 'horizontal',
    },
  )
  useEffect(() => {
    writeDecodeLayoutMode(decodeLayoutMode)
  }, [decodeLayoutMode])

  useEffect(() => {
    writeDecodeCollapsed(decodeCollapsed)
  }, [decodeCollapsed])

  useEffect(() => {
    if (decodePanel === null) return
    try {
      if (decodeCollapsed) {
        decodePanel.collapse()
      } else if (decodePanel.isCollapsed()) {
        decodePanel.expand()
      }
    } catch {
      // Layout mode changes remount the group; ignore stale panel handles from the previous group.
    }
  }, [decodeCollapsed, decodePanel])

  const toggleDecodeLayoutMode = useCallback(() => {
    setDecodeLayoutMode((current) => current === 'vertical' ? 'horizontal' : 'vertical')
  }, [])

  const handleDecodeResize = useCallback((panelSize: PanelSize) => {
    setDecodeCollapsed(panelSize.asPercentage <= 0.001)
  }, [])

  const defaultLayoutForMode = useMemo(() => defaultLayout, [defaultLayout])

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
        key={decodeLayoutMode}
        id={layoutId}
        orientation={decodeLayoutMode}
        defaultLayout={defaultLayoutForMode}
        onLayoutChanged={onLayoutChanged}
        className={groupClassName}
      >
        <Panel
          id="table"
          defaultSize={`${DEFAULT_TABLE_SIZE[decodeLayoutMode]}%`}
          minSize={`${MIN_TABLE_SIZE[decodeLayoutMode]}%`}
          className={tablePanelClassName}
        >
          <TableCard
            className="card bg-base-100 h-full min-h-0 min-w-0"
            decodeLayoutMode={decodeLayoutMode}
            onToggleDecodeLayoutMode={toggleDecodeLayoutMode}
            onRowClick={setSelectedIndex}
            selectedIndex={selectedIndex}
            isConnected={isConnected}
            isConnecting={isConnecting}
            manualDisconnect={manualDisconnect}
            autoConnectOnLoad={autoConnectOnLoad}
            autoReconnectOnHotplug={autoReconnectOnHotplug}
            onAutoConnectOnLoadChange={onAutoConnectOnLoadChange}
            onAutoReconnectOnHotplugChange={onAutoReconnectOnHotplugChange}
            selectedMonitorDeviceKind={selectedMonitorDeviceKind}
            monitorDeviceOptions={monitorDeviceOptions}
            monitorDeviceCapabilities={monitorDeviceCapabilities}
            onMonitorDeviceKindChange={onMonitorDeviceKindChange}
            onConnectBtnClick={onConnectBtnClick}
            onSendRawPdFrame={onSendRawPdFrame}
            onSendHardReset={onSendHardReset}
            onSendCableReset={onSendCableReset}
            onSetCCMode={onSetCCMode}
            isSendingCommand={isSendingCommand}
            isDeviceSupported={isDeviceSupported}
            currentView={currentView}
            onViewChange={onViewChange}
          />
        </Panel>

        <Separator className={separatorClassName}>
          <span className={separatorTrackClassName} />
        </Separator>

        <Panel
          id="decode"
          panelRef={setDecodePanel}
          collapsible
          collapsedSize="0%"
          defaultSize={`${100 - DEFAULT_TABLE_SIZE[decodeLayoutMode]}%`}
          minSize={MIN_DECODE_SIZE[decodeLayoutMode]}
          maxSize={MAX_DECODE_SIZE[decodeLayoutMode]}
          className={decodePanelClassName}
          onResize={handleDecodeResize}
        >
          <DecodeCard className="card bg-base-100 h-full min-h-0" selectedIndex={selectedIndex} />
        </Panel>
      </Group>
    </main>
  )
}

export default Layout
