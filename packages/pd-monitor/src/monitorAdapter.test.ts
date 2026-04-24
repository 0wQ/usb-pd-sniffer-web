import { describe, expect, test } from "vitest";
import {
  encodeNativeMonitorTxCommandBody,
  isPdMonitorEvent,
  MONITOR_EVENT,
  MONITOR_TX_CMD,
  NATIVE_HID_REPORT_BODY_SIZE,
  NATIVE_MONITOR_PAYLOAD_MAX_LEN,
  normalizePdPayloadForMonitorEvent,
  monitorEventName,
  monitorEventSop,
  parseNativeMonitorHidReportBody,
  toPdObservedFrameFromMonitorEvent
} from "./monitorAdapter.js";

describe("pd-monitor adapter", () => {
  test("keeps native monitor event numbering aligned with firmware groups", () => {
    expect(MONITOR_EVENT.POWER_TELEMETRY).toBe(10);
    expect(MONITOR_EVENT.PD_SOP0).toBe(20);
    expect(MONITOR_EVENT.PD_SOP1).toBe(21);
    expect(MONITOR_EVENT.PD_SOP2).toBe(22);
    expect(MONITOR_EVENT.PD_SOP1_DEBUG).toBe(23);
    expect(MONITOR_EVENT.PD_SOP2_DEBUG).toBe(24);
    expect(MONITOR_EVENT.HARD_RESET).toBe(25);
    expect(MONITOR_EVENT.CABLE_RESET).toBe(26);
    expect(MONITOR_EVENT.PD_ERROR).toBe(30);
  });

  test("maps native PD event families to stable monitor names and SOP variants", () => {
    expect(monitorEventName(MONITOR_EVENT.PD_SOP0)).toBe("PD_SOP0");
    expect(monitorEventName(MONITOR_EVENT.PD_SOP1_DEBUG)).toBe("PD_SOP1_DEBUG");
    expect(monitorEventName(MONITOR_EVENT.PD_SOP2_DEBUG)).toBe("PD_SOP2_DEBUG");
    expect(monitorEventName(MONITOR_EVENT.HARD_RESET)).toBe("HARD_RESET");
    expect(monitorEventName(MONITOR_EVENT.CABLE_RESET)).toBe("CABLE_RESET");
    expect(monitorEventName(MONITOR_EVENT.POWER_TELEMETRY)).toBe("POWER_TELEMETRY");

    expect(monitorEventSop(MONITOR_EVENT.PD_SOP0)).toBe("SOP");
    expect(monitorEventSop(MONITOR_EVENT.PD_SOP1)).toBe("SOP_PRIME");
    expect(monitorEventSop(MONITOR_EVENT.PD_SOP1_DEBUG)).toBe("SOP_PRIME");
    expect(monitorEventSop(MONITOR_EVENT.PD_SOP2)).toBe("SOP_DPRIME");
    expect(monitorEventSop(MONITOR_EVENT.PD_SOP2_DEBUG)).toBe("SOP_DPRIME");
    expect(() => monitorEventSop(MONITOR_EVENT.HARD_RESET)).toThrow("does not map to a PD Start Of Packet");
    expect(() => monitorEventSop(MONITOR_EVENT.CABLE_RESET)).toThrow("does not map to a PD Start Of Packet");
    expect(() => monitorEventSop(MONITOR_EVENT.PD_ERROR)).toThrow("does not map to a PD Start Of Packet");
  });

  test("keeps POWER_TELEMETRY and connection events outside the PD frame pipeline", () => {
    expect(isPdMonitorEvent(MONITOR_EVENT.POWER_TELEMETRY)).toBe(false);
    expect(isPdMonitorEvent(MONITOR_EVENT.CC1_CONNECT)).toBe(false);
    expect(isPdMonitorEvent(MONITOR_EVENT.CC2_CONNECT)).toBe(false);
    expect(isPdMonitorEvent(MONITOR_EVENT.PD_SOP0)).toBe(true);
    expect(isPdMonitorEvent(MONITOR_EVENT.HARD_RESET)).toBe(true);
    expect(isPdMonitorEvent(MONITOR_EVENT.CABLE_RESET)).toBe(true);

    expect(
      toPdObservedFrameFromMonitorEvent({
        eventType: MONITOR_EVENT.POWER_TELEMETRY,
        payload: Uint8Array.from([1, 2, 3, 4])
      })
    ).toBeNull();
  });

  test("keeps PD payload bytes unchanged for SOP frame events", () => {
    const zeroObjectWithCrc = Uint8Array.from([0x42, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]);
    const oneObjectWithoutCrc = Uint8Array.from([0x42, 0x10, 0xaa, 0xbb, 0xcc, 0xdd]);

    expect(Array.from(normalizePdPayloadForMonitorEvent(MONITOR_EVENT.PD_SOP0, zeroObjectWithCrc))).toEqual(
      Array.from(zeroObjectWithCrc)
    );
    expect(Array.from(normalizePdPayloadForMonitorEvent(MONITOR_EVENT.PD_SOP0, oneObjectWithoutCrc))).toEqual([
      0x42, 0x10, 0xaa, 0xbb, 0xcc, 0xdd
    ]);
  });

  test("parses native HID input report body using the shared ABI layout", () => {
    const body = new Uint8Array(NATIVE_HID_REPORT_BODY_SIZE);
    body.set([0x88, 0x77, 0x66, 0x55], 0);
    body.set([0x44, 0x33, 0x22, 0x11], 4);
    body.set([0x04, 0x03, 0x02, 0x01], 8);
    body.set([0x9e, 0x13], 12);
    body.set([0x38, 0xff], 14);
    body.set([0x2c, 0x01], 16);
    body.set([0x58, 0x02], 18);
    body.set([0x84, 0x03], 20);
    body.set([0xb0, 0x04], 22);
    body[24] = MONITOR_EVENT.PD_SOP0;
    body[25] = 1;
    body[26] = 4;
    body.set([0xa1, 0x71, 0x2c, 0x91], 27);

    const report = parseNativeMonitorHidReportBody(body);

    expect(report.timestampUs).toBe(Number(0x1122334455667788n));
    expect(report.recvCount).toBe(0x01020304);
    expect(report.snapshot).toEqual({
      vbusMv: 5022,
      ibusMa: -200,
      cc1Mv: 300,
      cc2Mv: 600,
      dpMv: 900,
      dmMv: 1200
    });
    expect(report.eventType).toBe(MONITOR_EVENT.PD_SOP0);
    expect(report.activeCc).toBe(1);
    expect(report.payloadLen).toBe(4);
    expect(Array.from(report.payload)).toEqual([0xa1, 0x71, 0x2c, 0x91]);
  });

  test("clamps native HID payload length to the fixed monitor payload field", () => {
    const body = new Uint8Array(NATIVE_HID_REPORT_BODY_SIZE);
    body[26] = 0xff;

    const report = parseNativeMonitorHidReportBody(body);

    expect(report.payloadLen).toBe(NATIVE_MONITOR_PAYLOAD_MAX_LEN);
    expect(report.payload.length).toBe(NATIVE_MONITOR_PAYLOAD_MAX_LEN);
  });

  test("encodes raw SOP command body for native HID OUT", () => {
    const body = encodeNativeMonitorTxCommandBody({
      opcode: MONITOR_TX_CMD.SEND_RAW_SOP1,
      payload: Uint8Array.from([0x42, 0x10, 0xaa, 0xbb])
    });

    expect(body.length).toBe(NATIVE_HID_REPORT_BODY_SIZE);
    expect(body[0]).toBe(MONITOR_TX_CMD.SEND_RAW_SOP1);
    expect(body[1]).toBe(4);
    expect(Array.from(body.subarray(2, 6))).toEqual([0x42, 0x10, 0xaa, 0xbb]);
  });

  test("encodes reset commands with zero payload for native HID OUT", () => {
    const hardReset = encodeNativeMonitorTxCommandBody({
      opcode: MONITOR_TX_CMD.SEND_HARD_RESET
    });
    const cableReset = encodeNativeMonitorTxCommandBody({
      opcode: MONITOR_TX_CMD.SEND_CABLE_RESET
    });

    expect(hardReset.length).toBe(NATIVE_HID_REPORT_BODY_SIZE);
    expect(cableReset.length).toBe(NATIVE_HID_REPORT_BODY_SIZE);
    expect(hardReset[0]).toBe(MONITOR_TX_CMD.SEND_HARD_RESET);
    expect(cableReset[0]).toBe(MONITOR_TX_CMD.SEND_CABLE_RESET);
    expect(hardReset[1]).toBe(0);
    expect(cableReset[1]).toBe(0);
  });

  test("keeps host raw-send echo compatible with neutral PD monitor events", () => {
    const payload = Uint8Array.from([0x42, 0x10, 0xaa, 0xbb]);
    const body = encodeNativeMonitorTxCommandBody({
      opcode: MONITOR_TX_CMD.SEND_RAW_SOP2,
      payload
    });
    const echoed = toPdObservedFrameFromMonitorEvent({
      eventType: MONITOR_EVENT.PD_SOP2,
      payload: body.slice(2, 2 + body[1])
    });

    expect(echoed).not.toBeNull();
    expect(echoed?.sop).toBe("SOP_DPRIME");
    expect(Array.from(echoed?.bytes ?? [])).toEqual(Array.from(payload));
  });

  test("keeps reset echo compatible with neutral PD monitor events", () => {
    const hardResetEcho = toPdObservedFrameFromMonitorEvent({
      eventType: MONITOR_EVENT.HARD_RESET,
      payload: new Uint8Array(0)
    });
    const cableResetEcho = toPdObservedFrameFromMonitorEvent({
      eventType: MONITOR_EVENT.CABLE_RESET,
      payload: new Uint8Array(0)
    });

    expect(hardResetEcho).toBeNull();
    expect(cableResetEcho).toBeNull();
  });

  test("rejects reserved SET_ACTIVE_CC command", () => {
    expect(() =>
      encodeNativeMonitorTxCommandBody({ opcode: MONITOR_TX_CMD.SET_ACTIVE_CC })
    ).toThrow("SET_ACTIVE_CC is reserved");
  });
});
