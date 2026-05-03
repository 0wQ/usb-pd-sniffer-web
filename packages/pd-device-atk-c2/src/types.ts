import type {
  CaptureDevice as BaseCaptureDevice,
  CaptureDeviceStats as BaseCaptureDeviceStats,
  CaptureDeviceStatus as BaseCaptureDeviceStatus,
  CaptureRecord as BaseCaptureRecord,
} from "@usb-pd-sniffer/pd-device-types";

export type MonitorRecord = BaseCaptureRecord;

export type MonitorDeviceStatus = BaseCaptureDeviceStatus;

export type MonitorPdTxTarget = "SOP" | "SOP_PRIME" | "SOP_DPRIME";

export type MonitorActiveCCMode = "auto" | "cc1" | "cc2";

export type MonitorCCMode = "open" | "rd" | "ra" | "rp";

export type MonitorCCModeConfig = {
  activeCC: MonitorActiveCCMode;
  cc1: MonitorCCMode;
  cc2: MonitorCCMode;
};

export type MonitorDevice = BaseCaptureDevice & {
  sendRawPd(target: MonitorPdTxTarget, payload: Uint8Array): Promise<void>;
  sendHardReset(): Promise<void>;
  sendCableReset(): Promise<void>;
  setCCMode(config: MonitorCCModeConfig): Promise<void>;
};

export type MonitorDeviceStats = BaseCaptureDeviceStats;
