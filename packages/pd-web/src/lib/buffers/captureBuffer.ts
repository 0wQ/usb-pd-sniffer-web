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

export function createCaptureBuffer(capacity: number): CaptureBuffer {
  let buffer = new Array<CaptureRecord>(capacity)
  let head = 0
  let count = 0
  let version = 0
  let orderedCache: CaptureRecord[] | null = null
  let orderedCacheVersion = -1

  const push = (record: CaptureRecord) => {
    buffer[head] = record
    head = (head + 1) % capacity
    count = Math.min(count + 1, capacity)
  }

  const getLogicalIndex = (index: number) => {
    if (index < 0 || index >= count) return -1
    return (head - count + index + capacity) % capacity
  }

  const invalidate = () => {
    version++
    orderedCache = null
    orderedCacheVersion = -1
  }

  return {
    add(record) {
      push(record)
      invalidate()
    },

    addBatch(records) {
      if (records.length === 0) return

      if (records.length >= capacity) {
        const start = records.length - capacity
        buffer = records.slice(start)
        head = 0
        count = capacity
      } else {
        for (const record of records) {
          push(record)
        }
      }

      invalidate()
    },

    get(index) {
      const physicalIndex = getLogicalIndex(index)
      return physicalIndex === -1 ? undefined : buffer[physicalIndex]
    },

    get length() {
      return count
    },

    get currentVersion() {
      return version
    },

    clear() {
      buffer = new Array<CaptureRecord>(capacity)
      head = 0
      count = 0
      invalidate()
    },

    // Return records in visible order: oldest retained record first, newest last.
    getAll() {
      if (orderedCache && orderedCacheVersion === version) return orderedCache

      const result = new Array<CaptureRecord>(count)
      for (let index = 0; index < count; index += 1) {
        result[index] = buffer[(head - count + index + capacity) % capacity]
      }

      orderedCache = result
      orderedCacheVersion = version
      return result
    },
  }
}
