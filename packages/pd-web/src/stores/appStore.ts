import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AppView } from '@/components/app/ViewTabs'
import type { PdTxSop } from '@/lib/devices/deviceDrivers'

export type DecodeLayoutMode = 'vertical' | 'horizontal'
export const APP_THEMES = [
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
export type AppTheme = (typeof APP_THEMES)[number]
export type SendMode = 'raw' | 'hard_reset' | 'cable_reset'
export type TxDialogDraft = {
  mode: SendMode
  sop: PdTxSop
  hexPayload: string
}

type StateUpdater<T> = T | ((current: T) => T)

interface AppState {
  currentView: AppView
  decodeLayoutMode: DecodeLayoutMode
  decodeCollapsed: boolean
  theme: AppTheme
  txDialogDraft: TxDialogDraft
  setCurrentView: (view: StateUpdater<AppView>) => void
  setDecodeLayoutMode: (mode: StateUpdater<DecodeLayoutMode>) => void
  setDecodeCollapsed: (collapsed: StateUpdater<boolean>) => void
  setTheme: (theme: StateUpdater<AppTheme>) => void
  setTxDialogDraft: (draft: StateUpdater<TxDialogDraft>) => void
}

const APP_STORE_STORAGE_KEY = 'usb-pd-app-store'

const DEFAULT_TX_DIALOG_DRAFT: TxDialogDraft = {
  mode: 'raw',
  sop: 'SOP',
  hexPayload: 'A7 00',
}

const DEFAULT_APP_STATE: Pick<
  AppState,
  | 'currentView'
  | 'decodeLayoutMode'
  | 'decodeCollapsed'
  | 'theme'
  | 'txDialogDraft'
> = {
  currentView: 'protocol',
  decodeLayoutMode: 'horizontal',
  decodeCollapsed: false,
  theme: 'nord',
  txDialogDraft: DEFAULT_TX_DIALOG_DRAFT,
}

function applyTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

function resolveUpdater<T>(updater: StateUpdater<T>, current: T): T {
  return typeof updater === 'function'
    ? (updater as (value: T) => T)(current)
    : updater
}

applyTheme(DEFAULT_APP_STATE.theme)

const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_APP_STATE,

      setCurrentView: (currentView) => {
        set({ currentView: resolveUpdater(currentView, get().currentView) })
      },

      setDecodeLayoutMode: (decodeLayoutMode) => {
        set({
          decodeLayoutMode: resolveUpdater(
            decodeLayoutMode,
            get().decodeLayoutMode,
          ),
        })
      },

      setDecodeCollapsed: (decodeCollapsed) => {
        set({
          decodeCollapsed: resolveUpdater(
            decodeCollapsed,
            get().decodeCollapsed,
          ),
        })
      },

      setTheme: (theme) => {
        const nextTheme = resolveUpdater(theme, get().theme)
        applyTheme(nextTheme)
        set({ theme: nextTheme })
      },

      setTxDialogDraft: (txDialogDraft) => {
        set({
          txDialogDraft: resolveUpdater(txDialogDraft, get().txDialogDraft),
        })
      },
    }),
    {
      name: APP_STORE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentView: state.currentView,
        decodeLayoutMode: state.decodeLayoutMode,
        decodeCollapsed: state.decodeCollapsed,
        theme: state.theme,
        txDialogDraft: state.txDialogDraft,
      }),
      onRehydrateStorage: () => (state) => {
        if (state !== undefined) {
          applyTheme(state.theme)
        }
      },
    },
  ),
)

export default useAppStore
