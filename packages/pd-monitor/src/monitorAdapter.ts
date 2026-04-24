import type {
  MessagePacket,
  StartOfPacket
} from "@usb-pd-sniffer/pd-core";

export type MonitorSnapshot = {
  vbusMv: number;
  ibusMa: number;
  cc1Mv: number;
  cc2Mv: number;
  dpMv: number;
  dmMv: number;
};

export type FirmwareMeta = {
  recvCount: number;
  pdActiveCc: 0 | 1 | 2;
  snapshot: MonitorSnapshot;
  rawEventType: number;
  rawPayload: Uint8Array;
  sopDebug?: boolean;
};

export type MonitorFrameInput = {
  eventType: number;
  payload: Uint8Array;
};

export const MONITOR_EVENT = {
  DISCONNECT: 0,
  CC1_CONNECT: 1,
  CC2_CONNECT: 2,
  POWER_TELEMETRY: 10,
  PD_SOP0: 20,
  PD_SOP1: 21,
  PD_SOP2: 22,
  PD_SOP1_DEBUG: 23,
  PD_SOP2_DEBUG: 24,
  HARD_RESET: 25,
  CABLE_RESET: 26,
  PD_ERROR: 30,
  BUFFER_OVERFLOW: 31,
  UFCS_DP_SINGLE: 40,
  UFCS_DM_SINGLE: 41,
  UFCS_DP_CHUNK0: 42,
  UFCS_DM_CHUNK0: 43,
  UFCS_DP_CHUNK1: 44,
  UFCS_DM_CHUNK1: 45
} as const;

export const NATIVE_HID_REPORT_ID = 0x00;
export const NATIVE_HID_REPORT_BODY_SIZE = 64;
export const NATIVE_TX_PAYLOAD_MAX_LEN = 62;

export const MONITOR_TX_CMD = {
  SEND_RAW_SOP0: 0x01,
  SEND_RAW_SOP1: 0x02,
  SEND_RAW_SOP2: 0x03,
  SEND_HARD_RESET: 0x04,
  SEND_CABLE_RESET: 0x05,
  SET_ACTIVE_CC: 0x10
} as const;

export type NativeMonitorTxOpcode = typeof MONITOR_TX_CMD[keyof typeof MONITOR_TX_CMD];

export type NativeMonitorTxCommand =
  | { opcode: typeof MONITOR_TX_CMD.SEND_RAW_SOP0 | typeof MONITOR_TX_CMD.SEND_RAW_SOP1 | typeof MONITOR_TX_CMD.SEND_RAW_SOP2; payload: Uint8Array }
  | { opcode: typeof MONITOR_TX_CMD.SEND_HARD_RESET | typeof MONITOR_TX_CMD.SEND_CABLE_RESET; payload?: Uint8Array | null }
  | { opcode: typeof MONITOR_TX_CMD.SET_ACTIVE_CC; payload?: Uint8Array | null };

function isPdSopFrameEvent(eventType: number): boolean {
  return (
    eventType === MONITOR_EVENT.PD_SOP0 ||
    eventType === MONITOR_EVENT.PD_SOP1 ||
    eventType === MONITOR_EVENT.PD_SOP2 ||
    eventType === MONITOR_EVENT.PD_SOP1_DEBUG ||
    eventType === MONITOR_EVENT.PD_SOP2_DEBUG
  );
}

function isPdResetOrErrorEvent(eventType: number): boolean {
  return (
    eventType === MONITOR_EVENT.HARD_RESET ||
    eventType === MONITOR_EVENT.CABLE_RESET ||
    eventType === MONITOR_EVENT.PD_ERROR
  );
}

