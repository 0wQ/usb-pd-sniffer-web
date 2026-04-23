import { describe, expect, test } from "bun:test";
import {
  encodeNativeMonitorTxCommandBody,
  isPdMonitorEvent,
  MONITOR_EVENT,
  MONITOR_TX_CMD,
  NATIVE_HID_REPORT_BODY_SIZE,
  normalizePdPayloadForMonitorEvent,
  monitorEventName,
  monitorEventSop,
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
    expect(monitorEventSop(MONITOR_EVENT.HARD_RESET)).toBe("HARD_RESET");
    expect(monitorEventSop(MONITOR_EVENT.CABLE_RESET)).toBe("CABLE_RESET");
    expect(monitorEventSop(MONITOR_EVENT.PD_ERROR)).toBe("ERROR");
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

  test("strips CRC only when payload length matches header-derived frame+crc length", () => {
    const zeroObjectWithCrc = Uint8Array.from([0x42, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]);
    const oneObjectWithoutCrc = Uint8Array.from([0x42, 0x10, 0xaa, 0xbb, 0xcc, 0xdd]);

    expect(Array.from(normalizePdPayloadForMonitorEvent(MONITOR_EVENT.PD_SOP0, zeroObjectWithCrc))).toEqual([0x42, 0x00]);
    expect(Array.from(normalizePdPayloadForMonitorEvent(MONITOR_EVENT.PD_SOP0, oneObjectWithoutCrc))).toEqual([
      0x42, 0x10, 0xaa, 0xbb, 0xcc, 0xdd
    ]);
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

    expect(hardResetEcho).toEqual({
      sop: "HARD_RESET",
      bytes: new Uint8Array(0)
    });
    expect(cableResetEcho).toEqual({
      sop: "CABLE_RESET",
      bytes: new Uint8Array(0)
    });
  });

  test("rejects reserved SET_ACTIVE_CC command", () => {
    expect(() =>
      encodeNativeMonitorTxCommandBody({ opcode: MONITOR_TX_CMD.SET_ACTIVE_CC })
    ).toThrow("SET_ACTIVE_CC is reserved");
  });
});
