import { useEffect, useState, type ReactNode } from "react";
import { Empty, Loading } from "./Shell";
import { ErrorNotice } from "./Notice";

/**
 * THE PANEL CHASSIS — one loader, one row, three named states.
 *
 * Lifted out of `pages/Systems.tsx` when Stage 3's dispatch surface arrived, because the Backends
 * screens need exactly the same guarantees and copying them would have been copying the two
 * incidents they encode (see `asList` and `Panel` below). One definition means one place to fix.
 *
 * Nothing here changed in the lift: the behaviour is byte-for-byte what Systems shipped.
 */

/**
 * A LIST MUST SPEAK WHILE IT IS LOADING.
 *
 * Three states, all named. Loading says so, a failure says what happened and keeps the page, and
 * an empty result says it is empty rather than rendering a blank rectangle that looks like
 * something is still coming.
 */
export function usePanel<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    load()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { data, error, reload: () => setNonce((n) => n + 1), setError };
}

export function Panel({
  title,
  hint,
  state,
  children,
}: {
  title: string;
  hint: string;
  state: { data: unknown; error: unknown };
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <p className="eyebrow">{title}</p>
      <ErrorNotice error={state.error} />
      {state.error ? null : state.data === null ? <Loading /> : isEmpty(state.data) ? <Empty title="Nothing here yet" hint={hint} /> : children}
    </section>
  );
}

/**
 * Coerce a payload to a list, because `?.map` is not the guard it looks like.
 *
 * These endpoints are typed `any` on the client, and several of them return an OBJECT that wraps
 * the rows rather than the rows themselves. `data?.map(...)` survives null and undefined and then
 * walks straight into `data.map is not a function` on `{ flags: [...] }` — an uncaught TypeError,
 * which in React 18 unmounts the whole tree. The E2E suite caught exactly that: one governance
 * endpoint returned a wrapper and the entire Boss OS app went blank, tab bar and all.
 *
 * So no panel calls `.map` on a payload again. Anything that is not a list becomes one, and a
 * shape nobody anticipated renders as empty rather than taking the app down.
 */
export function asList(d: unknown): any[] {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") {
    for (const v of Object.values(d as Record<string, unknown>)) if (Array.isArray(v)) return v;
  }
  return [];
}

export function isEmpty(d: unknown) {
  if (d === null || d === undefined) return true;
  if (Array.isArray(d)) return d.length === 0;
  if (typeof d === "object") return Object.keys(d as object).length === 0;
  return false;
}

export function Row({ title, sub, val }: { title: string; sub?: string; val?: string }) {
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </div>
      {val && <div className="row-val">{val}</div>}
    </div>
  );
}

export function text(v: unknown, fallback = "—") {
  if (v === null || v === undefined || v === "") return fallback;
  return String(v);
}

/**
 * A JSON ARRAY COLUMN, WHICHEVER SHAPE IT ARRIVES IN.
 *
 * `capabilities`, `allowed_kinds`, `forbidden_actions`, `files_touched` and `commands` are TEXT
 * columns holding JSON. Whether the row is parsed before it reaches the client is the server's
 * business and has changed before, so this accepts both — an already-parsed array, or the raw
 * string — and, crucially, never throws on a shape it does not recognise. A malformed value
 * renders as nothing, which the caller states, rather than unmounting the tree.
 */
export function jsonList(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return v.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}
