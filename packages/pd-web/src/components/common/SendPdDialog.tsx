import { useEffect, useMemo, useRef, useState } from 'react'
import type { BitField, MessageFrame, Section } from '@usb-pd-sniffer/pd-core'
import clsx from 'clsx'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import type { MonitorActiveCCMode, MonitorCCMode, MonitorCCModeConfig, MonitorPdTxTarget } from '@/lib/devices/monitorDrivers'
import { applyFieldRawValue, formatEditedBytes } from '@/lib/analyzer/fieldEdit'
import { hasPdTxPayloadNewline, parsePdHexPayload, previewPdTxFrame, splitPdTxPayloadLines } from '@/lib/analyzer/txPreview'
import { hexBytes, IssueList, SectionView } from '@/components/decode/DecodedSectionsView'

type SendMode = 'raw' | 'hard_reset' | 'cable_reset'
const MULTILINE_TX_INTERVAL_MS = 50
const TX_DIALOG_DRAFT_STORAGE_KEY = 'usb-pd-tx-dialog-draft-v1'

const SEND_MODE_OPTIONS: Array<{ key: SendMode; label: string }> = [
  { key: 'raw', label: 'Raw' },
  { key: 'hard_reset', label: 'Hard Reset' },
  { key: 'cable_reset', label: 'Cable Reset' },
]

const TX_TARGET_OPTIONS = ['SOP', 'SOP_PRIME', 'SOP_DPRIME'] as const satisfies readonly MonitorPdTxTarget[]

type TxDialogDraft = {
  mode: SendMode
  target: MonitorPdTxTarget
  hexPayload: string
}

const DEFAULT_TX_DIALOG_DRAFT: TxDialogDraft = {
  mode: 'raw',
  target: 'SOP',
  hexPayload: 'A7 00',
}

function isSendMode(value: unknown): value is SendMode {
  return value === 'raw' || value === 'hard_reset' || value === 'cable_reset'
}

function isTxTarget(value: unknown): value is MonitorPdTxTarget {
  return typeof value === 'string' && TX_TARGET_OPTIONS.includes(value as MonitorPdTxTarget)
}

function readTxDialogDraft(): TxDialogDraft {
  try {
    const rawValue = localStorage.getItem(TX_DIALOG_DRAFT_STORAGE_KEY)
    if (rawValue === null) return DEFAULT_TX_DIALOG_DRAFT

    const parsed = JSON.parse(rawValue) as Partial<TxDialogDraft>
    return {
      mode: isSendMode(parsed.mode) ? parsed.mode : DEFAULT_TX_DIALOG_DRAFT.mode,
      target: isTxTarget(parsed.target) ? parsed.target : DEFAULT_TX_DIALOG_DRAFT.target,
      hexPayload: typeof parsed.hexPayload === 'string' ? parsed.hexPayload : DEFAULT_TX_DIALOG_DRAFT.hexPayload,
    }
  } catch {
    return DEFAULT_TX_DIALOG_DRAFT
  }
}

