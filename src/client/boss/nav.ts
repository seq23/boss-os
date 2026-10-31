/**
 * THE ADDRESSES HER EMAIL OPENS (24 Oct 2026). Every item in Simone's morning email links to its own
 * screen, so the address bar carries which one:
 *
 *   /?morning=<day>&item=<id>   one item of that morning (a decision, a deal, a finding, a done line)
 *   /?task=<id>                 one piece of work (what it waits on, in full)
 *   /?employee=<id>             one employee's open work (Today's "Monique: 1 open")
 *   /?view=briefing             Today, opened at Camille's briefing
 *   /?view=morning              Today, opened at "This morning's email"
 *   /?view=tell                 Today, at the "Tell Simone" box, cursor in it
 *
 * `go` moves there without reloading; the browser's Back returns to where she was.
 */
export type Route =
  | { kind: "morning"; day: string; item: string }
  | { kind: "task"; id: string }
  | { kind: "employee"; id: string }
  | { kind: "command"; id: string }
  | { kind: "mail"; id: string }
  | null;

export function readRoute(search = typeof window === "undefined" ? "" : window.location.search): Route {
  const q = new URLSearchParams(search);
  const day = q.get("morning");
  const item = q.get("item");
  if (day && item && /^\d{4}-\d{2}-\d{2}$/.test(day)) return { kind: "morning", day, item };
  const command = q.get("command");
  if (command) return { kind: "command", id: command };
  const mail = q.get("mail");
  if (mail) return { kind: "mail", id: mail };
  const task = q.get("task");
  if (task) return { kind: "task", id: task };
  const employee = q.get("employee");
  if (employee) return { kind: "employee", id: employee };
  return null;
}

export type Focus = "briefing" | "morning" | "tell" | "coach" | "gate";

/**
 * `?view=coach` opens a coach talk (the tough-love emails' "5-minute coach talk ›"), `?view=gate&gate=
 * morning` opens today's Morning gate in the list (their "Open today's Morning gate ›").
 */
export function readFocus(search = typeof window === "undefined" ? "" : window.location.search): Focus | null {
  const v = new URLSearchParams(search).get("view");
  return v === "briefing" || v === "morning" || v === "tell" || v === "coach" || v === "gate" ? v : null;
}

export function readGateFocus(search = typeof window === "undefined" ? "" : window.location.search): "morning" | "midday" | "night" | null {
  const q = new URLSearchParams(search);
  const g = q.get("gate");
  return q.get("view") === "gate" && (g === "morning" || g === "midday" || g === "night") ? g : null;
}

/** Today, scrolled to the "Tell Simone" box with the cursor in it (an employee page's "Tell Simone ↑"). */
export const tellSimoneHref = () => "/?view=tell";

export function go(href: string) {
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const morningHref = (day: string, item: string) => `/?morning=${encodeURIComponent(day)}&item=${encodeURIComponent(item)}`;
export const taskHref = (id: string) => `/?task=${encodeURIComponent(id)}`;
export const employeeHref = (id: string) => `/?employee=${encodeURIComponent(id)}`;

export const commandHref = (id: string) => `/?command=${encodeURIComponent(id)}`;
