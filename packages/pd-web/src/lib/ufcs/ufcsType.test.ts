import { describe, expect, test } from 'vitest'
import { MONITOR_EVENT } from '@usb-pd-sniffer/pd-monitor'
import { decodeUfcsRecordType, decodeUfcsType, formatUfcsSignal, formatUfcsTypeSummary } from './ufcsType'
import type { CaptureRecord } from '@/types/pd'

function record(eventType: number, data: number[]): CaptureRecord {
  return {
    timestamp_us: 0,
    recv_counter: 0,
    vbus_mv: 0,
    ibus_ma: 0,
    cc1_mv: 0,
    cc2_mv: 0,
    dp_mv: 0,
    dm_mv: 0,
    event_type: eventType,
    active_cc: 1,
    data_len: data.length,
    data,
  }
}

describe('UFCS temporary type decoder', () => {
  test('decodes UFCS DATA type from frame with training byte', () => {
    const decoded = decodeUfcsType([0xAA, 0x24, 0x09, 0x02, 0x08, 0x00])

    expect(decoded).toEqual({
      address: 1,
      messageNumber: 2,
      version: 1,
      type: 1,
      typeName: 'DATA',
      commandId: 0x02,
      commandName: 'REQUEST',
    })
    expect(formatUfcsTypeSummary(decoded)).toBe('REQUEST')
  })

  test('decodes UFCS CTRL type from frame without training byte', () => {
    const decoded = decodeUfcsType([0x20, 0x08, 0x01, 0x00])

    expect(decoded?.typeName).toBe('CTRL')
    expect(decoded?.commandName).toBe('ACK')
    expect(formatUfcsTypeSummary(decoded)).toBe('ACK')
    expect(decoded?.address).toBe(1)
  })

  test('maps UFCS single events to physical line labels', () => {
    const dp = record(MONITOR_EVENT.UFCS_DP_SINGLE, [0xAA, 0x24, 0x09])
    const dm = record(MONITOR_EVENT.UFCS_DM_SINGLE, [0xAA, 0x24, 0x09])

    expect(formatUfcsSignal(dp)).toBe('D+')
    expect(formatUfcsSignal(dm)).toBe('D-')
    expect(decodeUfcsRecordType(dp)?.typeName).toBe('DATA')
  })
})
