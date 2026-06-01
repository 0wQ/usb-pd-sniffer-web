import { createAtkC2Device } from '@usb-pd-sniffer/pd-device-atk-c2'
import { createNativeCdcDevice } from '@usb-pd-sniffer/pd-device-native-cdc'
import type {
  ActiveCCMode,
  CCMode,
  CCModeConfig,
  NativeHidDevice,
  PdTxSop,
} from '@usb-pd-sniffer/pd-device-native-hid'
import { createNativeHidDevice } from '@usb-pd-sniffer/pd-device-native-hid'
import { createWitrnK2HidDevice } from '@usb-pd-sniffer/pd-device-witrn-k2-hid'
import type { CaptureDevice } from '@usb-pd-sniffer/pd-device-types'

export type DeviceKind = 'native' | 'native-cdc' | 'witrn-k2-hid' | 'atk-c2'

export type { ActiveCCMode, CCMode, CCModeConfig, PdTxSop }

export type HidDeviceHandle = NativeHidDevice

export type DeviceDriver = {
  kind: DeviceKind
  label: string
  shortLabel: string
  apiName: string
  createDevice: () => CaptureDevice
}

export const DEFAULT_DEVICE_KIND: DeviceKind = 'native'

export const DEVICE_DRIVERS: Record<DeviceKind, DeviceDriver> = {
  native: {
    kind: 'native',
    label: 'Sniffer-V5-HID',
    shortLabel: 'V5 HID',
    apiName: 'WebHID',
    createDevice: createNativeHidDevice,
  },
  'native-cdc': {
    kind: 'native-cdc',
    label: 'Native CDC',
    shortLabel: 'CDC',
    apiName: 'Web Serial',
    createDevice: createNativeCdcDevice,
  },
  'witrn-k2-hid': {
    kind: 'witrn-k2-hid',
    label: 'WITRN K2',
    shortLabel: 'K2',
    apiName: 'WebHID',
    createDevice: createWitrnK2HidDevice,
  },
  'atk-c2': {
    kind: 'atk-c2',
    label: 'ATK C2',
    shortLabel: 'ATK C2',
    apiName: 'WebUSB',
    createDevice: createAtkC2Device,
  },
}

const SELECTABLE_DEVICE_KINDS = ['native', 'witrn-k2-hid', 'atk-c2'] as const

export const DEVICE_OPTIONS = SELECTABLE_DEVICE_KINDS.map(
  (kind) => DEVICE_DRIVERS[kind],
)

export function getDeviceDriver(kind: DeviceKind): DeviceDriver {
  return DEVICE_DRIVERS[kind] ?? DEVICE_DRIVERS[DEFAULT_DEVICE_KIND]
}

export function isDeviceKind(value: string): value is DeviceKind {
  return (
    value === 'native' ||
    value === 'native-cdc' ||
    value === 'witrn-k2-hid' ||
    value === 'atk-c2'
  )
}

export function isSelectableDeviceKind(kind: DeviceKind): boolean {
  return SELECTABLE_DEVICE_KINDS.includes(
    kind as (typeof SELECTABLE_DEVICE_KINDS)[number],
  )
}

export function normalizeSelectableDeviceKind(kind: DeviceKind): DeviceKind {
  return isSelectableDeviceKind(kind) ? kind : DEFAULT_DEVICE_KIND
}

export function isNativeHidDevice(
  _device: CaptureDevice,
  kind: DeviceKind,
): _device is HidDeviceHandle {
  return kind === 'native'
}
