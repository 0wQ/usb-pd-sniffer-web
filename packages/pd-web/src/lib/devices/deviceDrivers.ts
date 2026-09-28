import { createAtkC2Device } from '@usb-pd-sniffer/pd-device-atk-c2'
import { createNativeCdcDevice } from '@usb-pd-sniffer/pd-device-native-cdc'
import type {
  ActiveCCMode,
  CCPull,
  CCPullConfig,
  NativeHidDevice,
  PdTxSop,
} from '@usb-pd-sniffer/pd-device-native-hid'
import { createNativeHidDevice } from '@usb-pd-sniffer/pd-device-native-hid'
import type { NativeWinusbDevice } from '@usb-pd-sniffer/pd-device-native-winusb'
import { createNativeWinusbDevice } from '@usb-pd-sniffer/pd-device-native-winusb'
import type { CaptureDevice } from '@usb-pd-sniffer/pd-device-types'
import { createWitrnK2HidDevice } from '@usb-pd-sniffer/pd-device-witrn-k2-hid'

export type DeviceKind =
  | 'native'
  | 'native-winusb'
  | 'native-cdc'
  | 'witrn-k2-hid'
  | 'atk-c2'

export type { ActiveCCMode, CCPull, CCPullConfig, PdTxSop }

// Both native transports (HID and WinUSB/bulk) speak the same 64-byte record
// protocol, so they expose the same control surface.
export type NativeDeviceHandle = NativeHidDevice | NativeWinusbDevice

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
  'native-winusb': {
    kind: 'native-winusb',
    label: 'Sniffer-V5-WinUSB',
    shortLabel: 'V5 USB',
    apiName: 'WebUSB',
    createDevice: createNativeWinusbDevice,
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

const SELECTABLE_DEVICE_KINDS = [
  'native',
  'native-winusb',
  'witrn-k2-hid',
  'atk-c2',
] as const

export const DEVICE_OPTIONS = SELECTABLE_DEVICE_KINDS.map(
  (kind) => DEVICE_DRIVERS[kind],
)

export function getDeviceDriver(kind: DeviceKind): DeviceDriver {
  return DEVICE_DRIVERS[kind] ?? DEVICE_DRIVERS[DEFAULT_DEVICE_KIND]
}

export function isDeviceKind(value: string): value is DeviceKind {
  return (
    value === 'native' ||
    value === 'native-winusb' ||
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

export function isNativeDevice(
  _device: CaptureDevice,
  kind: DeviceKind,
): _device is NativeDeviceHandle {
  return kind === 'native' || kind === 'native-winusb'
}

/**
 * Only the WinUSB variant surfaces the firmware's recv/drop counters today;
 * the HID transport parses them but discards them.
 */
export function isNativeWinusbDevice(
  _device: CaptureDevice,
  kind: DeviceKind,
): _device is NativeWinusbDevice {
  return kind === 'native-winusb'
}
