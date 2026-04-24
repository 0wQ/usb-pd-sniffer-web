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
import { decodeSingleReport, monitorEventName, reportToObservedFrame } from '@/lib/live/pdCore'
import type { WebPdTxTarget } from '@/lib/live/tx'

const ROW_HEIGHT = 30
const THEME_STORAGE_KEY = 'usb-pd-sniffer-theme'
const TOOLBAR_ICON_BUTTON_CLASS = 'btn btn-sm btn-square btn-ghost'

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
  { key: 'CC1', label: 'CC1', width: 50, align: 'center' as const },
  { key: 'CC2', label: 'CC2', width: 50, align: 'center' as const },
  { key: 'sop', label: 'SOP', width: 62, align: 'left' as const },
  { key: 'drole', label: 'DRole', width: 60, align: 'center' as const },
  { key: 'prole', label: 'PRole', width: 70, align: 'center' as const },
  { key: 'ver', label: 'Ver', width: 40, align: 'center' as const },
  { key: 'numberOfDataObjects', label: 'Obj', width: 40, align: 'center' as const },
  { key: 'msgId', label: 'ID', width: 40, align: 'center' as const },
  { key: 'type', label: 'Type', width: 140, align: 'left' as const },
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
  reports: CaptureRecord[]
  onRowClick: (index: number) => void
  selectedIndex: number | null
}

type ColumnKey = typeof COLUMNS[number]['key']

type DerivedRowData = {
  reportIndex: number
  cells: Record<ColumnKey, React.ReactNode>
}

const padNumber = (value: number, length = 2): string => value.toString().padStart(length, '0')
const formatMinutes = (minutes: number): string => {
  if (minutes >= 100) {
    return minutes.toString()
  }
  return padNumber(minutes, 2)
}

