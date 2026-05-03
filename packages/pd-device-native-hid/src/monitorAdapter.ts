import {
  CAPTURE_EVENT,
  type CaptureEventType,
} from "@usb-pd-sniffer/pd-device-types";

export type MonitorSnapshot = {
  vbusMv: number;
  ibusUa: number;
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

export type MonitorPdSop =
  | "SOP"
  | "SOP_PRIME"
  | "SOP_DPRIME"
  | "SOP_PRIME_DEBUG"
  | "SOP_DPRIME_DEBUG";

export type MonitorPdFrame = {
  sop: MonitorPdSop;
  bytes: Uint8Array;
};

export const MONITOR_EVENT = {
  DISCONNECT: 0,
  CC1_CONNECT: 1,
  CC2_CONNECT: 2,
  PD_SOP0: 20,
  PD_SOP1: 21,
  PD_SOP2: 22,
  PD_SOP1_DEBUG: 23,
  PD_SOP2_DEBUG: 24,
  HARD_RESET: 25,
  CABLE_RESET: 26,
  PD_ERROR: 30,
  BUFFER_OVERFLOW: 31,
  UFCS_DP: 40,
  UFCS_DM: 41
} as const;

export const NATIVE_HID_REPORT_ID = 0x00;
export const NATIVE_HID_REPORT_BODY_SIZE = 64;
export const NATIVE_MONITOR_PAYLOAD_MAX_LEN = 34;
export const NATIVE_PD_TX_MESSAGE_MIN_LEN = 2;
export const NATIVE_PD_TX_MESSAGE_MAX_LEN = 30;
export const NATIVE_TX_PAYLOAD_MAX_LEN = 62;
export const NATIVE_HID_REPORT_TYPE = {
  EVENT: 0x01,
  STATUS: 0x02,
} as const;

export const MONITOR_TX_CMD = {
  SEND_RAW_SOP0: 0x01,
  SEND_RAW_SOP1: 0x02,
  SEND_RAW_SOP2: 0x03,
  SEND_HARD_RESET: 0x04,
  SEND_CABLE_RESET: 0x05,
  SET_CC_MODE: 0x10,
  GET_STATUS: 0x20,
} as const;

export type MonitorActiveCCMode = "auto" | "cc1" | "cc2";

export const MONITOR_CC_MODE = {
  OPEN: 0x00,
  RD: 0x01,
  RA: 0x02,
  RP: 0x03
} as const;

export type MonitorCCMode = "open" | "rd" | "ra" | "rp";

export type MonitorCCModeConfig = {
  activeCC: MonitorActiveCCMode;
  cc1: MonitorCCMode;
  cc2: MonitorCCMode;
};

export type NativeMonitorTxOpcode = typeof MONITOR_TX_CMD[keyof typeof MONITOR_TX_CMD];

export type NativeMonitorTxCommand =
  | { opcode: typeof MONITOR_TX_CMD.SEND_RAW_SOP0 | typeof MONITOR_TX_CMD.SEND_RAW_SOP1 | typeof MONITOR_TX_CMD.SEND_RAW_SOP2; payload: Uint8Array }
  | { opcode: typeof MONITOR_TX_CMD.SEND_HARD_RESET | typeof MONITOR_TX_CMD.SEND_CABLE_RESET; payload?: Uint8Array | null }
  | { opcode: typeof MONITOR_TX_CMD.SET_CC_MODE; activeCC: MonitorActiveCCMode; cc1: MonitorCCMode; cc2: MonitorCCMode; payload?: Uint8Array | null }
  | { opcode: typeof MONITOR_TX_CMD.GET_STATUS; payload?: Uint8Array | null };

export type NativeMonitorEventReport = {
  reportType: typeof NATIVE_HID_REPORT_TYPE.EVENT;
  timestampUs: number;
  recvCount: number;
  snapshot: MonitorSnapshot;
  eventType: number;
  activeCC: number;
  payloadLen: number;
  payload: Uint8Array;
};

export type NativeMonitorStatusReport = {
  reportType: typeof NATIVE_HID_REPORT_TYPE.STATUS;
  statusType: number;
  timestampUs: number;
  recvCount: number;
  snapshot: MonitorSnapshot;
  activeCC: number;
  payloadLen: number;
  dropCount: number;
};

export type NativeMonitorHidReport = NativeMonitorEventReport | NativeMonitorStatusReport;

function getU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function getI32LE(bytes: Uint8Array, offset: number): number {
  const value = getU32LE(bytes, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function getU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function ccModeToByte(mode: MonitorCCMode): number {
  switch (mode) {
    case "open":
      return MONITOR_CC_MODE.OPEN;
    case "rd":
      return MONITOR_CC_MODE.RD;
    case "ra":
      return MONITOR_CC_MODE.RA;
    case "rp":
      return MONITOR_CC_MODE.RP;
  }
}

function activeCCModeToByte(mode: MonitorActiveCCMode): number {
  switch (mode) {
    case "auto":
      return 0;
    case "cc1":
      return 1;
    case "cc2":
      return 2;
  }
}

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

export function isUfcsMonitorEvent(eventType: number): boolean {
  return eventType === MONITOR_EVENT.UFCS_DP || eventType === MONITOR_EVENT.UFCS_DM;
}

export function monitorEventName(eventType: number): string {
  switch (eventType) {
    case MONITOR_EVENT.DISCONNECT:
      return "DISCONNECT";
    case MONITOR_EVENT.CC1_CONNECT:
      return "CC1_CONNECT";
    case MONITOR_EVENT.CC2_CONNECT:
      return "CC2_CONNECT";
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
    case MONITOR_EVENT.UFCS_DP:
      return "UFCS_DP";
    case MONITOR_EVENT.UFCS_DM:
      return "UFCS_DM";
    default:
      return `EVENT_${eventType}`;
  }
}

export function monitorEventToCaptureEvent(eventType: number): CaptureEventType | null {
  switch (eventType) {
    case MONITOR_EVENT.DISCONNECT:
      return CAPTURE_EVENT.DISCONNECT;
    case MONITOR_EVENT.CC1_CONNECT:
      return CAPTURE_EVENT.CC1_CONNECT;
    case MONITOR_EVENT.CC2_CONNECT:
      return CAPTURE_EVENT.CC2_CONNECT;
    case MONITOR_EVENT.PD_SOP0:
      return CAPTURE_EVENT.PD_SOP0;
    case MONITOR_EVENT.PD_SOP1:
      return CAPTURE_EVENT.PD_SOP1;
    case MONITOR_EVENT.PD_SOP2:
      return CAPTURE_EVENT.PD_SOP2;
    case MONITOR_EVENT.PD_SOP1_DEBUG:
      return CAPTURE_EVENT.PD_SOP1_DEBUG;
    case MONITOR_EVENT.PD_SOP2_DEBUG:
      return CAPTURE_EVENT.PD_SOP2_DEBUG;
    case MONITOR_EVENT.HARD_RESET:
      return CAPTURE_EVENT.PD_HARD_RESET;
    case MONITOR_EVENT.CABLE_RESET:
      return CAPTURE_EVENT.PD_CABLE_RESET;
    case MONITOR_EVENT.UFCS_DP:
      return CAPTURE_EVENT.UFCS_DP;
    case MONITOR_EVENT.UFCS_DM:
      return CAPTURE_EVENT.UFCS_DM;
    default:
      return null;
  }
}

export function isPdMonitorEvent(eventType: number): boolean {
  return isPdSopFrameEvent(eventType) || isPdResetOrErrorEvent(eventType);
}

export function monitorEventSop(eventType: number): MonitorPdSop {
  switch (eventType) {
    case MONITOR_EVENT.PD_SOP0:
      return "SOP";
    case MONITOR_EVENT.PD_SOP1:
      return "SOP_PRIME";
    case MONITOR_EVENT.PD_SOP1_DEBUG:
      return "SOP_PRIME_DEBUG";
    case MONITOR_EVENT.PD_SOP2:
      return "SOP_DPRIME";
    case MONITOR_EVENT.PD_SOP2_DEBUG:
      return "SOP_DPRIME_DEBUG";
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

export function parseNativeMonitorHidReportBody(body: Uint8Array): NativeMonitorHidReport {
  if (body.length !== NATIVE_HID_REPORT_BODY_SIZE) {
    throw new Error(
      `Unexpected native HID input report length ${body.length}; expected ${NATIVE_HID_REPORT_BODY_SIZE}.`
    );
  }

  const reportType = body[0] ?? 0;
  const timestampUsLo = getU32LE(body, 4);
  const timestampUsHi = getU32LE(body, 8);
  const timestampUs = (BigInt(timestampUsHi) << 32n) | BigInt(timestampUsLo);
  const snapshot = {
    vbusMv: getU16LE(body, 16),
    ibusUa: getI32LE(body, 18),
    cc1Mv: getU16LE(body, 22),
    cc2Mv: getU16LE(body, 24),
    dpMv: getU16LE(body, 26),
    dmMv: getU16LE(body, 28)
  };

  if (reportType === NATIVE_HID_REPORT_TYPE.EVENT) {
    const payloadLen = Math.min(body[2] ?? 0, NATIVE_MONITOR_PAYLOAD_MAX_LEN);
    return {
      reportType,
      timestampUs: Number(timestampUs),
      recvCount: getU32LE(body, 12),
      snapshot,
      eventType: body[1] ?? 0,
      activeCC: body[3] ?? 0,
      payloadLen,
      payload: body.slice(30, 30 + payloadLen)
    };
  }

  if (reportType === NATIVE_HID_REPORT_TYPE.STATUS) {
    return {
      reportType,
      statusType: body[1] ?? 0,
      timestampUs: Number(timestampUs),
      recvCount: getU32LE(body, 12),
      snapshot,
      activeCC: body[3] ?? 0,
      payloadLen: body[2] ?? 0,
      dropCount: getU32LE(body, 30),
    };
  }

  throw new Error(`Unexpected native HID report type ${reportType}.`);
}

export function encodeNativeMonitorCommandPayload(command: NativeMonitorTxCommand): Uint8Array {
  const payload = command.payload ?? new Uint8Array(0);

  switch (command.opcode) {
    case MONITOR_TX_CMD.SEND_RAW_SOP0:
    case MONITOR_TX_CMD.SEND_RAW_SOP1:
    case MONITOR_TX_CMD.SEND_RAW_SOP2:
      if (payload.length < NATIVE_PD_TX_MESSAGE_MIN_LEN || payload.length > NATIVE_PD_TX_MESSAGE_MAX_LEN) {
        throw new Error(`Raw PD TX payload length must be ${NATIVE_PD_TX_MESSAGE_MIN_LEN}..${NATIVE_PD_TX_MESSAGE_MAX_LEN} bytes without CRC, got ${payload.length}.`);
      }
      return Uint8Array.from([command.opcode, ...payload]);
    case MONITOR_TX_CMD.SEND_HARD_RESET:
    case MONITOR_TX_CMD.SEND_CABLE_RESET:
    case MONITOR_TX_CMD.GET_STATUS:
      if (payload.length !== 0) {
        throw new Error(`Command payload length must be 0 bytes, got ${payload.length}.`);
      }
      return Uint8Array.from([command.opcode]);
    case MONITOR_TX_CMD.SET_CC_MODE:
      if (payload.length !== 0) {
        throw new Error(`CC mode command payload must be encoded from activeCC/cc1/cc2, got ${payload.length} raw bytes.`);
      }
      return Uint8Array.from([
        command.opcode,
        activeCCModeToByte(command.activeCC),
        ccModeToByte(command.cc1),
        ccModeToByte(command.cc2)
      ]);
  }

  throw new Error("Unsupported native monitor TX command.");
}

export function encodeNativeMonitorTxCommandBody(command: NativeMonitorTxCommand): Uint8Array {
  const body = new Uint8Array(NATIVE_HID_REPORT_BODY_SIZE);
  const commandPayload = encodeNativeMonitorCommandPayload(command);
  const payloadLen = commandPayload.length - 1;

  if (payloadLen > NATIVE_TX_PAYLOAD_MAX_LEN) {
    throw new Error(`Native HID command payload is too long: ${payloadLen} bytes.`);
  }

  body[0] = commandPayload[0] ?? 0;
  body[1] = payloadLen;
  body.set(commandPayload.subarray(1), 2);
  return body;
}

export function toPdObservedFrameFromMonitorEvent(
  input: MonitorFrameInput
): MonitorPdFrame | null {
  if (!isPdSopFrameEvent(input.eventType)) {
    return null;
  }

  return {
    sop: monitorEventSop(input.eventType),
    bytes: normalizePdPayloadForMonitorEvent(input.eventType, input.payload)
  };
}
