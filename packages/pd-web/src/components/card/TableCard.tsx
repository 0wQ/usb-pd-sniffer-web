import { useEffect, useState, useMemo, memo, useCallback, useRef } from 'react'
import { List, useListCallbackRef, type RowComponentProps } from 'react-window'
import { toast } from 'sonner'
import useDeviceStore from '@/stores/deviceStore'
import type { CaptureRecord } from '@/types/pd'
import type { ImportMode } from '@/types/csv'
import { exportToCsv, importFromCsv, generateFilename, downloadCsv, readFile } from '@/utils/csvHelper'
import ImportDialog from '@/components/common/ImportDialog'
import SendPdDialog from '@/components/common/SendPdDialog'
import ViewTabs, { type AppView } from '@/components/common/ViewTabs'
import clsx from 'clsx'
import {
  CirclePause,
  CirclePlay,
  Download,
  Eraser,
  MapPin,
  Palette,
  PanelBottomOpen,
  PanelRightOpen,
  Send,
  Settings,
  Upload,
} from 'lucide-react'
import { monitorEventName } from '@usb-pd-sniffer/pd-monitor'
import { decodeSingleRecord } from '@/lib/analyzer/decode'
import { decodeUfcsRecordType, formatUfcsSignal, formatUfcsTypeSummary } from '@/lib/ufcs/ufcsType'
import { formatCompactPowerRoleOrCable, formatCompactSop } from '@/lib/display/pdTableFields'
import type {
  MonitorDeviceCapabilities,
  MonitorDeviceDriver,
  MonitorDeviceKind,
  MonitorPdTxTarget,
} from '@/lib/devices/monitorDrivers'

const ROW_HEIGHT = 30
const THEME_STORAGE_KEY = 'usb-pd-sniffer-theme'
const TOOLBAR_ICON_BUTTON_CLASS = 'btn btn-sm btn-square btn-ghost'
const TOOLBAR_ICON_CLASS = 'h-5 w-5'
type DecodeLayoutMode = 'vertical' | 'horizontal'

const themes = [
  'light',
  'dark',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'halloween',
  'garden',
  'forest',
  'lofi',
  'pastel',
  'fantasy',
  'wireframe',
  'black',
  'dracula',
  'cmyk',
  'business',
  'lemonade',
  'night',
  'winter',
  'dim',
  'nord',
  'sunset',
  'silk',
] as const

const changeTheme = (theme: string = 'light') => {
  const html = document.querySelector('html')
  const currentTheme = html?.getAttribute('data-theme')
  if (currentTheme === theme) return
  html?.setAttribute('data-theme', theme)
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}

// Configuration: Auto-scroll behavior
const AUTO_SCROLL_CONFIG = {
  // Whether to stop auto-scroll when a row is clicked
  STOP_ON_ROW_CLICK: false,
  // Whether to stop auto-scroll when jumping to selection
  STOP_ON_JUMP: true,
  // Whether to stop auto-scroll when user manually scrolls up
  STOP_ON_MANUAL_SCROLL: true,
  // Whether to resume auto-scroll when user scrolls to bottom
  RESUME_ON_SCROLL_TO_BOTTOM: true,
  // Threshold in pixels to consider "at bottom"
  BOTTOM_THRESHOLD: 50,
} as const

type ColumnDefinition = {
  key: string
  label: string
  width: number | null
  align: React.CSSProperties['textAlign']
  minWidth?: number
}

const COLUMNS = [
  { key: 'seq', label: 'Seq', width: 70, align: 'center' as const },
  { key: 'time', label: 'Time', width: 150, align: 'right' as const },
  { key: 'deltaTime', label: 'ΔTime', width: 100, align: 'right' as const },
  { key: 'vbus', label: 'Vbus', width: 60, align: 'right' as const },
  { key: 'ibus', label: 'Ibus', width: 60, align: 'right' as const },
  { key: 'cc', label: 'CC', width: 50, align: 'center' as const },
  { key: 'sop', label: 'SOP', width: 60, align: 'left' as const },
  { key: 'drole', label: 'DRole', width: 60, align: 'center' as const },
  { key: 'prole', label: 'PRole', width: 70, align: 'center' as const },
  { key: 'ver', label: 'Ver', width: 40, align: 'center' as const },
  { key: 'numberOfDataObjects', label: 'Obj', width: 40, align: 'center' as const },
  { key: 'msgId', label: 'ID', width: 40, align: 'center' as const },
  { key: 'type', label: 'Type', width: 220, align: 'left' as const },
  { key: 'data', label: 'Data', width: null, align: 'left' as const, minWidth: 320 },
] satisfies ReadonlyArray<ColumnDefinition>

