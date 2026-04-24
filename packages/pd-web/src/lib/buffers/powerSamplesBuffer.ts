import type { PowerSample } from '@/types/pd'

export type PowerSamplesBuffer = {
  add(sample: PowerSample): void
  addBatch(samples: PowerSample[]): void
  clear(): void
  getRecent(limit: number): PowerSample[]
  getLatest(): PowerSample | null
  readonly length: number
  readonly currentVersion: number
}

export function createPowerSamplesBuffer(capacity: number): PowerSamplesBuffer {
  let buffer = new Array<PowerSample>(capacity)
  let head = 0
  let count = 0
  let version = 0

  return {
    add(sample) {
      buffer[head] = sample
      head = (head + 1) % capacity
      count = Math.min(count + 1, capacity)
      version++
    },

    addBatch(samples) {
      if (samples.length === 0) return

      for (const sample of samples) {
        buffer[head] = sample
        head = (head + 1) % capacity
        count = Math.min(count + 1, capacity)
      }

      version++
    },

    clear() {
      buffer = new Array<PowerSample>(capacity)
      head = 0
      count = 0
      version++
    },

    getRecent(limit) {
      if (count === 0 || limit <= 0) return []

      const size = Math.min(limit, count)
      const start = (head - size + capacity) % capacity
      const result: PowerSample[] = []

      for (let index = 0; index < size; index += 1) {
        const sample = buffer[(start + index) % capacity]
        if (sample) {
          result.push(sample)
        }
      }

      return result
    },

    getLatest() {
      if (count === 0) return null
      return buffer[(head - 1 + capacity) % capacity] ?? null
    },

    get length() {
      return count
    },

    get currentVersion() {
      return version
    },
  }
}
