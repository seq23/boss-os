/**
 * PUT THE WEDNESDAY PACKET IN FRONT OF HER, RATHER THAN ON A PAGE SHE MIGHT OPEN.
 *
 * The packet has been built and correct since it shipped, and it lives inside the Meetings block on
 * Today. That is the same shape as every defect this system keeps producing: a finished thing whose
 * only route to her is a screen she has to remember to look at. Her instruction was exactly that —
 * "build the wednesday packet reminder so i actually see it".
 *
 * ─── Two deliveries, because one of them always fails ───────────────────────
 *
 *   · A macOS notification, which is what "see it" means on a Wednesday morning.
 *   · A markdown file on disk, because a notification is gone the moment it is dismissed and a
 *     record of the week is something to have open in the meeting, not glanced at before it.
 *
 * The notification carries the single most important line — the top blocking item — not a summary.
 * "You have 3 items" is a notification she learns to swipe away; "Ask Scooter for the Google grant"
 * is one she acts on.
 *
 * ─── Wednesday morning, which was her call and not mine ─────────────────────
 *
 * I built it to fire Tuesday evening as well, on the reasoning that a blocking item needs hours to
 * act on. Asked directly, she wanted Wednesday morning only. That is the right answer for what the
 * packet turned out to be FOR — showing him the work — because a record of the week is read on the
 * way into the meeting, not acted on the night before. Two reminders for a document you read once
 * is how a notification becomes something to swipe away.
 *
 * ─── It is quiet when there is nothing ──────────────────────────────────────
 *
 * No open items and a week where nothing moved produces no notification at all. A reminder that
 * fires every week regardless is one she stops reading, and then the week it mattered looks exactly
 * like the forty before it.
 */

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const OUT_DIR = process.env.BOSS_OS_PACKET_DIR ?? `${process.env.HOME}/.boss-os/packets`;
const COUNTERPART = process.env.PACKET_COUNTERPART ?? "scooter";
const FORCE = process.argv.includes("--force");

/** macOS notification. Silent by design: this is a nudge, not an alarm. */
async function notify(title, subtitle, body) {
  const { execFile } = await import("node:child_process");
  const esc = (s) => String(s).replace(/["\\]/g, "\\$&").slice(0, 220);
  const script = `display notification "${esc(body)}" with title "${esc(title)}" subtitle "${esc(subtitle)}"`;
  return new Promise((resolve) => execFile("osascript", ["-e", script], () => resolve()));
}

function markdown(p, day, lp) {
  /*
   * WHAT CHANGED LEADS, which was her answer and not my guess. I had put the blocking asks first;
   * she wanted "what changed since last Wednesday". A partner meeting opens on movement, and the
   * asks read better once he knows what the week actually contained.
   */
  const lines = [
    `# West Peek — ${day}`,
    `_Since ${p.window.from}_`,
    "",
    `## What changed`,
    "",
    p.headline,
    "",
    `- Deals advanced: ${p.done.deals_advanced}`,
    `- Counterparties touched: ${p.done.touches_logged}`,
    `- Buyer candidates reviewed: ${p.done.candidates_reviewed}`,
    `- Loops closed: ${p.done.loops_closed}`,
  ];

  /*
   * THE LP NUMBERS COME FROM HERE, NOT FROM BOSS OS, because only this side can read the sheets.
   * The Worker computes what it holds; this process holds Sheets access. Splitting it the other way
   * would mean either putting LP rows into the OS — which her naming rule forbids — or a packet that
   * is silent about the thing the meeting is actually about.
   */
  if (lp) {
    lines.push(
      `- LP outreach sent: ${lp.sent_in_window} this week (${lp.total} logged all-time)`,
      `- People reached: ${lp.people} across ${lp.firms} firms`,
    );
  }

  lines.push("", `## To raise (${p.to_raise.length})`, "");
  for (const i of p.to_raise) {
    lines.push(`### ${i.priority === 1 ? "**BLOCKING** — " : ""}${i.title}`);
    if (i.detail) lines.push("", i.detail);
    lines.push("");
  }
  if (p.to_raise.length === 0) lines.push("_Nothing outstanding._", "");

  // The flex section: one-offs nothing derives and nothing ever will.
  if (p.misc?.length) {
    lines.push("## Also", "");
    for (const i of p.misc) lines.push(`- ${i.title}${i.detail ? ` — ${i.detail}` : ""}`);
    lines.push("");
  }
  // What the packet cannot see is part of the packet — otherwise she walks in believing it complete.
  lines.push("## Not in here", "");
  for (const g of p.gaps) lines.push(`- ${g}`);
  return lines.join("\n");
}

/**
 * LP outreach volume, read straight from the Twin log.
 *
 * FAILS SOFT AND SILENTLY BY DESIGN. If the sheet cannot be read the packet still arrives without
 * these two lines, because a reminder that does not fire is worse than one missing a number — and
 * the packet's own "not in here" section already says what it could not see.
 */
async function lpNumbers(sinceDay) {
  const SHEET = process.env.LP_SOURCE_SHEET ?? "1Riww0SiaLb_vxHjUpruSdkNemBEndcQrDQgu7Ly9rRA";
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) return null;

  const { createSign } = await import("node:crypto");
  const b64 = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // As itself, not impersonating: the sheet was shared with the service account directly.
  const cl = b64(JSON.stringify({
    iss: creds.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sg = createSign("RSA-SHA256"); sg.update(`${h}.${cl}`);
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${h}.${cl}.${b64(sg.sign(creds.private_key))}`,
    }),
  });
  if (!tok.ok) return null;
  const access = (await tok.json()).access_token;

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/Sent%20Log`, {
    headers: { authorization: `Bearer ${access}` },
  });
  if (!res.ok) return null;
  const rows = ((await res.json()).values ?? []).slice(1).filter((r) => (r[0] ?? "").trim());
  const inWindow = rows.filter((r) => String(r[0]).slice(0, 10) >= sinceDay);
  return {
    total: rows.length,
    sent_in_window: inWindow.length,
    people: new Set(rows.map((r) => (r[5] ?? "").toLowerCase()).filter(Boolean)).size,
    firms: new Set(rows.map((r) => r[3]).filter(Boolean)).size,
  };
}

async function main() {
  const now = new Date();
  const weekday = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" })
    .format(now).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (d) => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[d]));

  if (!FORCE && weekday !== 3) {
    // Not Wednesday. Says so and exits rather than firing something she did not ask for.
    console.log("Not Wednesday; nothing to remind about.");
    return;
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/today/packet/${COUNTERPART}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`packet failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const p = (await res.json()).data;

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(OUT_DIR, { recursive: true });
  const lp = await lpNumbers(p.window.from).catch(() => null);
  const path = join(OUT_DIR, `${day}-${COUNTERPART}.md`);
  await writeFile(path, markdown(p, day, lp));

  const blocking = p.to_raise.filter((i) => i.priority === 1);
  const top = blocking[0] ?? p.to_raise[0] ?? null;

  console.log(`Packet written to ${path}`);
  console.log(`  ${p.headline}`);
  console.log(`  ${p.to_raise.length} to raise (${blocking.length} blocking)`);

  if (!top) {
    // Nothing to say. Silence is the correct output, and it is stated for the log.
    console.log("Nothing outstanding, so no notification was sent.");
    return;
  }

  await notify(
    "Today: West Peek",
    `${p.to_raise.length} to raise${blocking.length ? ` · ${blocking.length} blocking` : ""}`,
    top.title,
  );
  console.log(`Notified: ${top.title}`);
}

main().catch((err) => {
  console.error(`packet reminder failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
