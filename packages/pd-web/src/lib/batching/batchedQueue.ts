export type BatchedQueue<T> = {
  push(item: T): void
  flush(): void
  clear(): void
}

export function createBatchedQueue<T>({
  maxBatchSize,
  timeoutMs,
  onFlush,
}: {
  maxBatchSize: number
  timeoutMs: number
  onFlush: (items: T[]) => void
}): BatchedQueue<T> {
  let pending: T[] = []
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null

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

  return {
    push(item) {
      pending.push(item)

      if (pending.length >= maxBatchSize) {
        flush()
        return
      }

      if (timer === null) {
        timer = globalThis.setTimeout(flush, timeoutMs)
      }
    },

    flush,

    clear() {
      clearTimer()
      pending = []
    },
  }
}
