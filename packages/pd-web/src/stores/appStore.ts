import { create } from 'zustand'
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

const APP_STORAGE_KEYS = {
  currentView: 'usb-pd-app-current-view',
  decodeLayoutMode: 'usb-pd-layout-decode-mode',
  decodeCollapsed: 'usb-pd-layout-decode-collapsed',
  theme: 'usb-pd-theme',
  txDialogDraft: 'usb-pd-tx-dialog-draft-v1',
} as const

function readString(key: string, fallback: string): string {
  try {
    const value = localStorage.getItem(key)
    return value ?? fallback
  } catch {
    return fallback
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    if (value === 'true') return true
    if (value === 'false') return false
    return fallback
  } catch {
    return fallback
  }
}

function writeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function isAppView(value: string): value is AppView {
  return value === 'protocol' || value === 'power'
}

function isSendMode(value: unknown): value is SendMode {
  return value === 'raw' || value === 'hard_reset' || value === 'cable_reset'
}

function isTxSop(value: unknown): value is PdTxSop {
  return value === 'SOP' || value === 'SOP_PRIME' || value === 'SOP_DPRIME'
}

function readCurrentView(): AppView {
  const value = readString(APP_STORAGE_KEYS.currentView, 'protocol')
  return isAppView(value) ? value : 'protocol'
}

function readDecodeLayoutMode(): DecodeLayoutMode {
  const value = readString(APP_STORAGE_KEYS.decodeLayoutMode, 'vertical')
  return value === 'horizontal' ? 'horizontal' : 'vertical'
}

function isAppTheme(value: string): value is AppTheme {
  return APP_THEMES.includes(value as AppTheme)
}

function readTheme(): AppTheme {
  const value = readString(APP_STORAGE_KEYS.theme, 'silk')
  return isAppTheme(value) ? value : 'silk'
}

function applyTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

const DEFAULT_TX_DIALOG_DRAFT: TxDialogDraft = {
  mode: 'raw',
  sop: 'SOP',
  hexPayload: 'A7 00',
}

function readTxDialogDraft(): TxDialogDraft {
  try {
    const rawValue = localStorage.getItem(APP_STORAGE_KEYS.txDialogDraft)
    if (rawValue === null) return DEFAULT_TX_DIALOG_DRAFT

    const parsed = JSON.parse(rawValue) as Partial<TxDialogDraft>
    return {
      mode: isSendMode(parsed.mode) ? parsed.mode : DEFAULT_TX_DIALOG_DRAFT.mode,
      sop: isTxSop(parsed.sop) ? parsed.sop : DEFAULT_TX_DIALOG_DRAFT.sop,
      hexPayload: typeof parsed.hexPayload === 'string' ? parsed.hexPayload : DEFAULT_TX_DIALOG_DRAFT.hexPayload,
    }
  } catch {
    return DEFAULT_TX_DIALOG_DRAFT
  }
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

const initialTheme = readTheme()
applyTheme(initialTheme)

const useAppStore = create<AppState>()((set) => ({
  currentView: readCurrentView(),
  decodeLayoutMode: readDecodeLayoutMode(),
  decodeCollapsed: readBool(APP_STORAGE_KEYS.decodeCollapsed, false),
  theme: initialTheme,
  txDialogDraft: readTxDialogDraft(),

  setCurrentView: (currentView) => {
    writeValue(APP_STORAGE_KEYS.currentView, currentView)
    set({ currentView })
  },

  setDecodeLayoutMode: (decodeLayoutMode) => {
    writeValue(APP_STORAGE_KEYS.decodeLayoutMode, decodeLayoutMode)
    set({ decodeLayoutMode })
  },

  setDecodeCollapsed: (decodeCollapsed) => {
    writeValue(APP_STORAGE_KEYS.decodeCollapsed, String(decodeCollapsed))
    set({ decodeCollapsed })
  },

  setTheme: (theme) => {
    writeValue(APP_STORAGE_KEYS.theme, theme)
    applyTheme(theme)
    set({ theme })
  },

  setTxDialogDraft: (txDialogDraft) => {
    writeValue(APP_STORAGE_KEYS.txDialogDraft, JSON.stringify(txDialogDraft))
    set({ txDialogDraft })
  },
}))

export default useAppStore
