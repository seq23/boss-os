/**
 * THE SMALL KIT ZORA'S AND TONI'S MAC DUTIES SHARE (22 Oct 2026).
 *
 * archive-audit.mjs, risk-watch.mjs and outside-locks.mjs each read a handful of sources, decide what
 * MOVED since the last run, and email her only about that. The four things they share live here so
 * there is one way to do each: reach Boss OS, send as an employee, ask her Claude session, and keep
 * the last state.
 *
 * QUIET UNLESS SOMETHING MOVES. Every reading is `{ key, state, line }` — state `ok`, `alert`, `stop`,
 * `paused`, or `notice` (a one-off item such as a receipt: news when first seen, never "cleared"). A reading is news only when
 * its state differs from the last run's — a new alert, a cleared alert, a new stop. A stop (a source
 * that cannot be read) is said once, plainly, and re-raised only when it changes (R16), never read as
 * "fine".
 *
 * RULE 0. `assertReadSomething` fails the run when every source was a stop: a watch that read nothing
 * is not a quiet day.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createSign } from "node:crypto";
import { seatEnv } from "./seat-env.mjs";
import { sendersFor, employeeMail, postEmployeeMail } from "../notify.mjs";
import { addMorningLines } from "../../../src/shared/boss/mail/morning.mjs";

export const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
export const OWNER_TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";

// ─── State: what the last run saw ──────────────────────────────────────────────

export function statePath(name) {
  return join(process.env.BOSS_OS_STATE_DIR ?? join(homedir(), ".boss-os", "duties"), `${name}.json`);
}

export function loadState(name) {
  try { const p = statePath(name); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {}; } catch { return {}; }
}

export function saveState(name, state) {
  const p = statePath(name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
}

/**
 * The readings whose state changed since `prev` (a `{ key: state }` map). A reading seen for the first
 * time is news unless it is `ok` — an ok on day one is not worth an email. Pure.
 */
export function movedReadings(readings, prev = {}) {
  const out = [];
  for (const r of readings) {
    const was = prev[r.key];
    if (was === undefined ? r.state !== "ok" : was !== r.state) out.push({ ...r, was: was ?? null });
  }
  // A key that was alerting and is no longer read at all has cleared by disappearance; say so.
  const now = new Set(readings.map((r) => r.key));
  for (const [key, was] of Object.entries(prev)) {
    if (!now.has(key) && was === "alert") out.push({ key, state: "cleared", line: `${key}: no longer present.`, was });
  }
  return out;
}

/** `{ key: state }` for the next run. */
export function stateMap(readings) {
  return Object.fromEntries(readings.map((r) => [r.key, r.state]));
}

/** Rule 0: every source a stop means the run read nothing. Returns the stop line, or null. */
export function readNothingStop(readings, code) {
  if (readings.length === 0) return `NAMED STOP [${code}] no source produced a reading at all.`;
  if (readings.every((r) => r.state === "stop")) return `NAMED STOP [${code}] every source was unreadable: ${readings.map((r) => r.key).join(", ")}.`;
  return null;
}

// ─── Boss OS ───────────────────────────────────────────────────────────────────

/** A signed-in client for Boss OS's API, through the vault's passcode. Throws a NAMED STOP sentence. */
export async function bossApi(fetchImpl = fetch) {
  if (!process.env.BOSS_PASSCODE) throw new Error("NAMED STOP [NO_PASSCODE] run through the vault: npm run vault:run -- node …");
  const unlock = await fetchImpl(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`NAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${unlock.status}).`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
  const call = async (method, path, body) => {
    const r = await fetchImpl(`${ORIGIN}/api/boss${path}`, {
      method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j?.error ?? j).slice(0, 160)}`);
    return j?.data ?? j;
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b) };
}

// ─── Mail ──────────────────────────────────────────────────────────────────────

/** Send as an employee through the one Resend path every Mac lane uses. Returns true on a send. */
export async function sendAs(who, { subject, text, html, prelaid = null, to = OWNER_TO }, fetchImpl = fetch) {
  const senders = sendersFor(who);
  for (const sender of senders) {
    const res = await postEmployeeMail(sender, employeeMail(sender, { to, subject, text, html, prelaid }), fetchImpl);
    if (res.ok) { console.log(`emailed ${to} as ${sender.from}`); return true; }
    console.error(`  ${sender.from} refused: ${res.status}`);
  }
  return false;
}

/**
 * INTO THE MORNING EMAIL, NOT A NEW EMAIL (owner, 23 Oct 2026, rule 1). Zora's audit, Toni's routine
 * risk and the tail reports add their lines (and any Decide item) to Simone's one morning email
 * (src/shared/boss/mail/morning.mjs). Returns true when written; a refused section is said by name.
 */
export function toMorning(section, add) {
  try { addMorningLines(section, add); console.log(`into the morning email (${section}): ${(add.lines ?? []).length} line(s), ${(add.decide ?? []).length} decision(s)`); return true; }
  catch (e) { console.error(`NAMED STOP [MORNING_SECTION_REFUSED] ${e?.message ?? e}`); return false; }
}

/**
 * A CHORE FOR THE TEAM, NEVER HER MAIL (rule 3): a source that cannot be read, a token missing a
 * permission, a DNS record — a task on Danielle's desk with what was seen. Best effort; returns the
 * reason it was not opened, or null.
 */
export async function fixJob(api, { title, prompt }) {
  try { await api.post("/tasks", { title: String(title).slice(0, 160), lane: "ops", employee_id: "emp_repo", input: { origin: "repair", repair_kind: "self_repair", prompt: `seq23/boss-os — ${prompt}` } }); return null; }
  catch (e) { return String(e?.message ?? e); }
}

// ─── Google, through the service account (delegation is granted per mailbox) ──

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function googleToken(scope, sub, fetchImpl = fetch) {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("NAMED STOP [NO_SERVICE_ACCOUNT] GSC_SERVICE_ACCOUNT_JSON is not in the vault run.");
  const creds = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: creds.client_email, sub, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(signer.sign(creds.private_key))}` }),
  });
  if (!res.ok) throw new Error(`token for ${sub} refused (${res.status})`);
  return (await res.json()).access_token;
}