const formatHexData = (pdRaw: number[], pdDataLen: number): string => {
  if (pdDataLen <= 0) return ''

  const visibleLen = Math.max(0, Math.min(pdRaw.length, pdDataLen))

  return pdRaw
    .slice(0, visibleLen)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

const formatDeltaTime = (deltaTime: number | null): string => {
  if (deltaTime === null) return '0'
  return `${deltaTime > 0 ? '+' : ''}${deltaTime}`
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

const RowComponentInner = ({ ariaAttributes, index, style, reports, onRowClick, selectedIndex }: RowComponentProps<RowData>) => {
  const rowData = useMemo<DerivedRowData | null>(() => {
    const reportIndex = index
    const report = reports[reportIndex]
    if (!report) return null

    const prevReport = reportIndex > 0 ? reports[reportIndex - 1] : null
    const deltaTime = prevReport ? report.timestamp_us - prevReport.timestamp_us : null
    const decoded = decodeSingleReport(report)
    const timestampText = formatTimestamp(report.timestamp_us)
    const deltaTimeText = formatDeltaTime(deltaTime)
    const hexData = formatHexData(report.data, report.data_len)
    const pdLength = report.data_len.toString().padStart(2, '0')
    const versionText = decoded?.header?.specificationRevision ?? ''
    const typeDesc =
      decoded === null
        ? monitorEventName(report.event_type)
        : (decoded.messageType.name ?? decoded.category)
    const sopDesc = decoded === null ? monitorEventName(report.event_type) : decoded.frame.sop
    const dataRole =
      decoded?.header?.portDataRoleMeaning === null || decoded?.header?.portDataRoleMeaning === undefined
        ? ''
        : decoded.header.portDataRoleMeaning
    const powerRole = decoded?.header?.portPowerRoleOrCablePlugMeaning ?? ''

    const cells: Record<ColumnKey, React.ReactNode> = {
      seq: report.recv_counter,
      time: timestampText,
      deltaTime: deltaTimeText,
      vbus: report.vbus_mv,
      ibus: report.ibus_ma ?? '',
      CC1: report.cc1_mv,
      CC2: report.cc2_mv,
      sop: sopDesc,
      drole: dataRole,
      prole: powerRole,
      ver: versionText,
      numberOfDataObjects: decoded?.header?.numberOfDataObjects ?? '',
      msgId: decoded?.header?.messageId ?? '',
      type: typeDesc,
      data: `(${pdLength}) ${hexData}`,
    }

    return { reportIndex, cells }
  }, [index, reports])

  const rowStyle = useMemo(() => ({ ...style, display: 'flex', alignItems: 'center' }), [style])
  const isSelected = rowData !== null && selectedIndex === rowData.reportIndex
  const handleClick = useCallback(() => {
    if (rowData !== null) {
      onRowClick(rowData.reportIndex)
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
  const reportsBuffer = useDeviceStore((state) => state.reportsBuffer)
  const reportsVersion = useDeviceStore((state) => state.reportsVersion)
  const reportsCount = useDeviceStore((state) => state.reportsCount)

  const [list, setList] = useListCallbackRef()
  const lastScrollRequest = useRef(0)
  const isProgrammaticScroll = useRef(false)
  const lastScrollTop = useRef(0)

  const reports = reportsBuffer.getAll()
  const reportCount = reportsCount

  useEffect(() => {
    if (autoScroll && reportCount > 1) {
      isProgrammaticScroll.current = true
      list?.scrollToRow({
        behavior: 'smooth',
        index: reportCount - 1,
      })
      // Reset flag after a short delay to allow scroll to complete
      setTimeout(() => {
        isProgrammaticScroll.current = false
      }, 100)
    }
  }, [reportCount, list, autoScroll])

  useEffect(() => {
    if (scrollRequest === 0) return
    if (scrollRequest === lastScrollRequest.current) return
    if (selectedIndex === null) return
    if (!list) return
    if (selectedIndex < 0 || selectedIndex >= reportCount) return
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
  }, [scrollRequest, selectedIndex, list, reportCount])

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
    () => ({ reports, onRowClick, selectedIndex }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportsVersion, onRowClick, selectedIndex]
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
            {reportCount === 0 ? (
              <div className="grid h-full place-items-center px-6 text-center text-xs text-base-content/55">
                No records yet.
              </div>
            ) : (
              <List
                listRef={setList}
                rowComponent={RowComponentInner}
                rowCount={reportCount}
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
  const reportsCount = useDeviceStore((state) => state.reportsCount)
  const reportsBuffer = useDeviceStore((state) => state.reportsBuffer)

  const lastReport = reportsCount > 0 ? reportsBuffer.get(reportsCount - 1) : null
  const dropCount = lastReport?.drop_count
  const hasDropCount = typeof dropCount === 'number'
  const dropText = hasDropCount ? dropCount.toLocaleString() : ''

  return (
    <div className="btn btn-sm rounded-full gap-1.5 border-base-300 bg-base-100 px-3 font-mono font-normal normal-case text-base-content/65 pointer-events-none cursor-default hover:bg-base-100">
      <span className="font-semibold text-base-content/80">{reportsCount.toLocaleString()}</span>
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
  onRowClick: (index: number) => void
  selectedIndex: number | null
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
  isDeviceSupported: boolean
  currentView: AppView
  onViewChange: (view: AppView) => void
}

const Card = memo(({
  className,
  onRowClick,
  selectedIndex,
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

  const clearReports = useDeviceStore((state) => state.clearReports)
  const reportsBuffer = useDeviceStore((state) => state.reportsBuffer)
  const reportsCount = useDeviceStore((state) => state.reportsCount)
  const importReports = useDeviceStore((state) => state.importReports)
  const detailContextBacktrackRecords = useDeviceStore((state) => state.detailContextBacktrackRecords)
  const setDetailContextBacktrackRecords = useDeviceStore((state) => state.setDetailContextBacktrackRecords)
  const selectedReport = selectedIndex === null ? null : (reportsBuffer.get(selectedIndex) ?? null)
  const selectedFrameForTx = useMemo(() => {
    if (selectedReport === null) {
      return null
    }

    return reportToObservedFrame(selectedReport)
  }, [selectedReport])

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
      const reports = reportsBuffer.getAll()
      const csvContent = exportToCsv(reports)
      const filename = generateFilename()
      downloadCsv(csvContent, filename)
      toast.success(`Exported ${reports.length.toLocaleString()} records to ${filename}`)
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsProcessing(false)
    }
  }, [reportsBuffer])

  const handleImportCsv = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setIsProcessing(true)
      const content = await readFile(file)
      const { reports, errors } = importFromCsv(content)

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

      if (reports.length === 0) {
        toast.error('No valid records found in CSV file')
        return
      }

      setPendingImportData(reports)
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
      importReports(pendingImportData, mode)
      toast.success(`Imported ${pendingImportData.length.toLocaleString()} records (${mode} mode)`)
    } catch (error) {
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setImportDialogOpen(false)
      setPendingImportData(null)
    }
  }, [pendingImportData, importReports])

  const handleImportDialogClose = useCallback(() => {
    setImportDialogOpen(false)
    setPendingImportData(null)
  }, [])

  return (
    <section className={clsx('flex min-w-0 flex-col min-h-0', className)}>
      <div className="relative z-20 shrink-0 overflow-visible p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 className="card-title select-none">
              <span className="text-primary">USB PD Sniffer</span>
            </h2>
            <ViewTabs currentView={currentView} onViewChange={onViewChange} />
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 xl:w-auto">
            <div className="flex flex-wrap items-center gap-2">
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

            <div className="flex flex-wrap items-center gap-1">
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={() => setTxDialogOpen(true)}
                disabled={!isDeviceSupported || !isConnected || isSendingCommand}
                aria-label="Native PD TX"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 11.5L21 3l-8.5 18-1.8-7.7L3 11.5z"
                  />
                </svg>
              </button>
              <div className="dropdown dropdown-end">
                <label tabIndex={0} role="button" className={TOOLBAR_ICON_BUTTON_CLASS}>
                  <svg
                    className="h-5 w-5 stroke-current"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </label>
                <div tabIndex={0} className="dropdown-content z-20 w-72 rounded-box bg-base-100 p-3 shadow-md">
                  {isDeviceSupported && (
                    <>
                    <div className="px-1 pb-2 text-xs font-semibold text-base-content/60 select-none">
                      Monitor Device Settings
                    </div>
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
                    {manualDisconnect && !isConnected && (
                      <div className="mt-2 px-1 text-xs text-warning select-none">
                        Auto-connect is paused until you click CONNECT.
                      </div>
                    )}
                    </>
                  )}
                  <div className={clsx('px-1 pb-2 text-xs font-semibold text-base-content/60 select-none', {
                    'pt-3 mt-3 border-t border-base-300': isDeviceSupported,
                  })}>
                    Decode Settings
                  </div>
                  <label className="flex items-center justify-between gap-3 px-1 py-2">
                    <span className="text-sm select-none">Context backtrack</span>
                    <select
                      className="select select-bordered select-sm w-40"
                      value={detailContextBacktrackRecords === null ? 'unlimited' : String(detailContextBacktrackRecords)}
                      onChange={(e) => {
                        const value = e.target.value
                        setDetailContextBacktrackRecords(value === 'unlimited' ? null : Number.parseInt(value, 10))
                      }}
                    >
                      <option value="unlimited">Full history</option>
                      <option value="128">128 records</option>
                      <option value="256">256 records</option>
                      <option value="512">512 records</option>
                      <option value="1024">1,024 records</option>
                      <option value="2048">2,048 records</option>
                      <option value="4096">4,096 records</option>
                      <option value="8192">8,192 records</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="dropdown dropdown-end">
                <label tabIndex={0} role="button" className={TOOLBAR_ICON_BUTTON_CLASS}>
                  <svg
                    className="h-5 w-5 stroke-current"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M7 4h10a2 2 0 012 2v4a2 2 0 01-2 2h-1.5l-2.2 6.2a1 1 0 01-1.9-.2L10 12H7a2 2 0 01-2-2V6a2 2 0 012-2z"
                    />
                    <circle cx="8.5" cy="8" r="1" fill="currentColor" stroke="none" />
                    <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
                    <circle cx="15.5" cy="8" r="1" fill="currentColor" stroke="none" />
                  </svg>
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

            <div className="flex flex-wrap items-center gap-1">
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={() => setAutoScroll(!autoScroll)}
                aria-label="Auto Scroll"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={autoScroll
                      ? "M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      : "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    }
                  />
                </svg>
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={handleScrollToSelection}
                disabled={selectedIndex === null}
                aria-label="Scroll to selection"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={handleExportCsv}
                disabled={reportsCount === 0 || isProcessing}
                aria-label="Export to CSV"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={handleImportCsv}
                disabled={isProcessing}
                aria-label="Import from CSV"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
              </button>
              <button
                className={TOOLBAR_ICON_BUTTON_CLASS}
                onClick={clearReports}
                aria-label="Clear"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
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
