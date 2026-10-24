/**
 * THE ADDRESSES HER EMAIL OPENS (24 Oct 2026). Every item in Simone's morning email links to its own
 * screen, so the address bar carries which one:
 *
 *   /?morning=<day>&item=<id>   one item of that morning (a decision, a deal, a finding, a done line)
 *   /?task=<id>                 one piece of work (what it waits on, in full)
 *   /?employee=<id>             one employee's open work (Today's "Monique: 1 open")
 *   /?view=briefing             Today, opened at Camille's briefing
 *   /?view=morning              Today, opened at "This morning's email"
 *
 * `go` moves there without reloading; the browser's Back returns to where she was.
 */
export type Route =
  | { kind: "morning"; day: string; item: string }
  | { kind: "task"; id: string }
  | { kind: "employee"; id: string }
  | null;

export function readRoute(search = typeof window === "undefined" ? "" : window.location.search): Route {
  const q = new URLSearchParams(search);
  const day = q.get("morning");
  const item = q.get("item");
  if (day && item && /^\d{4}-\d{2}-\d{2}$/.test(day)) return { kind: "morning", day, item };
  const task = q.get("task");
  if (task) return { kind: "task", id: task };
  const employee = q.get("employee");
  if (employee) return { kind: "employee", id: employee };
  return null;
}

export function readFocus(search = typeof window === "undefined" ? "" : window.location.search): "briefing" | "morning" | null {
  const v = new URLSearchParams(search).get("view");
  return v === "briefing" || v === "morning" ? v : null;
}

export function go(href: string) {
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const morningHref = (day: string, item: string) => `/?morning=${encodeURIComponent(day)}&item=${encodeURIComponent(item)}`;
export const taskHref = (id: string) => `/?task=${encodeURIComponent(id)}`;
export const employeeHref = (id: string) => `/?employee=${encodeURIComponent(id)}`;
