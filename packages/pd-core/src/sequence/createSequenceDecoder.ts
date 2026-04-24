import { decodePacket } from "../decode/message.js";
import type { DecodeContext, MessagePacket, SequenceDecoder } from "../types.js";

export function createSequenceDecoder(): SequenceDecoder {
  return {
    push(packet: MessagePacket, context?: DecodeContext) {
      return decodePacket(packet, context);
    },
    reset() {
      // The decoder is currently stateless; multi-frame helpers remain outside this wrapper.
    },
  };
}
