import type { CaptureRecord } from '@/types/pd'

export type CaptureBuffer = {
  add(record: CaptureRecord): void
  addBatch(records: CaptureRecord[]): void
  get(index: number): CaptureRecord | undefined
  readonly length: number
  readonly currentVersion: number
  clear(): void
  getAll(): CaptureRecord[]
}

export function createCaptureBuffer(): CaptureBuffer {
  let buffer: CaptureRecord[] = []
  let version = 0

  return {
    add(record) {
      buffer.push(record)
      version++
    },

    addBatch(records) {
      buffer.push(...records)
      version++
    },

    get(index) {
      return buffer[index]
    },

    get length() {
      return buffer.length
    },

    get currentVersion() {
      return version
    },

    clear() {
      buffer = []
      version++
    },

    // Return the backing array intentionally; virtualized views use version for invalidation.
    getAll() {
      return buffer
    },
  }
}
