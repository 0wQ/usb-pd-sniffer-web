import { useEffect, useRef } from 'react'
import type { ImportMode } from '@/types/import'

type Props = {
  isOpen: boolean
  recordCount: number
  onClose: () => void
  onConfirm: (mode: ImportMode) => void
}

const ImportDialog = ({ isOpen, recordCount, onClose, onConfirm }: Props) => {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen) {
      dialog.showModal()
    } else {
      dialog.close()
    }
  }, [isOpen])

  const handleReplace = () => {
    onConfirm('replace')
  }

  const handleAppend = () => {
    onConfirm('append')
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDialogElement>) => {
    // Close when clicking backdrop
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      onPointerDown={handlePointerDown}
      onClose={onClose}
    >
      <div className="modal-box">
        <h3 className="font-bold text-lg">Import Capture Data</h3>
        <p className="py-4">
          Found{' '}
          <span className="font-mono font-semibold text-primary">
            {recordCount.toLocaleString()}
          </span>{' '}
          records in the selected file.
        </p>
        <p className="text-sm text-base-content/70 mb-4">
          How would you like to import this data?
        </p>

        <div className="flex flex-col gap-3">
          <button className="btn btn-primary" onClick={handleReplace} type="button">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Replace All Data
            <span className="text-xs opacity-70">(Clear existing records)</span>
          </button>

          <button className="btn btn-secondary" onClick={handleAppend} type="button">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Append to Existing Data
            <span className="text-xs opacity-70">(Keep existing records)</span>
          </button>
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  )
}

export default ImportDialog
