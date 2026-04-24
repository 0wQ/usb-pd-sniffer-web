import type { PowerSample } from '@/types/pd'

export class PowerSamplesBuffer {
  private buffer: PowerSample[]
  private capacity: number
  private head: number = 0
  private count: number = 0
  private version: number = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array<PowerSample>(capacity)
  }

  add(sample: PowerSample) {
    this.buffer[this.head] = sample
    this.head = (this.head + 1) % this.capacity
    this.count = Math.min(this.count + 1, this.capacity)
    this.version++
  }

  addBatch(samples: PowerSample[]) {
    if (samples.length === 0) return

    for (const sample of samples) {
      this.buffer[this.head] = sample
      this.head = (this.head + 1) % this.capacity
      this.count = Math.min(this.count + 1, this.capacity)
    }

    this.version++
  }

  clear() {
    this.buffer = new Array<PowerSample>(this.capacity)
    this.head = 0
    this.count = 0
    this.version++
  }

  getRecent(limit: number): PowerSample[] {
    if (this.count === 0 || limit <= 0) return []

    const size = Math.min(limit, this.count)
    const start = (this.head - size + this.capacity) % this.capacity
    const result: PowerSample[] = []

    for (let index = 0; index < size; index += 1) {
      const sample = this.buffer[(start + index) % this.capacity]
      if (sample) {
        result.push(sample)
      }
    }

    return result
  }

  getLatest(): PowerSample | null {
    if (this.count === 0) return null
    return this.buffer[(this.head - 1 + this.capacity) % this.capacity] ?? null
  }

  get length(): number {
    return this.count
  }

  get currentVersion(): number {
    return this.version
  }
}
