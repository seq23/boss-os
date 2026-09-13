/**
 * MANY READS, ONE ROUND TRIP — because on this runtime the round trip is the cost.
 *
 * Measured on production, 13 September 2026, with a probe route that ran the same five-row SELECT
 * n times and read Cloudflare's own CPU accounting for the request:
 *
 *     n=24  serial awaits      16–19 ms
 *     n=24  Promise.all        10–11 ms
 *     n=24  one db.batch        1–2 ms
 *
 * So a D1 statement costs roughly 0.7 ms of CPU on its own, 0.4 ms in parallel, and next to
 * nothing inside a batch. The Free plan allows 10 ms a request. A screen that assembles itself
 * from twenty reads therefore lives or dies on whether those reads share a batch — not on the SQL,
 * which was always fast.
 *
 * This is a batch that reads like `Promise.all`. Each `all`/`first` hands back a promise straight
 * away and records the statement; `flush()` sends every recorded statement as ONE `db.batch` and
 * settles the promises with the same shapes `.all()` and `.first()` would have produced. A read
 * that is not wanted resolves to its fallback and is never sent — a group of Today's blocks asks
 * only for what it will render.
 *
 *     const reads = batchReads(db);
 *     const a = reads.all<Row>(true, () => db.prepare(...));
 *     const b = reads.first<Row>(wanted, () => db.prepare(...).bind(x));
 *     const c = someHelperThatQueriesOnItsOwn(db);   // runs in parallel with the flush
 *     await reads.flush();
 *     const [rowsA, rowB, resultC] = await Promise.all([a, b, c]);
 *
 * ORDER IS PRESERVED: D1 batches run statements in sequence, so a read placed after a write in the
 * same batch sees the write. `flush()` must be called once every read has been recorded; a read
 * recorded after the flush is sent by the next flush, and a promise never flushed never settles —
 * which is loud in a test and is the intended failure of forgetting it.
 */
export interface BatchReads {
  all<T>(wanted: boolean, stmt: () => D1PreparedStatement, fallback?: D1Result<T>): Promise<D1Result<T>>;
  first<T>(wanted: boolean, stmt: () => D1PreparedStatement, fallback?: T | null): Promise<T | null>;
  /** Sends everything recorded so far as one batch and settles their promises. */
  flush(): Promise<void>;
  /** How many statements are waiting — for tests that pin a group's cost. */
  readonly pending: number;
}

/** What `.all()` answers when nothing was read: the same shape, empty. */
export const NO_ROWS = { results: [], success: true, meta: {} } as unknown as D1Result<never>;

export function batchReads(db: D1Database): BatchReads {
  let queue: { stmt: D1PreparedStatement; resolve: (r: D1Result<unknown>) => void; reject: (e: unknown) => void }[] = [];

  const record = (stmt: D1PreparedStatement) =>
    new Promise<D1Result<unknown>>((resolve, reject) => { queue.push({ stmt, resolve, reject }); });

  return {
    get pending() { return queue.length; },
    all<T>(wanted: boolean, stmt: () => D1PreparedStatement, fallback: D1Result<T> = NO_ROWS as D1Result<T>) {
      if (!wanted) return Promise.resolve(fallback);
      return record(stmt()) as Promise<D1Result<T>>;
    },
    first<T>(wanted: boolean, stmt: () => D1PreparedStatement, fallback: T | null = null) {
      if (!wanted) return Promise.resolve(fallback);
      return record(stmt()).then((r) => ((r.results as T[])[0] ?? null));
    },
    async flush() {
      if (queue.length === 0) return;
      const sending = queue;
      queue = [];
      try {
        const results = await db.batch(sending.map((q) => q.stmt));
        sending.forEach((q, i) => q.resolve(results[i]!));
      } catch (err) {
        for (const q of sending) q.reject(err);
      }
    },
  };
}