function writeTxDialogDraft(value: TxDialogDraft): void {
  try {
    localStorage.setItem(TX_DIALOG_DRAFT_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Ignore unavailable storage.
  }
}

type Props = {
  isOpen: boolean
  isConnected: boolean
  selectedFrame: MessageFrame | null
  onClose: () => void
  onSendRaw: (target: MonitorPdTxTarget, hexPayload: string) => Promise<void>
  onSendHardReset: () => Promise<void>
  onSendCableReset: () => Promise<void>
  onSetCCMode: (config: MonitorCCModeConfig) => Promise<void>
}

const SendPdDialog = ({
  isOpen,
  isConnected,
  selectedFrame,
  onClose,
  onSendRaw,
  onSendHardReset,
  onSendCableReset,
  onSetCCMode,
}: Props) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const initialDraftRef = useRef<TxDialogDraft | null>(null)
  if (initialDraftRef.current === null) {
    initialDraftRef.current = readTxDialogDraft()
  }

  const [mode, setMode] = useState<SendMode>(initialDraftRef.current.mode)
  const [target, setTarget] = useState<MonitorPdTxTarget>(initialDraftRef.current.target)
  const [hexPayload, setHexPayload] = useState(initialDraftRef.current.hexPayload)
  const [activeCCMode, setActiveCCMode] = useState<MonitorActiveCCMode>('auto')
  const [cc1Mode, setCC1Mode] = useState<MonitorCCMode>('open')
  const [cc2Mode, setCC2Mode] = useState<MonitorCCMode>('open')
  const [isTxCommandSending, setIsTxCommandSending] = useState(false)
  const [isBatchSending, setIsBatchSending] = useState(false)
  const [isApplyingCCMode, setIsApplyingCCMode] = useState(false)
  const isSendBusy = isTxCommandSending || isBatchSending
  const hasMultilinePayload = hasPdTxPayloadNewline(hexPayload)
  const payloadLines = useMemo(() => splitPdTxPayloadLines(hexPayload), [hexPayload])
  const preview = useMemo(() => {
    if (mode !== 'raw') {
      return null
    }

    if (hasMultilinePayload) {
      return null
    }

    if (hexPayload.trim().length === 0) {
      return null
    }

    try {
      return { result: previewPdTxFrame(target, hexPayload), error: null }
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : 'Preview decode failed.',
      }
    }
  }, [hasMultilinePayload, hexPayload, mode, target])

  useEffect(() => {
    writeTxDialogDraft({ mode, target, hexPayload })
  }, [hexPayload, mode, target])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen) {
      dialog.showModal()
    } else {
      dialog.close()
    }
  }, [isOpen])

  const handlePointerDown = (event: React.PointerEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  const runCommand = async (action: () => Promise<void>, successMessage: string) => {
    try {
      setIsTxCommandSending(true)
      await action()
      toast.success(successMessage)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Command failed.')
    } finally {
      setIsTxCommandSending(false)
    }
  }

  const delay = (milliseconds: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })

  const handleSendRaw = async () => {
    if (!hasMultilinePayload) {
      await runCommand(
        () => onSendRaw(target, hexPayload),
        `Sent raw ${target} payload.`,
      )
      return
    }

    if (payloadLines.length === 0) {
      toast.error('Enter at least one raw payload line.')
      return
    }

    try {
      for (const line of payloadLines) {
        parsePdHexPayload(line)
      }

      setIsBatchSending(true)
      for (const [index, line] of payloadLines.entries()) {
        await onSendRaw(target, line)
        if (index < payloadLines.length - 1) {
          await delay(MULTILINE_TX_INTERVAL_MS)
        }
      }

      toast.success(`Sent ${payloadLines.length} raw ${target} payloads.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Command failed.')
    } finally {
      setIsBatchSending(false)
    }
  }

  const handleSendHardReset = async () => {
    await runCommand(
      onSendHardReset,
      'Sent hard reset.',
    )
  }

  const handleSendCableReset = async () => {
    await runCommand(
      onSendCableReset,
      'Sent cable reset.',
    )
  }

  const handleSetCCMode = async () => {
    try {
      setIsApplyingCCMode(true)
      await onSetCCMode({ activeCC: activeCCMode, cc1: cc1Mode, cc2: cc2Mode })
      toast.success(`Applied CC mode: Active ${activeCCMode.toUpperCase()}, CC1 ${cc1Mode.toUpperCase()}, CC2 ${cc2Mode.toUpperCase()}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Command failed.')
    } finally {
      setIsApplyingCCMode(false)
    }
  }

  const handlePreviewFieldEdit = (section: Section, field: BitField, rawValue: bigint) => {
    if (preview?.result === undefined || preview.result === null) {
      throw new Error('Preview is not available for field editing.')
    }

    const editedBytes = applyFieldRawValue(preview.result.frame.bytes, section, field, rawValue)
    setHexPayload(formatEditedBytes(editedBytes))
  }

  const fillFromSelected = () => {
    if (selectedFrame === null) {
      toast.error('No protocol frame selected.')
      return
    }

    switch (selectedFrame.sop) {
      case 'SOP':
        setMode('raw')
        setTarget('SOP')
        setHexPayload(hexBytes(selectedFrame.bytes))
        return
      case 'SOP_PRIME':
        setMode('raw')
        setTarget('SOP_PRIME')
        setHexPayload(hexBytes(selectedFrame.bytes))
        return
      case 'SOP_DPRIME':
        setMode('raw')
        setTarget('SOP_DPRIME')
        setHexPayload(hexBytes(selectedFrame.bytes))
        return
      default:
        toast.error(`Selected frame ${selectedFrame.sop} cannot be sent from the current TX dialog.`)
    }
  }

  const sendButtonLabel =
    mode === 'raw'
      ? (isSendBusy ? 'Sending...' : hasMultilinePayload ? `Send ${payloadLines.length} Raw` : 'Send Raw')
      : mode === 'hard_reset'
        ? (isSendBusy ? 'Sending...' : 'Send Hard Reset')
        : (isSendBusy ? 'Sending...' : 'Send Cable Reset')
  const sendButtonClass = clsx(
    'btn btn-sm min-w-[9rem] rounded-full gap-2 px-4 normal-case',
    mode === 'raw'
      ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
      : 'border-warning/35 bg-warning/10 text-warning hover:bg-warning/15',
  )
  const handleSendCurrentMode = () => {
    if (mode === 'raw') {
      void handleSendRaw()
      return
    }

    if (mode === 'hard_reset') {
      void handleSendHardReset()
      return
    }

    void handleSendCableReset()
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onPointerDown={handlePointerDown}
      onClose={onClose}
    >
      <div className="modal-box flex max-h-[calc(100vh-2rem)] max-w-5xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold">Native Controls</h3>
          </div>
          <button
            className="btn btn-sm btn-square btn-ghost shrink-0"
            onClick={onClose}
            aria-label="Close TX controls"
            title="Close"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
          <div className="rounded-lg border border-base-300 bg-base-200/70 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">CC Mode</div>
              </div>
              <button
                className="btn btn-sm rounded-full border-primary/30 bg-primary/10 px-4 normal-case text-primary hover:bg-primary/15"
                onClick={() => void handleSetCCMode()}
                disabled={!isConnected || isApplyingCCMode}
                type="button"
              >
                {isApplyingCCMode ? 'Applying...' : 'Apply CC Mode'}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase text-base-content/50">Active CC</span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={activeCCMode}
                  onChange={(e) => setActiveCCMode(e.target.value as MonitorActiveCCMode)}
                  disabled={!isConnected}
                >
                  <option value="auto">Auto</option>
                  <option value="cc1">CC1</option>
                  <option value="cc2">CC2</option>
                </select>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase text-base-content/50">CC1</span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={cc1Mode}
                  onChange={(e) => setCC1Mode(e.target.value as MonitorCCMode)}
                  disabled={!isConnected}
                >
                  <option value="open">Open</option>
                  <option value="rd">Rd</option>
                  <option value="ra">Ra</option>
                  <option value="rp">Rp</option>
                </select>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase text-base-content/50">CC2</span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={cc2Mode}
                  onChange={(e) => setCC2Mode(e.target.value as MonitorCCMode)}
                  disabled={!isConnected}
                >
                  <option value="open">Open</option>
                  <option value="rd">Rd</option>
                  <option value="ra">Ra</option>
                  <option value="rp">Rp</option>
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex w-fit items-center rounded-full border border-base-300/80 bg-base-200/70 p-1">
              {SEND_MODE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  className={clsx(
                    'rounded-full px-3 py-1.5 text-xs font-medium tracking-[0.08em] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-55',
                    {
                      'bg-base-100 text-primary shadow-sm': mode === option.key,
                      'text-base-content/55 hover:bg-base-100/70 hover:text-base-content/80': mode !== option.key,
                    },
                  )}
                  onClick={() => setMode(option.key)}
                  disabled={isSendBusy}
                  type="button"
                >
                  <span className="select-none">{option.label}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                className="btn btn-sm rounded-full border-base-300 bg-base-100 px-4 normal-case text-base-content/70 hover:bg-base-200"
                onClick={fillFromSelected}
                disabled={selectedFrame === null || isSendBusy || mode !== 'raw'}
              >
                Fill From Selected
              </button>
              <button
                className={sendButtonClass}
                onClick={handleSendCurrentMode}
                disabled={!isConnected || isSendBusy || (mode === 'raw' && hasMultilinePayload && payloadLines.length === 0)}
              >
                {sendButtonLabel}
              </button>
            </div>
          </div>

          {mode === 'raw' ? (
            <>
          <label className="grid max-w-[180px] gap-2">
            <span className="text-sm font-medium">SOP Target</span>
            <select
              className="select select-bordered w-full"
              value={target}
              onChange={(e) => setTarget(e.target.value as MonitorPdTxTarget)}
              disabled={!isConnected}
            >
              {TX_TARGET_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'SOP' ? 'SOP' : option === 'SOP_PRIME' ? "SOP'" : "SOP''"}
                </option>
              ))}
            </select>
          </label>

          <label className="grid min-w-0 gap-2">
            <span className="text-sm font-medium">Raw Payload</span>
            <textarea
              className="textarea textarea-bordered min-h-16 w-full font-mono text-sm"
              placeholder="42 10 aa bb"
              value={hexPayload}
              onChange={(e) => setHexPayload(e.target.value)}
              disabled={!isConnected}
            />
            <span className="text-xs text-base-content/60">
              Accepts spaced or compact hex. Multiple non-empty lines are sent in order with a {MULTILINE_TX_INTERVAL_MS}ms interval and are not locally decoded.
            </span>
          </label>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-base-300 bg-base-200/70 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">Local Preview</div>
              {preview?.result && (
                <div className="font-mono text-xs text-base-content/65">
                  {preview.result.frame.bytes.length} B
                </div>
              )}
            </div>

            {hasMultilinePayload ? (
              <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content/70">
                Multiline payload mode: {payloadLines.length} non-empty line{payloadLines.length === 1 ? '' : 's'} will be sent in order with a {MULTILINE_TX_INTERVAL_MS}ms interval. Local decode preview is disabled for multiline input.
              </div>
            ) : preview === null ? (
              <div className="text-sm text-base-content/60">Enter raw payload hex to preview the decode.</div>
            ) : preview.error ? (
              <div className="text-sm text-error">{preview.error}</div>
            ) : preview.result === null ? (
              <div className="text-sm text-error">Preview decode failed.</div>
            ) : (
              <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">SOP</div>
                    <div className="mt-1 font-mono text-xs">{preview.result.decoded.frame.sop}</div>
                  </div>
                  <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Type</div>
                    <div className="mt-1 font-mono text-xs">{preview.result.decoded.messageType.name ?? preview.result.decoded.category}</div>
                  </div>
                  <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Payload</div>
                    <div className="mt-1 font-mono text-xs">{preview.result.frame.bytes.length} B</div>
                  </div>
                  <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Sections</div>
                    <div className="mt-1 font-mono text-xs">{preview.result.decoded.sections.length}</div>
                  </div>
                </div>

                <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Raw Payload</div>
                  <div className="mt-2 break-all font-mono text-xs leading-5 text-base-content">
                    {hexBytes(preview.result.frame.bytes)}
                  </div>
                  <div className="mt-2 text-[11px] text-base-content/55">
                    CRC is not part of this TX preview. The PD PHY generates CRC during transmission.
                  </div>
                </div>

                <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Parser Issues</div>
                  {preview.result.decoded.issues.length === 0 ? (
                    <div className="mt-1 text-xs text-success">No parser issues.</div>
                  ) : (
                    <div className="mt-2">
                      <IssueList issues={preview.result.decoded.issues} />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  {preview.result.decoded.sections.map((section) => (
                    <SectionView
                      key={section.key}
                      section={section}
                      onFieldEdit={!isConnected ? undefined : handlePreviewFieldEdit}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
            </>
          ) : (
            <div className="rounded-lg border border-base-300 bg-base-200/70 px-3 py-4 text-sm text-base-content/70">
              {mode === 'hard_reset'
                ? 'Send a Hard Reset through the native monitor device.'
                : 'Send a Cable Reset through the native monitor device.'}
            </div>
          )}

          {!isConnected && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Connect the native monitor device before sending.
            </div>
          )}
        </div>

      </div>
    </dialog>
  )
}

export default SendPdDialog
