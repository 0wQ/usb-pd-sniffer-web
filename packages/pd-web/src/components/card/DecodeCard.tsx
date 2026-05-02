import clsx from 'clsx'
import { useMemo } from 'react'
import type { DecodedPacket } from '@usb-pd-sniffer/pd-core'
import useDeviceStore from '@/stores/deviceStore'
import { monitorEventName } from '@usb-pd-sniffer/pd-device-native-hid'
import { decodeRecordAtIndex, decodeSingleRecord } from '@/lib/analyzer/decode'
import { decodeUfcsRecordType, formatUfcsTypeSummary, type UfcsTypeDecode } from '@/lib/ufcs/ufcsType'
import { hexBytes, IssueList, SectionView } from '@/components/decode/DecodedSectionsView'

const DETAIL_CONTEXT_BACKTRACK_RECORDS = 10_000

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
  return `${deltaUs >= 0 ? '+' : ''}${deltaUs.toLocaleString()} us`
}

function contextDiffSummary(withContext: DecodedPacket, withoutContext: DecodedPacket): string | null {
  const differences: string[] = []

  if (withContext.messageType.name !== withoutContext.messageType.name) {
    differences.push(
      `Type changed from ${withoutContext.messageType.name ?? withoutContext.category} to ${withContext.messageType.name ?? withContext.category}`
    )
  }

  if (withContext.sections.length !== withoutContext.sections.length) {
    differences.push(`Decoded sections increased from ${withoutContext.sections.length} to ${withContext.sections.length}`)
  }

  if (withContext.issues.length !== withoutContext.issues.length) {
    differences.push(`Issue count changed from ${withoutContext.issues.length} to ${withContext.issues.length}`)
  }

  return differences.length === 0 ? null : differences.join(' | ')
}

type UfcsTypeViewProps = {
  decoded: UfcsTypeDecode
}


function UfcsTypeView({ decoded }: UfcsTypeViewProps) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100/80 p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">UFCS Type</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Message Type</div>
          <div className="mt-1 font-mono text-xs">{decoded.typeName} ({decoded.type})</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Command</div>
          <div className="mt-1 font-mono text-xs">{formatUfcsTypeSummary(decoded)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Address</div>
          <div className="mt-1 font-mono text-xs">{decoded.address}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Message Number</div>
          <div className="mt-1 font-mono text-xs">{decoded.messageNumber}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Version</div>
          <div className="mt-1 font-mono text-xs">{decoded.version}</div>
        </div>
      </div>
    </div>
  )
}

const DecodeCard = ({ className, selectedIndex }: Props) => {
  const captureBuffer = useDeviceStore((state) => state.captureBuffer)
  const captureVersion = useDeviceStore((state) => state.captureVersion)

  const records = useMemo(() => {
    void captureVersion
    return captureBuffer.getAll()
  }, [captureBuffer, captureVersion])

  const selectedRecord = selectedIndex !== null ? records[selectedIndex] : null
  const previousRecord = selectedIndex !== null && selectedIndex > 0 ? records[selectedIndex - 1] : null

  const decodeResult = useMemo(() => {
    if (selectedIndex === null) return null
    return decodeRecordAtIndex(records, selectedIndex, DETAIL_CONTEXT_BACKTRACK_RECORDS)
  }, [records, selectedIndex])
  const decodedFrame = decodeResult?.decoded ?? null
  const contextBacktrackUsed = decodeResult?.contextBacktrackUsed ?? 0

  const decodedWithoutContext = useMemo(() => {
    if (selectedRecord === null) return null
    return decodeSingleRecord(selectedRecord)
  }, [selectedRecord])

  const ufcsDecoded = useMemo(() => {
    if (selectedRecord === null) return null
    return decodeUfcsRecordType(selectedRecord)
  }, [selectedRecord])

  const deltaUs = selectedRecord && previousRecord
    ? selectedRecord.timestamp_us - previousRecord.timestamp_us
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
            <div className="min-w-0 truncate text-right font-mono text-[11px] text-base-content/55">
              {[
                decodedFrame.messageType.name ?? decodedFrame.category,
                decodedFrame.frame.sop,
                `Backtrack ${contextBacktrackUsed.toLocaleString()}`,
              ].join(' · ')}
            </div>
          )}
        </div>

        {selectedRecord === null ? (
          <div className="text-sm text-base-content/60">Select a row to inspect decoded PD details.</div>
        ) : (
          <>
            <div className="rounded-xl border border-base-300 bg-base-100/80 p-3">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Time</div>
                  <div className="mt-1 font-mono text-xs">{formatTimestampUs(selectedRecord.timestamp_us)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">ΔTime</div>
                  <div className="mt-1 font-mono text-xs">{formatDeltaUs(deltaUs)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Event</div>
                  <div className="mt-1 font-mono text-xs">{monitorEventName(selectedRecord.event_type)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Payload</div>
                  <div className="mt-1 font-mono text-xs">{selectedRecord.data_len} B</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Sections</div>
                  <div className="mt-1 font-mono text-xs">{decodedFrame?.sections.length ?? 0}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Type</div>
                  <div className="mt-1 font-mono text-xs">{decodedFrame?.messageType.name ?? formatUfcsTypeSummary(ufcsDecoded) ?? '-'}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-base-300 bg-base-100/80 p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Raw Packet</div>
              <div className="mt-2 break-all font-mono text-xs leading-5">
                {hexBytes(decodedFrame?.packet.bytes ?? selectedRecord.data.slice(0, selectedRecord.data_len))}
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
                <div className="text-[10px] uppercase tracking-[0.14em] text-warning">
                  Context-Enhanced Decode
                </div>
                <div className="mt-2 text-xs leading-5 text-base-content/75">
                  This row decodes differently after looking back for the required protocol context.
                </div>
                <div className="mt-1 text-xs leading-5 text-base-content/75">{contextDifference}</div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              {decodedFrame === null ? (
                ufcsDecoded === null ? (
                  <div className="rounded-xl border border-base-300 bg-base-100/80 p-3 text-sm text-base-content/60">
                    This row does not decode to a PD message frame.
                  </div>
                ) : (
                  <UfcsTypeView decoded={ufcsDecoded} />
                )
              ) : (
                decodedFrame.sections.map((section) => (
                  <SectionView
                    key={section.key}
                    section={section}
                  />
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
