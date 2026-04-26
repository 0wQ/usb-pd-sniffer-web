import {
  ATK_C2_CMD,
  ATK_C2_USB,
  AtkC2ProtocolDecoder,
  buildAtkC2SwitchCommand,
} from "./protocol.js";
import type {
  MonitorDevice,
  MonitorDeviceStatus,
  MonitorCCModeConfig,
  MonitorPdTxTarget,
  MonitorPowerSample,
  MonitorRecord,
} from "./types.js";

type UsbTransferStatus = "ok" | "stall" | "babble";

type UsbInTransferResultLike = {
  readonly data?: DataView;
  readonly status: UsbTransferStatus;
};

type UsbOutTransferResultLike = {
  readonly bytesWritten: number;
  readonly status: UsbTransferStatus;
};

type UsbConfigurationLike = {
  readonly configurationValue: number;
};

type UsbDeviceLike = {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly serialNumber?: string;
  readonly opened: boolean;
  readonly configuration: UsbConfigurationLike | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferIn(endpointNumber: number, length: number): Promise<UsbInTransferResultLike>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<UsbOutTransferResultLike>;
};

type UsbConnectionEventLike = {
  readonly device: UsbDeviceLike;
};

type UsbLike = {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(options: { filters: Array<{ vendorId: number; productId: number }> }): Promise<UsbDeviceLike>;
  addEventListener(type: "connect", listener: (event: UsbConnectionEventLike) => void): void;
  addEventListener(type: "disconnect", listener: (event: UsbConnectionEventLike) => void): void;
  removeEventListener(type: "connect", listener: (event: UsbConnectionEventLike) => void): void;
  removeEventListener(type: "disconnect", listener: (event: UsbConnectionEventLike) => void): void;
};

type NavigatorWithUsb = {
  readonly usb?: UsbLike;
};

export type AtkC2MonitorDeviceOptions = {
  readonly transferInLength?: number;
};

const DEVICE_FILTER = {
  vendorId: ATK_C2_USB.vendorId,
  productId: ATK_C2_USB.productId,
} as const;

const DEFAULT_TRANSFER_IN_LENGTH = 4096;

function getUsb(): UsbLike | null {
  const navigatorLike = (globalThis as unknown as { navigator?: NavigatorWithUsb }).navigator;
  return navigatorLike?.usb ?? null;
}

