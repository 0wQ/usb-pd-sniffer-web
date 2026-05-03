import { describe, expect, test } from "vitest";
import { MONITOR_EVENT } from "./monitorAdapter.js";
import {
  createMonitorRecordNormalizer,
  type MonitorRecord
} from "./device.js";

function record(eventType: number, recvCounter: number, pdRaw: number[]): MonitorRecord {
  return {
    timestamp_us: 1000 + recvCounter,
    recv_counter: recvCounter,
    vbus_mv: 5000,
    ibus_ma: 100,
    cc1_mv: 0,
    cc2_mv: 0,
    dp_mv: 0,
    dm_mv: 0,
    event_type: eventType,
    active_cc: 1,
    data_len: pdRaw.length,
    data: pdRaw,
  };
}

function bytes(count: number, start = 0): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

describe("monitor record normalizer", () => {
  test("passes connection and monitor status records through unchanged", () => {
    const normalizer = createMonitorRecordNormalizer();
    const disconnect = record(MONITOR_EVENT.DISCONNECT, 1, []);
    const cc1 = record(MONITOR_EVENT.CC1_CONNECT, 2, []);
    const cc2 = record(MONITOR_EVENT.CC2_CONNECT, 3, []);
    const overflow = record(MONITOR_EVENT.BUFFER_OVERFLOW, 4, []);

    expect(normalizer.push(disconnect)).toEqual([disconnect]);
    expect(normalizer.push(cc1)).toEqual([cc1]);
    expect(normalizer.push(cc2)).toEqual([cc2]);
    expect(normalizer.push(overflow)).toEqual([overflow]);
  });

  test("keeps power telemetry outside capture records", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.POWER_TELEMETRY, 5, []))).toEqual([]);
  });

  test("passes short UFCS records through unchanged", () => {
    const normalizer = createMonitorRecordNormalizer();
    const input = record(MONITOR_EVENT.UFCS_DP, 7, [1, 2, 3]);

    expect(normalizer.push(input)).toEqual([input]);
  });

  test("assembles consecutive same-counter UFCS HID reports", () => {
    const normalizer = createMonitorRecordNormalizer();
    const chunk0 = record(MONITOR_EVENT.UFCS_DP, 10, bytes(34));
    const chunk1 = record(MONITOR_EVENT.UFCS_DP, 10, [34, 35]);

    expect(normalizer.push(chunk0)).toEqual([]);
    const output = normalizer.push(chunk1);

    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      event_type: MONITOR_EVENT.UFCS_DP,
      recv_counter: 10,
      data_len: 36,
      data: bytes(36),
    });
  });

  test("flushes pending UFCS report when the counter changes", () => {
    const normalizer = createMonitorRecordNormalizer();
    const first = record(MONITOR_EVENT.UFCS_DP, 10, bytes(34));
    const second = record(MONITOR_EVENT.UFCS_DP, 11, [50, 51]);

    expect(normalizer.push(first)).toEqual([]);
    expect(normalizer.push(second)).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DP,
        recv_counter: 10,
        data_len: 34,
      },
      second,
    ]);
  });

  test("flushes pending UFCS report when the signal changes", () => {
    const normalizer = createMonitorRecordNormalizer();
    const dp = record(MONITOR_EVENT.UFCS_DP, 30, bytes(34));
    const dm = record(MONITOR_EVENT.UFCS_DM, 31, [3, 4]);

    expect(normalizer.push(dp)).toEqual([]);
    expect(normalizer.push(dm)).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DP,
        recv_counter: 30,
        data_len: 34,
      },
      {
        event_type: MONITOR_EVENT.UFCS_DM,
        recv_counter: 31,
        data_len: 2,
        data: [3, 4],
      }
    ]);
  });

  test("flushes pending UFCS report before a non-UFCS record", () => {
    const normalizer = createMonitorRecordNormalizer();
    const ufcs = record(MONITOR_EVENT.UFCS_DM, 40, bytes(34));
    const pd = record(MONITOR_EVENT.PD_SOP0, 41, [0x42, 0x10]);

    expect(normalizer.push(ufcs)).toEqual([]);
    expect(normalizer.push(pd)).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DM,
        recv_counter: 40,
        data_len: 34,
      },
      pd,
    ]);
  });

  test("reset drops pending UFCS HID reports", () => {
    const normalizer = createMonitorRecordNormalizer();
    const input = record(MONITOR_EVENT.UFCS_DM, 12, [3, 4]);

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM, 12, bytes(34)))).toEqual([]);
    normalizer.reset();
    expect(normalizer.push(input)).toEqual([input]);
  });
});
