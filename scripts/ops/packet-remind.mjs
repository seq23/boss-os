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
  /*
   * WHAT CHANGED LEADS, and for West Peek that means LP OUTREACH. Her description of the meeting:
   * "every wednesday i put together a packet for scooter to talk about what ive been working on and
   * what i did for west peek specifically. so we can talk about how many LPs i reached out to via my
   * twin agent."
   *
   * These numbers exist only here. Boss OS holds no LP row — her naming rule keeps counterparty
   * names out of it, and the outreach sheets already have them — so the Worker contributes the
   * agenda and this side contributes the week.
   */
  const lines = [
    `# West Peek — ${day}`,
    `_Since ${p.window.from}_`,
    "",
    "## What changed",
    "",
  ];

  if (lp) {
    lines.push(
      `**${lp.sent_in_window} LP outreach emails** went out this week, to ${lp.people_in_window} ` +
      `people across ${lp.firms_in_window} firms.`,
      "",
      `- New people contacted for the first time: ${lp.first_time_in_window}`,
      `- Follow-ups to people already in sequence: ${lp.sent_in_window - lp.first_time_in_window}`,
      `- Replies logged: ${lp.replies === null ? "not tracked in the sheet yet" : lp.replies}`,
      "",
      `_All time: ${lp.total} emails to ${lp.people} people across ${lp.firms} firms._`,
    );
  } else {
    /*
     * NO NUMBERS IS SAID OUT LOUD. A packet whose entire "what changed" section is silently missing
     * would be read as a quiet week rather than a broken read, and she would say so in the meeting.
     */
    lines.push("**The outreach sheet could not be read**, so this week's LP numbers are missing — " +
      "that is a failure to fetch, not a quiet week.");
  }

  /*
   * ── YOUR WEEK, AND IT IS LABELLED AS YOURS ────────────────────────────────
   *
   * "there is no packet to prepare me for the meeting with scooter (even if its empty this time) it
   * needs to show what ive accomplished in the week prior."
   *
   * Everything else in this file is written for a partner to read. Her week spans two businesses and
   * only one of them is his, so this section says whose it is rather than quietly putting brokerage
   * activity in front of a fund partner — the same separation rule that keeps the counters out of
   * "what changed".
   *
   * NOT PADDED. She said in advance that an empty answer is fine, which removes the only reason it
   * ever would be.
   */
  lines.push("", "## Your week (for you, not for him)", "");
  if ((p.accomplished ?? []).length === 0) {
    lines.push("_Nothing finished was recorded in the window. That is the honest answer, not a broken query._", "");
  } else {
    for (const a of p.accomplished) lines.push(`- **${a.business}** — ${a.line} _(${a.source})_`);
    lines.push("");
  }
  for (const g of p.accomplished_gaps ?? []) lines.push(`- _Not counted: ${g}_`);
  lines.push("");

  lines.push("", `## To raise (${p.to_raise.length})`, "");
  for (const i of p.to_raise) {
    lines.push(`### ${i.priority === 1 ? "**BLOCKING** — " : ""}${i.title}`);
    /*
     * HOW LONG HE HAS HAD IT, PRINTED. This item has appeared here worded identically every week
     * since 19 August and three weeks passed with nothing happening. An item that reads the same on
     * week one and week four is one the reader stops seeing; an item that says "you raised this 7
     * days ago and it is still not done" is a different sentence every week.
     */
    if (i.status === "raised" && i.raised_at) {
      const days = Math.max(0, Math.floor((Date.now() - i.raised_at) / 86400000));
      lines.push("", `_You raised this ${days} day${days === 1 ? "" : "s"} ago and it is still not done._`);
    }
    // The detail carries the handable click path and exact values, so the steps are IN the document
    // she takes into the meeting rather than somewhere she has to go and find them.
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
  const before = new Set(rows.filter((r) => String(r[0]).slice(0, 10) < sinceDay).map((r) => (r[5] ?? "").toLowerCase()));
  const emails = (rs) => new Set(rs.map((r) => (r[5] ?? "").toLowerCase()).filter(Boolean));

  /*
   * WINDOWED AND ALL-TIME ARE LABELLED SEPARATELY, because the first version was not. It printed
   * "146 this week" beside "213 people across 202 firms" where the 213 was every person ever
   * contacted — two different windows presented as one line, in a document whose only job is to be
   * accurate about a week.
   */
  const replyRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/Reply%20Log`, {
    headers: { authorization: `Bearer ${access}` },
  });
  const replyRows = replyRes.ok ? ((await replyRes.json()).values ?? []).slice(1).filter((r) => (r[0] ?? "").trim()) : null;

  return {
    total: rows.length,
    people: emails(rows).size,
    firms: new Set(rows.map((r) => r[3]).filter(Boolean)).size,
    sent_in_window: inWindow.length,
    people_in_window: emails(inWindow).size,
    firms_in_window: new Set(inWindow.map((r) => r[3]).filter(Boolean)).size,
    // A first-time contact is someone with no row before the window. That is the top-of-funnel
    // number; the rest are follow-ups, and conflating them overstates reach every week.
    first_time_in_window: [...emails(inWindow)].filter((e) => !before.has(e)).length,
    replies: replyRows === null ? null : replyRows.length,
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
  const doc = markdown(p, day, lp);
  await writeFile(path, doc);

  const blocking = p.to_raise.filter((i) => i.priority === 1);
  const top = blocking[0] ?? p.to_raise[0] ?? null;

  /*
   * ── AND IT GOES SOMEWHERE SHE CAN OPEN ────────────────────────────────────
   *
   * "id rather have a download link to the packet" · "u can have several meetings in one scrollable
   * page" · "i dont need a real page in boss OS that is stupid".
   *
   * For six weeks this file was written correctly and read by nobody: it lived on her Mac, Today
   * showed an empty Meetings section, and the one blocking item on it went unseen from 19 August to
   * 9 September. Filing it here is the fix — one URL that never changes, holding every agenda
   * newest-first, with a download for each.
   *
   * FILED BEFORE THE NOTIFICATION, ON PURPOSE. The notification is gone the moment it is dismissed;
   * the page is the durable half, so it goes first and its failure is named rather than swallowed.
   */
  const filed = await fetch(`${ORIGIN}/api/boss/packets`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      counterpart: COUNTERPART,
      day_id: day,
      markdown: doc,
      headline: top?.title ?? null,
      blocking: blocking.length > 0,
      source: FORCE ? "manual" : "launchd",
    }),
  });
  console.log(filed.ok
    ? `Filed to the agenda page: ${ORIGIN}/api/boss/packets/page`
    : `NAMED STOP [PACKET_NOT_FILED] the agenda page rejected it (${filed.status}): ${(await filed.text()).slice(0, 200)}`);

  console.log(`Packet written to ${path}`);
  // The log echoes the WEST PEEK line, not the Worker's headline — that one only says where the
  // numbers come from, which is true and useless in a log.
  console.log(lp
    ? `  ${lp.sent_in_window} LP emails this week · ${lp.first_time_in_window} new · ${lp.replies ?? "?"} replies`
    : "  LP numbers unavailable (sheet unreadable)");
  console.log(`  ${p.to_raise.length} to raise (${blocking.length} blocking)${p.misc?.length ? ` · ${p.misc.length} misc` : ""}`);

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

  /*
   * ── AND IT GOES IN HER INBOX, WHICH IS WHERE SHE ASKED FOR IT ─────────────
   *
   * "it should be in my inbox and my screen should either mirror it or say to check inbox."
   *
   * A notification is gone the moment it is dismissed and a markdown file on her laptop reached her
   * exactly never — this document has been generated correctly every Wednesday and consumed by
   * nothing. Today now mirrors the substance; the Inbox holds the part that is genuinely a decision.
   *
   * IT IS A DECISION AND NOT A FILING ACTION. "Did you raise these with him" changes what happens
   * next: approving stamps every open item as raised, so next Wednesday the grant item says how long
   * he has had it instead of arriving as though it were new. That is the whole reason three weeks
   * passed unnoticed. Raising something is still not the same as it being done — the grant item is
   * closed by the credential prober authenticating, never by her ticking a box.
   */
  const raise = await fetch(`${ORIGIN}/api/boss/judgement`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      employee_id: "emp_relationship",
      lane: "ops",
      risk: blocking.length ? "high" : "medium",
      title: `Wednesday packet — ${p.to_raise.length} to raise with Scooter`,
      question:
        `${top.title}. The full packet is at ${ORIGIN}/api/boss/packets/page — one link, every agenda, ` +
        "with the steps to hand him inline. " +
        "Approve once you have raised these with him and it records the date, so anything still not done " +
        "comes back next week saying how long he has had it. Try Again if you did not get to them, with a sentence saying why.",
      resume_kind: "meeting_packet_raised",
      // One packet docket at a time. Last week's unanswered one is replaced rather than stacked,
      // because two packets on the screen is a way to record the wrong week as raised.
      supersedes_key: "meeting_packet_raised",
    }),
  });
  console.log(raise.ok
    ? "Raised in her Inbox: approving it records that these were said out loud."
    : `NAMED STOP [PACKET_NOT_IN_INBOX] the docket could not be raised (${raise.status}). The file and the notification still went; the Inbox did not.`);
}

main().catch((err) => {
  console.error(`packet reminder failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
