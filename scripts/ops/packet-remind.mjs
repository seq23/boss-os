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
 *   · A macOS notification, which is what "see it" means at 5pm on a Tuesday.
 *   · A markdown file on disk, because a notification is gone the moment it is dismissed and the
 *     three items she needs to raise are not something to hold in your head until the morning.
 *
 * The notification carries the single most important line — the top blocking item — not a summary.
 * "You have 3 items" is a notification she learns to swipe away; "Ask Scooter for the Google grant"
 * is one she acts on.
 *
 * ─── Tuesday evening AND Wednesday morning ──────────────────────────────────
 *
 * Tuesday is the one that matters. A reminder at 6am on the day of the meeting is a reminder that
 * arrives too late to do anything about — the whole point of preparing a packet is the hours before
 * it, when an access grant can still be asked for. Wednesday's is the reread on the way in.
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

function markdown(p, day) {
  const lines = [
    `# West Peek — ${day}`,
    "",
    `## This week`,
    "",
    p.headline,
    "",
    `- Anchors kept: ${p.done.anchors_kept} · missed: ${p.done.anchors_missed} · unanswered: ${p.done.anchors_unanswered}`,
    `- Deals advanced: ${p.done.deals_advanced}`,
    `- Counterparties touched: ${p.done.touches_logged}`,
    `- Candidates reviewed: ${p.done.candidates_reviewed}`,
    `- Loops closed: ${p.done.loops_closed}`,
    "",
    `## To raise (${p.to_raise.length})`,
    "",
  ];
  for (const i of p.to_raise) {
    lines.push(`### ${i.priority === 1 ? "**BLOCKING** — " : ""}${i.title}`);
    if (i.detail) lines.push("", i.detail);
    lines.push("");
  }
  if (p.to_raise.length === 0) lines.push("_Nothing outstanding._", "");
  // What the packet cannot see is part of the packet — otherwise she walks in believing it complete.
  lines.push("## Not in here", "");
  for (const g of p.gaps) lines.push(`- ${g}`);
  return lines.join("\n");
}

async function main() {
  const now = new Date();
  const weekday = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" })
    .format(now).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (d) => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[d]));

  if (!FORCE && weekday !== 2 && weekday !== 3) {
    // Not a packet day. Says so and exits rather than firing something she did not ask for.
    console.log("Not Tuesday or Wednesday; nothing to remind about.");
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
  const path = join(OUT_DIR, `${day}-${COUNTERPART}.md`);
  await writeFile(path, markdown(p, day));

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
    weekday === 2 ? "Tomorrow: West Peek" : "Today: West Peek",
    `${p.to_raise.length} to raise${blocking.length ? ` · ${blocking.length} blocking` : ""}`,
    top.title,
  );
  console.log(`Notified: ${top.title}`);
}

main().catch((err) => {
  console.error(`packet reminder failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
