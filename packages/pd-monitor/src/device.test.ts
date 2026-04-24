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
    pd_data_len: pdRaw.length,
    pd_raw: pdRaw,
  };
}

describe("monitor record normalizer", () => {
  test("passes UFCS single records through unchanged", () => {
    const normalizer = createMonitorRecordNormalizer();
    const input = record(MONITOR_EVENT.UFCS_DP_SINGLE, 7, [1, 2, 3]);

    expect(normalizer.push(input)).toEqual([input]);
  });

  test("assembles UFCS chunk0 and chunk1 into one single record", () => {
    const normalizer = createMonitorRecordNormalizer();
    const chunk0 = record(MONITOR_EVENT.UFCS_DP_CHUNK0, 10, [1, 2, 3]);
    const chunk1 = record(MONITOR_EVENT.UFCS_DP_CHUNK1, 10, [4, 5]);

    expect(normalizer.push(chunk0)).toEqual([]);
    const output = normalizer.push(chunk1);

    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      event_type: MONITOR_EVENT.UFCS_DP_SINGLE,
      recv_counter: 10,
      pd_data_len: 5,
      pd_raw: [1, 2, 3, 4, 5],
    });
  });

  test("does not assemble chunks with different directions or counters", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_CHUNK0, 10, [1, 2]))).toEqual([]);
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK1, 10, [3, 4]))).toEqual([]);
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_CHUNK1, 11, [5, 6]))).toEqual([]);
  });

  test("reset drops pending UFCS chunk0 records", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK0, 12, [1, 2]))).toEqual([]);
    normalizer.reset();
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK1, 12, [3, 4]))).toEqual([]);
  });
});