/** Message ids, From and Subject for a Gmail search — metadata only, never a body. */
export async function gmailHeaders(token, q, max = 25, fetchImpl = fetch) {
  const g = async (u) => { const r = await fetchImpl(u, { headers: { authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`gmail ${r.status}`); return r.json(); };
  const list = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
  const out = [];
  for (const m of list.messages ?? []) {
    const msg = await g(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const h = Object.fromEntries((msg.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
    out.push({ id: m.id, from: h.from ?? "", subject: (h.subject ?? "").slice(0, 160), date: new Date(Number(msg.internalDate ?? Date.now())).toISOString().slice(0, 10) });
  }
  return out;
}

/** The sending domain of a From header, never the person. "Amazon KDP <x@amazon.com>" → "amazon.com". */
export function fromDomain(from) {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(String(from ?? ""));
  return m ? m[1].toLowerCase() : "unknown";
}

// ─── Her Claude session (the personal Gmail connector, the artifact gallery) ──

/**
 * One short `claude -p` on her seat (never an API key: `seatEnv` strips them), returning the JSON the
 * prompt asked for. `{ ok: true, json }` or `{ ok: false, why }` — the caller turns a failure into a
 * NAMED STOP reading for that source only.
 *
 * A MODEL WITHOUT THE TOOL WILL ANSWER ANYWAY (CONFIRMED 22 Oct 2026: asked to search Gmail, one run
 * answered `"gmail_tool": true` and the next `false`, with the same prompt). So an answer is accepted
 * only when the run's own event stream shows a call to a tool matching `requireTool` that came back
 * without an error. "[]" from a run that never reached the mailbox is a stop, not an empty mailbox.
 * Connector tools are deferred in headless runs; the prompt is prefixed with the ToolSearch step.
 */
export function askClaudeJson(prompt, { model = "claude-haiku-4-5-20251001", maxTurns = 12, timeoutMs = 300_000, requireTool = null, toolSearch = null, run = spawnSync } = {}) {
  const bin = process.env.CLAUDE_BIN ?? "claude";
  const full = toolSearch ? `First call ToolSearch with query "${toolSearch}" to load the tool. ${prompt}` : prompt;
  const r = run(bin, ["-p", full, "--model", model, "--max-turns", String(maxTurns), "--output-format", "stream-json", "--verbose"], {
    encoding: "utf8", timeout: timeoutMs, env: seatEnv(process.env), cwd: homedir(), maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) return { ok: false, why: `the claude CLI could not start (${r.error.code ?? r.error.message})` };
  if (r.status !== 0) return { ok: false, why: `the claude run exited ${r.status}` };
  return readClaudeStream(String(r.stdout ?? ""), requireTool);
}

/** Pure: the stream-json output of a run → `{ ok, json }` or `{ ok: false, why }`. */
export function readClaudeStream(stdout, requireTool = null) {
  const calls = new Map();
  let text = "";
  for (const line of stdout.split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(e?.message?.content) ? e.message.content : [];
    if (e.type === "assistant") for (const c of content) if (c?.type === "tool_use") calls.set(c.id, { name: String(c.name ?? ""), ok: null });
    if (e.type === "user") for (const c of content) if (c?.type === "tool_result" && calls.has(c.tool_use_id)) calls.get(c.tool_use_id).ok = c.is_error !== true;
    if (e.type === "result") text = String(e.result ?? "");
  }
  if (requireTool && ![...calls.values()].some((c) => requireTool.test(c.name) && c.ok === true)) {
    return { ok: false, why: `the run never reached the tool (no successful ${requireTool} call in its own event stream) — an answer without it would be a guess` };
  }
  const m = /```json\s*([\s\S]*?)```/.exec(text) ?? /(\{[\s\S]*\}|\[[\s\S]*\])\s*$/.exec(text.trim());
  if (!m) return { ok: false, why: "the claude run returned no JSON" };
  try { return { ok: true, json: JSON.parse(m[1]) }; } catch { return { ok: false, why: "the claude run returned JSON that does not parse" }; }
}
