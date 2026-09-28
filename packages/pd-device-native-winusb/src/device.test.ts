import type { CaptureRecord } from '@usb-pd-sniffer/pd-device-types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeWinusbDevice } from './device.js'
import {
  NATIVE_WINUSB_EVENT,
  NATIVE_WINUSB_REPORT_BODY_SIZE,
  NATIVE_WINUSB_REPORT_TYPE,
} from './protocol.js'

type UsbInResult = {
  data?: DataView
  status: 'ok' | 'stall' | 'babble'
}

type PendingTransfer = {
  resolve: (result: UsbInResult) => void
  reject: (error: unknown) => void
  length: number
  endpoint: number
}

function buildEventBody(options: {
  eventType: number
  recvCount: number
  payload: readonly number[]
}): DataView {
  const body = new Uint8Array(NATIVE_WINUSB_REPORT_BODY_SIZE)
  body[0] = NATIVE_WINUSB_REPORT_TYPE.EVENT
  body[1] = options.eventType
  body[2] = options.payload.length
  body[3] = 1

  new DataView(body.buffer).setUint32(12, options.recvCount, true)
  body.set(options.payload, 30)

  return new DataView(body.buffer, body.byteOffset, body.byteLength)
}

function buildStatusBody(): DataView {
  const body = new Uint8Array(NATIVE_WINUSB_REPORT_BODY_SIZE)
  body[0] = NATIVE_WINUSB_REPORT_TYPE.STATUS
  body[2] = 4
  new DataView(body.buffer).setUint32(30, 3, true)
  return new DataView(body.buffer, body.byteOffset, body.byteLength)
}

// Mirrors Chrome, which validates that the endpoint number is in range (0-15)
// and rejects the raw endpoint ADDRESS with IndexSizeError. Without this the
// 0x81-vs-1 mistake silently kills every read while the unit tests stay green.
const ENDPOINT_NUMBER_LIMIT = 15

function assertEndpointNumber(endpoint: number): void {
  if (
    !Number.isInteger(endpoint) ||
    endpoint < 0 ||
    endpoint > ENDPOINT_NUMBER_LIMIT
  ) {
    throw new DOMException(
      "Failed to execute 'transferIn' on 'USBDevice': The specified endpoint number is out of range.",
      'IndexSizeError',
    )
  }
}

function createFakeUsbDevice() {
  const pending: PendingTransfer[] = []

  const device = {
    vendorId: 0x1a86,
    productId: 0x2335,
    productName: 'USB PD Sniffer V4 WinUSB',
    opened: false,
    configuration: null as { configurationValue: number } | null,
    async open(): Promise<void> {
      device.opened = true
    },
    async close(): Promise<void> {
      device.opened = false
    },
    async selectConfiguration(configurationValue: number): Promise<void> {
      device.configuration = { configurationValue }
    },
    async claimInterface(): Promise<void> {},
    async releaseInterface(): Promise<void> {},
    transferIn(endpoint: number, length: number): Promise<UsbInResult> {
      assertEndpointNumber(endpoint)
      return new Promise<UsbInResult>((resolve, reject) => {
        pending.push({ resolve, reject, length, endpoint })
      })
    },
    async transferOut(
      endpoint: number,
    ): Promise<{ bytesWritten: number; status: 'ok' }> {
      assertEndpointNumber(endpoint)
      return { bytesWritten: NATIVE_WINUSB_REPORT_BODY_SIZE, status: 'ok' }
    },
  }

  return { device, pending }
}

