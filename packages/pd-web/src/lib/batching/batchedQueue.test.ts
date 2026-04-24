import { afterEach, describe, expect, test, vi } from 'vitest'
import { createBatchedQueue } from './batchedQueue'

describe('createBatchedQueue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('flushes immediately when max batch size is reached', () => {
    const flushed: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 3,
      timeoutMs: 50,
      onFlush: (items) => flushed.push(items),
    })

    queue.push(1)
    queue.push(2)
    expect(flushed).toEqual([])

    queue.push(3)
    expect(flushed).toEqual([[1, 2, 3]])
  })

  test('flushes pending items after timeout', () => {
    vi.useFakeTimers()

    const flushed: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 10,
      timeoutMs: 50,
      onFlush: (items) => flushed.push(items),
    })

    queue.push(1)
    queue.push(2)
    vi.advanceTimersByTime(49)
    expect(flushed).toEqual([])

    vi.advanceTimersByTime(1)
    expect(flushed).toEqual([[1, 2]])
  })

  test('manual flush emits pending items and cancels timeout', () => {
    vi.useFakeTimers()

    const flushed: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 10,
      timeoutMs: 50,
      onFlush: (items) => flushed.push(items),
    })

    queue.push(1)
    queue.flush()
    vi.advanceTimersByTime(50)

    expect(flushed).toEqual([[1]])
  })

  test('clear drops pending items and cancels timeout', () => {
    vi.useFakeTimers()

    const flushed: number[][] = []
    const queue = createBatchedQueue<number>({
      maxBatchSize: 10,
      timeoutMs: 50,
      onFlush: (items) => flushed.push(items),
    })

    queue.push(1)
    queue.clear()
    vi.advanceTimersByTime(50)

    expect(flushed).toEqual([])
  })
})