type CellComponentProps = {
  width: number | null
  align: React.CSSProperties['textAlign']
  children: React.ReactNode
  flex?: boolean
  minWidth?: number | null
}

const toPx = (value: number | null | undefined): string => {
  if (typeof value === 'number') return `${value}px`
  return 'auto'
}

const CellComponent = memo(({ width, align, children, flex = false, minWidth = null }: CellComponentProps) => {
  const cellStyle: React.CSSProperties = useMemo(() => ({
    width: flex ? 'auto' : toPx(width),
    minWidth: flex ? toPx(minWidth ?? width) : toPx(width),
    textAlign: align,
    flex: flex ? '1 1 0' : 'none',
  }), [width, minWidth, align, flex])

  const displayValue = (children === '' || children === null || typeof children === 'undefined') ? '-' : children

  return (
    <div style={cellStyle} className="px-2 overflow-hidden text-ellipsis whitespace-nowrap">
      {displayValue}
    </div>
  )
})

CellComponent.displayName = 'CellComponent'

type RowData = {
  records: CaptureRecord[]
  onRowClick: (index: number) => void
  selectedIndex: number | null
}

type ColumnKey = typeof COLUMNS[number]['key']

type DerivedRowData = {
  recordIndex: number
  cells: Record<ColumnKey, React.ReactNode>
}

const padNumber = (value: number, length = 2): string => value.toString().padStart(length, '0')
const formatMinutes = (minutes: number): string => {
  if (minutes >= 100) {
    return minutes.toString()
  }
  return padNumber(minutes, 2)
}