export function monitorEventName(eventType: number): string {
  switch (eventType) {
    case MONITOR_EVENT.DISCONNECT:
      return "DISCONNECT";
    case MONITOR_EVENT.CC1_CONNECT:
      return "CC1_CONNECT";
    case MONITOR_EVENT.CC2_CONNECT:
      return "CC2_CONNECT";
    case MONITOR_EVENT.POWER_TELEMETRY:
      return "POWER_TELEMETRY";
    case MONITOR_EVENT.PD_SOP0:
      return "PD_SOP0";
    case MONITOR_EVENT.PD_SOP1:
      return "PD_SOP1";
    case MONITOR_EVENT.PD_SOP2:
      return "PD_SOP2";
    case MONITOR_EVENT.PD_SOP1_DEBUG:
      return "PD_SOP1_DEBUG";
    case MONITOR_EVENT.PD_SOP2_DEBUG:
      return "PD_SOP2_DEBUG";
    case MONITOR_EVENT.HARD_RESET:
      return "HARD_RESET";
    case MONITOR_EVENT.CABLE_RESET:
      return "CABLE_RESET";
    case MONITOR_EVENT.PD_ERROR:
      return "PD_ERROR";
    case MONITOR_EVENT.BUFFER_OVERFLOW:
      return "BUFFER_OVERFLOW";
    case MONITOR_EVENT.UFCS_DP_SINGLE:
      return "UFCS_DP_SINGLE";
    case MONITOR_EVENT.UFCS_DM_SINGLE:
      return "UFCS_DM_SINGLE";
    case MONITOR_EVENT.UFCS_DP_CHUNK0:
      return "UFCS_DP_CHUNK0";
    case MONITOR_EVENT.UFCS_DM_CHUNK0:
      return "UFCS_DM_CHUNK0";
    case MONITOR_EVENT.UFCS_DP_CHUNK1:
      return "UFCS_DP_CHUNK1";
    case MONITOR_EVENT.UFCS_DM_CHUNK1:
      return "UFCS_DM_CHUNK1";
    default:
      return `EVENT_${eventType}`;
  }
}

export function isPdMonitorEvent(eventType: number): boolean {
  return isPdSopFrameEvent(eventType) || isPdResetOrErrorEvent(eventType);
}

export function monitorEventSop(eventType: number): StartOfPacket {
  switch (eventType) {
    case MONITOR_EVENT.PD_SOP0:
      return "SOP";
    case MONITOR_EVENT.PD_SOP1:
    case MONITOR_EVENT.PD_SOP1_DEBUG:
      return "SOP_PRIME";
    case MONITOR_EVENT.PD_SOP2:
    case MONITOR_EVENT.PD_SOP2_DEBUG:
      return "SOP_DPRIME";
    default:
      throw new Error(`Event ${eventType} does not map to a PD Start Of Packet.`);
  }
}

export function normalizePdPayloadForMonitorEvent(
  eventType: number,
  payload: Uint8Array
): Uint8Array {
  if (!isPdSopFrameEvent(eventType)) {
    return payload;
  }

  return payload;
}

export function encodeNativeMonitorTxCommandBody(command: NativeMonitorTxCommand): Uint8Array {
  const body = new Uint8Array(NATIVE_HID_REPORT_BODY_SIZE);
  const payload = command.payload ?? new Uint8Array(0);

  body[0] = command.opcode;

  switch (command.opcode) {
    case MONITOR_TX_CMD.SEND_RAW_SOP0:
    case MONITOR_TX_CMD.SEND_RAW_SOP1:
    case MONITOR_TX_CMD.SEND_RAW_SOP2:
      if (payload.length < 2 || payload.length > 34) {
        throw new Error(`Raw PD TX payload length must be 2..34 bytes, got ${payload.length}.`);
      }
      body[1] = payload.length;
      body.set(payload.subarray(0, Math.min(payload.length, NATIVE_TX_PAYLOAD_MAX_LEN)), 2);
      return body;
    case MONITOR_TX_CMD.SEND_HARD_RESET:
    case MONITOR_TX_CMD.SEND_CABLE_RESET:
      if (payload.length !== 0) {
        throw new Error(`Reset command payload length must be 0 bytes, got ${payload.length}.`);
      }
      body[1] = 0;
      return body;
    case MONITOR_TX_CMD.SET_ACTIVE_CC:
      throw new Error("SET_ACTIVE_CC is reserved in firmware and must not be used.");
  }

  throw new Error("Unsupported native monitor TX command.");
}

export function toPdObservedFrameFromMonitorEvent(
  input: MonitorFrameInput
): MessagePacket | null {
  if (!isPdSopFrameEvent(input.eventType)) {
    return null;
  }

  return {
    sop: monitorEventSop(input.eventType),
    bytes: normalizePdPayloadForMonitorEvent(input.eventType, input.payload)
  };
}
