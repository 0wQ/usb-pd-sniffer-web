import clsx from 'clsx'
import type { BitField, DecodeIssue, Section } from '@usb-pd-sniffer/pd-core'

export function hexBytes(bytes: readonly number[] | Uint8Array): string {
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

type FieldRowProps = {
  field: BitField
}

const fieldGridClassName = 'grid gap-x-3 md:grid-cols-[60px_minmax(0,2fr)_minmax(0,1fr)_60px]'

function FieldRow({ field }: FieldRowProps) {
  return (
    <div className={clsx(fieldGridClassName, 'gap-y-1 border-b border-base-300/70 px-3 py-2 last:border-b-0')}>
      <div className="font-mono text-[11px] text-base-content/55">{bitRangeLabel(field.bitStart, field.bitLength)}</div>
      <div className="min-w-0">
        <div className="text-xs text-base-content">{field.label}</div>
        {field.note !== undefined && (
          <div className="mt-1 text-[11px] leading-4 text-base-content/55">{field.note}</div>
        )}
      </div>
      <div className="min-w-0 font-mono text-xs text-base-content break-all">{formatFieldMeaning(field)}</div>
      <div className="font-mono text-[11px] text-right text-base-content/50">{formatRawValue(field.rawValue)}</div>
    </div>
  )
}

type IssueListProps = {
  issues: DecodeIssue[]
}

export function IssueList({ issues }: IssueListProps) {
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

export function SectionView({ section }: SectionViewProps) {
  const showEmptyState = section.fields.length === 0

  return (
    <div className="rounded-xl border border-base-300 bg-base-100/80">
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
            <div className={clsx(fieldGridClassName, 'border-b border-base-300/80 bg-base-200/55 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-base-content/45')}>
              <div>Bits</div>
              <div>Name</div>
              <div>Meaning</div>
              <div className="text-right">Raw</div>
            </div>
            {section.fields.map((field) => (
              <FieldRow
                key={`${section.key}-${field.key}-${field.bitStart}-${field.bitLength}`}
                field={field}
              />
            ))}
          </div>
        ) : showEmptyState ? (
          <div className="mt-3 rounded-lg border border-dashed border-base-300/80 bg-base-200/35 px-3 py-3 text-xs text-base-content/55">
            No decoded fields yet.
          </div>
        ) : null}
      </div>
    </div>
  )
}
