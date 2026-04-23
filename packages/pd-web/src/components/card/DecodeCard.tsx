import clsx from 'clsx'
import { useMemo } from 'react'
import type { BitField, DecodedMessage, DecodeIssue, Section } from '@usb-pd-sniffer/pd-core'
import useDeviceStore from '@/stores/deviceStore'
import { decodeReportAtIndex, decodeSingleReport, monitorEventName } from '@/lib/live/pdCore'

type Props = {
  className?: string
  selectedIndex: number | null
}

function formatTimestampUs(timestampUs: number): string {
  const totalMicroseconds = Math.max(0, Math.floor(timestampUs))
  const minutes = Math.floor(totalMicroseconds / 60_000_000)
  const remainingAfterMinutes = totalMicroseconds % 60_000_000
  const seconds = Math.floor(remainingAfterMinutes / 1_000_000)
  const remainingAfterSeconds = remainingAfterMinutes % 1_000_000
  const milliseconds = Math.floor(remainingAfterSeconds / 1_000)
  const microseconds = remainingAfterSeconds % 1_000

  return [
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
    milliseconds.toString().padStart(3, '0'),
    microseconds.toString().padStart(3, '0'),
  ].join(':')
}

function formatDeltaUs(deltaUs: number | null): string {
  if (deltaUs === null) return '-'
  return `${deltaUs >= 0 ? '+' : ''}${deltaUs} us`
}

