import { useEffect, useMemo, useRef, useState } from 'react'
import type { MessageFrame } from '@usb-pd-sniffer/pd-core'
import clsx from 'clsx'
import { toast } from 'sonner'
import type { MonitorPdTxTarget } from '@usb-pd-sniffer/pd-monitor'
import { previewPdTxFrame } from '@/lib/analyzer/txPreview'
import { hexBytes, IssueList, SectionView } from '@/components/decode/DecodedSectionsView'

type SendMode = 'raw' | 'hard_reset' | 'cable_reset'

const SEND_MODE_OPTIONS: Array<{ key: SendMode; label: string }> = [
  { key: 'raw', label: 'Raw' },
  { key: 'hard_reset', label: 'Hard Reset' },
  { key: 'cable_reset', label: 'Cable Reset' },
]

type Props = {
  isOpen: boolean
  isConnected: boolean
  isSending: boolean
  selectedFrame: MessageFrame | null
  onClose: () => void
  onSendRaw: (target: MonitorPdTxTarget, hexPayload: string) => Promise<void>
  onSendHardReset: () => Promise<void>
  onSendCableReset: () => Promise<void>
}

const SendPdDialog = ({
  isOpen,
  isConnected,
  isSending,
  selectedFrame,
  onClose,
  onSendRaw,
  onSendHardReset,
  onSendCableReset,
}: Props) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<SendMode>('raw')
  const [target, setTarget] = useState<MonitorPdTxTarget>('SOP')
  const [hexPayload, setHexPayload] = useState('A7 00')
  const preview = useMemo(() => {
    if (mode !== 'raw') {
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

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const runCommand = async (action: () => Promise<void>, successMessage: string) => {
    try {
      await action()
      toast.success(successMessage)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'TX command failed.')
    }
  }

  const handleSendRaw = async () => {
    await runCommand(
      () => onSendRaw(target, hexPayload),
      `Sent raw ${target} payload.`,
    )
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
      ? (isSending ? 'Sending...' : 'Send Raw')
      : mode === 'hard_reset'
        ? (isSending ? 'Sending...' : 'Send Hard Reset')
        : (isSending ? 'Sending...' : 'Send Cable Reset')
  const sendButtonClass = clsx(
    'btn btn-sm rounded-full gap-2 px-4 normal-case',
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
      onClick={handleBackdropClick}
      onClose={onClose}
    >
      <div className="modal-box flex max-h-[calc(100vh-2rem)] max-w-5xl flex-col overflow-hidden">
        <h3 className="text-lg font-bold">Native PD TX</h3>
        <p className="mt-2 text-sm text-base-content/70">
          Send raw PD bytes through the monitor device. Enter header + data objects only, without CRC.
        </p>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
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
                  disabled={isSending}
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
                disabled={selectedFrame === null || isSending || mode !== 'raw'}
              >
                Fill From Selected
              </button>
              <button
                className={sendButtonClass}
                onClick={handleSendCurrentMode}
                disabled={!isConnected || isSending}
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
              disabled={!isConnected || isSending}
            >
              <option value="SOP">SOP</option>
              <option value="SOP_PRIME">SOP'</option>
              <option value="SOP_DPRIME">SOP''</option>
            </select>
          </label>

          <label className="grid min-w-0 gap-2">
            <span className="text-sm font-medium">Raw Payload</span>
            <textarea
              className="textarea textarea-bordered min-h-16 w-full font-mono text-sm"
              placeholder="42 10 aa bb"
              value={hexPayload}
              onChange={(e) => setHexPayload(e.target.value)}
              disabled={!isConnected || isSending}
            />
            <span className="text-xs text-base-content/60">
              Accepts spaced or compact hex. Send header + data objects only. CRC is handled below the host TX command path.
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

            {preview === null ? (
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
