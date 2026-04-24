import {
  encodeNativeMonitorTxCommandBody,
  isPdMonitorEvent,
  MONITOR_EVENT,
  MONITOR_TX_CMD,
  NATIVE_HID_REPORT_BODY_SIZE,
  NATIVE_HID_REPORT_ID,
  parseNativeMonitorHidReportBody,
  type NativeMonitorTxCommand,
} from "./monitorAdapter.js";

const DEVICE_FILTER = { vendorId: 0x1a86, productId: 0x2333 } as const;

type HidDeviceLike = {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  addEventListener(type: "inputreport", listener: (event: HidInputReportEventLike) => void): void;
  removeEventListener(type: "inputreport", listener: (event: HidInputReportEventLike) => void): void;
};

type HidInputReportEventLike = {
  readonly reportId: number;
  readonly data: DataView;
};

type HidConnectionEventLike = {
  readonly device: HidDeviceLike;
};

type HidLike = {
  getDevices(): Promise<HidDeviceLike[]>;
  requestDevice(options: { filters: Array<typeof DEVICE_FILTER> }): Promise<HidDeviceLike[]>;
  addEventListener(type: "connect", listener: (event: HidConnectionEventLike) => void): void;
  addEventListener(type: "disconnect", listener: (event: HidConnectionEventLike) => void): void;
  removeEventListener(type: "connect", listener: (event: HidConnectionEventLike) => void): void;
  removeEventListener(type: "disconnect", listener: (event: HidConnectionEventLike) => void): void;
};

type NavigatorWithHid = {
  readonly hid?: HidLike;
};

type UfcsDirection = "dp" | "dm";

type PendingUfcsChunks = {
  dp: MonitorRecord | null;
  dm: MonitorRecord | null;
};

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

export type MonitorPdTxTarget = "SOP" | "SOP_PRIME" | "SOP_DPRIME";

export type MonitorRecordNormalizer = {
  push(record: MonitorRecord): MonitorRecord[];
  reset(): void;
};

export function parsePdHexPayload(input: string): Uint8Array {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Raw PD payload is required.");
  }

  const compact = trimmed
    .replace(/0x/gi, "")
    .replace(/[\s,_-]+/g, "");

  if (compact.length === 0) {
    throw new Error("Raw PD payload is required.");
  }

  if (compact.length % 2 !== 0) {
    throw new Error(`Raw PD payload hex length must be even, got ${compact.length}.`);
  }

  if (!/^[0-9a-f]+$/i.test(compact)) {
    throw new Error("Raw PD payload contains non-hex characters.");
  }

  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < compact.length; index += 2) {
    bytes[index / 2] = Number.parseInt(compact.slice(index, index + 2), 16);
  }

  return bytes;
}

function getHid(): HidLike | null {
  const navigatorLike = (globalThis as unknown as { navigator?: NavigatorWithHid }).navigator;
  return navigatorLike?.hid ?? null;
}

