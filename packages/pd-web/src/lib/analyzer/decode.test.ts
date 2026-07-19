import { calculatePdCrc32 } from '@usb-pd-sniffer/pd-core'
import {
  CAPTURE_EVENT,
  type CaptureEventType,
  type CaptureRecord,
} from '@usb-pd-sniffer/pd-device-types'
import { describe, expect, test } from 'vitest'
import { decodeRecordAtIndex } from './decode.js'

function packetRecord(
  seq: number,
  eventType: CaptureEventType,
  messageBytes: readonly number[],
): CaptureRecord {
  const crc = calculatePdCrc32(messageBytes)
  const data = [
    ...messageBytes,
    crc & 0xff,
    (crc >>> 8) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 24) & 0xff,
  ]

  return {
    timestamp_us: seq,
    seq,
    vbus_mv: 0,
    ibus_ma: 0,
    cc1_mv: 0,
    cc2_mv: 0,
    dp_mv: 0,
    dm_mv: 0,
    event_type: eventType,
    active_cc: 0,
    data_len: data.length,
    data,
  }
}

const sourceCapabilities = [
  0xa1, 0x31, 0x2c, 0x91, 0x01, 0x00, 0xc8, 0xd0, 0x02, 0x00, 0x2c, 0x41, 0x06,
  0x00,
]
const request = [0xa2, 0x11, 0xc8, 0x20, 0x03, 0x20]
const softReset = [0x8d, 0x00]

describe('decodeRecordAtIndex context boundaries', () => {
  test('does not use Source_Capabilities from before a Soft Reset on SOP', () => {
    const decoded = decodeRecordAtIndex(
      [
        packetRecord(0, CAPTURE_EVENT.PD_SOP0, sourceCapabilities),
        packetRecord(1, CAPTURE_EVENT.PD_SOP0, softReset),
        packetRecord(2, CAPTURE_EVENT.PD_SOP0, request),
      ],
      2,
    )

    expect(
      decoded?.decoded.sections.some(
        (section) => section.title === 'RDO - Common',
      ),
    ).toBe(true)
    expect(decoded?.decoded.explainContext.notes).toHaveLength(0)
    expect(decoded?.contextBacktrackUsed).toBe(1)
  })

  test('does not assemble chunks across a Soft Reset on the same SOP', () => {
    const decoded = decodeRecordAtIndex(
      [
        packetRecord(
          0,
          CAPTURE_EVENT.PD_SOP0,
          [
            0xb1, 0xfb, 0x24, 0x80, 0x2c, 0x91, 0x81, 0x08, 0x2c, 0xd1, 0x02,
            0x00, 0x0a, 0xb1, 0x04, 0x00, 0xc8, 0x40, 0x06, 0x00, 0x48, 0x32,
            0xdc, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          ],
        ),
        packetRecord(1, CAPTURE_EVENT.PD_SOP0, softReset),
        packetRecord(
          2,
          CAPTURE_EVENT.PD_SOP0,
          [
            0xb1, 0xbd, 0x24, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0xd0,
          ],
        ),
      ],
      2,
    )

    expect(
      decoded?.decoded.explainContext.notes.some((note) =>
        note.includes('requires previous chunk context 0..0'),
      ),
    ).toBe(true)
    expect(decoded?.contextBacktrackUsed).toBe(1)
  })

  test('does not let a Soft Reset on another SOP block SOP Request context', () => {
    const decoded = decodeRecordAtIndex(
      [
        packetRecord(0, CAPTURE_EVENT.PD_SOP0, sourceCapabilities),
        packetRecord(1, CAPTURE_EVENT.PD_SOP1, softReset),
        packetRecord(2, CAPTURE_EVENT.PD_SOP0, request),
      ],
      2,
    )

    expect(
      decoded?.decoded.sections.some(
        (section) => section.title === 'RDO - Fixed and Variable',
      ),
    ).toBe(true)
    expect(
      decoded?.decoded.explainContext.notes.some((note) =>
        note.includes('Resolved Request object position 2'),
      ),
    ).toBe(true)
    expect(decoded?.contextBacktrackUsed).toBe(2)
  })
})
