import type { StartOfPacket } from "@usb-pd-sniffer/pd-core";
import { MONITOR_EVENT, type MonitorRecord } from "./types.js";

export const ATK_C2_USB = {
  vendorId: 0x2e88,
  productId: 0xc2c2,
  configurationValue: 1,
  interfaceNumber: 0,
  endpointOut: 1,
  endpointIn: 2,
} as const;

export const ATK_C2_CMD = {
  WAVEFORM_UPLOAD: 0x04,
  PROTOCOL_ANALYSIS: 0x0c,
  SAMPLE_BLOCK: 0x0d,
} as const;

const DEC4B5B = [
  0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x13, 0x14,
  0x10, 0x01, 0x04, 0x05, 0x10, 0x16, 0x06, 0x07,
  0x10, 0x12, 0x08, 0x09, 0x02, 0x03, 0x0a, 0x0b,
  0x11, 0x15, 0x0c, 0x0d, 0x0e, 0x0f, 0x00, 0x10,
] as const;

const SYM_ERR = 0x10;
const SYNC1 = 0x11;
const SYNC2 = 0x12;
const SYNC3 = 0x13;
const RST1 = 0x14;
const RST2 = 0x15;
const EOP = 0x16;

const SOP_MAP = new Map<string, StartOfPacket | "CABLE_RESET" | "HARD_RESET">([
  [[SYNC1, SYNC1, SYNC1, SYNC2].join(","), "SOP"],
  [[SYNC1, SYNC1, SYNC3, SYNC3].join(","), "SOP_PRIME"],
  [[SYNC1, SYNC3, SYNC1, SYNC3].join(","), "SOP_DPRIME"],
  [[SYNC1, RST2, RST2, SYNC3].join(","), "SOP_PRIME_DEBUG"],
  [[SYNC1, RST2, SYNC3, SYNC2].join(","), "SOP_DPRIME_DEBUG"],
  [[RST1, SYNC1, RST1, SYNC3].join(","), "CABLE_RESET"],
  [[RST1, RST1, RST1, RST2].join(","), "HARD_RESET"],
]);

const SAMPLE_RATE_HZ = 2_400_000;
const BMC_EDGE_ZERO_THRESHOLD_SAMPLES = 6;
const BMC_PACKET_GAP_SAMPLES = 12;
const MIN_PD_PACKET_BITS = 50;

export type AtkC2Frame = {
  cmd: number;
  payload: Uint8Array;
};

export type AtkC2Packet = {
  sop: StartOfPacket;
  bytes: Uint8Array;
  sampleIndex: number;
};

export type AtkC2Reset = {
  kind: "hard_reset" | "cable_reset";
  sampleIndex: number;
};

export type AtkC2DecodedEvent = AtkC2Packet | AtkC2Reset;

export type AtkC2CaptureSnapshot = {
  vbusMv: number;
  ibusMa: number;
  cc1Mv: number;
  cc2Mv: number;
  dpMv: number;
  dmMv: number;
  activeCc: number;
};

export type AtkC2ProtocolDecoderOptions = {
  initialRecvCounter?: number;
};

function checksum8(bytes: Uint8Array, length = bytes.length): number {
  let sum = 0;
  for (let index = 0; index < length; index++) {
    sum = (sum + (bytes[index] ?? 0)) & 0xff;
  }
  return (-sum) & 0xff;
}

export function buildAtkC2CommandFrame(cmd: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (payload.length > 0x3a) {
    throw new Error(`ATK C2 command payload is too long: ${payload.length} bytes.`);
  }

  const frame = new Uint8Array(63);
  frame[0] = 0xee;
  frame[1] = cmd & 0xff;
  frame[2] = payload.length;
  frame.set(payload, 3);
  frame[3 + payload.length] = checksum8(frame, 3 + payload.length);
  frame[4 + payload.length] = 0xff;
  return frame;
}

export function buildAtkC2SwitchCommand(cmd: number, enabled: boolean): Uint8Array {
  return buildAtkC2CommandFrame(cmd, Uint8Array.from([enabled ? 1 : 0, 0]));
}

