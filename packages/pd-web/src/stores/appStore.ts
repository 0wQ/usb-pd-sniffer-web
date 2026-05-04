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
export type AppTheme = typeof APP_THEMES[number]
export type SendMode = 'raw' | 'hard_reset' | 'cable_reset'
export type TxDialogDraft = {
  mode: SendMode
  sop: PdTxSop
  hexPayload: string
}

interface AppState {
  currentView: AppView
  decodeLayoutMode: DecodeLayoutMode
  decodeCollapsed: boolean
  theme: AppTheme
  txDialogDraft: TxDialogDraft
  setCurrentView: (view: AppView) => void
  setDecodeLayoutMode: (mode: DecodeLayoutMode) => void
  setDecodeCollapsed: (collapsed: boolean) => void
  setTheme: (theme: AppTheme) => void
  setTxDialogDraft: (draft: TxDialogDraft) => void
}

type AppPersistedState = Pick<
  AppState,
  'currentView' | 'decodeLayoutMode' | 'decodeCollapsed' | 'theme' | 'txDialogDraft'
>

const APP_STORE_STORAGE_KEY = 'usb-pd-app-store'

const DEFAULT_TX_DIALOG_DRAFT: TxDialogDraft = {
  mode: 'raw',
  sop: 'SOP',
  hexPayload: 'A7 00',
}

const DEFAULT_APP_PERSISTED_STATE: AppPersistedState = {
  currentView: 'protocol',
  decodeLayoutMode: 'vertical',
  decodeCollapsed: false,
  theme: 'silk',
  txDialogDraft: DEFAULT_TX_DIALOG_DRAFT,
}

function applyTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

applyTheme(DEFAULT_APP_PERSISTED_STATE.theme)

const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      ...DEFAULT_APP_PERSISTED_STATE,

      setCurrentView: (currentView) => set({ currentView }),

      setDecodeLayoutMode: (decodeLayoutMode) => set({ decodeLayoutMode }),

      setDecodeCollapsed: (decodeCollapsed) => set({ decodeCollapsed }),

      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },

      setTxDialogDraft: (txDialogDraft) => set({ txDialogDraft }),
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
