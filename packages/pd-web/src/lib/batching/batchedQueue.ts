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
  let timer: number | null = null

  const clearTimer = () => {
    if (timer === null) return
    clearTimeout(timer)
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
        timer = window.setTimeout(flush, timeoutMs)
      }
    },

    flush,

    clear() {
      clearTimer()
      pending = []
    },
  }
}