export class AtkC2FrameParser {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): AtkC2Frame[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const frames: AtkC2Frame[] = [];

    while (this.buffer.length > 0) {
      if (this.buffer[0] !== 0xee) {
        const next = this.buffer.indexOf(0xee, 1);
        this.buffer = next < 0 ? new Uint8Array(0) : this.buffer.slice(next);
        continue;
      }

      if (this.buffer.length < 3) break;

      const cmd = this.buffer[1] ?? 0;
      const payloadLen = this.buffer[2] ?? 0;
      const frameLen = cmd === ATK_C2_CMD.SAMPLE_BLOCK ? 64 : payloadLen + 5;

      if (frameLen < 5 || frameLen > 64) {
        this.buffer = this.buffer.slice(1);
        continue;
      }

      if (this.buffer.length < frameLen) break;

      const expectedTail = cmd === ATK_C2_CMD.SAMPLE_BLOCK ? 0x00 : 0xff;
      const checksumOffset = frameLen - 2;
      const checksumOk = checksum8(this.buffer, checksumOffset) === this.buffer[checksumOffset];
      const tailOk = this.buffer[frameLen - 1] === expectedTail;

      if (!checksumOk || !tailOk) {
        this.buffer = this.buffer.slice(1);
        continue;
      }

      frames.push({
        cmd,
        payload: this.buffer.slice(3, 3 + payloadLen),
      });
      this.buffer = this.buffer.slice(frameLen);
    }

    return frames;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}

function getSymbol(bits: readonly number[], offset: number): number | null {
  if (offset + 5 > bits.length) return null;

  let raw = 0;
  for (let index = 0; index < 5; index++) {
    raw |= ((bits[offset + index] ?? 0) & 1) << index;
  }

  return DEC4B5B[raw] ?? SYM_ERR;
}

function scanSymbols(bits: readonly number[]): { sop: StartOfPacket | "CABLE_RESET" | "HARD_RESET"; symbols: number[] } | null {
  for (let offset = 0; offset <= bits.length - 20; offset++) {
    const sopSymbols = [
      getSymbol(bits, offset),
      getSymbol(bits, offset + 5),
      getSymbol(bits, offset + 10),
      getSymbol(bits, offset + 15),
    ];
    const sop = SOP_MAP.get(sopSymbols.join(","));
    if (sop === undefined) continue;

    const symbols: number[] = [];
    for (let pos = offset; pos + 5 <= bits.length; pos += 5) {
      const symbol = getSymbol(bits, pos) ?? SYM_ERR;
      symbols.push(symbol);
      if (symbol === EOP) break;
    }

    return { sop, symbols };
  }

  return null;
}

function symbolsToBytes(symbols: readonly number[]): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index + 1 < symbols.length; index += 2) {
    const lo = symbols[index] ?? SYM_ERR;
    const hi = symbols[index + 1] ?? SYM_ERR;
    if (lo > 0x0f || hi > 0x0f) break;
    bytes.push(lo | (hi << 4));
  }
  return Uint8Array.from(bytes);
}

export class AtkC2BmcDecoder {
  private sampleIndex = 0;
  private previousSample: number | null = null;
  private previousEdge: number | null = null;
  private bits: number[] = [];
  private halfOne = false;
  private packetStartSample = 0;

  pushSampleBlock(payload: Uint8Array): AtkC2DecodedEvent[] {
    const events: AtkC2DecodedEvent[] = [];

    for (const byte of payload) {
      for (let bit = 0; bit < 8; bit++) {
        const sample = (byte >> bit) & 1;
        this.pushSample(sample, events);
        this.sampleIndex++;
      }
    }

    return events;
  }

  reset(): void {
    this.sampleIndex = 0;
    this.previousSample = null;
    this.previousEdge = null;
    this.bits = [];
    this.halfOne = false;
    this.packetStartSample = 0;
  }

  private pushSample(sample: number, events: AtkC2DecodedEvent[]): void {
    if (this.previousSample === null) {
      this.previousSample = sample;
      return;
    }

    if (sample === this.previousSample) {
      return;
    }

    this.previousSample = sample;
    this.handleEdge(this.sampleIndex, events);
  }

  private handleEdge(edge: number, events: AtkC2DecodedEvent[]): void {
    if (this.previousEdge === null) {
      this.previousEdge = edge;
      this.packetStartSample = edge;
      return;
    }

    const diff = edge - this.previousEdge;

    if (diff > BMC_PACKET_GAP_SAMPLES) {
      this.flushPacket(events);
      this.bits = [];
      this.halfOne = false;
      this.packetStartSample = edge;
      this.previousEdge = edge;
      return;
    }

    const isZero = diff > BMC_EDGE_ZERO_THRESHOLD_SAMPLES;

    if (isZero && !this.halfOne) {
      this.bits.push(0);
    } else if (!isZero && this.halfOne) {
      this.bits.push(1);
      this.halfOne = false;
    } else if (!isZero && !this.halfOne) {
      this.halfOne = true;
    } else {
      this.bits.push(0);
      this.halfOne = false;
    }

    this.previousEdge = edge;
  }

