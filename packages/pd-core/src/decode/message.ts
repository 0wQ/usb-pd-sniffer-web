import { decodeExtendedMessageHeader, explainExtendedMessageHeader } from "./extendedMessageHeader.js";
import { explainDataObjects } from "./dataObjects.js";
import { explainExtendedDataBlocks } from "./extendedDataBlocks.js";
import { decodeMessageHeader, explainMessageHeader } from "./messageHeader.js";
import { lookupMessageTypeName } from "../registry/messageTypes.js";
import type { DecodedMessage, DecodeIssue, MessageFrame, MessageTypeInfo, Section } from "../types.js";

export function decodeMessage(frame: MessageFrame): DecodedMessage {
  const issues: DecodeIssue[] = [];
  const sections: Section[] = [];

  if (frame.bytes.length < 2) {
    issues.push({
      severity: "error",
      code: "PD_SHORT_FRAME",
      message: "PD frame is shorter than the 2-byte Message Header.",
    });

    return {
      frame,
      category: "unknown",
      messageType: {
        category: "unknown",
        code: null,
        name: null,
      },
      header: null,
      extendedHeader: null,
      explainContext: {
        mode: "single_frame",
        notes: [],
      },
      sections,
      issues,
    };
  }

  const header = decodeMessageHeader(frame);
  const messageType: MessageTypeInfo = {
    category: header.category,
    code: header.messageType,
    name: lookupMessageTypeName(header.category, header.messageType),
  };

  sections.push(explainMessageHeader(header, frame));

  if (header.extended) {
    if (frame.bytes.length < 4) {
      issues.push({
        severity: "error",
        code: "PD_SHORT_EXTENDED_FRAME",
        message: "Extended Message is shorter than the required 4-byte headers.",
      });

      return {
        frame,
        category: header.category,
        messageType,
        header,
        extendedHeader: null,
        explainContext: {
          mode: "single_frame",
          notes: [],
        },
        sections,
        issues,
      };
    }

    const extendedHeaderBytes = frame.bytes.slice(2, 4);
    const extendedHeader = decodeExtendedMessageHeader(extendedHeaderBytes);
    sections.push(explainExtendedMessageHeader(extendedHeader, extendedHeaderBytes));

    const payloadBytes = frame.bytes.slice(4);
    if (payloadBytes.length > 0) {
      const payloadSectionKey = "extended-message-payload";
      sections.push({
        key: payloadSectionKey,
        kind: "extended_message_payload",
        title: messageType.name ?? "Extended Message Payload",
        semanticKind: messageType.name ?? "extended_message_payload",
        depth: 0,
        byteOffset: 4,
        byteLength: payloadBytes.length,
        rawBytes: payloadBytes,
        fields: [],
        issues: [],
      });
      sections.push({
        key: `${payloadSectionKey}:data-block`,
        kind: "data_block",
        title: "Extended Message Data Block",
        semanticKind: "extended_message_data_block",
        parentSectionKey: payloadSectionKey,
        depth: 1,
        byteOffset: 4,
        byteLength: payloadBytes.length,
        rawBytes: payloadBytes,
        fields: [],
        issues: [],
      });
      sections.push(...explainExtendedDataBlocks(payloadBytes, messageType, extendedHeader, frame.sop, payloadSectionKey, 4));
    }

    return {
      frame,
      category: header.category,
      messageType,
      header,
      extendedHeader,
      explainContext: {
        mode: "single_frame",
        notes: [],
      },
      sections,
      issues,
    };
  }

  const payloadBytes = frame.bytes.slice(2);
  const expectedPayloadBytes = header.numberOfDataObjects * 4;

  if (payloadBytes.length !== expectedPayloadBytes) {
    issues.push({
      severity: "warning",
      code: "PD_OBJECT_COUNT_LENGTH_MISMATCH",
      message: `Message Header indicates ${expectedPayloadBytes} payload bytes, but frame has ${payloadBytes.length}.`,
    });
  }

  if (payloadBytes.length > 0) {
    const payloadSectionKey = "data-message-payload";
    sections.push({
      key: payloadSectionKey,
      kind: "data_message_payload",
      title: messageType.name ?? "Data Message Payload",
      semanticKind: messageType.name ?? "data_message_payload",
      depth: 0,
      byteOffset: 2,
      byteLength: payloadBytes.length,
      rawBytes: payloadBytes,
      fields: [],
      issues: [],
    });
    sections.push(...explainDataObjects(payloadBytes, frame.sop, messageType, payloadSectionKey, 2));
  }

  return {
    frame,
    category: header.category,
    messageType,
    header,
    extendedHeader: null,
    explainContext: {
      mode: "single_frame",
      notes: [],
    },
    sections,
    issues,
  };
}
