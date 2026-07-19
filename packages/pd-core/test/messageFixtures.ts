export function extendedMessageBytes(
  messageType: number,
  payload: readonly number[],
  declaredDataSize = payload.length,
): Uint8Array {
  const numberOfDataObjects = Math.ceil((2 + payload.length) / 4)

  return Uint8Array.from([
    0x80 | messageType,
    0x80 | (numberOfDataObjects << 4),
    declaredDataSize & 0xff,
    (declaredDataSize >>> 8) & 0x01,
    ...payload,
  ])
}
