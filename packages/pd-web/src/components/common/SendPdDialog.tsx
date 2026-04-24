import { useEffect, useMemo, useRef, useState } from 'react'
import type { MessageFrame } from '@usb-pd-sniffer/pd-core'
import { toast } from 'sonner'
import type { MonitorPdTxTarget } from '@usb-pd-sniffer/pd-monitor'
import { previewPdTxFrame } from '@/lib/analyzer/txPreview'

type SendMode = 'raw' | 'hard_reset' | 'cable_reset'

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
  const [hexPayload, setHexPayload] = useState('42 10')
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

  const selectedFrameSummary = useMemo(() => {
    if (selectedFrame === null) return 'No protocol frame selected.'
    return `Selected frame: ${selectedFrame.sop} ${selectedFrame.bytes.length}B`
  }, [selectedFrame])

  const fillFromSelected = () => {
    if (selectedFrame === null) {
      toast.error('No protocol frame selected.')
      return
    }

    switch (selectedFrame.sop) {
      case 'SOP':
        setMode('raw')
        setTarget('SOP')
        setHexPayload(Array.from(selectedFrame.bytes).map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '))
        return
      case 'SOP_PRIME':
        setMode('raw')
        setTarget('SOP_PRIME')
        setHexPayload(Array.from(selectedFrame.bytes).map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '))
        return
      case 'SOP_DPRIME':
        setMode('raw')
        setTarget('SOP_DPRIME')
        setHexPayload(Array.from(selectedFrame.bytes).map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' '))
        return
      default:
        toast.error(`Selected frame ${selectedFrame.sop} cannot be sent from the current TX dialog.`)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onClick={handleBackdropClick}
      onClose={onClose}
    >
      <div className="modal-box max-w-2xl">
        <h3 className="text-lg font-bold">Native PD TX</h3>
        <p className="mt-2 text-sm text-base-content/70">
          Send raw PD bytes through the monitor device. Enter header + data objects only, without CRC.
        </p>

        <div className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-base-300 bg-base-200/70 px-3 py-2">
            <div className="text-sm text-base-content/70">{selectedFrameSummary}</div>
            <button
              className="btn btn-sm btn-ghost"
              onClick={fillFromSelected}
              disabled={selectedFrame === null || isSending}
            >
              Fill From Selected
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className={`btn btn-sm ${mode === 'raw' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setMode('raw')}
              disabled={isSending}
            >
              Raw
            </button>
            <button
              className={`btn btn-sm ${mode === 'hard_reset' ? 'btn-warning' : 'btn-ghost'}`}
              onClick={() => setMode('hard_reset')}
              disabled={isSending}
            >
              Hard Reset
            </button>
            <button
              className={`btn btn-sm ${mode === 'cable_reset' ? 'btn-warning' : 'btn-ghost'}`}
              onClick={() => setMode('cable_reset')}
              disabled={isSending}
            >
              Cable Reset
            </button>
          </div>

          {mode === 'raw' ? (
            <>
          <label className="grid gap-2">
            <span className="text-sm font-medium">SOP Target</span>
            <select
              className="select select-bordered"
              value={target}
              onChange={(e) => setTarget(e.target.value as MonitorPdTxTarget)}
              disabled={!isConnected || isSending}
            >
              <option value="SOP">SOP</option>
              <option value="SOP_PRIME">SOP'</option>
              <option value="SOP_DPRIME">SOP''</option>
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Raw Payload</span>
            <textarea
              className="textarea textarea-bordered min-h-28 font-mono text-sm"
              placeholder="42 10 aa bb"
              value={hexPayload}
              onChange={(e) => setHexPayload(e.target.value)}
              disabled={!isConnected || isSending}
            />
            <span className="text-xs text-base-content/60">
              Accepts spaced or compact hex. Send header + data objects only. CRC is handled below the host TX command path.
            </span>
          </label>

          <div className="rounded-lg border border-base-300 bg-base-200/70 p-3">
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
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">SOP</div>
                    <div className="mt-1 font-mono text-xs">{preview.result.decoded.frame.sop}</div>
                  </div>
                  <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Summary</div>
                    <div className="mt-1 font-mono text-xs">{preview.result.decoded.messageType.name ?? preview.result.decoded.category}</div>
                  </div>
                  <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Type</div>
                    <div className="mt-1 font-mono text-xs">
                      {preview.result.decoded.messageType.name ?? preview.result.decoded.category}
                    </div>
                  </div>
                  <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Objects</div>
                    <div className="mt-1 font-mono text-xs">{preview.result.decoded.sections.length}</div>
                  </div>
                </div>

                {preview.result.decoded.header && (
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Msg ID</div>
                      <div className="mt-1 font-mono text-xs">{preview.result.decoded.header.messageId}</div>
                    </div>
                    <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">NDO</div>
                      <div className="mt-1 font-mono text-xs">{preview.result.decoded.header.numberOfDataObjects}</div>
                    </div>
                    <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Spec Rev</div>
                      <div className="mt-1 font-mono text-xs">{preview.result.decoded.header.specificationRevision}</div>
                    </div>
                    <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Raw Header</div>
                      <div className="mt-1 font-mono text-xs">{`0x${preview.result.decoded.header.raw16.toString(16).padStart(4, '0').toUpperCase()}`}</div>
                    </div>
                  </div>
                )}

                <div className="rounded-md border border-base-300 bg-base-100 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/45">Parser Issues</div>
                  {preview.result.decoded.issues.length === 0 ? (
                    <div className="mt-1 text-xs text-success">No parser issues.</div>
                  ) : (
                    <div className="mt-1 grid gap-1">
                      {preview.result.decoded.issues.map((issue, index) => (
                        <div key={`${issue.code}-${index}`} className="font-mono text-xs text-warning">
                          {issue.code}: {issue.message}
                        </div>
                      ))}
                    </div>
                  )}
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

          {mode === 'raw' ? (
            <button
              className="btn btn-primary"
              onClick={() => void handleSendRaw()}
              disabled={!isConnected || isSending}
            >
              {isSending ? 'Sending...' : 'Send Raw'}
            </button>
          ) : mode === 'hard_reset' ? (
            <button
              className="btn btn-warning"
              onClick={() => void handleSendHardReset()}
              disabled={!isConnected || isSending}
            >
              {isSending ? 'Sending...' : 'Send Hard Reset'}
            </button>
          ) : (
            <button
              className="btn btn-warning btn-outline"
              onClick={() => void handleSendCableReset()}
              disabled={!isConnected || isSending}
            >
              {isSending ? 'Sending...' : 'Send Cable Reset'}
            </button>
          )}

          {!isConnected && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Connect the native monitor device before sending.
            </div>
          )}
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose} disabled={isSending}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  )
}

export default SendPdDialog
