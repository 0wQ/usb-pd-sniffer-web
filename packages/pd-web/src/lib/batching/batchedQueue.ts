export type BatchedQueue<T> = {
  push(item: T): void
  flush(): void
  clear(): void
}

/**
 * Collects items and hands them to `onFlush` in batches.
 *
 * The flush is triggered by *quiet*, not by a fixed period: once items start
 * arriving the queue waits for a gap of `idleMs` with no further arrivals
 * before flushing. Device traffic is bursty, so this lands the consumer's work
 * in the quiet period after a burst instead of during it, where it would
 * compete with the device draining that same burst.
 *
 * `maxWaitMs` caps how long a batch may be held so a genuinely continuous
 * stream cannot starve the consumer. `maxBatchSize` bounds the batch itself.
 */
export function createBatchedQueue<T>({
  maxBatchSize,
  idleMs,
  maxWaitMs,
  onFlush,
}: {
  maxBatchSize: number
  /** Flush once this long has passed with no new arrival. */
  idleMs: number
  /** Flush anyway this long after the first arrival of the batch. */
  maxWaitMs: number
  onFlush: (items: T[]) => void
}): BatchedQueue<T> {
  let pending: T[] = []
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null
  let lastArrival = 0
  let batchStart = 0

  const clearTimer = () => {
    if (timer === null) return
    globalThis.clearTimeout(timer)
    timer = null
  }

  const flush = () => {
    clearTimer()
    if (pending.length === 0) return

    const items = pending
    pending = []
    onFlush(items)
  }

  const onTimer = () => {
    timer = null
    const now = performance.now()
    const idleFor = now - lastArrival

    if (idleFor >= idleMs) {
      flush()
      return
    }

    const untilMaxWait = maxWaitMs - (now - batchStart)
    if (untilMaxWait <= 0) {
      flush()
      return
    }

    // Still receiving: wait out the remaining quiet time, but never past the
    // hard cap. Re-arming one timer per interval (rather than one per item)
    // keeps timer churn independent of the arrival rate.
    timer = globalThis.setTimeout(
      onTimer,
      Math.min(idleMs - idleFor, untilMaxWait),
    )
  }

  return {
    push(item) {
      const now = performance.now()
      if (pending.length === 0) {
        batchStart = now
      }
      lastArrival = now
      pending.push(item)

      if (pending.length >= maxBatchSize) {
        flush()
        return
      }

      if (timer === null) {
        // Wake at whichever comes first: the end of the quiet window or the
        // hard cap. Without the cap in this min() a maxWaitMs shorter than
        // idleMs could never fire, because the timer would outlive the test.
        const untilMaxWait = maxWaitMs - (now - batchStart)
        timer = globalThis.setTimeout(
          onTimer,
          Math.max(1, Math.min(idleMs, untilMaxWait)),
        )
      }
    },

    flush,

    clear() {
      clearTimer()
      pending = []
    },
  }
}
