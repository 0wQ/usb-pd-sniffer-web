export type StartOfPacket = "SOP" | "SOP_PRIME" | "SOP_DPRIME";

export type MessageFrame = {
  sop: StartOfPacket;
  bytes: Uint8Array;
};

export type SpecificationRevision = "1.0" | "2.0" | "3.x" | "reserved";

export type MessageCategory = "control" | "data" | "extended" | "unknown";

export type MessageTypeInfo = {
  category: MessageCategory;
  code: number | null;
  name: string | null;
};

export type DecodeIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
};

export type BitField = {
  key: string;
  label: string;
  bitStart: number;
  bitLength: number;
  rawValue: number | bigint;
  decodedValue: string | number | boolean | null;
  displayValue?: string;
  unit?: string;
  note?: string;
};

export type MessageHeader = {
  raw16: number;
  extended: boolean;
  numberOfDataObjects: number;
  messageId: number;
  portPowerRoleOrCablePlugBit: 0 | 1;
  portPowerRoleOrCablePlugMeaning: "Sink" | "Source" | "DFP/UFP Port" | "Cable Plug / VPD";
  specificationRevisionBits: 0 | 1 | 2 | 3;
  specificationRevision: SpecificationRevision;
  portDataRoleBit: 0 | 1 | null;
  portDataRoleMeaning: "UFP" | "DFP" | null;
  messageType: number;
  category: MessageCategory;
};

export type ExtendedMessageHeader = {
  raw16: number;
  chunked: boolean;
  chunkNumber: number;
  requestChunk: boolean;
  dataSize: number;
};

export type SectionKind =
  | "message_header"
  | "extended_message_header"
  | "data_message_payload"
  | "extended_message_payload"
  | "data_object"
  | "request_data_object"
  | "request_payload_interpretation"
  | "vdm_header"
  | "vendor_data_object"
  | "data_block"
  | "raw_payload";

export type Section = {
  key: string;
  kind: SectionKind;
  title: string;
  index?: number;
  semanticKind?: string;
  parentSectionKey?: string;
  depth: number;
  byteOffset: number;
  byteLength: number;
  rawBytes: Uint8Array;
  rawValue?: number | bigint;
  fields: BitField[];
  issues: DecodeIssue[];
};

export type ExplainContext = {
  mode: "single_frame" | "sequence";
  notes: string[];
};

export type DecodedMessage = {
  frame: MessageFrame;
  category: MessageCategory;
  messageType: MessageTypeInfo;
  header: MessageHeader | null;
  extendedHeader: ExtendedMessageHeader | null;
  explainContext: ExplainContext;
  sections: Section[];
  issues: DecodeIssue[];
};

export type SequenceDecoder = {
  push(frame: MessageFrame): DecodedMessage;
  reset(): void;
};
