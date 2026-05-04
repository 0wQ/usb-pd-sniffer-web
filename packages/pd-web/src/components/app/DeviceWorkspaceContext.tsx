import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { AppView } from '@/components/app/ViewTabs'
import type { CaptureBuffer } from '@/lib/buffers/captureBuffer'
import type {
  CCModeConfig,
  DeviceDriver,
  DeviceKind,
  PdTxSop,
} from '@/lib/devices/deviceDrivers'
import type { ImportMode } from '@/types/import'

export type DeviceWorkspaceContextValue = {
  currentView: AppView
  onViewChange: (view: AppView) => void
  selectedIndex: number | null
  setSelectedIndex: (index: number | null) => void
  captureBuffer: CaptureBuffer
  captureCount: number
  clearRecords: () => void
  importRecords: (records: CaptureRecord[], mode: ImportMode) => void
  isConnected: boolean
  isConnecting: boolean
  autoConnectOnLoad: boolean
  autoReconnectOnHotplug: boolean
  selectedDeviceKind: DeviceKind
  deviceOptions: DeviceDriver[]
  supportsTx: boolean
  isSending: boolean
  isDeviceSupported: boolean
  deviceError: string | null
  selectDeviceKind: (kind: DeviceKind) => void
  connectDevice: () => Promise<void>
  disconnectDevice: () => Promise<void>
  sendRawPdFrame: (sop: PdTxSop, hexPayload: string) => Promise<void>
  sendHardReset: () => Promise<void>
  sendCableReset: () => Promise<void>
  setCCMode: (config: CCModeConfig) => Promise<void>
  setAutoConnectOnLoad: (value: boolean) => void
  setAutoReconnectOnHotplug: (value: boolean) => void
  isTxDialogOpen: boolean
  openTxDialog: () => void
  closeTxDialog: () => void
}

const DeviceWorkspaceContext =
  createContext<DeviceWorkspaceContextValue | null>(null)

type ProviderProps = {
  value: Omit<
    DeviceWorkspaceContextValue,
    'isTxDialogOpen' | 'openTxDialog' | 'closeTxDialog'
  >
  isTxDialogOpen: boolean
  onOpenTxDialog: () => void
  onCloseTxDialog: () => void
  children: ReactNode
}

export const DeviceWorkspaceProvider = ({
  value,
  isTxDialogOpen,
  onOpenTxDialog,
  onCloseTxDialog,
  children,
}: ProviderProps) => {
  const contextValue = useMemo<DeviceWorkspaceContextValue>(
    () => ({
      ...value,
      isTxDialogOpen,
      openTxDialog: onOpenTxDialog,
      closeTxDialog: onCloseTxDialog,
    }),
    [isTxDialogOpen, onCloseTxDialog, onOpenTxDialog, value],
  )

  return (
    <DeviceWorkspaceContext.Provider value={contextValue}>
      {children}
    </DeviceWorkspaceContext.Provider>
  )
}

export function useDeviceWorkspaceContext(): DeviceWorkspaceContextValue {
  const context = useContext(DeviceWorkspaceContext)
  if (context === null) {
    throw new Error(
      'useDeviceWorkspaceContext must be used within DeviceWorkspaceProvider',
    )
  }
  return context
}
