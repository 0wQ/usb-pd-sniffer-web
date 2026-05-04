import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Group,
  Panel,
  type PanelSize,
  Separator,
  useDefaultLayout,
  usePanelCallbackRef,
} from 'react-resizable-panels'
import { useDeviceWorkspaceContext } from '@/components/app/DeviceWorkspaceContext'
import ProtocolDecodeCard from '@/components/protocol/ProtocolDecodeCard'
import ProtocolTableCard from '@/components/protocol/ProtocolTableCard'
import SendPdDialog from '@/components/protocol/SendPdDialog'
import { decodeSingleRecord } from '@/lib/analyzer/decode'
import type { DecodeLayoutMode } from '@/stores/appStore'
import useAppStore from '@/stores/appStore'

const DEFAULT_TABLE_SIZE = {
  vertical: 88,
  horizontal: 75,
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

const ProtocolPage = () => {
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
  const decodeLayoutMode = useAppStore((state) => state.decodeLayoutMode)
  const setDecodeLayoutMode = useAppStore((state) => state.setDecodeLayoutMode)
  const decodeCollapsed = useAppStore((state) => state.decodeCollapsed)
  const setDecodeCollapsed = useAppStore((state) => state.setDecodeCollapsed)
  const [decodeHandleHighlighted, setDecodeHandleHighlighted] = useState(false)
  const [decodePanel, setDecodePanel] = usePanelCallbackRef()
  const hasSelectedRecord = selectedIndex !== null
  const layoutId = `pd-web-main-layout-${decodeLayoutMode}`
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutId,
    panelIds: ['table', 'decode'],
  })
  const tablePanelClassName = clsx('min-h-0 min-w-0 overflow-visible', {
    'pr-5': decodeLayoutMode === 'vertical',
    'pb-5': decodeLayoutMode === 'horizontal',
  })
  const decodePanelClassName = clsx(
    'min-h-0 min-w-0',
    !decodeCollapsed && 'pr-5 pb-5',
  )
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
    if (decodePanel === null) return
    try {
      if (!hasSelectedRecord || decodeCollapsed) {
        decodePanel.collapse()
      } else if (decodePanel.isCollapsed()) {
        decodePanel.expand()
      }
    } catch {
      // Ignore stale panel handles from layout updates.
    }
  }, [decodeCollapsed, decodePanel, hasSelectedRecord])

  const toggleDecodeLayoutMode = useCallback(() => {
    setDecodeLayoutMode((current) =>
      current === 'vertical' ? 'horizontal' : 'vertical',
    )
    setDecodeHandleHighlighted(true)
  }, [setDecodeLayoutMode])

  useEffect(() => {
    if (!decodeHandleHighlighted) return

    const timeoutId = window.setTimeout(() => {
      setDecodeHandleHighlighted(false)
    }, 900)

    return () => window.clearTimeout(timeoutId)
  }, [decodeHandleHighlighted])

  const handleDecodeResize = useCallback(
    (panelSize: PanelSize) => {
      if (!hasSelectedRecord) return
      setDecodeCollapsed(panelSize.asPercentage <= 0.001)
    },
    [hasSelectedRecord, setDecodeCollapsed],
  )

  const handleDecodeSeparatorDoubleClick = useCallback(() => {
    if (!hasSelectedRecord) return
    setDecodeCollapsed((current) => !current)
  }, [hasSelectedRecord, setDecodeCollapsed])

  const defaultLayoutForMode = useMemo(() => defaultLayout, [defaultLayout])
  const selectedRecord =
    selectedIndex === null ? null : (captureBuffer.get(selectedIndex) ?? null)
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
          <ProtocolTableCard
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
          <ProtocolDecodeCard
            className="card bg-base-100 h-full min-h-0"
            selectedIndex={selectedIndex}
          />
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

export default ProtocolPage
