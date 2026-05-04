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
import type { CaptureDevice } from '@usb-pd-sniffer/pd-device-types'

export type DeviceKind = 'native' | 'native-cdc' | 'atk-c2'

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
    label: 'Native HID',
    shortLabel: 'Native',
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
  'atk-c2': {
    kind: 'atk-c2',
    label: 'ATK C2',
    shortLabel: 'ATK C2',
    apiName: 'WebUSB',
    createDevice: createAtkC2Device,
  },
}

export const DEVICE_OPTIONS = Object.values(DEVICE_DRIVERS)

export function getDeviceDriver(kind: DeviceKind): DeviceDriver {
  return DEVICE_DRIVERS[kind] ?? DEVICE_DRIVERS[DEFAULT_DEVICE_KIND]
}

export function isDeviceKind(value: string): value is DeviceKind {
  return value === 'native' || value === 'native-cdc' || value === 'atk-c2'
}

export function isNativeHidDevice(
  _device: CaptureDevice,
  kind: DeviceKind,
): _device is HidDeviceHandle {
  return kind === 'native'
}