function hexBytes(bytes: readonly number[] | Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

function bitRangeLabel(bitStart: number, bitLength: number): string {
  if (bitLength <= 1) {
    return `B${bitStart}`
  }

  return `B${bitStart + bitLength - 1}..${bitStart}`
}

function formatRawValue(rawValue: number | bigint | undefined): string {
  if (rawValue === undefined) return '-'

  if (typeof rawValue === 'bigint') {
    return `0x${rawValue.toString(16).toUpperCase()}`
  }

  const normalized = rawValue >>> 0
  return `0x${normalized.toString(16).toUpperCase()}`
}

function formatFieldMeaning(field: BitField): string {
  if (field.displayValue !== undefined) return field.displayValue
  if (field.decodedValue === null) return '-'
  if (typeof field.decodedValue === 'boolean') return field.decodedValue ? 'true' : 'false'
  return String(field.decodedValue)
}

function formatByteRange(byteOffset: number, byteLength: number): string {
  if (byteLength <= 0) {
    return `Byte ${byteOffset}`
  }

  if (byteLength === 1) {
    return `Byte ${byteOffset}`
  }

  return `Bytes ${byteOffset}..${byteOffset + byteLength - 1}`
}

function issueTone(issue: DecodeIssue): string {
  switch (issue.severity) {
    case 'error':
      return 'badge-error'
    case 'warning':
      return 'badge-warning'
    default:
      return 'badge-info'
  }
}

function contextDiffSummary(withContext: DecodedMessage, withoutContext: DecodedMessage): string | null {
  const differences: string[] = []

  if (withContext.messageType.name !== withoutContext.messageType.name) {
    differences.push(
      `Type ${withoutContext.messageType.name ?? withoutContext.category} -> ${withContext.messageType.name ?? withContext.category}`
    )
  }

  if (withContext.sections.length !== withoutContext.sections.length) {
    differences.push(`Sections ${withoutContext.sections.length} -> ${withContext.sections.length}`)
  }

  if (withContext.issues.length !== withoutContext.issues.length) {
    differences.push(`Issues ${withoutContext.issues.length} -> ${withContext.issues.length}`)
  }

  return differences.length === 0 ? null : differences.join(' | ')
}

type FieldRowProps = {
  field: BitField
}

function FieldRow({ field }: FieldRowProps) {
  return (
    <div className="grid gap-x-3 gap-y-1 border-b border-base-300/70 px-3 py-2 last:border-b-0 md:grid-cols-[88px_minmax(0,1.2fr)_minmax(0,1fr)_120px]">
      <div className="font-mono text-[11px] text-base-content/55">{bitRangeLabel(field.bitStart, field.bitLength)}</div>
      <div className="min-w-0">
        <div className="text-xs text-base-content">{field.label}</div>
        {field.note !== undefined && (
          <div className="mt-1 text-[11px] leading-4 text-base-content/55">{field.note}</div>
        )}
      </div>
      <div className="min-w-0 font-mono text-xs text-base-content break-all">{formatFieldMeaning(field)}</div>
      <div className="font-mono text-[11px] text-base-content/50">{formatRawValue(field.rawValue)}</div>
    </div>
  )
}

type IssueListProps = {
  issues: DecodeIssue[]
}

function IssueList({ issues }: IssueListProps) {
  if (issues.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      {issues.map((issue) => (
        <div
          key={`${issue.severity}-${issue.code}-${issue.message}`}
          className="rounded-lg border border-base-300/80 bg-base-200/60 px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span className={clsx('badge badge-xs uppercase', issueTone(issue))}>{issue.severity}</span>
            <span className="font-mono text-[11px] text-base-content/55">{issue.code}</span>
          </div>
          <div className="mt-1 text-xs leading-5 text-base-content/75">{issue.message}</div>
        </div>
      ))}
    </div>
  )
}

type SectionViewProps = {
  section: Section
}

function SectionView({ section }: SectionViewProps) {
  return (
    <div
      className="rounded-xl border border-base-300 bg-base-100/80"
      style={{ marginLeft: `${section.depth * 14}px` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-base-300/80 px-3 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-base-content">{section.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-base-content/50">
            <span>{formatByteRange(section.byteOffset, section.byteLength)}</span>
            <span>•</span>
            <span className="font-mono">{section.kind}</span>
            {section.semanticKind !== undefined && (
              <>
                <span>•</span>
                <span className="font-mono">{section.semanticKind}</span>
              </>
            )}
          </div>
        </div>

        <div className="text-right">
          {section.index !== undefined && (
            <div className="text-[11px] text-base-content/45">Index {section.index + 1}</div>
          )}
          <div className="mt-1 font-mono text-[11px] text-base-content/60">{formatRawValue(section.rawValue)}</div>
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0 rounded-lg border border-base-300/80 bg-base-200/45 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Raw Bytes</div>
            <div className="mt-2 break-all font-mono text-xs leading-5 text-base-content">{hexBytes(section.rawBytes)}</div>
          </div>
          <div className="rounded-lg border border-base-300/80 bg-base-200/45 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Fields / Issues</div>
            <div className="mt-2 font-mono text-xs text-base-content">
              {section.fields.length} / {section.issues.length}
            </div>
          </div>
        </div>

        {section.issues.length > 0 && (
          <div className="mt-3">
            <IssueList issues={section.issues} />
          </div>
        )}

        {section.fields.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-base-300/80 bg-base-100">
            <div className="grid border-b border-base-300/80 bg-base-200/55 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-base-content/45 md:grid-cols-[88px_minmax(0,1.2fr)_minmax(0,1fr)_120px]">
              <div>Bits</div>
              <div>Name</div>
              <div>Meaning</div>
              <div>Raw</div>
            </div>
            {section.fields.map((field) => (
              <FieldRow
                key={`${section.key}-${field.key}-${field.bitStart}-${field.bitLength}`}
                field={field}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-base-300/80 bg-base-200/35 px-3 py-3 text-xs text-base-content/55">
            No decoded fields yet.
          </div>
        )}
      </div>
    </div>
  )
}

const DecodeCard = ({ className, selectedIndex }: Props) => {
  const reportsBuffer = useDeviceStore((state) => state.reportsBuffer)
  const reportsVersion = useDeviceStore((state) => state.reportsVersion)
  const detailContextBacktrackRecords = useDeviceStore((state) => state.detailContextBacktrackRecords)

  const reports = useMemo(() => {
    void reportsVersion
    return reportsBuffer.getAll()
  }, [reportsBuffer, reportsVersion])

  const selectedReport = selectedIndex !== null ? reports[selectedIndex] : null
  const previousReport = selectedIndex !== null && selectedIndex > 0 ? reports[selectedIndex - 1] : null

  const decodedFrame = useMemo(() => {
    if (selectedIndex === null) return null
    return decodeReportAtIndex(reports, selectedIndex, detailContextBacktrackRecords)
  }, [reports, selectedIndex, detailContextBacktrackRecords])

  const decodedWithoutContext = useMemo(() => {
    if (selectedReport === null) return null
    return decodeSingleReport(selectedReport)
  }, [selectedReport])

  const deltaUs = selectedReport && previousReport
    ? selectedReport.timestamp_us - previousReport.timestamp_us
    : null

  const contextDifference = useMemo(() => {
    if (decodedFrame === null || decodedWithoutContext === null) return null
    return contextDiffSummary(decodedFrame, decodedWithoutContext)
  }, [decodedFrame, decodedWithoutContext])

  return (
    <section className={clsx('flex flex-col min-w-0 min-h-0', className)}>
      <div className="card-body p-5 flex flex-col gap-4 min-h-0 overflow-auto">
        <div className="flex items-center justify-between gap-3">
          <h2 className="card-title select-none">DECODE</h2>
          {decodedFrame !== null && (
            <div className="text-right text-[11px] text-base-content/55">
              <div>{decodedFrame.messageType.name ?? decodedFrame.category}</div>
              <div>{decodedFrame.frame.sop}</div>
              <div>
                {detailContextBacktrackRecords === null
                  ? 'Context: Full History'
                  : `Context: Last ${detailContextBacktrackRecords.toLocaleString()} Records`}
              </div>
            </div>
          )}
        </div>

        {selectedReport === null ? (
          <div className="text-sm text-base-content/60">Select a row to inspect decoded PD details.</div>
        ) : (
          <>
            <div className="rounded-xl border border-base-300 bg-base-100/80 p-3">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Time</div>
                  <div className="mt-1 font-mono text-xs">{formatTimestampUs(selectedReport.timestamp_us)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">ΔTime</div>
                  <div className="mt-1 font-mono text-xs">{formatDeltaUs(deltaUs)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Event</div>
                  <div className="mt-1 font-mono text-xs">{monitorEventName(selectedReport.event_type)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Payload</div>
                  <div className="mt-1 font-mono text-xs">{selectedReport.pd_data_len} B</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Type</div>
                  <div className="mt-1 font-mono text-xs">{decodedFrame?.messageType.name ?? '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Sections</div>
                  <div className="mt-1 font-mono text-xs">{decodedFrame?.sections.length ?? 0}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-base-300 bg-base-100/80 p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Raw Payload</div>
              <div className="mt-2 break-all font-mono text-xs leading-5">
                {hexBytes(decodedFrame?.frame.bytes ?? selectedReport.pd_raw.slice(0, selectedReport.pd_data_len))}
              </div>
            </div>

            {decodedFrame !== null && decodedFrame.issues.length > 0 && (
              <div className="rounded-xl border border-base-300 bg-base-100/80 p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Message Issues</div>
                <div className="mt-3">
                  <IssueList issues={decodedFrame.issues} />
                </div>
              </div>
            )}

            {decodedFrame !== null && decodedFrame.explainContext.notes.length > 0 && (
              <div className="rounded-xl border border-base-300 bg-base-100/80 p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Context Notes</div>
                <div className="mt-2 flex flex-col gap-2">
                  {decodedFrame.explainContext.notes.map((note) => (
                    <div
                      key={note}
                      className="rounded-lg border border-base-300/80 bg-base-200/45 px-3 py-2 text-xs text-base-content/70"
                    >
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {contextDifference !== null && (
              <div className="rounded-xl border border-warning/35 bg-warning/8 p-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-warning">Context Difference</div>
                <div className="mt-2 font-mono text-xs leading-5 text-base-content/80">{contextDifference}</div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {decodedFrame === null ? (
                <div className="rounded-xl border border-base-300 bg-base-100/80 p-3 text-sm text-base-content/60">
                  This row does not decode to a PD message frame.
                </div>
              ) : (
                decodedFrame.sections.map((section) => (
                  <SectionView key={section.key} section={section} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default DecodeCard
