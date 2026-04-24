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
      data_len: 5,
      data: [1, 2, 3, 4, 5],
    });
  });

  test("does not assemble chunks with different directions or counters", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_CHUNK0, 10, [1, 2]))).toEqual([]);
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK1, 10, [3, 4]))).toEqual([]);
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_CHUNK1, 11, [5, 6]))).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DP_SINGLE,
        recv_counter: 10,
        data_len: 2,
        data: [1, 2],
      }
    ]);
  });

  test("keeps DP and DM pending chunks independent", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_CHUNK0, 20, [1, 2]))).toEqual([]);
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK0, 21, [9]))).toEqual([]);

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_CHUNK1, 20, [3]))).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DP_SINGLE,
        recv_counter: 20,
        data_len: 3,
        data: [1, 2, 3],
      }
    ]);

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK1, 21, [10, 11]))).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DM_SINGLE,
        recv_counter: 21,
        data_len: 3,
        data: [9, 10, 11],
      }
    ]);
  });

  test("flushes same-direction pending chunk0 before a new single record", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_CHUNK0, 30, [1, 2]))).toEqual([]);
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_SINGLE, 31, [3, 4]))).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DP_SINGLE,
        recv_counter: 30,
        data_len: 2,
        data: [1, 2],
      },
      {
        event_type: MONITOR_EVENT.UFCS_DP_SINGLE,
        recv_counter: 31,
        data_len: 2,
        data: [3, 4],
      }
    ]);
  });

  test("flushes same-direction pending chunk0 before replacing it with a new chunk0", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK0, 40, [1]))).toEqual([]);
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK0, 41, [2, 3]))).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DM_SINGLE,
        recv_counter: 40,
        data_len: 1,
        data: [1],
      }
    ]);
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK1, 41, [4]))).toMatchObject([
      {
        event_type: MONITOR_EVENT.UFCS_DM_SINGLE,
        recv_counter: 41,
        data_len: 3,
        data: [2, 3, 4],
      }
    ]);
  });

  test("drops chunk1 when no same-direction pending chunk0 exists", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DP_CHUNK1, 50, [1, 2]))).toEqual([]);
  });

  test("reset drops pending UFCS chunk0 records", () => {
    const normalizer = createMonitorRecordNormalizer();

    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK0, 12, [1, 2]))).toEqual([]);
    normalizer.reset();
    expect(normalizer.push(record(MONITOR_EVENT.UFCS_DM_CHUNK1, 12, [3, 4]))).toEqual([]);
  });
});
