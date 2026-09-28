import { describe, expect, it } from 'vitest'
import { createBatchedQueue } from './batchedQueue'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createBatchedQueue', () => {
  it('flushes once the stream has been quiet for idleMs', async () => {
    const flushes: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 100,
      idleMs: 30,
      maxWaitMs: 500,
      onFlush: (items) => flushes.push(items),
    })

    queue.push(1)
    queue.push(2)

    await sleep(15)
    expect(flushes).toHaveLength(0)

    await sleep(60)
    expect(flushes).toHaveLength(1)
    expect(flushes[0]).toEqual([1, 2])
  })

  it('holds the flush while items keep arriving', async () => {
    const flushes: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 1000,
      idleMs: 30,
      maxWaitMs: 5000,
      onFlush: (items) => flushes.push(items),
    })

    // Arrivals every 10ms for 150ms: the queue is never quiet for 30ms, so
    // nothing should be flushed while the "burst" is in progress.
    for (let index = 0; index < 15; index += 1) {
      queue.push(index)
      await sleep(10)
    }
    const duringBurst = flushes.length

    await sleep(80)
    expect(duringBurst).toBe(0)
    expect(flushes).toHaveLength(1)
    expect(flushes[0]).toHaveLength(15)
  })

  it('flushes at maxWaitMs even when arrivals never stop', async () => {
    const flushes: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 1000,
      idleMs: 1000,
      maxWaitMs: 60,
      onFlush: (items) => flushes.push(items),
    })

    for (let index = 0; index < 20; index += 1) {
      queue.push(index)
      await sleep(10)
    }

    // idleMs is far longer than the burst, so the only way anything gets out
    // is the hard cap.
    expect(flushes.length).toBeGreaterThan(0)
    expect(flushes.flat().length).toBeGreaterThan(0)
  })

  it('flushes immediately when maxBatchSize is reached', () => {
    const flushes: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 3,
      idleMs: 1000,
      maxWaitMs: 5000,
      onFlush: (items) => flushes.push(items),
    })

    queue.push(1)
    queue.push(2)
    expect(flushes).toHaveLength(0)

    queue.push(3)
    expect(flushes).toHaveLength(1)
    expect(flushes[0]).toEqual([1, 2, 3])
  })

  it('drops pending items on clear without flushing', async () => {
    const flushes: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 100,
      idleMs: 20,
      maxWaitMs: 500,
      onFlush: (items) => flushes.push(items),
    })

    queue.push(1)
    queue.clear()
    await sleep(60)

    expect(flushes).toHaveLength(0)
  })

  it('starts a fresh batch after a flush', async () => {
    const flushes: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 100,
      idleMs: 20,
      maxWaitMs: 500,
      onFlush: (items) => flushes.push(items),
    })

    queue.push(1)
    await sleep(60)
    queue.push(2)
    await sleep(60)

    expect(flushes).toEqual([[1], [2]])
  })
})