function copyDataViewBytes(data: DataView): Uint8Array {
  return Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function deviceFingerprint(device: HidDeviceLike): string {
  return `${device.vendorId}:${device.productId}:${device.productName ?? ""}`;
}

function matchesTargetDevice(device: HidDeviceLike): boolean {
  return device.vendorId === DEVICE_FILTER.vendorId && device.productId === DEVICE_FILTER.productId;
}

function pickPreferredDevice(devices: readonly HidDeviceLike[], preferredFingerprint?: string | null): HidDeviceLike | null {
  const candidates = devices.filter(matchesTargetDevice);
  if (candidates.length === 0) return null;

  if (preferredFingerprint) {
    const preferred = candidates.find((device) => deviceFingerprint(device) === preferredFingerprint);
    if (preferred) return preferred;
  }

  return candidates[0] ?? null;
}

function opcodeForTarget(target: MonitorPdTxTarget): typeof MONITOR_TX_CMD.SEND_RAW_SOP0 | typeof MONITOR_TX_CMD.SEND_RAW_SOP1 | typeof MONITOR_TX_CMD.SEND_RAW_SOP2 {
  switch (target) {
    case "SOP":
      return MONITOR_TX_CMD.SEND_RAW_SOP0;
    case "SOP_PRIME":
      return MONITOR_TX_CMD.SEND_RAW_SOP1;
    case "SOP_DPRIME":
      return MONITOR_TX_CMD.SEND_RAW_SOP2;
  }
}

function normalizeReportBody(reportId: number, data: DataView): Uint8Array {
  const bytes = copyDataViewBytes(data);

  if (reportId !== NATIVE_HID_REPORT_ID) {
    throw new Error(`Unexpected HID input report ID ${reportId}; expected ${NATIVE_HID_REPORT_ID}.`);
  }

  if (bytes.length !== NATIVE_HID_REPORT_BODY_SIZE) {
    throw new Error(`Unexpected HID input report length ${bytes.length}; expected ${NATIVE_HID_REPORT_BODY_SIZE}.`);
  }

  return bytes;
}

function reportToRecord(reportId: number, data: DataView): MonitorRecord {
  const report = parseNativeMonitorHidReportBody(normalizeReportBody(reportId, data));

  return {
    timestamp_us: report.timestampUs,
    recv_counter: report.recvCount,
    vbus_mv: report.snapshot.vbusMv,
    ibus_ma: report.snapshot.ibusMa,
    cc1_mv: report.snapshot.cc1Mv,
    cc2_mv: report.snapshot.cc2Mv,
    dp_mv: report.snapshot.dpMv,
    dm_mv: report.snapshot.dmMv,
    event_type: report.eventType,
    active_cc: report.activeCc,
    data_len: report.payloadLen,
    data: Array.from(report.payload),
  };
}

function recordToPowerSample(record: MonitorRecord): MonitorPowerSample {
  return {
    timestamp_us: record.timestamp_us,
    recv_counter: record.recv_counter,
    vbus_mv: record.vbus_mv,
    ibus_ma: record.ibus_ma,
    cc1_mv: record.cc1_mv,
    cc2_mv: record.cc2_mv,
    dp_mv: record.dp_mv,
    dm_mv: record.dm_mv,
    active_cc: record.active_cc,
    event_type: record.event_type,
  };
}

function ufcsSingleEventType(eventType: number): number | null {
  switch (eventType) {
    case MONITOR_EVENT.UFCS_DP_SINGLE:
    case MONITOR_EVENT.UFCS_DM_SINGLE:
      return eventType;
    default:
      return null;
  }
}

function ufcsChunk0Direction(eventType: number): UfcsDirection | null {
  switch (eventType) {
    case MONITOR_EVENT.UFCS_DP_CHUNK0:
      return "dp";
    case MONITOR_EVENT.UFCS_DM_CHUNK0:
      return "dm";
    default:
      return null;
  }
}

function ufcsChunk1Direction(eventType: number): UfcsDirection | null {
  switch (eventType) {
    case MONITOR_EVENT.UFCS_DP_CHUNK1:
      return "dp";
    case MONITOR_EVENT.UFCS_DM_CHUNK1:
      return "dm";
    default:
      return null;
  }
}

function ufcsAssembledEventType(direction: UfcsDirection): number {
  return direction === "dp" ? MONITOR_EVENT.UFCS_DP_SINGLE : MONITOR_EVENT.UFCS_DM_SINGLE;
}

function cloneRecord(record: MonitorRecord): MonitorRecord {
  return {
    ...record,
    data: record.data.slice(0, record.data_len),
  };
}

function assembleUfcsRecord(chunk0: MonitorRecord, chunk1: MonitorRecord, direction: UfcsDirection): MonitorRecord {
  const data = [
    ...chunk0.data.slice(0, chunk0.data_len),
    ...chunk1.data.slice(0, chunk1.data_len),
  ];

  return {
    ...chunk0,
    event_type: ufcsAssembledEventType(direction),
    data_len: data.length,
    data: data,
  };
}

function pendingChunkAsSingle(chunk0: MonitorRecord, direction: UfcsDirection): MonitorRecord {
  return {
    ...cloneRecord(chunk0),
    event_type: ufcsAssembledEventType(direction),
  };
}

export function createMonitorRecordNormalizer(): MonitorRecordNormalizer {
  const pending: PendingUfcsChunks = {
    dp: null,
    dm: null,
  };

  return {
    push(record: MonitorRecord): MonitorRecord[] {
      const singleEventType = ufcsSingleEventType(record.event_type);
      if (singleEventType !== null) {
        const direction: UfcsDirection = singleEventType === MONITOR_EVENT.UFCS_DP_SINGLE ? "dp" : "dm";
        const previous = pending[direction];
        pending[direction] = null;
        return previous === null
          ? [record]
          : [pendingChunkAsSingle(previous, direction), record];
      }

      const chunk0Direction = ufcsChunk0Direction(record.event_type);
      if (chunk0Direction !== null) {
        const previous = pending[chunk0Direction];
        pending[chunk0Direction] = cloneRecord(record);
        return previous === null ? [] : [pendingChunkAsSingle(previous, chunk0Direction)];
      }

      const chunk1Direction = ufcsChunk1Direction(record.event_type);
      if (chunk1Direction !== null) {
        const chunk0 = pending[chunk1Direction];
        pending[chunk1Direction] = null;
        if (chunk0 === null) {
          return [];
        }

        if (chunk0.recv_counter !== record.recv_counter) {
          return [pendingChunkAsSingle(chunk0, chunk1Direction)];
        }

        return [assembleUfcsRecord(chunk0, record, chunk1Direction)];
      }

      return isPdMonitorEvent(record.event_type) ? [record] : [];
    },
    reset(): void {
      pending.dp = null;
      pending.dm = null;
    },
  };
}

export function createMonitorDevice(): MonitorDevice {
  const hid = getHid();
  const recordListeners = new Set<(record: MonitorRecord) => void>();
  const powerListeners = new Set<(sample: MonitorPowerSample) => void>();
  const statusListeners = new Set<(status: MonitorDeviceStatus) => void>();
  const recordNormalizer = createMonitorRecordNormalizer();

  let device: HidDeviceLike | null = null;
  let isConnecting = false;
  let isPrompting = false;
  let isSending = false;
  let error: string | null = hid === null ? "WebHID is not supported. Please use Chrome, Edge, or Opera." : null;
  let autoReconnect = false;
  let autoReconnectFingerprint: string | null = null;
  let disposed = false;

  const status = (): MonitorDeviceStatus => ({
    isSupported: hid !== null,
    isConnected: device?.opened ?? false,
    isConnecting,
    isSending,
    error,
    productName: device?.productName ?? null,
    fingerprint: device === null ? null : deviceFingerprint(device),
  });

  const emitStatus = () => {
    const current = status();
    for (const listener of statusListeners) listener(current);
  };

  const emitRecord = (record: MonitorRecord): void => {
    for (const listener of recordListeners) listener(record);
  };

  const processRecord = (record: MonitorRecord): void => {
    for (const normalizedRecord of recordNormalizer.push(record)) {
      emitRecord(normalizedRecord);
    }
  };

  const handleInputReport = (event: HidInputReportEventLike): void => {
    try {
      const record = reportToRecord(event.reportId, event.data);
      if (record.event_type === MONITOR_EVENT.POWER_TELEMETRY) {
        const sample = recordToPowerSample(record);
        for (const listener of powerListeners) listener(sample);
        return;
      }

      processRecord(record);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Failed to parse HID input report.";
      emitStatus();
    }
  };

  const setupDevice = async (nextDevice: HidDeviceLike): Promise<void> => {
    if (disposed) return;

    if (nextDevice.opened) {
      device = nextDevice;
      error = null;
      nextDevice.addEventListener("inputreport", handleInputReport);
      emitStatus();
      return;
    }

    if (isConnecting) return;

    try {
      isConnecting = true;
      emitStatus();
      await nextDevice.open();
      device = nextDevice;
      error = null;
      nextDevice.addEventListener("inputreport", handleInputReport);
    } catch (caught) {
      device = null;
      error = caught instanceof Error ? caught.message : "Failed to open HID device.";
      throw caught;
    } finally {
      isConnecting = false;
      emitStatus();
    }
  };

  const connectAuthorized = async (preferredFingerprint?: string | null): Promise<void> => {
    if (hid === null || disposed || device?.opened || isPrompting || isConnecting) return;

    const devices = await hid.getDevices();
    const preferred = pickPreferredDevice(devices, preferredFingerprint ?? autoReconnectFingerprint);
    if (preferred === null) return;
    await setupDevice(preferred);
  };

  const handleConnect = (): void => {
    if (!autoReconnect || disposed) return;
    void connectAuthorized(autoReconnectFingerprint).catch((caught) => {
      error = caught instanceof Error ? caught.message : "Auto reconnect failed.";
      emitStatus();
    });
  };

  const handleDisconnect = (event: HidConnectionEventLike): void => {
    const current = device;
    if (current === null) return;

    const isCurrentDevice = event.device === current || deviceFingerprint(event.device) === deviceFingerprint(current);
    if (!isCurrentDevice) return;

    current.removeEventListener("inputreport", handleInputReport);
    recordNormalizer.reset();
    device = null;
    emitStatus();
  };

  if (hid !== null) {
    hid.addEventListener("connect", handleConnect);
    hid.addEventListener("disconnect", handleDisconnect);
  }

  const sendCommand = async (command: NativeMonitorTxCommand): Promise<void> => {
    if (device === null || !device.opened) {
      throw new Error("No HID device connected.");
    }
    if (isSending) {
      throw new Error("A TX command is already in flight.");
    }

    try {
      isSending = true;
      emitStatus();
      const body = encodeNativeMonitorTxCommandBody(command);
      await device.sendReport(NATIVE_HID_REPORT_ID, new Uint8Array(body));
    } finally {
      isSending = false;
      emitStatus();
    }
  };

  return {
    get isSupported() {
      return hid !== null;
    },
    async connect(): Promise<void> {
      if (hid === null) {
        throw new Error("WebHID is not supported. Please use Chrome, Edge, or Opera.");
      }
      if (disposed || isConnecting || isPrompting) return;

      try {
        isPrompting = true;
        isConnecting = true;
        emitStatus();
        const devices = await hid.requestDevice({ filters: [DEVICE_FILTER] });
        const selected = devices[0] ?? null;
        if (selected === null) return;
        isConnecting = false;
        await setupDevice(selected);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "NotFoundError") {
          error = null;
          throw caught;
        }

        error = caught instanceof Error ? caught.message : "Failed to connect HID device.";
        throw caught;
      } finally {
        isPrompting = false;
        isConnecting = false;
        emitStatus();
      }
    },
    connectAuthorized,
    async disconnect(): Promise<void> {
      if (device === null) {
        emitStatus();
        return;
      }

      const current = device;
      try {
        current.removeEventListener("inputreport", handleInputReport);
        if (current.opened) {
          await current.close();
        }
      } finally {
        recordNormalizer.reset();
        device = null;
        emitStatus();
      }
    },
    setAutoReconnect(enabled: boolean, preferredFingerprint?: string | null): void {
      autoReconnect = enabled;
      autoReconnectFingerprint = preferredFingerprint ?? null;
    },
    dispose(): void {
      disposed = true;
      if (hid !== null) {
        hid.removeEventListener("connect", handleConnect);
        hid.removeEventListener("disconnect", handleDisconnect);
      }
      if (device !== null) {
        device.removeEventListener("inputreport", handleInputReport);
      }
      recordNormalizer.reset();
      device = null;
      emitStatus();
    },
    async sendRawPd(target: MonitorPdTxTarget, payload: Uint8Array): Promise<void> {
      await sendCommand({ opcode: opcodeForTarget(target), payload });
    },
    async sendHardReset(): Promise<void> {
      await sendCommand({ opcode: MONITOR_TX_CMD.SEND_HARD_RESET });
    },
    async sendCableReset(): Promise<void> {
      await sendCommand({ opcode: MONITOR_TX_CMD.SEND_CABLE_RESET });
    },
    onRecord(listener: (record: MonitorRecord) => void): () => void {
      recordListeners.add(listener);
      return () => recordListeners.delete(listener);
    },
    onPowerSample(listener: (sample: MonitorPowerSample) => void): () => void {
      powerListeners.add(listener);
      return () => powerListeners.delete(listener);
    },
    onStatus(listener: (status: MonitorDeviceStatus) => void): () => void {
      statusListeners.add(listener);
      listener(status());
      return () => statusListeners.delete(listener);
    },
  };
}
