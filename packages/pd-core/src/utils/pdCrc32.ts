const PD_CRC32_INITIAL = 0xFFFFFFFF;
const PD_CRC32_POLY = 0x04C11DB6;

function reverse32(value: number): number {
  let result = 0;

  for (let index = 0; index < 32; index += 1) {
    result = (result | (((value >>> index) & 1) << (31 - index))) >>> 0;
  }

  return result >>> 0;
}

/**
 * Calculates the USB PD CRC32 field value for Message Header + Payload bytes.
 *
 * This follows the USB PD specification CRC example: shift incoming bytes LSB
 * first, use the spec polynomial representation 0x04C11DB6, then invert and
 * reverse the final 32-bit remainder before comparing to the little-endian
 * CRC32 field carried on the wire.
 */
export function calculatePdCrc32(messageBytes: readonly number[] | Uint8Array): number {
  let crc = PD_CRC32_INITIAL;

  for (const byte of messageBytes) {
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      const newBit = (((crc >>> 31) ^ ((byte >>> bitIndex) & 1)) & 1) >>> 0;
      const shifted = (((crc << 1) >>> 0) | newBit) >>> 0;
      crc = (shifted ^ (newBit === 1 ? PD_CRC32_POLY : 0)) >>> 0;
    }
  }

  return reverse32((~crc) >>> 0);
}
