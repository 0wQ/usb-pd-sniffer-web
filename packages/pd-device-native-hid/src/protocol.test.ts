import { describe, expect, it } from 'vitest'
import {
  encodeNativeHidTxCommandBody,
  NATIVE_HID_TX_CMD,
} from './nativeHidAdapter.js'

// The numeric values are a wire contract with bsp_pd_cc_pull_t in the firmware:
// OPEN, RD, RA, RP_DEFAULT_USB, RP_1P5A, RP_3A. Getting them wrong silently
// terminates the CC line at the wrong current, so pin them down here.
const CC_PULL_WIRE_VALUES = [
  ['open', 0x00],
  ['rd', 0x01],
  ['ra', 0x02],
  ['rp-default-usb', 0x03],
  ['rp-1p5a', 0x04],
  ['rp-3a', 0x05],
] as const

describe('native HID CC pull encoding', () => {
  it.each(CC_PULL_WIRE_VALUES)('encodes %s as 0x%02x', (pull, byte) => {
    const body = encodeNativeHidTxCommandBody({
      opcode: NATIVE_HID_TX_CMD.SET_CC_PULL,
      activeCC: 'auto',
      cc1: pull,
      cc2: pull,
    })

    expect(body).toHaveLength(64)
    expect(body[0]).toBe(NATIVE_HID_TX_CMD.SET_CC_PULL)
    expect(body[1]).toBe(3) // active_cc + cc1_pull + cc2_pull
    expect(body[2]).toBe(0) // active_cc = auto
    expect(body[3]).toBe(byte)
    expect(body[4]).toBe(byte)
  })

  it('encodes the active CC selector independently of the pull', () => {
    const body = encodeNativeHidTxCommandBody({
      opcode: NATIVE_HID_TX_CMD.SET_CC_PULL,
      activeCC: 'cc2',
      cc1: 'rp-3a',
      cc2: 'rd',
    })

    expect(body[2]).toBe(2) // force CC2
    expect(body[3]).toBe(0x05) // CC1 = Rp 3 A
    expect(body[4]).toBe(0x01) // CC2 = Rd
  })
})
