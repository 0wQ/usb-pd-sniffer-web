import { afterEach, describe, expect, test, vi } from "vitest";
import { MONITOR_EVENT } from "@usb-pd-sniffer/pd-device-native-hid";
import { createNativeCdcMonitorDevice } from "./device.js";
import {
  encodeNativeCdcFrame,
  NATIVE_CDC_EVENT_HEADER_SIZE,
  NATIVE_CDC_FRAME_TYPE_EVENT,
  NATIVE_CDC_USB,
} from "./protocol.js";

class FakeSerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable = new WritableStream<Uint8Array>();
  readonly connected: boolean;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  signals: Array<{ dataTerminalReady?: boolean; requestToSend?: boolean }> = [];
  openOptions: unknown[] = [];
  openCalls = 0;
  closeCalls = 0;

  constructor(
    private readonly options: {
      cancelPromise?: Promise<void>;
      closePromise?: Promise<void>;
      connected?: boolean;
      openPromise?: Promise<void>;
      setSignalsPromise?: Promise<void>;
    } = {},
  ) {
    super();
    this.connected = options.connected ?? true;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => options.cancelPromise,
    });
  }

  getInfo(): { usbVendorId: number; usbProductId: number } {
    return {
      usbVendorId: NATIVE_CDC_USB.vendorId,
      usbProductId: NATIVE_CDC_USB.productId,
    };
  }

  async open(options: unknown): Promise<void> {
    this.openCalls += 1;
    this.openOptions.push(options);
    await this.options.openPromise;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    await this.options.closePromise;
  }

  async setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    this.signals.push(signals);
    await this.options.setSignalsPromise;
  }

  enqueue(chunk: Uint8Array): void {
    this.controller?.enqueue(chunk);
  }
}

type SerialEvent = Event & {
  readonly port?: FakeSerialPort;
};

type SerialListener = (event: SerialEvent) => void;

class FakeSerial {
  ports: FakeSerialPort[] = [];
  readonly listeners = {
    connect: new Set<SerialListener>(),
    disconnect: new Set<SerialListener>(),
  };

  async getPorts(): Promise<FakeSerialPort[]> {
    return this.ports;
  }

  async requestPort(): Promise<FakeSerialPort> {
    const selected = this.ports[0];
    if (selected === undefined) {
      throw new DOMException("No port selected.", "NotFoundError");
    }
    return selected;
  }

  addEventListener(type: "connect" | "disconnect", listener: SerialListener): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: "connect" | "disconnect", listener: SerialListener): void {
    this.listeners[type].delete(listener);
  }

  dispatchConnect(port?: FakeSerialPort): void {
    for (const listener of this.listeners.connect) {
      listener({ port, target: port ?? null } as SerialEvent);
    }
  }

  dispatchDisconnect(port?: FakeSerialPort): void {
    for (const listener of this.listeners.disconnect) {
      listener({ port, target: port ?? null } as SerialEvent);
    }
  }
}

