import { describe, expect, test } from "vitest";
import { MONITOR_EVENT, MONITOR_TX_CMD } from "@usb-pd-sniffer/pd-device-native-hid";
import {
  encodeNativeCdcCommandFrame,
  encodeNativeCdcFrame,
  NativeCdcFrameParser,
  NATIVE_CDC_EVENT_HEADER_SIZE,
  NATIVE_CDC_FRAME_HEADER_SIZE,
  NATIVE_CDC_FRAME_MAGIC,
  NATIVE_CDC_FRAME_TYPE_CMD,
  NATIVE_CDC_FRAME_TYPE_EVENT,
  parseNativeCdcEventPayload,
} from "./protocol.js";

function putU16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function putU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

describe("native CDC protocol", () => {
  test("encodes host commands as CDC frames", () => {
    const frame = encodeNativeCdcCommandFrame({
      opcode: MONITOR_TX_CMD.SEND_RAW_SOP1,
      payload: Uint8Array.from([0x42, 0x10, 0xaa, 0xbb]),
    });

    expect(Array.from(frame.subarray(0, NATIVE_CDC_FRAME_MAGIC.length))).toEqual(Array.from(NATIVE_CDC_FRAME_MAGIC));
    expect(frame[NATIVE_CDC_FRAME_MAGIC.length]).toBe(NATIVE_CDC_FRAME_TYPE_CMD);
    expect(frame[NATIVE_CDC_FRAME_MAGIC.length + 1]).toBe(5);
    expect(frame[NATIVE_CDC_FRAME_MAGIC.length + 2]).toBe(0);
    expect(Array.from(frame.subarray(NATIVE_CDC_FRAME_HEADER_SIZE))).toEqual([
      MONITOR_TX_CMD.SEND_RAW_SOP1,
      0x42,
      0x10,
      0xaa,
      0xbb,
    ]);
  });

  test("parses fragmented byte stream frames", () => {
    const parser = new NativeCdcFrameParser();
    const payload = new Uint8Array(NATIVE_CDC_EVENT_HEADER_SIZE);
    payload[26] = MONITOR_EVENT.PD_SOP0;
    const frame = encodeNativeCdcFrame(NATIVE_CDC_FRAME_TYPE_EVENT, payload);

    expect(parser.push(frame.subarray(0, 2))).toEqual([]);
    expect(parser.push(frame.subarray(2, 6))).toEqual([]);
    const parsed = parser.push(frame.subarray(6));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.type).toBe(NATIVE_CDC_FRAME_TYPE_EVENT);
    expect(Array.from(parsed[0]?.payload ?? [])).toEqual(Array.from(payload));
  });

  test("rejects false magic candidates with invalid event payloads", () => {
    const parser = new NativeCdcFrameParser();
    const invalidPayload = new Uint8Array(NATIVE_CDC_EVENT_HEADER_SIZE + 10);
    invalidPayload[26] = 153;
    invalidPayload.set([0x80, 0x04, 0x00, 0xb8, 0xe1, 0x4e, 0x58, 0x0a, 0x55, 0x50], NATIVE_CDC_EVENT_HEADER_SIZE);

    const validPayload = new Uint8Array(NATIVE_CDC_EVENT_HEADER_SIZE);
    validPayload[26] = MONITOR_EVENT.PD_SOP0;
    validPayload[27] = 1;

    const invalidFrame = encodeNativeCdcFrame(NATIVE_CDC_FRAME_TYPE_EVENT, invalidPayload);
    const validFrame = encodeNativeCdcFrame(NATIVE_CDC_FRAME_TYPE_EVENT, validPayload);
    const chunk = new Uint8Array(invalidFrame.length + validFrame.length);
    chunk.set(invalidFrame, 0);
    chunk.set(validFrame, invalidFrame.length);

    const parsed = parser.push(chunk);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.type).toBe(NATIVE_CDC_FRAME_TYPE_EVENT);
    expect(Array.from(parsed[0]?.payload ?? [])).toEqual(Array.from(validPayload));
  });

  test("parses native CDC event payloads", () => {
    const payload = new Uint8Array(NATIVE_CDC_EVENT_HEADER_SIZE + 4);
    putU32LE(payload, 0, 0x55667788);
    putU32LE(payload, 4, 0x11223344);
    putU32LE(payload, 8, 0x01020304);
    putU16LE(payload, 12, 5022);
    putU32LE(payload, 14, 0xfffcf2c0);
    putU16LE(payload, 18, 300);
    putU16LE(payload, 20, 600);
    putU16LE(payload, 22, 900);
    putU16LE(payload, 24, 1200);
    payload[26] = MONITOR_EVENT.UFCS_DP;
    payload[27] = 1;
    payload.set([0xaa, 0x24, 0x09, 0x00], NATIVE_CDC_EVENT_HEADER_SIZE);

    const record = parseNativeCdcEventPayload(payload);

    expect(record.timestamp_us).toBe(Number(0x1122334455667788n));
    expect(record.recv_counter).toBe(0x01020304);
    expect(record.vbus_mv).toBe(5022);
    expect(record.ibus_ma).toBe(-200);
    expect(record.cc1_mv).toBe(300);
    expect(record.cc2_mv).toBe(600);
    expect(record.dp_mv).toBe(900);
    expect(record.dm_mv).toBe(1200);
    expect(record.event_type).toBe(MONITOR_EVENT.UFCS_DP);
    expect(record.active_cc).toBe(1);
    expect(record.data_len).toBe(4);
    expect(record.data).toEqual([0xaa, 0x24, 0x09, 0x00]);
  });
});