  private flushPacket(events: AtkC2DecodedEvent[]): void {
    if (this.bits.length < MIN_PD_PACKET_BITS) return;

    const scanned = scanSymbols(this.bits);
    if (scanned === null) return;

    if (scanned.sop === "HARD_RESET") {
      events.push({ kind: "hard_reset", sampleIndex: this.packetStartSample });
      return;
    }

    if (scanned.sop === "CABLE_RESET") {
      events.push({ kind: "cable_reset", sampleIndex: this.packetStartSample });
      return;
    }

    const eopIndex = scanned.symbols.indexOf(EOP);
    if (eopIndex < 0) return;

    const dataSymbols = scanned.symbols.slice(4, eopIndex);
    if (dataSymbols.some((symbol) => symbol === SYM_ERR)) return;

    const bytes = symbolsToBytes(dataSymbols);
    if (bytes.length < 6) return;

    events.push({
      sop: scanned.sop,
      bytes,
      sampleIndex: this.packetStartSample,
    });
  }
}

function eventTypeForDecodedEvent(event: AtkC2DecodedEvent): number {
  if ("kind" in event) {
    return event.kind === "hard_reset" ? MONITOR_EVENT.HARD_RESET : MONITOR_EVENT.CABLE_RESET;
  }

  switch (event.sop) {
    case "SOP":
      return MONITOR_EVENT.PD_SOP0;
    case "SOP_PRIME":
      return MONITOR_EVENT.PD_SOP1;
    case "SOP_DPRIME":
      return MONITOR_EVENT.PD_SOP2;
    case "SOP_PRIME_DEBUG":
      return MONITOR_EVENT.PD_SOP1_DEBUG;
    case "SOP_DPRIME_DEBUG":
      return MONITOR_EVENT.PD_SOP2_DEBUG;
  }
}

function timestampUsFromSampleIndex(sampleIndex: number): number {
  return Math.floor((sampleIndex * 1_000_000) / SAMPLE_RATE_HZ);
}

export class AtkC2ProtocolDecoder {
  private frameParser = new AtkC2FrameParser();
  private bmcDecoder = new AtkC2BmcDecoder();
  private recvCounter: number;
  private snapshot: AtkC2CaptureSnapshot = {
    vbusMv: 0,
    ibusMa: 0,
    cc1Mv: 0,
    cc2Mv: 0,
    dpMv: 0,
    dmMv: 0,
    activeCc: 0,
  };

  constructor(options: AtkC2ProtocolDecoderOptions = {}) {
    this.recvCounter = options.initialRecvCounter ?? 0;
  }

  pushBytes(chunk: Uint8Array): MonitorRecord[] {
    const records: MonitorRecord[] = [];

    for (const frame of this.frameParser.push(chunk)) {
      if (frame.cmd === ATK_C2_CMD.SAMPLE_BLOCK) {
        for (const event of this.bmcDecoder.pushSampleBlock(frame.payload)) {
          records.push(this.eventToRecord(event));
        }
      } else if (frame.cmd === ATK_C2_CMD.WAVEFORM_UPLOAD) {
        this.updateSnapshot(frame.payload);
      }
    }

    return records;
  }

  reset(): void {
    this.frameParser.reset();
    this.bmcDecoder.reset();
    this.recvCounter = 0;
  }

  private eventToRecord(event: AtkC2DecodedEvent): MonitorRecord {
    const data = "bytes" in event ? Array.from(event.bytes) : [];
    const record: MonitorRecord = {
      timestamp_us: timestampUsFromSampleIndex(event.sampleIndex),
      recv_counter: this.recvCounter++,
      vbus_mv: this.snapshot.vbusMv,
      ibus_ma: this.snapshot.ibusMa,
      cc1_mv: this.snapshot.cc1Mv,
      cc2_mv: this.snapshot.cc2Mv,
      dp_mv: this.snapshot.dpMv,
      dm_mv: this.snapshot.dmMv,
      event_type: eventTypeForDecodedEvent(event),
      active_cc: this.snapshot.activeCc,
      data_len: data.length,
      data,
    };

    return record;
  }

  private updateSnapshot(payload: Uint8Array): void {
    if (payload.length < 57) return;

    this.snapshot = {
      // The ATK status frame scale is not yet fully documented. Keep raw capture
      // integration conservative and fill only fields whose unit mapping is known.
      vbusMv: 0,
      ibusMa: 0,
      cc1Mv: 0,
      cc2Mv: 0,
      dpMv: 0,
      dmMv: 0,
      activeCc: payload[56] ?? 0,
    };
  }
}
