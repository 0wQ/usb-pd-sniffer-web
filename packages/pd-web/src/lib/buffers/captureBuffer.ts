import type { CaptureRecord } from '@/types/pd'

// Capture records are kept in insertion order for indexed virtual-table access.
export class CaptureBuffer {
  private buffer: CaptureRecord[] = []
  private version: number = 0

  add(record: CaptureRecord) {
    this.buffer.push(record)
    this.version++
  }

  addBatch(records: CaptureRecord[]) {
    this.buffer.push(...records)
    this.version++
  }

  get(index: number): CaptureRecord | undefined {
    return this.buffer[index]
  }

  get length(): number {
    return this.buffer.length
  }

  get currentVersion(): number {
    return this.version
  }

  clear() {
    this.buffer = []
    this.version++
  }

  // Return the backing array intentionally; virtualized views use version for invalidation.
  getAll(): CaptureRecord[] {
    return this.buffer
  }
}
