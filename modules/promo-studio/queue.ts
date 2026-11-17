/** Bulk re-analysis runs at most this many promos at once. */
export const BULK_CONCURRENCY = 2;
export const BULK_MAX = 50;

/**
 * A tiny in-process work queue: add jobs any time, at most `limit` run at once.
 * `onStart` sees the ids still waiting, so callers can keep them fresh.
 */
export function createQueue(limit: number, run: (id: string) => Promise<void>, onStart?: (waiting: string[]) => Promise<void> | void) {
  const waiting: string[] = [];
  const active = new Set<string>();
  let drained: (() => void)[] = [];

  const pump = () => {
    while (active.size < limit && waiting.length) {
      const id = waiting.shift()!;
      active.add(id);
      void (async () => {
        try {
          await Promise.resolve(); // let this pump finish starting jobs first
          await onStart?.([...waiting]);
        } catch {
          // Keeping waiting rows fresh is best effort.
        }
        try {
          await run(id);
        } catch {
          // A failed job never stops the queue.
        } finally {
          active.delete(id);
          pump();
        }
      })();
    }
    if (!active.size && !waiting.length) {
      const done = drained;
      drained = [];
      done.forEach((resolve) => resolve());
    }
  };

  return {
    add(ids: readonly string[]) {
      for (const id of ids) if (!active.has(id) && !waiting.includes(id)) waiting.push(id);
      pump();
    },
    /** Resolves when nothing is running or waiting. */
    idle(): Promise<void> {
      if (!active.size && !waiting.length) return Promise.resolve();
      return new Promise((resolve) => drained.push(resolve));
    },
    size: () => ({ active: active.size, waiting: waiting.length }),
  };
}
