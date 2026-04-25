export type MonitorRecord = {
  timestamp_us: number;
  recv_counter: number;
  drop_count?: number;
  vbus_mv: number;
  ibus_ma: number;
  cc1_mv: number;
  cc2_mv: number;
  dp_mv: number;
  dm_mv: number;
  event_type: number;
  active_cc: number;
  data_len: number;
  data: number[];
};

export type MonitorPowerSample = {
  timestamp_us: number;
  recv_counter: number;
  vbus_mv: number;
  ibus_ma: number;
  cc1_mv: number;
  cc2_mv: number;
  dp_mv: number;
  dm_mv: number;
  active_cc: number;
  event_type: number;
};

export type MonitorDeviceStatus = {
  readonly isSupported: boolean;
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly isSending: boolean;
  readonly error: string | null;
  readonly productName: string | null;
  readonly fingerprint: string | null;
};

export type MonitorPdTxTarget = "SOP" | "SOP_PRIME" | "SOP_DPRIME";

export type MonitorDevice = {
  readonly isSupported: boolean;
  connect(): Promise<void>;
  connectAuthorized(preferredFingerprint?: string | null): Promise<void>;
  disconnect(): Promise<void>;
  setAutoReconnect(enabled: boolean, preferredFingerprint?: string | null): void;
  dispose(): void;
  sendRawPd(target: MonitorPdTxTarget, payload: Uint8Array): Promise<void>;
  sendHardReset(): Promise<void>;
  sendCableReset(): Promise<void>;
  onRecord(listener: (record: MonitorRecord) => void): () => void;
  onPowerSample(listener: (sample: MonitorPowerSample) => void): () => void;
  onStatus(listener: (status: MonitorDeviceStatus) => void): () => void;
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
  UFCS_DM_CHUNK1: 45,
} as const;