function copyDataViewBytes(data: DataView): Uint8Array {
  return Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function deviceFingerprint(device: UsbDeviceLike): string {
  return `${device.vendorId}:${device.productId}:${device.serialNumber ?? ""}:${device.productName ?? ""}`;
}

function matchesTargetDevice(device: UsbDeviceLike): boolean {
  return device.vendorId === ATK_C2_USB.vendorId && device.productId === ATK_C2_USB.productId;
}

function pickPreferredDevice(devices: readonly UsbDeviceLike[], preferredFingerprint?: string | null): UsbDeviceLike | null {
  const candidates = devices.filter(matchesTargetDevice);
  if (candidates.length === 0) return null;

  if (preferredFingerprint) {
    const preferred = candidates.find((device) => deviceFingerprint(device) === preferredFingerprint);
    if (preferred) return preferred;
  }

  return candidates[0] ?? null;
}

async function ensureAtkC2Ready(device: UsbDeviceLike): Promise<void> {
  if (!device.opened) {
    await device.open();
  }

  if (device.configuration?.configurationValue !== ATK_C2_USB.configurationValue) {
    await device.selectConfiguration(ATK_C2_USB.configurationValue);
  }

  await device.claimInterface(ATK_C2_USB.interfaceNumber);
}

function unsupportedError(): string {
  return "WebUSB is not supported. Please use Chrome, Edge, or Opera.";
}

export function createAtkC2MonitorDevice(options: AtkC2MonitorDeviceOptions = {}): MonitorDevice {
  const usb = getUsb();
  const transferInLength = options.transferInLength ?? DEFAULT_TRANSFER_IN_LENGTH;
  const recordListeners = new Set<(record: MonitorRecord) => void>();
  const powerListeners = new Set<(sample: MonitorPowerSample) => void>();
  const statusListeners = new Set<(status: MonitorDeviceStatus) => void>();
  const decoder = new AtkC2ProtocolDecoder();

  let device: UsbDeviceLike | null = null;
  let isConnecting = false;
  let isPrompting = false;
  let isSending = false;
  let readLoopRunning = false;
  let shouldRead = false;
  let error: string | null = usb === null ? unsupportedError() : null;
  let autoReconnect = false;
  let autoReconnectFingerprint: string | null = null;
  let disposed = false;

  const status = (): MonitorDeviceStatus => ({
    isSupported: usb !== null,
    isConnected: device?.opened ?? false,
    isConnecting,
    isSending,
    error,
    productName: device?.productName ?? null,
    fingerprint: device === null ? null : deviceFingerprint(device),
  });

  const emitStatus = (): void => {
    const current = status();
    for (const listener of statusListeners) listener(current);
  };

  const emitRecord = (record: MonitorRecord): void => {
    for (const listener of recordListeners) listener(record);
  };

  const emitRecordsFromChunk = (chunk: Uint8Array): void => {
    for (const record of decoder.pushBytes(chunk)) {
      emitRecord(record);
    }
  };

  const transferOut = async (data: Uint8Array): Promise<void> => {
    if (device === null || !device.opened) {
      throw new Error("No ATK C2 device connected.");
    }

    const result = await device.transferOut(ATK_C2_USB.endpointOut, data);
    if (result.status !== "ok") {
      throw new Error(`ATK C2 bulk OUT failed: ${result.status}.`);
    }
  };

  const sendSwitch = async (cmd: number, enabled: boolean): Promise<void> => {
    await transferOut(buildAtkC2SwitchCommand(cmd, enabled));
  };

  const startReadLoop = (): void => {
    if (readLoopRunning || device === null) return;

    shouldRead = true;
    readLoopRunning = true;

    void (async () => {
      try {
        while (shouldRead && device !== null && device.opened) {
          const result = await device.transferIn(ATK_C2_USB.endpointIn, transferInLength);
          if (!shouldRead) break;

          if (result.status !== "ok") {
            throw new Error(`ATK C2 bulk IN failed: ${result.status}.`);
          }

          if (result.data !== undefined && result.data.byteLength > 0) {
            emitRecordsFromChunk(copyDataViewBytes(result.data));
          }
        }
      } catch (caught) {
        if (shouldRead && !disposed) {
          error = caught instanceof Error ? caught.message : "ATK C2 read loop failed.";
          emitStatus();
        }
      } finally {
        readLoopRunning = false;
      }
    })();
  };

  const setupDevice = async (nextDevice: UsbDeviceLike): Promise<void> => {
    if (disposed || isConnecting) return;

    try {
      isConnecting = true;
      emitStatus();
      await ensureAtkC2Ready(nextDevice);
      device = nextDevice;
      decoder.reset();
      error = null;
      await sendSwitch(ATK_C2_CMD.WAVEFORM_UPLOAD, true);
      await sendSwitch(ATK_C2_CMD.PROTOCOL_ANALYSIS, true);
      startReadLoop();
    } catch (caught) {
      device = null;
      error = caught instanceof Error ? caught.message : "Failed to open ATK C2 device.";
      throw caught;
    } finally {
      isConnecting = false;
      emitStatus();
    }
  };

  const connectAuthorized = async (preferredFingerprint?: string | null): Promise<void> => {
    if (usb === null || disposed || device?.opened || isPrompting || isConnecting) return;

    const devices = await usb.getDevices();
    const preferred = pickPreferredDevice(devices, preferredFingerprint ?? autoReconnectFingerprint);
    if (preferred === null) return;
    await setupDevice(preferred);
  };

  const handleConnect = (): void => {
    if (!autoReconnect || disposed) return;
    void connectAuthorized(autoReconnectFingerprint).catch((caught) => {
      error = caught instanceof Error ? caught.message : "ATK C2 auto reconnect failed.";
      emitStatus();
    });
  };

  const handleDisconnect = (event: UsbConnectionEventLike): void => {
    const current = device;
    if (current === null) return;

    const isCurrentDevice = event.device === current || deviceFingerprint(event.device) === deviceFingerprint(current);
    if (!isCurrentDevice) return;

    shouldRead = false;
    decoder.reset();
    device = null;
    emitStatus();
  };

  if (usb !== null) {
    usb.addEventListener("connect", handleConnect);
    usb.addEventListener("disconnect", handleDisconnect);
  }

  const shutdownCurrentDevice = async (): Promise<void> => {
    const current = device;
    shouldRead = false;

    if (current === null) {
      emitStatus();
      return;
    }

    try {
      if (current.opened) {
        try {
          await current.transferOut(
            ATK_C2_USB.endpointOut,
            buildAtkC2SwitchCommand(ATK_C2_CMD.PROTOCOL_ANALYSIS, false),
          );
          await current.transferOut(
            ATK_C2_USB.endpointOut,
            buildAtkC2SwitchCommand(ATK_C2_CMD.WAVEFORM_UPLOAD, false),
          );
        } catch {
          // Best-effort shutdown: closing the device is still the important cleanup.
        }

        try {
          await current.releaseInterface(ATK_C2_USB.interfaceNumber);
        } catch {
          // The interface may already be released after unplug or browser cleanup.
        }

        await current.close();
      }
    } finally {
      decoder.reset();
      device = null;
      emitStatus();
    }
  };

  return {
    get isSupported() {
      return usb !== null;
    },
    async connect(): Promise<void> {
      if (usb === null) {
        throw new Error(unsupportedError());
      }
      if (disposed || isConnecting || isPrompting) return;

      try {
        isPrompting = true;
        isConnecting = true;
        emitStatus();
        const selected = await usb.requestDevice({ filters: [DEVICE_FILTER] });
        isConnecting = false;
        await setupDevice(selected);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "NotFoundError") {
          error = null;
          throw caught;
        }

        error = caught instanceof Error ? caught.message : "Failed to connect ATK C2 device.";
        throw caught;
      } finally {
        isPrompting = false;
        isConnecting = false;
        emitStatus();
      }
    },
    connectAuthorized,
    async disconnect(): Promise<void> {
      await shutdownCurrentDevice();
    },
    setAutoReconnect(enabled: boolean, preferredFingerprint?: string | null): void {
      autoReconnect = enabled;
      autoReconnectFingerprint = preferredFingerprint ?? null;
    },
    dispose(): void {
      disposed = true;
      shouldRead = false;
      if (usb !== null) {
        usb.removeEventListener("connect", handleConnect);
        usb.removeEventListener("disconnect", handleDisconnect);
      }
      decoder.reset();
      device = null;
      emitStatus();
    },
    async sendRawPd(_target: MonitorPdTxTarget, _payload: Uint8Array): Promise<void> {
      throw new Error("ATK C2 WebUSB backend currently supports capture only; PD TX is not implemented.");
    },
    async sendHardReset(): Promise<void> {
      throw new Error("ATK C2 WebUSB backend currently supports capture only; hard reset TX is not implemented.");
    },
    async sendCableReset(): Promise<void> {
      throw new Error("ATK C2 WebUSB backend currently supports capture only; cable reset TX is not implemented.");
    },
    async setCCMode(_config: MonitorCCModeConfig): Promise<void> {
      throw new Error("ATK C2 WebUSB backend does not support CC mode control.");
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
