export function extractBits(
  raw: number,
  bitStart: number,
  bitLength: number,
): number {
  const mask = bitLength >= 32 ? 0xffffffff : (1 << bitLength) - 1
  return (raw >>> bitStart) & mask
}

export function readUint16Le(bytes: Uint8Array, offset = 0): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

export function readUint32Le(bytes: Uint8Array, offset = 0): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}
