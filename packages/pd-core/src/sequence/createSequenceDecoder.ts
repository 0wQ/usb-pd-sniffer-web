import { decodeMessage } from "../decode/message.js";
import type { MessageFrame, SequenceDecoder } from "../types.js";

export function createSequenceDecoder(): SequenceDecoder {
  return {
    push(frame: MessageFrame) {
      return decodeMessage(frame);
    },
    reset() {
      // Context-aware request/extended replay will be added after the core schema settles.
    },
  };
}
