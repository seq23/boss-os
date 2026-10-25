/**
 * HER ONE-TAP SEND / CHANGE / TRY AGAIN ON A DRAFT SIMONE WROTE FOR A PERSON.
 *
 * Served at /tap/<token> through the same door as the LP taps (routes/lpTap.ts hands any `cmd…`
 * token here). A GET never acts: it renders a confirm page whose own POST does. Send approves
 * EXACTLY the words her email showed and nothing else; Change asks what to change; Try again
 * redrafts. A used or unknown token says "this link has done its job".
 */
import type { Context } from "hono";
import type { Env } from "../env";
import { approveAndSend, redraft, getCommand } from "./run";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
function page(title: string, line: string, extra = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font:17px/1.5 -apple-system,system-ui,sans-serif;background:#faf8f5;color:#222;margin:0;padding:48px 20px;text-align:center}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;color:#555}textarea{width:100%;max-width:520px;min-height:120px;font:inherit;padding:12px;border-radius:10px;border:1px solid #ccc;box-sizing:border-box}
button{font:inherit;padding:14px 28px;border-radius:10px;border:0;background:#1f4d3a;color:#fff;margin-top:12px}
</style></head><body><h1>${esc(title)}</h1><p>${esc(line)}</p>${extra}</body></html>`;
}

export function isCommandToken(token: string): boolean {
  return /^cmd[A-Za-z0-9]{20,37}$/.test(token);
}

async function find(env: Env, token: string) {
  const r = await env.DB.prepare(`SELECT id FROM boss_commands WHERE tap_token = ?`).bind(token).first<{ id: string }>();
  return r ? getCommand(env, r.id) : null;
}

export async function commandTapGet(c: Context<any>, token: string): Promise<Response> {
  const action = c.req.query("do") ?? "";
  const row = await find(c.env as Env, token);
  if (!row || ["sent", "cancelled"].includes(row.state)) return c.html(page("This link has done its job", row?.state === "sent" ? "That email has already gone." : "Nothing else to do here."));
  if (action === "change") {
    return c.html(page("What should change?", "Say it the way you'd say it to Simone. Nothing is sent; the new version comes back to you first.",
      `<form method="post" action="?do=change"><textarea name="note" required></textarea><br><button type="submit">Change it</button></form>`));
  }
  const verbs: Record<string, string> = { send: "Sending your email…", retry: "Writing a fresh version…" };
  if (!verbs[action]) return c.html(page("This link has done its job", "Nothing else to do here."));
  return c.html(page(verbs[action]!, "One moment.",
    `<form id="f" method="post" action="?do=${action}"><button type="submit">Tap to confirm</button></form><script>document.getElementById("f").submit();</script>`));
}

export async function commandTapPost(c: Context<any>, token: string): Promise<Response> {
  const env = c.env as Env;
  const action = c.req.query("do") ?? "";
  const row = await find(env, token);
  if (!row || ["sent", "cancelled"].includes(row.state)) return c.html(page("This link has done its job", "Nothing else to do here."));
  if (action === "send") {
    const line = await approveAndSend(env, row);
    return c.html(page(/^Sent/.test(line) ? "Sent" : /^Held/.test(line) ? "Held until it's live" : "Not sent", line));
  }
  if (action === "retry") return c.html(page("Rewriting it", await redraft(env, row, null)));
  if (action === "change") {
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const note = String((form as Record<string, unknown>).note ?? "").trim().slice(0, 2000);
    if (!note) return c.html(page("What should change?", "Nothing was written, so nothing changed."));
    return c.html(page("Changing it", await redraft(env, row, note)));
  }
  return c.html(page("This link has done its job", "Nothing else to do here."));
}