describe("native CDC monitor device", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("opens an authorized port for page-load reconnect", async () => {
    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const connectedStatuses: boolean[] = [];
    const offStatus = device.onStatus((status) => {
      connectedStatuses.push(status.isConnected);
    });

    const port = new FakeSerialPort();
    serial.ports = [port];
    await device.connectAuthorized();

    expect(port.openCalls).toBe(1);
    expect(port.openOptions).toEqual([{ baudRate: NATIVE_CDC_USB.baudRate, bufferSize: 1 << 20 }]);
    expect(connectedStatuses.at(-1)).toBe(true);

    offStatus();
    await device.disconnect();
    device.dispose();
  });

  test("uses the hotplug event port before it appears in getPorts", async () => {
    vi.useFakeTimers();

    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const connectedStatuses: boolean[] = [];
    const offStatus = device.onStatus((status) => {
      connectedStatuses.push(status.isConnected);
    });

    const port = new FakeSerialPort();
    device.setAutoReconnect(true);
    serial.dispatchConnect(port);
    await vi.advanceTimersByTimeAsync(300);

    expect(port.openCalls).toBe(1);
    expect(connectedStatuses.at(-1)).toBe(true);

    offStatus();
    await device.disconnect();
    device.dispose();
  });

  test("lowers DTR and closes the port on disconnect", async () => {
    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const port = new FakeSerialPort();
    serial.ports = [port];

    await device.connectAuthorized();
    await device.disconnect();

    expect(port.signals).toEqual([
      { dataTerminalReady: true },
      { dataTerminalReady: false },
    ]);
    expect(port.closeCalls).toBe(1);

    device.dispose();
  });

  test("does not stay connecting when opening a port hangs", async () => {
    vi.useFakeTimers();

    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const statuses: Array<{ isConnected: boolean; isConnecting: boolean; error: string | null }> = [];
    const offStatus = device.onStatus((status) => {
      statuses.push({
        isConnected: status.isConnected,
        isConnecting: status.isConnecting,
        error: status.error,
      });
    });

    serial.ports = [new FakeSerialPort({ openPromise: new Promise(() => undefined) })];
    const connectPromise = expect(device.connectAuthorized()).rejects.toThrow("Timed out opening native CDC serial port.");
    await vi.advanceTimersByTimeAsync(10000);
    await connectPromise;

    expect(statuses.at(-1)).toEqual({
      isConnected: false,
      isConnecting: false,
      error: "Timed out opening native CDC serial port.",
    });

    offStatus();
    device.dispose();
  });

  test("does not stay connecting when asserting DTR hangs", async () => {
    vi.useFakeTimers();

    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const statuses: Array<{ isConnected: boolean; isConnecting: boolean; error: string | null }> = [];
    const offStatus = device.onStatus((status) => {
      statuses.push({
        isConnected: status.isConnected,
        isConnecting: status.isConnecting,
        error: status.error,
      });
    });

    const port = new FakeSerialPort({ setSignalsPromise: new Promise(() => undefined) });
    serial.ports = [port];
    const connectPromise = expect(device.connectAuthorized()).rejects.toThrow("Timed out asserting native CDC DTR.");
    await vi.advanceTimersByTimeAsync(1500);
    await connectPromise;

    expect(port.closeCalls).toBe(1);
    expect(statuses.at(-1)).toEqual({
      isConnected: false,
      isConnecting: false,
      error: "Timed out asserting native CDC DTR.",
    });

    offStatus();
    device.dispose();
  });

  test("coalesces repeated hotplug events into one open attempt", async () => {
    vi.useFakeTimers();

    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const port = new FakeSerialPort();

    device.setAutoReconnect(true);
    serial.dispatchConnect(port);
    serial.dispatchConnect(port);
    serial.dispatchConnect(port);
    await vi.advanceTimersByTimeAsync(300);

    expect(port.openCalls).toBe(1);

    await device.disconnect();
    device.dispose();
  });

  test("ignores disconnected hotplug event ports", async () => {
    vi.useFakeTimers();

    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const port = new FakeSerialPort({ connected: false });

    device.setAutoReconnect(true);
    serial.dispatchConnect(port);
    await vi.advanceTimersByTimeAsync(300);

    expect(port.openCalls).toBe(0);

    device.dispose();
  });

  test("starts a new read loop after quick unplug and replug", async () => {
    vi.useFakeTimers();

    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const records: unknown[] = [];
    const offRecord = device.onRecord((record) => {
      records.push(record);
    });
    device.setAutoReconnect(true);

    const firstPort = new FakeSerialPort();
    serial.ports = [firstPort];
    await device.connectAuthorized();

    serial.ports = [];
    serial.dispatchDisconnect(firstPort);

    const secondPort = new FakeSerialPort();
    serial.ports = [secondPort];
    serial.dispatchConnect(secondPort);
    await vi.advanceTimersByTimeAsync(300);

    const payload = new Uint8Array(NATIVE_CDC_EVENT_HEADER_SIZE + 2);
    payload[26] = MONITOR_EVENT.PD_SOP0;
    payload.set([0x42, 0x10], NATIVE_CDC_EVENT_HEADER_SIZE);
    secondPort.enqueue(encodeNativeCdcFrame(NATIVE_CDC_FRAME_TYPE_EVENT, payload));
    await Promise.resolve();
    await Promise.resolve();

    expect(secondPort.openCalls).toBe(1);
    expect(records).toHaveLength(1);

    offRecord();
    await device.disconnect();
    device.dispose();
  });

  test("does not get stuck connecting when the removed port read loop hangs", async () => {
    vi.useFakeTimers();

    const serial = new FakeSerial();
    vi.stubGlobal("navigator", { serial });

    const device = createNativeCdcMonitorDevice();
    const statuses: Array<{ isConnected: boolean; isConnecting: boolean }> = [];
    const offStatus = device.onStatus((status) => {
      statuses.push({
        isConnected: status.isConnected,
        isConnecting: status.isConnecting,
      });
    });
    device.setAutoReconnect(true);

    const firstPort = new FakeSerialPort({ cancelPromise: new Promise(() => undefined) });
    serial.ports = [firstPort];
    await device.connectAuthorized();

    serial.ports = [];
    serial.dispatchDisconnect(firstPort);

    const secondPort = new FakeSerialPort();
    serial.ports = [secondPort];
    serial.dispatchConnect(secondPort);
    await vi.advanceTimersByTimeAsync(300);

    expect(secondPort.openCalls).toBe(1);
    expect(statuses.at(-1)).toEqual({
      isConnected: true,
      isConnecting: false,
    });

    offStatus();
    await device.disconnect();
    device.dispose();
  });
});
