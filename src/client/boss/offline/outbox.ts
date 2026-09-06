/**
 * The offline outbox — Batch 7 of Boss OS v20.1.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
 *
 * It is durable capture: a note or an open loop written with no connection is kept in IndexedDB
 * and sent when there is one. It is NOT an offline copy of Boss OS. The plan is explicit that the
 * service-worker shell cache "must not be misrepresented as full offline data operation", and
 * forbids "an API-response cache pretending to be synchronized state" — so nothing here caches a
 * read. Offline, the app opens, says it is offline, and lets you write. That is the whole promise,
 * and it is one that can be kept.
 *
 * WHY IndexedDB AND NOT localStorage. localStorage is synchronous, string-only, and silently
 * capacity-bound; a capture lost because a quota was hit while the tab was closing is exactly the
 * failure this exists to prevent.
 *
 * THE MUTATION ID IS GENERATED HERE, ON PURPOSE. It is the same identity the server ledger keys
 * on, so a flush that is sent twice — because the reply was lost, or the tab was reopened
 * mid-send — is one write on the server, not two. The client does not have to know whether its
 * last request arrived, which is good, because it cannot.
 */

const DB_NAME = "boss-os-outbox";
const DB_VERSION = 1;
const STORE = "outbox";
const DEVICE_KEY = "boss-os-device-id";

export type OutboxKind = "open_loop";

export interface OutboxItem {
  mutationId: string;
  /** Generated on the client so the record has a stable identity before it has ever been sent. */
  recordId: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/**
 * The outbox announces its own changes.
 *
 * Without this the badge only moved when the browser's online/offline events fired, so a capture
 * written while already offline sat in IndexedDB with the reader told nothing — the exact silence
 * Batch 7's "visible offline/sync state" exists to prevent. The store is the source of truth and
 * anything that writes to it says so, rather than every caller remembering to.
 */
const CHANGED = "boss-outbox-changed";

function announce(): void {
  try {
    window.dispatchEvent(new CustomEvent(CHANGED));
  } catch {
    /* no window (a worker, a test harness): nothing is listening anyway */
  }
}

export function onOutboxChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "mutationId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

/**
 * This browser's device id.
 *
 * Stable per browser profile, and NOT an authorization: the passcode session is what authorizes a
 * flush. This exists so the server can attribute a mutation and keep a cursor, which is why losing
 * it is survivable — a new id is a new device row, not a lockout.
 */
export function deviceId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(DEVICE_KEY);
  } catch {
    id = null;
  }
  if (!id) {
    id = `dev_browser_${crypto.randomUUID()}`;
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      /* a private window gets a fresh device each session, which is correct rather than broken */
    }
  }
  return id;
}

export async function enqueue(kind: OutboxKind, payload: Record<string, unknown>): Promise<OutboxItem> {
  const item: OutboxItem = {
    mutationId: `mut_${crypto.randomUUID()}`,
    recordId: `loop_${crypto.randomUUID()}`,
    kind,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  await tx("readwrite", (s) => s.put(item));
  announce();
  return item;
}

export async function pending(): Promise<OutboxItem[]> {
  const all = await tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function pendingCount(): Promise<number> {
  try {
    return (await pending()).length;
  } catch {
    return 0;
  }
}

async function forget(mutationId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(mutationId));
  announce();
}

async function recordAttempt(item: OutboxItem, error: string): Promise<void> {
  await tx("readwrite", (s) => s.put({ ...item, attempts: item.attempts + 1, lastError: error }));
}

export interface FlushResult {
  sent: number;
  kept: number;
  conflicts: number;
}

/**
 * Send everything waiting.
 *
 * A conflict is NOT a failure to retry — retrying it would produce the same conflict for ever. It
 * leaves the outbox and becomes a conflict row on the server, which is where a person can see it.
 * A transport failure IS retried, and the item stays exactly where it was.
 */
export async function flush(): Promise<FlushResult> {
  const items = await pending().catch(() => [] as OutboxItem[]);
  if (items.length === 0) return { sent: 0, kept: 0, conflicts: 0 };

  let sent = 0;
  let kept = 0;
  let conflicts = 0;

  for (const item of items) {
    let res: Response;
    try {
      res = await fetch("/api/boss/sync/outbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId(),
          device_label: "Browser",
          mutation_id: item.mutationId,
          record_id: item.recordId,
          kind: item.kind,
          payload: item.payload,
        }),
      });
    } catch (err) {
      await recordAttempt(item, String(err));
      kept++;
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as any;
    if (res.ok && body?.ok) {
      const status = body?.data?.status;
      if (status === "CONFLICT") conflicts++;
      else sent++;
      await forget(item.mutationId);
    } else if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403) {
      /*
       * Keep it. 5xx and 429 are the server being unwell rather than the capture being wrong, and
       * 401/403 means the session lapsed while the note sat in the outbox — which unlocking fixes.
       * Dropping those would delete a note the reader wrote, to solve a problem that ends the
       * moment they type their passcode.
       */
      await recordAttempt(item, body?.error ?? `HTTP ${res.status}`);
      kept++;
    } else {
      /*
       * A 4xx is the server saying this will never be accepted — refused by the airlock, malformed,
       * or an entity that may not sync. Retrying for ever would be a queue that never drains and a
       * badge that never clears, so it is dropped with its reason recorded rather than pretended
       * about. The refusal is already on the server's record.
       */
      await recordAttempt(item, body?.error ?? `HTTP ${res.status}`);
      await forget(item.mutationId);
    }
  }
  return { sent, kept, conflicts };
}

/** Flush when the browser says we are back, and once on start in case we were closed offline. */
export function startAutoFlush(onChange?: (count: number) => void): () => void {
  const report = async () => onChange?.(await pendingCount());
  const run = async () => {
    if (!navigator.onLine) return report();
    await flush().catch(() => {});
    return report();
  };
  void run();
  const onOnline = () => void run();
  const onOffline = () => void report();
  const stopWatching = onOutboxChange(() => void report());
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  return () => {
    stopWatching();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
