import { useEffect, useState, useMemo, memo, useCallback, useRef } from 'react'
import { List, useListCallbackRef, type RowComponentProps } from 'react-window'
import { toast } from 'sonner'
import { useDeviceWorkspaceContext } from '@/components/app/DeviceWorkspaceContext'
import useAppStore, { APP_THEMES } from '@/stores/appStore'
import useDeviceStore from '@/stores/deviceStore'
import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import type { ImportMode } from '@/types/csv'
import {
  exportToCsv,
  importFromCsv,
  generateFilename,
  downloadCsv,
  readFile,
} from '@/utils/csvHelper'
import ImportDialog from '@/components/shared/ImportDialog'
import ViewTabs from '@/components/app/ViewTabs'
import clsx from 'clsx'
import {
  Check,
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
import { decodeSingleRecord } from '@/lib/analyzer/decode'
import {
  decodeUfcsRecordType,
  formatUfcsSignal,
  formatUfcsTypeSummary,
} from '@/lib/ufcs/ufcsType'
import {
  formatCompactPowerRoleOrCable,
  formatCompactSop,
} from '@/lib/display/pdTableFields'
import type { DeviceKind } from '@/lib/devices/deviceDrivers'

const ROW_HEIGHT = 30
const TOOLBAR_ICON_BUTTON_CLASS = 'btn btn-sm btn-square btn-ghost'
const TOOLBAR_ICON_CLASS = 'h-5 w-5'
const SMOOTH_FOLLOW_MIN_INTERVAL_MS = 180
const SMOOTH_FOLLOW_MAX_RECORD_DELTA = 4
type DecodeLayoutMode = 'vertical' | 'horizontal'

type ToolbarTooltipProps = {
  readonly tip: string
  readonly children: React.ReactNode
}

const ToolbarTooltip = ({
  tip,
  children,
}: ToolbarTooltipProps): React.JSX.Element => (
  <div className="tooltip tooltip-bottom" data-tip={tip}>
    {children}
  </div>
)

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
  {
    key: 'numberOfDataObjects',
    label: 'Obj',
    width: 40,
    align: 'center' as const,
  },
  { key: 'msgId', label: 'ID', width: 40, align: 'center' as const },
  { key: 'type', label: 'Type', width: 220, align: 'left' as const },
  {
    key: 'data',
    label: 'Data',
    width: null,
    align: 'left' as const,
    minWidth: 320,
  },
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

const CellComponent = memo(
  ({
    width,
    align,
    children,
    flex = false,
    minWidth = null,
  }: CellComponentProps) => {
    const cellStyle: React.CSSProperties = useMemo(
      () => ({
        width: flex ? 'auto' : toPx(width),
        minWidth: flex ? toPx(minWidth ?? width) : toPx(width),
        textAlign: align,
        flex: flex ? '1 1 0' : 'none',
      }),
      [width, minWidth, align, flex],
    )

    const displayValue =
      children === '' || children === null || typeof children === 'undefined'
        ? '-'
        : children

    return (
      <div
        style={cellStyle}
        className="px-2 overflow-hidden text-ellipsis whitespace-nowrap"
      >
        {displayValue}
      </div>
    )
  },
)

CellComponent.displayName = 'CellComponent'

type ColumnKey = (typeof COLUMNS)[number]['key']

type DerivedRowData = {
  recordIndex: number
  cells: Record<ColumnKey, React.ReactNode>
}

type RowData = {
  onRowClick: (index: number) => void
  selectedIndex: number | null
}

const padNumber = (value: number, length = 2): string =>
  value.toString().padStart(length, '0')
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

const formatActiveCC = (activeCC: number): string => {
  if (activeCC === 1) return 'CC1'
  if (activeCC === 2) return 'CC2'
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

const RowComponentInner = ({
  ariaAttributes,
  index,
  style,
  onRowClick,
  selectedIndex,
}: RowComponentProps<RowData>) => {
  const captureBuffer = useDeviceStore((state) => state.captureBuffer)
  const captureVersion = useDeviceStore((state) => state.captureVersion)

  const rowData = useMemo<DerivedRowData | null>(() => {
    void captureVersion
    const recordIndex = index
    const record = captureBuffer.get(recordIndex)
    if (!record) return null

    const previousRecord = recordIndex > 0 ? captureBuffer.get(recordIndex - 1) ?? null : null
    const deltaTime = previousRecord
      ? record.timestamp_us - previousRecord.timestamp_us
      : null
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
        ? (formatUfcsTypeSummary(ufcsDecoded) ?? record.event_type)
        : (decoded.messageType.name ?? decoded.category)
    const sopDesc = formatCompactSop(decoded?.frame.sop)
    const dataRole =
      ufcsSignal ??
      (decoded?.header?.portDataRoleMeaning === null ||
      decoded?.header?.portDataRoleMeaning === undefined
        ? ''
        : decoded.header.portDataRoleMeaning)
    const powerRole = formatCompactPowerRoleOrCable(
      decoded?.frame.sop,
      decoded?.header,
    )

    const cells: Record<ColumnKey, React.ReactNode> = {
      seq: record.seq,
      time: timestampText,
      deltaTime: deltaTimeText,
      vbus: record.vbus_mv,
      ibus: record.ibus_ma ?? '',
      cc: formatActiveCC(record.active_cc),
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
  }, [captureBuffer, captureVersion, index])

  const isSelected = rowData !== null && selectedIndex === rowData.recordIndex
  const handleClick = useCallback(() => {
    if (rowData !== null) {
      onRowClick(rowData.recordIndex)
    }
  }, [onRowClick, rowData])
  const rowStyle = useMemo(
    () => ({ ...style, display: 'flex', alignItems: 'center' }),
    [style],
  )

  if (!rowData) {
    return (
      <div style={style} {...ariaAttributes}>
        No Data
      </div>
    )
  }

  return (
    <div
      {...ariaAttributes}
      className={clsx('select-none cursor-pointer relative', {
        'bg-base-300 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-primary':
          isSelected,
        'hover:bg-base-300': !isSelected,
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

const HeaderCell = memo(({ col }: { col: (typeof COLUMNS)[number] }) => {
  const headerCellStyle: React.CSSProperties = useMemo(
    () => ({
      width: col.width ? `${col.width}px` : 'auto',
      minWidth: col.width ? `${col.width}px` : toPx(col.minWidth ?? null),
      textAlign: col.align,
      flex: col.width ? 'none' : 1,
    }),
    [col.width, col.align, col.minWidth],
  )

  return (
    <div style={headerCellStyle} className="px-2">
      {col.label}
    </div>
  )
})

HeaderCell.displayName = 'HeaderCell'

const TableComponent = memo(
  ({
    autoScroll,
    setAutoScroll,
    onRowClick,
    selectedIndex,
    scrollRequest,
  }: TableComponentProps) => {
    const { captureCount } = useDeviceWorkspaceContext()
    const [list, setList] = useListCallbackRef()
    const lastScrollRequest = useRef(0)
    const isProgrammaticScroll = useRef(false)
    const lastScrollTop = useRef(0)
    const userScrollIntent = useRef<'up' | 'down' | null>(null)
    const lastFollowScrollAt = useRef(0)
    const lastFollowRecordCount = useRef(0)

    const recordCount = captureCount

    useEffect(() => {
      if (autoScroll && recordCount > 1) {
        const now = performance.now()
        const recordDelta = recordCount - lastFollowRecordCount.current
        const elapsed = now - lastFollowScrollAt.current
        const followBehavior =
          elapsed >= SMOOTH_FOLLOW_MIN_INTERVAL_MS &&
          recordDelta > 0 &&
          recordDelta <= SMOOTH_FOLLOW_MAX_RECORD_DELTA
            ? 'smooth'
            : 'auto'

        isProgrammaticScroll.current = true
        list?.scrollToRow({
          behavior: followBehavior,
          index: recordCount - 1,
        })
        lastFollowScrollAt.current = now
        lastFollowRecordCount.current = recordCount
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
      setTimeout(() => {
        isProgrammaticScroll.current = false
      }, 100)
    }, [scrollRequest, selectedIndex, list, recordCount])

    const handleWheelCapture = useCallback(
      (event: React.WheelEvent<HTMLDivElement>) => {
        if (event.deltaY < 0) {
          userScrollIntent.current = 'up'
          isProgrammaticScroll.current = false
          if (autoScroll && AUTO_SCROLL_CONFIG.STOP_ON_MANUAL_SCROLL) {
            setAutoScroll(false)
          }
        } else if (event.deltaY > 0) {
          userScrollIntent.current = 'down'
        }
      },
      [autoScroll, setAutoScroll],
    )

    const handleScroll = useCallback(
      (event: React.UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget
        const currentScrollTop = target.scrollTop
        const scrollHeight = target.scrollHeight
        const clientHeight = target.clientHeight
        const isScrollingDown = currentScrollTop > lastScrollTop.current
        const isScrollingUp = currentScrollTop < lastScrollTop.current
        const intent = userScrollIntent.current

        // Check if scrolled to bottom
        const isAtBottom =
          scrollHeight - (currentScrollTop + clientHeight) <=
          AUTO_SCROLL_CONFIG.BOTTOM_THRESHOLD

        if (
          intent === 'up' &&
          AUTO_SCROLL_CONFIG.STOP_ON_MANUAL_SCROLL &&
          autoScroll
        ) {
          isProgrammaticScroll.current = false
          setAutoScroll(false)
        } else if (isProgrammaticScroll.current) {
          // Ignore programmatic follow-scroll events so they cannot undo an explicit pause.
        } else if (isAtBottom) {
          // Resume auto-scroll only when the user scrolls down to bottom.
          // Otherwise clicking the toolbar pause button while already at bottom can be undone by the next scroll event.
          if (
            AUTO_SCROLL_CONFIG.RESUME_ON_SCROLL_TO_BOTTOM &&
            !autoScroll &&
            isScrollingDown &&
            intent === 'down'
          ) {
            setAutoScroll(true)
          }
        } else if (AUTO_SCROLL_CONFIG.STOP_ON_MANUAL_SCROLL && autoScroll) {
          // Fallback for non-wheel upward navigation like scrollbar dragging.
          if (isScrollingUp) {
            setAutoScroll(false)
          }
        }

        lastScrollTop.current = currentScrollTop
        userScrollIntent.current = null
      },
      [autoScroll, setAutoScroll],
    )

    const rowProps = useMemo<RowData>(
      () => ({ onRowClick, selectedIndex }),
      [onRowClick, selectedIndex],
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

            <div className="flex-1 min-h-0" onWheelCapture={handleWheelCapture}>
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
  },
)

TableComponent.displayName = 'TableComponent'

const RecordCounterComponent = memo(() => {
  const { captureCount } = useDeviceWorkspaceContext()

  return (
    <div className="btn btn-sm rounded-full gap-1.5 border-base-300 bg-base-100 px-3 font-mono font-normal normal-case text-base-content/65 whitespace-nowrap pointer-events-none cursor-default hover:bg-base-100">
      <span className="font-semibold text-base-content/80">
        {captureCount.toLocaleString()}
      </span>
      <span>records</span>
    </div>
  )
})

RecordCounterComponent.displayName = 'RecordCounterComponent'

type CardProps = {
  className?: string
  decodeLayoutMode: DecodeLayoutMode
  onToggleDecodeLayoutMode: () => void
  onRowClick: (index: number | null) => void
  selectedIndex: number | null
  onOpenTxDialog: () => void
}

const ProtocolTableCard = memo(
  ({
    className,
    decodeLayoutMode,
    onToggleDecodeLayoutMode,
    onRowClick,
    selectedIndex,
    onOpenTxDialog,
  }: CardProps) => {
    const [autoScroll, setAutoScroll] = useState(true)
    const [scrollRequest, setScrollRequest] = useState(0)
    const [importDialogOpen, setImportDialogOpen] = useState(false)
    const [pendingImportData, setPendingImportData] = useState<
      CaptureRecord[] | null
    >(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const {
      currentView,
      onViewChange,
      clearRecords,
      captureBuffer,
      captureCount,
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
      connectDevice,
      selectDeviceKind,
      setAutoConnectOnLoad,
      setAutoReconnectOnHotplug,
    } = useDeviceWorkspaceContext()
    const theme = useAppStore((state) => state.theme)
    const setTheme = useAppStore((state) => state.setTheme)

    const handleRowClick = useCallback(
      (index: number) => {
        if (AUTO_SCROLL_CONFIG.STOP_ON_ROW_CLICK) {
          setAutoScroll(false)
        }
        onRowClick(selectedIndex === index ? null : index)
      },
      [onRowClick, selectedIndex],
    )

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
        toast.success(
          `Exported ${records.length.toLocaleString()} records to ${filename}`,
        )
      } catch (error) {
        toast.error(
          `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      } finally {
        setIsProcessing(false)
      }
    }, [captureBuffer])

    const handleImportCsv = useCallback(() => {
      fileInputRef.current?.click()
    }, [])

    const handleFileChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
          setIsProcessing(true)
          const content = await readFile(file)
          const { records, errors } = importFromCsv(content)

          if (errors.length > 0) {
            const errorMessage = errors
              .slice(0, 5)
              .map((err) => `Row ${err.row}: ${err.field} - ${err.reason}`)
              .join('\n')
            const moreErrors =
              errors.length > 5
                ? `\n... and ${errors.length - 5} more errors`
                : ''
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
          toast.error(
            `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          )
        } finally {
          setIsProcessing(false)
          // Reset file input
          if (e.target) {
            e.target.value = ''
          }
        }
      },
      [],
    )

    const handleImportConfirm = useCallback(
      (mode: ImportMode) => {
        if (!pendingImportData) return

        try {
          importRecords(pendingImportData, mode)
          toast.success(
            `Imported ${pendingImportData.length.toLocaleString()} records (${mode} mode)`,
          )
        } catch (error) {
          toast.error(
            `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          )
        } finally {
          setImportDialogOpen(false)
          setPendingImportData(null)
        }
      },
      [pendingImportData, importRecords],
    )

    const handleImportDialogClose = useCallback(() => {
      setImportDialogOpen(false)
      setPendingImportData(null)
    }, [])

    const decodeLayoutButtonLabel =
      decodeLayoutMode === 'vertical'
        ? 'Decode panel right'
        : 'Decode panel bottom'
    const DecodeLayoutIcon =
      decodeLayoutMode === 'vertical' ? PanelRightOpen : PanelBottomOpen
    const AutoScrollIcon = autoScroll ? CirclePause : CirclePlay

    return (
      <section className={clsx('@container flex min-w-0 flex-col min-h-0', className)}>
        <div className="relative z-20 shrink-0 overflow-visible p-5">
          <div className="flex flex-col gap-3 @min-[720px]:flex-row @min-[720px]:items-center @min-[720px]:justify-between">
            <div className="hidden min-w-max shrink-0 flex-nowrap items-center gap-2.5 @min-[960px]:flex">
              <h2 className="card-title hidden shrink-0 select-none whitespace-nowrap @min-[960px]:flex">
                <span className="text-primary">PD & UFCS Sniffer</span>
              </h2>
              <div className="hidden @min-[960px]:block">
                <ViewTabs currentView={currentView} onViewChange={onViewChange} />
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
              <div className="@min-[960px]:hidden">
                <ViewTabs currentView={currentView} onViewChange={onViewChange} />
              </div>
              <div className="flex min-w-max shrink-0 flex-nowrap items-center justify-end gap-2">
                {isDeviceSupported && (
                  <button
                    className="btn btn-sm rounded-full gap-2 whitespace-nowrap"
                    onClick={() => void connectDevice()}
                    disabled={isConnecting}
                    type="button"
                  >
                    {isConnected ? (
                      <>
                        <span className="inline-block h-2 w-2 rounded-full bg-success" />
                        DISCONNECT
                      </>
                    ) : (
                      <>
                        <span
                          className={clsx('inline-block h-2 w-2 rounded-full', {
                            'bg-warning animate-pulse': isConnecting,
                            'bg-base-content/25': !isConnecting,
                          })}
                        />
                        {isConnecting ? 'CONNECTING' : 'CONNECT'}
                      </>
                    )}
                  </button>
                )}
                <RecordCounterComponent />
              </div>

              <div className="flex min-w-max shrink-0 flex-nowrap items-center justify-end gap-1">
                <ToolbarTooltip tip="Device Settings">
                  <div className="group dropdown dropdown-end">
                    <button
                      className={TOOLBAR_ICON_BUTTON_CLASS}
                      aria-label="Device Settings"
                      type="button"
                    >
                      <Settings className={TOOLBAR_ICON_CLASS} />
                    </button>
                    <div className="dropdown-content z-20 mt-2 w-72 rounded-box bg-base-200 p-3 border-[length:var(--border)] border-white/5 shadow-md outline-[length:var(--border)] outline-black/5 pointer-events-none group-focus-within:pointer-events-auto">
                      {isDeviceSupported && (
                        <>
                          <div className="px-1 pb-2 text-xs font-semibold text-base-content/60 select-none">
                            Device Settings
                          </div>
                          <label className="flex items-center justify-between gap-3 px-1 py-2">
                            <span className="text-sm select-none">
                              Auto connect on load
                            </span>
                            <input
                              type="checkbox"
                              className="toggle toggle-sm"
                              checked={autoConnectOnLoad}
                              onChange={(e) =>
                                setAutoConnectOnLoad(e.target.checked)
                              }
                            />
                          </label>
                          <label className="flex items-center justify-between gap-3 px-1 py-2">
                            <span className="text-sm select-none">
                              Auto reconnect on plug-in
                            </span>
                            <input
                              type="checkbox"
                              className="toggle toggle-sm"
                              checked={autoReconnectOnHotplug}
                              onChange={(e) =>
                                setAutoReconnectOnHotplug(e.target.checked)
                              }
                            />
                          </label>
                          <label className="flex items-center justify-between gap-3 px-1 py-2">
                            <span className="text-sm select-none">Device</span>
                            <select
                              className="select select-bordered select-sm w-40"
                              value={selectedDeviceKind}
                              onChange={(event) =>
                                selectDeviceKind(event.target.value as DeviceKind)
                              }
                              disabled={isConnecting}
                              aria-label="Device"
                            >
                              {deviceOptions.map((device) => (
                                <option key={device.kind} value={device.kind}>
                                  {device.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                </ToolbarTooltip>
                <ToolbarTooltip
                  tip={
                    supportsTx
                      ? 'Native PD TX'
                      : 'Selected device does not support PD TX'
                  }
                >
                  <button
                    className={TOOLBAR_ICON_BUTTON_CLASS}
                    onClick={onOpenTxDialog}
                    disabled={
                      !supportsTx ||
                      !isDeviceSupported ||
                      !isConnected ||
                      isSending
                    }
                    aria-label="Native PD TX"
                    type="button"
                  >
                    <Send className={TOOLBAR_ICON_CLASS} />
                  </button>
                </ToolbarTooltip>
                <ToolbarTooltip tip={decodeLayoutButtonLabel}>
                  <button
                    className={TOOLBAR_ICON_BUTTON_CLASS}
                    onClick={onToggleDecodeLayoutMode}
                    aria-label={decodeLayoutButtonLabel}
                    type="button"
                  >
                    <DecodeLayoutIcon className={TOOLBAR_ICON_CLASS} />
                  </button>
                </ToolbarTooltip>

                <div className="group dropdown dropdown-end">
                  <ToolbarTooltip tip="Theme">
                    <button
                      className={TOOLBAR_ICON_BUTTON_CLASS}
                      aria-label="Theme"
                      type="button"
                    >
                      <Palette className={TOOLBAR_ICON_CLASS} />
                    </button>
                  </ToolbarTooltip>
                    <ul
                      tabIndex={-1}
                      className="dropdown-content z-20 mt-2 grid w-[26rem] grid-cols-3 gap-1 rounded-box bg-base-200 p-2 border-[length:var(--border)] border-white/5 shadow-md outline-[length:var(--border)] outline-black/5 pointer-events-none group-focus-within:pointer-events-auto"
                    >
                      {APP_THEMES.map((option) => (
                        <li key={option} className="list-none">
                          <button
                            className={clsx(
                              'btn btn-ghost h-auto min-h-0 w-full grid-cols-[auto_minmax(0,1fr)_auto] justify-start gap-1.5 rounded-btn px-1.5 py-1.5 text-left text-sm leading-5 font-normal capitalize transition-colors',
                              {
                                'bg-base-300/70 text-base-content shadow-none pointer-events-none cursor-default':
                                  theme === option,
                                'cursor-pointer hover:bg-base-300/70 hover:text-base-content':
                                  theme !== option,
                              },
                            )}
                            aria-current={theme === option ? 'true' : undefined}
                            onClick={
                              theme === option
                                ? undefined
                                : () => setTheme(option)
                            }
                            type="button"
                          >
                            <div
                              data-theme={option}
                              className="bg-base-100 grid shrink-0 grid-cols-2 gap-0.5 rounded-md p-[3px]"
                            >
                              <div className="bg-base-content size-1 rounded-full" />
                              <div className="bg-primary size-1 rounded-full" />
                              <div className="bg-secondary size-1 rounded-full" />
                              <div className="bg-accent size-1 rounded-full" />
                            </div>
                            <span className="block min-w-0 truncate">
                              {option}
                            </span>
                            <Check
                              className={clsx('h-2.5 w-2.5 shrink-0', {
                                invisible: theme !== option,
                              })}
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                </div>
                <ToolbarTooltip tip={autoScroll ? 'Pause auto scroll' : 'Auto Scroll'}>
                  <button
                    className={TOOLBAR_ICON_BUTTON_CLASS}
                    onClick={() => setAutoScroll((current) => !current)}
                    aria-label="Auto Scroll"
                    type="button"
                  >
                    <AutoScrollIcon className={TOOLBAR_ICON_CLASS} />
                  </button>
                </ToolbarTooltip>
                <ToolbarTooltip tip="Scroll to selection">
                  <button
                    className={TOOLBAR_ICON_BUTTON_CLASS}
                    onClick={handleScrollToSelection}
                    disabled={selectedIndex === null}
                    aria-label="Scroll to selection"
                    type="button"
                  >
                    <MapPin className={TOOLBAR_ICON_CLASS} />
                  </button>
                </ToolbarTooltip>
                <ToolbarTooltip tip="Export to CSV">
                  <button
                    className={TOOLBAR_ICON_BUTTON_CLASS}
                    onClick={handleExportCsv}
                    disabled={captureCount === 0 || isProcessing}
                    aria-label="Export to CSV"
                    type="button"
                  >
                    <Download className={TOOLBAR_ICON_CLASS} />
                  </button>
                </ToolbarTooltip>
                <ToolbarTooltip tip="Import from CSV">
                  <button
                    className={TOOLBAR_ICON_BUTTON_CLASS}
                    onClick={handleImportCsv}
                    disabled={isProcessing}
                    aria-label="Import from CSV"
                    type="button"
                  >
                    <Upload className={TOOLBAR_ICON_CLASS} />
                  </button>
                </ToolbarTooltip>
                <ToolbarTooltip tip="Clear">
                  <button
                    className={TOOLBAR_ICON_BUTTON_CLASS}
                    onClick={clearRecords}
                    aria-label="Clear"
                    type="button"
                  >
                    <Eraser className={TOOLBAR_ICON_CLASS} />
                  </button>
                </ToolbarTooltip>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-5 pb-5 overflow-hidden">
          <div className="h-full overflow-hidden rounded-lg bg-base-200 font-mono text-xs">
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
      </section>
    )
  },
)

ProtocolTableCard.displayName = 'ProtocolTableCard'

export default ProtocolTableCard