const formatHexData = (data: number[], dataLen: number): string => {
  if (dataLen <= 0) return ''

  const visibleLen = Math.max(0, Math.min(data.length, dataLen))

  return data
    .slice(0, visibleLen)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

const formatDeltaTime = (deltaTime: number | null): string => {
  if (deltaTime === null) return '0'
  return `${deltaTime > 0 ? '+' : ''}${deltaTime.toLocaleString()}`
}

const formatActiveCc = (activeCc: number): string => {
  if (activeCc === 1) return 'CC1'
  if (activeCc === 2) return 'CC2'
  return ''
}

// Converts a microsecond timestamp to MM:SS:MMM:UUU for readability.
const formatTimestamp = (timestampUs: number | null | undefined): string => {
  if (typeof timestampUs !== 'number' || Number.isNaN(timestampUs)) return '-'

  const totalMicroseconds = Math.max(0, Math.floor(timestampUs))
  const minutes = Math.floor(totalMicroseconds / 60_000_000)
  const remainingAfterMinutes = totalMicroseconds % 60_000_000
  const seconds = Math.floor(remainingAfterMinutes / 1_000_000)
  const remainingAfterSeconds = remainingAfterMinutes % 1_000_000
  const milliseconds = Math.floor(remainingAfterSeconds / 1_000)
  const microseconds = remainingAfterSeconds % 1_000

  return [
    formatMinutes(minutes),
    padNumber(seconds),
    padNumber(milliseconds, 3),
    padNumber(microseconds, 3),
  ].join(':')
}

const RowComponentInner = ({ ariaAttributes, index, style, records, onRowClick, selectedIndex }: RowComponentProps<RowData>) => {
  const rowData = useMemo<DerivedRowData | null>(() => {
    const recordIndex = index
    const record = records[recordIndex]
    if (!record) return null

    const previousRecord = recordIndex > 0 ? records[recordIndex - 1] : null
    const deltaTime = previousRecord ? record.timestamp_us - previousRecord.timestamp_us : null
    const decoded = decodeSingleRecord(record)
    const ufcsDecoded = decoded === null ? decodeUfcsRecordType(record) : null
    const ufcsSignal = decoded === null ? formatUfcsSignal(record) : null
    const timestampText = formatTimestamp(record.timestamp_us)
    const deltaTimeText = formatDeltaTime(deltaTime)
    const hexData = formatHexData(record.data, record.data_len)
    const pdLength = record.data_len.toString().padStart(2, '0')
    const versionText = decoded?.header?.specificationRevision ?? ''
    const typeDesc =
      decoded === null
        ? (formatUfcsTypeSummary(ufcsDecoded) ?? monitorEventName(record.event_type))
        : (decoded.messageType.name ?? decoded.category)
    const sopDesc = formatCompactSop(decoded?.frame.sop)
    const dataRole =
      ufcsSignal ?? (decoded?.header?.portDataRoleMeaning === null || decoded?.header?.portDataRoleMeaning === undefined
        ? ''
        : decoded.header.portDataRoleMeaning)
    const powerRole = formatCompactPowerRoleOrCable(decoded?.frame.sop, decoded?.header)

    const cells: Record<ColumnKey, React.ReactNode> = {
      seq: record.recv_counter,
      time: timestampText,
      deltaTime: deltaTimeText,
      vbus: record.vbus_mv,
      ibus: record.ibus_ma ?? '',
      cc: formatActiveCc(record.active_cc),
      sop: sopDesc,
      drole: dataRole,
      prole: powerRole,
      ver: versionText,
      numberOfDataObjects: decoded?.header?.numberOfDataObjects ?? '',
      msgId: decoded?.header?.messageId ?? '',
      type: typeDesc,
      data: `(${pdLength}) ${hexData}`,
    }

    return { recordIndex, cells }
  }, [index, records])

  const rowStyle = useMemo(() => ({ ...style, display: 'flex', alignItems: 'center' }), [style])
  const isSelected = rowData !== null && selectedIndex === rowData.recordIndex
  const handleClick = useCallback(() => {
    if (rowData !== null) {
      onRowClick(rowData.recordIndex)
    }
  }, [onRowClick, rowData])

  if (!rowData) {
    return <div style={style} {...ariaAttributes}>No Data</div>
  }

  return (
    <div
      className={clsx("select-none cursor-pointer relative", {
        "bg-base-300 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-primary": isSelected,
        "hover:bg-base-300": !isSelected
      })}
      style={rowStyle}
      onClick={handleClick}
    >
      {COLUMNS.map((col) => (
        <CellComponent
          key={col.key}
          width={col.width}
          align={col.align}
          flex={col.key === 'data'}
          minWidth={col.minWidth ?? null}
        >
          {rowData.cells[col.key]}
        </CellComponent>
      ))}
    </div>
  )
}

type TableComponentProps = {
  autoScroll: boolean
  setAutoScroll: (value: boolean) => void
  onRowClick: (index: number) => void
  selectedIndex: number | null
  scrollRequest: number
}

const HeaderCell = memo(({ col }: { col: typeof COLUMNS[number] }) => {
  const headerCellStyle: React.CSSProperties = useMemo(() => ({
    width: col.width ? `${col.width}px` : 'auto',
    minWidth: col.width ? `${col.width}px` : toPx(col.minWidth ?? null),
    textAlign: col.align,
    flex: col.width ? 'none' : 1,
  }), [col.width, col.align, col.minWidth])

  return (
    <div style={headerCellStyle} className="px-2">
      {col.label}
    </div>
  )
})

HeaderCell.displayName = 'HeaderCell'

const TableComponent = memo(({
  autoScroll,
  setAutoScroll,
  onRowClick,
  selectedIndex,
  scrollRequest,
}: TableComponentProps) => {
  const captureBuffer = useDeviceStore((state) => state.captureBuffer)
  const captureVersion = useDeviceStore((state) => state.captureVersion)
  const captureCount = useDeviceStore((state) => state.captureCount)

  const [list, setList] = useListCallbackRef()
  const lastScrollRequest = useRef(0)
  const isProgrammaticScroll = useRef(false)
  const lastScrollTop = useRef(0)

  const records = captureBuffer.getAll()
  const recordCount = captureCount

  useEffect(() => {
    if (autoScroll && recordCount > 1) {
      isProgrammaticScroll.current = true
      list?.scrollToRow({
        behavior: 'smooth',
        index: recordCount - 1,
      })
      // Reset flag after a short delay to allow scroll to complete
      setTimeout(() => {
        isProgrammaticScroll.current = false
      }, 100)
    }
  }, [recordCount, list, autoScroll])

  useEffect(() => {
    if (scrollRequest === 0) return
    if (scrollRequest === lastScrollRequest.current) return
    if (selectedIndex === null) return
    if (!list) return
    if (selectedIndex < 0 || selectedIndex >= recordCount) return
    isProgrammaticScroll.current = true
    list.scrollToRow({
      behavior: 'smooth',
      index: selectedIndex,
    })
    lastScrollRequest.current = scrollRequest
    // Reset flag after a short delay to allow scroll to complete
    setTimeout(() => {
      isProgrammaticScroll.current = false
    }, 100)
  }, [scrollRequest, selectedIndex, list, recordCount])

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (isProgrammaticScroll.current) return

    const target = event.currentTarget
    const currentScrollTop = target.scrollTop
    const scrollHeight = target.scrollHeight
    const clientHeight = target.clientHeight

    // Check if scrolled to bottom
    const isAtBottom = scrollHeight - (currentScrollTop + clientHeight) <= AUTO_SCROLL_CONFIG.BOTTOM_THRESHOLD

    if (isAtBottom) {
      // Resume auto-scroll when at bottom
      if (AUTO_SCROLL_CONFIG.RESUME_ON_SCROLL_TO_BOTTOM && !autoScroll) {
        setAutoScroll(true)
      }
    } else if (AUTO_SCROLL_CONFIG.STOP_ON_MANUAL_SCROLL && autoScroll) {
      // Stop auto-scroll when manually scrolling upward
      if (currentScrollTop < lastScrollTop.current) {
        setAutoScroll(false)
      }
    }

    lastScrollTop.current = currentScrollTop
  }, [autoScroll, setAutoScroll])

  const rowProps = useMemo<RowData>(
    () => ({ records, onRowClick, selectedIndex }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [captureVersion, onRowClick, selectedIndex]
  )

  return (
    <div className="flex flex-col h-full font-mono">
      <div className="flex-1 min-h-0 overflow-x-auto">
        <div className="flex flex-col h-full min-w-max">
          <div
            className="flex py-2.5 bg-base-300 font-semibold text-base-content/70 sticky z-10 top-0 select-none"
            style={{ alignItems: 'center' }}
          >
            {COLUMNS.map((col) => (
              <HeaderCell key={col.key} col={col} />
            ))}
          </div>

          <div className="flex-1 min-h-0">
            {recordCount === 0 ? (
              <div className="grid h-full place-items-center px-6 text-center text-xs text-base-content/55">
                No records yet.
              </div>
            ) : (
              <List
                listRef={setList}
                rowComponent={RowComponentInner}
                rowCount={recordCount}
                rowHeight={ROW_HEIGHT}
                rowProps={rowProps}
                onScroll={handleScroll}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

TableComponent.displayName = 'TableComponent'

const RecordCounterComponent = memo(() => {
  const captureCount = useDeviceStore((state) => state.captureCount)
  const captureBuffer = useDeviceStore((state) => state.captureBuffer)

  const lastRecord = captureCount > 0 ? captureBuffer.get(captureCount - 1) : null
  const dropCount = lastRecord?.drop_count
  const hasDropCount = typeof dropCount === 'number'
  const dropText = hasDropCount ? dropCount.toLocaleString() : ''

  return (
    <div className="btn btn-sm rounded-full gap-1.5 border-base-300 bg-base-100 px-3 font-mono font-normal normal-case text-base-content/65 pointer-events-none cursor-default hover:bg-base-100">
      <span className="font-semibold text-base-content/80">{captureCount.toLocaleString()}</span>
      <span>records</span>
      {hasDropCount && (
        <>
          <span className="text-base-content/35">/</span>
          <span className="text-base-content/65">{dropText}</span>
          <span>drop</span>
        </>
      )}
    </div>
  )
})

RecordCounterComponent.displayName = 'RecordCounterComponent'

type CardProps = {
  className?: string
  decodeLayoutMode: DecodeLayoutMode
  onToggleDecodeLayoutMode: () => void
  onRowClick: (index: number) => void
  selectedIndex: number | null
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
  onSetUfcsAttach: (enabled: boolean) => Promise<void>
  isSendingCommand: boolean
  isDeviceSupported: boolean
  currentView: AppView
  onViewChange: (view: AppView) => void
}

const Card = memo(({
  className,
  decodeLayoutMode,
  onToggleDecodeLayoutMode,
  onRowClick,
  selectedIndex,
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
  onSetUfcsAttach,
  isSendingCommand,
  isDeviceSupported,
  currentView,
  onViewChange,
}: CardProps) => {
  const [autoScroll, setAutoScroll] = useState(true)
  const [scrollRequest, setScrollRequest] = useState(0)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [txDialogOpen, setTxDialogOpen] = useState(false)
  const [pendingImportData, setPendingImportData] = useState<CaptureRecord[] | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clearRecords = useDeviceStore((state) => state.clearRecords)
  const captureBuffer = useDeviceStore((state) => state.captureBuffer)
  const captureCount = useDeviceStore((state) => state.captureCount)
  const importRecords = useDeviceStore((state) => state.importRecords)
  const selectedRecord = selectedIndex === null ? null : (captureBuffer.get(selectedIndex) ?? null)
  const selectedFrameForTx = useMemo(() => {
    if (selectedRecord === null) {
      return null
    }

    return decodeSingleRecord(selectedRecord)?.frame ?? null
  }, [selectedRecord])

  const handleRowClick = useCallback((index: number) => {
    if (AUTO_SCROLL_CONFIG.STOP_ON_ROW_CLICK) {
      setAutoScroll(false)
    }
    onRowClick(index)
  }, [onRowClick])

  const handleScrollToSelection = useCallback(() => {
    if (selectedIndex === null) return
    if (AUTO_SCROLL_CONFIG.STOP_ON_JUMP) {
      setAutoScroll(false)
    }
    setScrollRequest((prev) => prev + 1)
  }, [selectedIndex])

  const handleExportCsv = useCallback(() => {
    try {
      setIsProcessing(true)
      const records = captureBuffer.getAll()
      const csvContent = exportToCsv(records)
      const filename = generateFilename()
      downloadCsv(csvContent, filename)
      toast.success(`Exported ${records.length.toLocaleString()} records to ${filename}`)
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsProcessing(false)
    }
  }, [captureBuffer])

  const handleImportCsv = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setIsProcessing(true)
      const content = await readFile(file)
      const { records, errors } = importFromCsv(content)

      if (errors.length > 0) {
        const errorMessage = errors.slice(0, 5).map(err =>
          `Row ${err.row}: ${err.field} - ${err.reason}`
        ).join('\n')
        const moreErrors = errors.length > 5 ? `\n... and ${errors.length - 5} more errors` : ''
        toast.error(`Import failed with ${errors.length} error(s)`, {
          description: errorMessage + moreErrors,
        })
        return
      }

      if (records.length === 0) {
        toast.error('No valid records found in CSV file')
        return
      }

      setPendingImportData(records)
      setImportDialogOpen(true)
    } catch (error) {
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsProcessing(false)
      // Reset file input
      if (e.target) {
        e.target.value = ''
      }
    }
  }, [])

  const handleImportConfirm = useCallback((mode: ImportMode) => {
    if (!pendingImportData) return

    try {
      importRecords(pendingImportData, mode)
      toast.success(`Imported ${pendingImportData.length.toLocaleString()} records (${mode} mode)`)
    } catch (error) {
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setImportDialogOpen(false)
      setPendingImportData(null)
    }
  }, [pendingImportData, importRecords])

  const handleImportDialogClose = useCallback(() => {
    setImportDialogOpen(false)
    setPendingImportData(null)
  }, [])

  const handleSetUfcsAttach = useCallback(async (enabled: boolean) => {
    try {
      await onSetUfcsAttach(enabled)
      toast.success(enabled ? 'Enabled UFCS attach.' : 'Disabled UFCS attach.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update UFCS attach.')
    }
  }, [onSetUfcsAttach])

  const decodeLayoutButtonLabel = decodeLayoutMode === 'vertical'
    ? 'Move decode panel to right side'
    : 'Move decode panel to bottom'
  const DecodeLayoutIcon = decodeLayoutMode === 'vertical'
    ? PanelRightOpen
    : PanelBottomOpen
  const AutoScrollIcon = autoScroll ? CirclePause : CirclePlay

  return (
    <section className={clsx('flex min-w-0 flex-col min-h-0', className)}>
      <div className="relative z-20 shrink-0 overflow-visible p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-max shrink-0 flex-nowrap items-center gap-2.5">
            <h2 className="card-title shrink-0 select-none whitespace-nowrap">
              <span className="text-primary">PD & UFCS Sniffer</span>
            </h2>
            <ViewTabs currentView={currentView} onViewChange={onViewChange} />
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {isDeviceSupported && (
                <button
                  className="btn btn-sm rounded-full gap-2"
                  onClick={onConnectBtnClick}
                  disabled={isConnecting}
                >
                  {isConnected ? (
                    <>
                      <span className="inline-block h-2 w-2 rounded-full bg-success" />
                      DISCONNECT
                    </>
                  ) : (
                    <>
                      <span className={clsx('inline-block h-2 w-2 rounded-full', {
                        'bg-warning animate-pulse': isConnecting,
                        'bg-base-content/25': !isConnecting,
                      })} />
                      {isConnecting ? 'CONNECTING' : 'CONNECT'}
                    </>
                  )}
                </button>
              )}
              <RecordCounterComponent />
            </div>

            <div className="flex min-w-max shrink-0 flex-wrap items-center justify-end gap-1">
              <div className="dropdown dropdown-end">
                <label tabIndex={0} role="button" className={TOOLBAR_ICON_BUTTON_CLASS}>
                  <Settings className={TOOLBAR_ICON_CLASS} />
                </label>
                <div tabIndex={0} className="dropdown-content z-20 w-72 rounded-box bg-base-100 p-3 shadow-md">
                  {isDeviceSupported && (
                    <>
                    <div className="px-1 pb-2 text-xs font-semibold text-base-content/60 select-none">
                      Monitor Device Settings
                    </div>
                    {manualDisconnect && !isConnected && (
                      <div className="mb-2 px-1 text-xs text-warning select-none">
                        Auto-connect is paused until you click CONNECT.
                      </div>
                    )}
                    <label className="flex items-center justify-between gap-3 px-1 py-2">
                      <span className="text-sm select-none">Auto connect on load</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={autoConnectOnLoad}
                        onChange={(e) => onAutoConnectOnLoadChange(e.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 px-1 py-2">
                      <span className="text-sm select-none">Auto reconnect on plug-in</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={autoReconnectOnHotplug}
                        onChange={(e) => onAutoReconnectOnHotplugChange(e.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 px-1 py-2">
                      <span className="text-sm select-none">Device</span>
                      <select
                        className="select select-bordered select-sm w-40"
                        value={selectedMonitorDeviceKind}
                        onChange={(event) => onMonitorDeviceKindChange(event.target.value as MonitorDeviceKind)}
                        disabled={isConnecting}
                        aria-label="Monitor device"
                      >
                        {monitorDeviceOptions.map((device) => (
                          <option key={device.kind} value={device.kind}>
                            {device.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {monitorDeviceCapabilities.ufcs && (
                      <div className="mt-2 border-t border-base-300/70 pt-2">
                        <div className="px-1 pb-1 text-xs font-semibold text-base-content/60 select-none">
                          UFCS
                        </div>
                        <div className="flex items-center justify-between gap-3 px-1 py-2">
                          <span className="text-sm select-none">Attach</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="btn btn-xs rounded-full border-success/30 bg-success/10 px-3 normal-case text-success hover:bg-success/15"
                              onClick={() => void handleSetUfcsAttach(true)}
                              disabled={!isConnected || isSendingCommand}
                            >
                              Enable
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs rounded-full border-warning/35 bg-warning/10 px-3 normal-case text-warning hover:bg-warning/15"
                              onClick={() => void handleSetUfcsAttach(false)}
                              disabled={!isConnected || isSendingCommand}
                            >
                              Disable
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    </>
                  )}
                </div>
              </div>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={() => setTxDialogOpen(true)}
                disabled={!monitorDeviceCapabilities.tx || !isDeviceSupported || !isConnected || isSendingCommand}
                aria-label="Native PD TX"
                title={monitorDeviceCapabilities.tx ? 'Native PD TX' : 'Selected device does not support PD TX'}
              >
                <Send className={TOOLBAR_ICON_CLASS} />
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={onToggleDecodeLayoutMode}
                aria-label={decodeLayoutButtonLabel}
                title={decodeLayoutButtonLabel}
              >
                <DecodeLayoutIcon className={TOOLBAR_ICON_CLASS} />
              </button>

              <div className="dropdown dropdown-end">
                <label tabIndex={0} role="button" className={TOOLBAR_ICON_BUTTON_CLASS}>
                  <Palette className={TOOLBAR_ICON_CLASS} />
                </label>
                <ul tabIndex={-1} className="dropdown-content z-20 max-h-72 w-50 overflow-y-auto rounded-box bg-base-100 p-2 shadow-md menu">
                  {themes.map((theme) => (
                    <li key={theme} onClick={() => changeTheme(theme)}>
                      <a className="capitalize">{theme}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex min-w-max shrink-0 flex-wrap items-center justify-end gap-1">
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={() => setAutoScroll(!autoScroll)}
                aria-label="Auto Scroll"
              >
                <AutoScrollIcon className={TOOLBAR_ICON_CLASS} />
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={handleScrollToSelection}
                disabled={selectedIndex === null}
                aria-label="Scroll to selection"
              >
                <MapPin className={TOOLBAR_ICON_CLASS} />
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={handleExportCsv}
                disabled={captureCount === 0 || isProcessing}
                aria-label="Export to CSV"
              >
                <Download className={TOOLBAR_ICON_CLASS} />
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={handleImportCsv}
                disabled={isProcessing}
                aria-label="Import from CSV"
              >
                <Upload className={TOOLBAR_ICON_CLASS} />
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={clearRecords}
                aria-label="Clear"
              >
                <Eraser className={TOOLBAR_ICON_CLASS} />
              </button>
            </div>
          </div>
        </div>

      </div>

      <div className="flex-1 min-h-0 px-5 pb-5 overflow-hidden">
        <div className="h-full overflow-auto rounded-lg bg-base-200 font-mono text-xs">
          <TableComponent
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            onRowClick={handleRowClick}
            selectedIndex={selectedIndex}
            scrollRequest={scrollRequest}
          />
        </div>
      </div>

      {/* Hidden file input for CSV import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Import confirmation dialog */}
      <ImportDialog
        isOpen={importDialogOpen}
        recordCount={pendingImportData?.length ?? 0}
        onClose={handleImportDialogClose}
        onConfirm={handleImportConfirm}
      />

      <SendPdDialog
        isOpen={txDialogOpen}
        isConnected={isConnected}
        isSending={isSendingCommand}
        selectedFrame={selectedFrameForTx}
        onClose={() => setTxDialogOpen(false)}
        onSendRaw={onSendRawPdFrame}
        onSendHardReset={onSendHardReset}
        onSendCableReset={onSendCableReset}
      />
    </section>
  )
})

Card.displayName = 'Card'

export default Card
