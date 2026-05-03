export const CAPTURE_EVENT = {
  DISCONNECT: "DISCONNECT",
  CC1_CONNECT: "CC1_CONNECT",
  CC2_CONNECT: "CC2_CONNECT",
  PD_SOP0: "PD_SOP0",
  PD_SOP1: "PD_SOP1",
  PD_SOP2: "PD_SOP2",
  PD_SOP1_DEBUG: "PD_SOP1_DEBUG",
  PD_SOP2_DEBUG: "PD_SOP2_DEBUG",
  PD_HARD_RESET: "PD_HARD_RESET",
  PD_CABLE_RESET: "PD_CABLE_RESET",
  UFCS_DP: "UFCS_DP",
  UFCS_DM: "UFCS_DM",
} as const;

export type CaptureEventType = typeof CAPTURE_EVENT[keyof typeof CAPTURE_EVENT];

export type CaptureRecord = {
  timestamp_us: number;
  seq: number;
  vbus_mv: number;
  ibus_ma: number;
  cc1_mv: number;
  cc2_mv: number;
  dp_mv: number;
  dm_mv: number;
  event_type: CaptureEventType;
  active_cc: number;
  data_len: number;
  data: number[];
};

export type CaptureDeviceStats = {
  recv_count: number;
  drop_count: number;
};

export type CaptureConnectionState = {
  readonly isSupported: boolean;
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly isSending: boolean;
  readonly error: string | null;
  readonly productName: string | null;
  readonly fingerprint: string | null;
};

export type CaptureDeviceStatus = CaptureConnectionState;

export type CaptureDeviceConnection = CaptureConnectionState & {
  connect(): Promise<void>;
  connectAuthorized(preferredFingerprint?: string | null): Promise<void>;
  disconnect(): Promise<void>;
  setAutoReconnect(enabled: boolean, preferredFingerprint?: string | null): void;
  dispose(): void;
};

export type CaptureRecordSource = {
  onRecord(listener: (record: CaptureRecord) => void): () => void;
};

export type CaptureStatusSource = {
  onStatus(listener: (status: CaptureConnectionState) => void): () => void;
};

export type CaptureStatsSource = {
  onStats(listener: (stats: CaptureDeviceStats) => void): () => void;
};

export type CaptureDevice =
  & CaptureDeviceConnection
  & CaptureRecordSource
  & CaptureStatusSource
  & CaptureStatsSource;
