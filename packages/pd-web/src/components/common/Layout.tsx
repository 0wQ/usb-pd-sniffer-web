import TableCard from '@/components/card/TableCard'
import DecodeCard from '@/components/card/DecodeCard'
import SendPdDialog from '@/components/common/SendPdDialog'
import { useDeviceWorkspaceContext } from '@/components/common/DeviceWorkspaceContext'
import { Group, Panel, Separator, useDefaultLayout, usePanelCallbackRef, type PanelSize } from 'react-resizable-panels'
import { decodeSingleRecord } from '@/lib/analyzer/decode'
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

const Layout = () => {
  const {
    selectedIndex,
    setSelectedIndex,
    captureBuffer,
    isConnected,
    sendRawPdFrame,
    sendHardReset,
    sendCableReset,
    setCCMode,
    isTxDialogOpen,
    openTxDialog,
    closeTxDialog,
  } = useDeviceWorkspaceContext()
  const [decodeLayoutMode, setDecodeLayoutMode] = useState<DecodeLayoutMode>(() => readDecodeLayoutMode())
  const [decodeCollapsed, setDecodeCollapsed] = useState(() => readDecodeCollapsed())
  const [decodeHandleHighlighted, setDecodeHandleHighlighted] = useState(false)
  const [decodePanel, setDecodePanel] = usePanelCallbackRef()
  const layoutId = `pd-web-main-layout-${decodeLayoutMode}`
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutId,
    panelIds: ['table', 'decode'],
  })
  const tablePanelClassName = clsx('min-h-0 min-w-0 overflow-visible', {
    'pr-5': decodeLayoutMode === 'vertical',
    'pb-5': decodeLayoutMode === 'horizontal',
  })
  const decodePanelClassName = clsx('min-h-0 min-w-0', {
    'pb-5': decodeLayoutMode === 'vertical' && !decodeCollapsed,
    'pr-5': decodeLayoutMode === 'horizontal' && !decodeCollapsed,
  })
  const groupClassName = clsx('flex h-full min-h-0 gap-0', {
    'flex-col': decodeLayoutMode === 'vertical',
    'flex-row': decodeLayoutMode === 'horizontal',
  })
  const separatorClassName = clsx(
    'group relative flex shrink-0 items-center justify-center outline-none focus:outline-none focus-visible:outline-none',
    {
      'h-5 cursor-row-resize': decodeLayoutMode === 'vertical',
      'w-5 cursor-col-resize': decodeLayoutMode === 'horizontal',
    },
  )
  const separatorTrackClassName = clsx(
    'rounded-full bg-base-300 transition-colors group-hover:bg-primary/50 group-data-[active]:bg-primary/70',
    decodeHandleHighlighted && 'bg-primary/50',
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
      // Ignore stale panel handles from layout updates.
    }
  }, [decodeCollapsed, decodePanel])

  const toggleDecodeLayoutMode = useCallback(() => {
    setDecodeLayoutMode((current) => current === 'vertical' ? 'horizontal' : 'vertical')
    setDecodeHandleHighlighted(true)
  }, [])

  useEffect(() => {
    if (!decodeHandleHighlighted) return

    const timeoutId = window.setTimeout(() => {
      setDecodeHandleHighlighted(false)
    }, 900)

    return () => window.clearTimeout(timeoutId)
  }, [decodeHandleHighlighted])

  const handleDecodeResize = useCallback((panelSize: PanelSize) => {
    setDecodeCollapsed(panelSize.asPercentage <= 0.001)
  }, [])

  const handleDecodeSeparatorDoubleClick = useCallback(() => {
    setDecodeCollapsed((current) => !current)
  }, [])

  const defaultLayoutForMode = useMemo(() => defaultLayout, [defaultLayout])
  const selectedRecord = selectedIndex === null ? null : (captureBuffer.get(selectedIndex) ?? null)
  const selectedFrameForTx = useMemo(() => {
    if (selectedRecord === null) return null

    return decodeSingleRecord(selectedRecord)?.frame ?? null
  }, [selectedRecord])

  return (
    <main
      className="
        relative flex-1 min-h-0
        z-10
        pl-5 pt-5
        overflow-visible
      "
    >
      <Group
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
            onOpenTxDialog={openTxDialog}
          />
        </Panel>

        <Separator
          className={separatorClassName}
          disabled={isTxDialogOpen}
          disableDoubleClick
          onDoubleClick={handleDecodeSeparatorDoubleClick}
        >
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

      <SendPdDialog
        isOpen={isTxDialogOpen}
        isConnected={isConnected}
        selectedFrame={selectedFrameForTx}
        onClose={closeTxDialog}
        onSendRaw={sendRawPdFrame}
        onSendHardReset={sendHardReset}
        onSendCableReset={sendCableReset}
        onSetCCMode={setCCMode}
      />
    </main>
  )
}

export default Layout