function installFakeUsb(
  devices: readonly ReturnType<typeof createFakeUsbDevice>['device'][],
): void {
  vi.stubGlobal('navigator', {
    usb: {
      async getDevices() {
        return devices
      },
      async requestDevice() {
        return devices[0]
      },
      addEventListener() {},
      removeEventListener() {},
    },
  })
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const created: ReturnType<typeof createNativeWinusbDevice>[] = []

function track<T extends ReturnType<typeof createNativeWinusbDevice>>(
  device: T,
): T {
  created.push(device)
  return device
}

afterEach(() => {
  for (const device of created.splice(0)) device.dispose()
  vi.unstubAllGlobals()
})

describe('native winusb bulk transport', () => {
  it('keeps the bulk IN window full and reissues on every completion', async () => {
    const { device, pending } = createFakeUsbDevice()
    installFakeUsb([device])

    const capture = track(createNativeWinusbDevice({ inFlightReads: 4 }))
    await capture.connect()

    expect(device.opened).toBe(true)
    expect(pending).toHaveLength(4)
    for (const transfer of pending) {
      expect(transfer.length).toBe(NATIVE_WINUSB_REPORT_BODY_SIZE)
      // Must be the endpoint NUMBER. 0x81 is the address and makes Chrome throw
      // IndexSizeError, which silently stops all delivery.
      expect(transfer.endpoint).toBe(1)
    }

    // Completing one read must immediately replace it, otherwise the endpoint
    // idles between transfers and bulk stops being faster than HID.
    pending[0]?.resolve({
      data: buildEventBody({
        eventType: NATIVE_WINUSB_EVENT.PD_SOP0,
        recvCount: 1,
        payload: [0xaa, 0xbb],
      }),
      status: 'ok',
    })
    await flush()

    expect(pending).toHaveLength(5)
    expect(pending.filter((t) => t.length === 64)).toHaveLength(5)
  })

  it('emits capture records parsed from bulk IN transfers', async () => {
    const { device, pending } = createFakeUsbDevice()
    installFakeUsb([device])

    const records: CaptureRecord[] = []
    const capture = track(createNativeWinusbDevice({ inFlightReads: 2 }))
    capture.onRecord((record) => records.push(record))
    await capture.connect()

    pending[0]?.resolve({
      data: buildEventBody({
        eventType: NATIVE_WINUSB_EVENT.PD_SOP0,
        recvCount: 42,
        payload: [0x01, 0x02, 0x03],
      }),
      status: 'ok',
    })
    await flush()

    expect(records).toHaveLength(1)
    expect(records[0]?.event_type).toBe('PD_SOP0')
    expect(records[0]?.seq).toBe(42)
    expect(records[0]?.data).toEqual([0x01, 0x02, 0x03])
  })

  it('reassembles a split UFCS frame arriving as two records', async () => {
    const { device, pending } = createFakeUsbDevice()
    installFakeUsb([device])

    const records: CaptureRecord[] = []
    const capture = track(createNativeWinusbDevice({ inFlightReads: 2 }))
    capture.onRecord((record) => records.push(record))
    await capture.connect()

    const chunk0 = Array.from({ length: 34 }, (_, i) => i)
    const chunk1 = Array.from({ length: 31 }, (_, i) => 34 + i)

    pending[0]?.resolve({
      data: buildEventBody({
        eventType: NATIVE_WINUSB_EVENT.UFCS_DP,
        recvCount: 7,
        payload: chunk0,
      }),
      status: 'ok',
    })
    pending[1]?.resolve({
      data: buildEventBody({
        eventType: NATIVE_WINUSB_EVENT.UFCS_DP,
        recvCount: 7,
        payload: chunk1,
      }),
      status: 'ok',
    })
    await flush()

    // The firmware still splits >34 byte UFCS frames into two 64 byte records;
    // the host must glue them back together exactly as it does over HID.
    expect(records).toHaveLength(1)
    expect(records[0]?.data_len).toBe(65)
    expect(records[0]?.data).toEqual([...chunk0, ...chunk1])
  })

  it('drops STATUS reports instead of emitting them as records', async () => {
    const { device, pending } = createFakeUsbDevice()
    installFakeUsb([device])

    const records: CaptureRecord[] = []
    const capture = track(createNativeWinusbDevice({ inFlightReads: 2 }))
    capture.onRecord((record) => records.push(record))
    await capture.connect()

    pending[0]?.resolve({ data: buildStatusBody(), status: 'ok' })
    await flush()

    expect(records).toHaveLength(0)
    expect(capture.error).toBeNull()
  })

  it('ignores transfers that complete after disconnect', async () => {
    const { device, pending } = createFakeUsbDevice()
    installFakeUsb([device])

    const records: CaptureRecord[] = []
    const capture = track(createNativeWinusbDevice({ inFlightReads: 2 }))
    capture.onRecord((record) => records.push(record))
    await capture.connect()

    const stale = pending[0]
    await capture.disconnect()
    stale?.resolve({
      data: buildEventBody({
        eventType: NATIVE_WINUSB_EVENT.PD_SOP0,
        recvCount: 1,
        payload: [],
      }),
      status: 'ok',
    })
    await flush()

    expect(records).toHaveLength(0)
    expect(capture.isConnected).toBe(false)
  })

  it('surfaces a malformed record length as an error', async () => {
    const { device, pending } = createFakeUsbDevice()
    installFakeUsb([device])

    const capture = track(createNativeWinusbDevice({ inFlightReads: 1 }))
    await capture.connect()

    pending[0]?.resolve({
      data: new DataView(new Uint8Array(8).buffer),
      status: 'ok',
    })
    await flush()

    expect(capture.error).toContain('Unexpected bulk IN length 8')
  })

  it('keeps pumping after a rejected transfer instead of stalling forever', async () => {
    const { device, pending } = createFakeUsbDevice()
    installFakeUsb([device])

    const records: CaptureRecord[] = []
    const capture = track(createNativeWinusbDevice({ inFlightReads: 3 }))
    capture.onRecord((record) => records.push(record))
    await capture.connect()

    expect(pending).toHaveLength(3)

    // A single rejection (e.g. the UA refusing more than one outstanding
    // request on an endpoint) must degrade concurrency, not stop delivery.
    pending[0]?.reject(new Error('a transfer is already in progress'))
    await new Promise((resolve) => setTimeout(resolve, 120))

    const issuedAfterReject = pending.length
    expect(issuedAfterReject).toBeGreaterThan(3)

    pending[issuedAfterReject - 1]?.resolve({
      data: buildEventBody({
        eventType: NATIVE_WINUSB_EVENT.PD_SOP0,
        recvCount: 9,
        payload: [0x11],
      }),
      status: 'ok',
    })
    await flush()

    expect(records).toHaveLength(1)
    expect(records[0]?.seq).toBe(9)
  })
})
