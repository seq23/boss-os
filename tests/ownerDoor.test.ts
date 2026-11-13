/**
 * THE ONE DOOR: EVERY EMAIL TO HER MEETS THE REQUIRED MINIMUM AT THE SEND (Wave 4, 13 Nov 2026).
 *
 * The rule is REPAIR, NOT BLOCK (src/shared/boss/mail/ownerDoor.mjs). What is mechanical is repaired
 * on what would be sent; what cannot be repaired is held for the team (a named stop and a fix job);
 * an email that truly needs her today is never held. Proven here through the real `postEmployeeMail`
 * with a recording fetch (nothing is sent), and by a census of the code: every file that holds a
 * mail transport sends through the door or is a named outsider-only path; zero found is a failure.
 */
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { employeeMail, sendersFor, postEmployeeMail, throughTheDoor, errandMail, errandPayloadProblems, ownerTo } from "../scripts/ops/notify.mjs";
import { ownerDoor, eventKey, trulyNeedsHer } from "../src/shared/boss/mail/ownerDoor.mjs";
import { minimumProblems, ownerEmail } from "../src/shared/boss/mail/ownerLayout.mjs";

process.env.BOSS_OS_MAIL_KEY = process.env.BOSS_OS_MAIL_KEY ?? "test-key-not-real";
const TO = "o@example.com";
const as = (who: string) => sendersFor(who)[0]!;

/** A fetch that records every request and accepts a send; nothing leaves the machine. */
function recorder() {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: any, init?: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body });
    if (String(url) === "https://api.resend.com/emails") return new Response(JSON.stringify({ id: `re_${calls.length}` }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const sent = () => calls.filter((c) => c.url === "https://api.resend.com/emails").map((c) => c.body);
  return { f, calls, sent };
}
beforeEach(() => {
  process.env.BOSS_OS_HELD_MAIL_DIR = mkdtempSync(join(tmpdir(), "w4-held-"));
  process.env.BOSS_OS_SENT_MAIL_DIR = mkdtempSync(join(tmpdir(), "w4-sent-"));
  delete process.env.BOSS_PASSCODE;
});
const post = async (payload: any, who = "Simone") => { const r = recorder(); const res = await postEmployeeMail(as(who), payload, r.f, { seen: new Set() }); return { res, sent: r.sent() }; };
const held = () => readdirSync(process.env.BOSS_OS_HELD_MAIL_DIR!).map((n) => JSON.parse(readFileSync(join(process.env.BOSS_OS_HELD_MAIL_DIR!, n), "utf8")));

describe("the door repairs what is mechanical, and sends", () => {
  it("a sender that states no layout is no longer skipped: filed as a Note, line 1 written, sent meeting the minimum", async () => {
    const payload = employeeMail(as("Simone"), { to: TO, subject: "Your Mac backup finished", text: "The weekly backup finished at 9:05 am and all 3 folders copied." });
    expect((payload as any).minimum, "this sender stated no layout").toBeUndefined();
    const { res, sent } = await post(payload);
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    // Line 1 keeps the email's own opening sentence and adds whether she must do anything; said once.
    expect(sent[0].text.split("\n")[0]).toBe("The weekly backup finished at 9:05 am and all 3 folders copied. Nothing to do.");
    expect(sent[0].html).toContain("all 3 folders copied. Nothing to do.");
    expect(sent[0].text.match(/all 3 folders copied/g)).toHaveLength(1);
    expect(sent[0].headers["X-Boss-Layout"]).toBe("note");
    expect(minimumProblems(sent[0], throughTheDoor(as("Simone"), payload).payload.minimum)).toEqual([]);
  });

  it("no plain-text part: written from the HTML, links kept", async () => {
    const laid: any = ownerEmail({ who: "Simone", layout: "delivered", subject: "The number you asked for", why: "The number you asked for", happened: "Example Gym's front desk is 555 0100." });
    const payload: any = employeeMail(as("Simone"), { to: TO, subject: "", prelaid: laid });
    const d = ownerDoor({ ...payload, text: "", html: '<html><body><div><p>The number you asked for. Nothing to do.</p><p><a href="https://example.com/x?a=1&amp;b=2">Open it</a></p></div></body></html>' }, { minimum: payload.minimum, replyTo: "simone@sequoiataylor.com" });
    expect(d.problems).toEqual([]);
    expect(d.repaired.join()).toMatch(/no plain-text part/);
    expect(d.payload.text).toContain("Open it: https://example.com/x?a=1&b=2");
  });

  it('"Nothing to do" above a Decide list: line 1 says what is hers', () => {
    const laid: any = ownerEmail({ who: "Simone", layout: "note", subject: "An email to send for you", why: "I wrote the email you asked for", decide: [{ title: "Send it as written?" }] });
    const payload: any = employeeMail(as("Simone"), { to: TO, subject: "", prelaid: laid });
    const wrong = { ...payload.minimum, act: "Nothing to do." };
    const bad = { ...payload, text: payload.text.replace(/^.*$/m, "I wrote the email you asked for. Nothing to do.") };
    expect(minimumProblems(bad, wrong).join()).toMatch(/above a Decide list/);
    const d = ownerDoor(bad, { minimum: wrong });
    expect(d.problems).toEqual([]);
    expect(d.payload.text.split("\n")[0]).toBe("I wrote the email you asked for. One thing for you to answer below.");
  });

  it('"needs you" on an email that needs nothing: the phrase goes, in the subject and the body', async () => {
    const payload = employeeMail(as("Simone"), { to: TO, subject: "Kindle report: needs you", text: "All 4 books are live and selling. The report needs a look only if a number seems off.", owner: { layout: "note", why: "Your Kindle books are all live" } });
    const { res, sent } = await post(payload);
    expect(res.ok).toBe(true);
    expect(`${sent[0].subject}\n${sent[0].text}`).not.toMatch(/needs? (a look|you)/i);
    expect(sent[0].text.split("\n")[0]).toMatch(/Nothing to do\.$/);
  });

  it("raw ids, a path and a UTC stamp: moved to an attached file, line 1 still says what it is", async () => {
    // A payload built by hand (no layout cleaned it): what the door itself must make plain.
    const text = "The site check finished.\n\nRun tsk_m5guard0099 wrote ~/GitHub/example/out/report.json at 14:05:11Z.\n\nAll pages passed.";
    const payload = { from: as("Danielle").from, to: [TO], reply_to: as("Danielle").reply_to, subject: "The site check finished", text, html: `<p>${text}</p>` };
    const { res, sent } = await post(payload, "Danielle");
    expect(res.ok).toBe(true);
    expect(sent[0].text).not.toMatch(/tsk_m5guard0099|~\/GitHub|14:05:11Z/);
    expect(sent[0].text.split("\n")[0]).toBe("The site check finished. Nothing to do.");
    expect(sent[0].text.match(/The site check finished/g)).toHaveLength(1);
    expect(sent[0].text).toContain("All pages passed.");
    expect(sent[0].attachments.map((a: any) => a.filename)).toContain("details.txt");
    // And the layout's own cleaner reads a machine stamp's clock as her time, whole.
    const laid = employeeMail(as("Danielle"), { to: TO, subject: "The site check finished", text: "The check ran at 14:05:11Z and passed.", owner: { layout: "note", why: "The site check you asked for finished" } });
    expect(laid.text).not.toMatch(/:11Z|\dZ\b/);
  });

  it("no subject, no Reply-To, a copy to someone else, a missing REF: each repaired", () => {
    const laid: any = ownerEmail({ who: "Danielle", layout: "approve", subject: "Plan for example-site", why: "A plan for the example-site change you asked for", act: "Reply approved to go ahead", ref: "rc_m5sneg0001", decide: [{ title: "Reply approved to go ahead" }] });
    const payload: any = employeeMail(as("Danielle"), { to: TO, subject: "", prelaid: laid });
    const broken = { ...payload, subject: "", reply_to: "", cc: ["someone@example.com"] };
    expect(minimumProblems(broken, payload.minimum).length).toBeGreaterThanOrEqual(3);
    const d = ownerDoor(broken, { minimum: payload.minimum, replyTo: "danielle@sequoiataylor.com" });
    expect(d.problems).toEqual([]);
    expect(d.payload.subject).toContain(payload.minimum.ref);
    expect(d.payload.reply_to).toBe("danielle@sequoiataylor.com");
    expect(d.payload.cc).toBeUndefined();
    expect(d.repaired.length).toBeGreaterThanOrEqual(3);
  });

  it("one email per event in a run: the second about the same event is not sent, and says so", async () => {
    const r = recorder(); const seen = new Set<string>();
    const mk = () => employeeMail(as("Simone"), { to: TO, subject: "The table is booked", text: "Example Cafe has your table for two on Saturday at 7:30 pm.", owner: { layout: "delivered", why: "The table you asked for is booked" } });
    const a = await postEmployeeMail(as("Simone"), mk(), r.f, { seen });
    const b = await postEmployeeMail(as("Simone"), mk(), r.f, { seen });
    expect(a.ok && b.ok).toBe(true);
    expect(((await b.json()) as any).duplicate).toBe(true);
    expect(r.sent()).toHaveLength(1);
    // A different event still goes; a refused send is not remembered as sent.
    const other = employeeMail(as("Simone"), { to: TO, subject: "The cake is ordered", text: "Example Bakery has the order.", owner: { layout: "delivered", why: "The cake you asked for is ordered" } });
    expect(eventKey(other)).not.toBe(eventKey(mk()));
    await postEmployeeMail(as("Simone"), other, r.f, { seen });
    expect(r.sent()).toHaveLength(2);
    const refuse = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const seen2 = new Set<string>();
    await postEmployeeMail(as("Simone"), mk(), refuse, { seen: seen2 });
    expect(seen2.size).toBe(0);
  });
});

describe("what cannot be repaired is held for the team; what truly needs her today is never held", () => {
  // Nothing in it says what it is: no subject, and every line is a code the plain gate must take out.
  const empty = () => ({ from: as("Simone").from, to: [TO], reply_to: as("Simone").reply_to, subject: "", text: "tsk_m5guard0100 rc_m5guard0101\n\ncmd_m5guard0102", html: "<p>tsk_m5guard0100 rc_m5guard0101</p>" });

  it("held: not sent, written down with its problems, a refused Response, never a question to her", async () => {
    const { res, sent } = await post(empty());
    expect(sent, "an unrepairable email reached her").toHaveLength(0);
    expect(res.status).toBe(422);
    const copy = held();
    expect(copy).toHaveLength(1);
    expect(copy[0].problems.length).toBeGreaterThan(0);
    expect(copy[0].sent_anyway).toBeUndefined();
  });

  it("never held when it truly needs her today: it goes with the best repair, and the problem is written down for the team", async () => {
    const laid: any = ownerEmail({ who: "Simone", layout: "approve", subject: "An email to send for you", why: "I wrote the email you asked for to Example Gym", ref: "cmd_m5guard0200", decide: [{ title: "Send it as written?", buttons: [{ label: "Send as is", url: "https://boss.sequoiataylor.com/tap/tokBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB?do=send" }] }] });
    const payload: any = employeeMail(as("Simone"), { to: TO, subject: "", prelaid: laid });
    // The job token is lost on the way: the door cannot invent it, so the minimum cannot be met.
    const broken: any = { ...payload, headers: { "X-Boss-Layout": "approve", "X-Boss-Owner-Line": "1" } };
    Object.defineProperty(broken, "minimum", { value: payload.minimum, enumerable: false });
    const door = throughTheDoor(as("Simone"), broken);
    expect(door.problems.join()).toMatch(/job token/);
    expect(door.mustGo).toBe(true);
    const { res, sent } = await post(broken);
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Decide (1)");
    const copy = held();
    expect(copy).toHaveLength(1);
    expect(copy[0].sent_anyway).toBe(true);
  });

  it("negative: the same unrepairable email about the system's own work (not hers) is held, not sent", async () => {
    const laid: any = ownerEmail({ who: "Camille", layout: "alarm", subject: "Stopped: the weekly queue job", why: "The weekly queue job stopped", act: "Reply restart to run it again", ref: "tsk_m5guard0300", broke: "The weekly queue job stopped after three tries.", doing: "The team is looking at it.", status: "Not fixed yet." });
    const payload: any = employeeMail(as("Camille"), { to: TO, subject: "", prelaid: laid });
    const broken: any = { ...payload, headers: { "X-Boss-Layout": "alarm", "X-Boss-Owner-Line": "1", "X-Boss-Kind": "problem" } };
    Object.defineProperty(broken, "minimum", { value: payload.minimum, enumerable: false });
    expect(trulyNeedsHer(broken, payload.minimum)).toBe(false);
    const { res, sent } = await post(broken, "Camille");
    expect(sent).toHaveLength(0);
    expect(res.status).toBe(422);
  });

  it("nowhere to send it is a named stop, never a guess: no recipient, nothing posted", async () => {
    expect(ownerTo({})).toBe("");
    expect(ownerTo({ BOSS_NOTIFY_TO: "x@example.com" })).toBe("x@example.com");
    const payload = employeeMail(as("Simone"), { to: ownerTo({}), subject: "Your Mac backup finished", text: "It finished.", owner: { layout: "note", why: "Your Mac backup finished" } });
    const { res, sent } = await post(payload);
    expect(sent).toHaveLength(0);
    expect(((await res.json()) as any).message).toMatch(/^NAMED STOP \[NO_OWNER_ADDRESS\]/);
  });

  it("an errand (a letter to a business) can never be addressed to her: her mail has one door", () => {
    expect(errandPayloadProblems(errandMail({ to: "desk@example.com", subject: "A table for two", text: "Hello" }), { owner: TO })).toEqual([]);
    expect(errandPayloadProblems(errandMail({ to: TO, subject: "A table for two", text: "Hello" }), { owner: TO }).join()).toMatch(/addressed to the owner/);
  });
});

// ─── The census: every send in the code goes through the door ───────────────────────────────────

/** A mail transport in code: Resend, Gmail send, a held draft's send, the Worker's reply or forward. */
const TRANSPORT = /api\.resend\.com\/emails|messages\/send|drafts\/send|\bmessage\.reply\(|\.forward\(|new EmailMessage\(/;
/** The door itself, on the Mac and on the Worker. */
const DOOR = /\bthroughTheDoor\(|\bthroughOwnerDoor\(/;
/** Transports that cannot address her, each with why. A stale entry (gone, or no longer a transport) fails. */
const OUTSIDERS_ONLY: Record<string, string> = {
  "scripts/ops/lp-prospects.mjs": "LP prospect letters from her Workspace mailbox, to the prospect; her own copy is the morning email",
  "src/worker/boss/routes/lpTap.ts": "sends a held LP reply draft on her tap, to the LP it answers",
  "src/mail-fanout/index.ts": "forwards an outsider's own email unchanged; composes nothing",
  "src/worker/effects/resendClient.ts": "the inherited West Peek chassis client, switched off (WP_OS_EMAIL_SEND) and behind a human-approved receipt; an approved letter to an outsider",
  "src/worker/effects/googleClient.ts": "the inherited West Peek chassis client: an approved letter from her connected Gmail to an outsider, behind a human-approved receipt",
};
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(m?js|ts)$/.test(n) && !/\.d\.m?ts$/.test(n) ? [p] : [];
  });
}
const realFiles = () => ["scripts", "src"].flatMap(walk)
  .filter((p) => !/(?:^|\/)(?:validate|tests?|fixtures)\//.test(p) && !/^src\/client\//.test(p))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));

/** Every file with a transport that neither sends through the door nor is a named outsider-only path. */
function bypasses(files: { path: string; text: string }[], exempt = OUTSIDERS_ONLY) {
  const withTransport = files.filter((f) => TRANSPORT.test(code(f.text)));
  const problems: string[] = [];
  if (!withTransport.length) problems.push("no file with a mail transport was found: the patterns went stale, the guard sees nothing");
  for (const f of withTransport) if (!DOOR.test(code(f.text)) && !exempt[f.path]) problems.push(`${f.path} sends mail without going through the door`);
  for (const p of Object.keys(exempt)) {
    const f = files.find((x) => x.path === p);
    if (!f) problems.push(`stale exemption: ${p} is gone`);
    else if (!TRANSPORT.test(code(f.text))) problems.push(`stale exemption: ${p} no longer sends mail`);
  }
  return { problems, found: withTransport.map((f) => f.path) };
}

describe("a sender that bypasses the door fails (the census over the code)", () => {
  const files = realFiles();
  it("the real code is clean, and the census saw the real senders", () => {
    const r = bypasses(files);
    expect(r.problems).toEqual([]);
    expect(r.found.length, "zero senders found is a failure, never a pass").toBeGreaterThanOrEqual(6);
    for (const must of ["scripts/ops/notify.mjs", "src/worker/boss/mail/history.ts", "src/worker/boss/outreach/gmail.ts", "src/worker/boss/commands/google.ts"]) expect(r.found).toContain(must);
  });
  it("on the Mac, only notify.mjs holds the Resend post, and the door runs before it in postEmployeeMail", () => {
    const resend = files.filter((f) => f.path.startsWith("scripts/") && /api\.resend\.com\/emails/.test(code(f.text))).map((f) => f.path);
    expect(resend).toEqual(["scripts/ops/notify.mjs"]);
    const src = code(files.find((f) => f.path === "scripts/ops/notify.mjs")!.text);
    const fn = src.slice(src.indexOf("export async function postEmployeeMail("), src.indexOf("export function plainOrSimplified("));
    expect(fn.indexOf("throughTheDoor(")).toBeGreaterThan(-1);
    expect(fn.indexOf("throughTheDoor(")).toBeLessThan(fn.indexOf("fetchImpl(RESEND"));
    // Every Mac sender to her calls the door's own functions; none builds a Resend request itself.
    const callers = files.filter((f) => f.path.startsWith("scripts/ops/") && /\b(?:postEmployeeMail|sendAsEmployee|sendAs)\(/.test(code(f.text)));
    expect(callers.length).toBeGreaterThanOrEqual(10);
  });
  it("on the Worker, each send calls the door BEFORE its transport", () => {
    for (const p of ["src/worker/boss/mail/history.ts", "src/worker/boss/outreach/gmail.ts", "src/worker/boss/commands/google.ts"]) {
      const src = code(files.find((f) => f.path === p)!.text);
      const at = src.search(/\bthroughOwnerDoor\(\s*(?:env|this\.env)/);
      const send = Math.max(src.lastIndexOf("message.reply("), src.lastIndexOf("messages/send`"), src.lastIndexOf("fetchImpl(GMAIL_SEND"));
      expect(at, p).toBeGreaterThan(-1);
      expect(at, `${p}: the door runs after the send`).toBeLessThan(send);
    }
  });
  it("negative: a new file that posts to Resend itself is caught", () => {
    const r = bypasses([...files, { path: "scripts/ops/new-sender.mjs", text: 'await fetch("https://api.resend.com/emails", { method: "POST", body });' }]);
    expect(r.problems).toContain("scripts/ops/new-sender.mjs sends mail without going through the door");
  });
  it("negative: a Worker file that replies or sends through Gmail without the door is caught", () => {
    for (const text of ['await message.reply({ from, subject, text });', 'await fetch(`${GMAIL}/messages/send`, { method: "POST" });']) {
      expect(bypasses([...files, { path: "src/worker/boss/new/route.ts", text }]).problems).toContain("src/worker/boss/new/route.ts sends mail without going through the door");
    }
  });
  it("negative: a transport named only in a comment is not a sender; zero files is a failure; a stale exemption is caught", () => {
    expect(bypasses([...files, { path: "src/worker/boss/x.ts", text: "// the Worker's only outbound mail is message.reply() on a live event\nexport const a = 1;" }]).problems).toEqual([]);
    expect(bypasses([]).problems.join()).toMatch(/the guard sees nothing/);
    expect(bypasses(files, { ...OUTSIDERS_ONLY, "src/worker/boss/gone.ts": "was a sender" }).problems).toContain("stale exemption: src/worker/boss/gone.ts is gone");
    expect(bypasses(files, { ...OUTSIDERS_ONLY, "src/shared/boss/mail/plain.mjs": "never was" }).problems).toContain("stale exemption: src/shared/boss/mail/plain.mjs no longer sends mail");
  });
});

// ─── The measurement: emails to her per week, and asks that were not hers ───────────────────────
// @ts-expect-error — plain ESM with no declaration file
import { countOwnerMail } from "../scripts/ops/owner-mail-count.mjs";

describe("the weekly count reads only her mail, and names an ask about the system's own work", () => {
  const rows = [
    { to_addr: "o@example.com", subject: "Friday: 2 decisions, 9 new deals", layout: "digest", delivery_state: "sent" },
    { to_addr: "o@example.com", subject: "Plan for example-site · v2 · REF BOS-TWGXD4", layout: "approve", delivery_state: "sent" },
    { to_addr: "o@example.com", subject: "Stopped: Weekly Sourcing Sweep · REF BOS-GFZ34J", layout: "alarm", delivery_state: "sent" },
    { to_addr: "o@example.com", subject: "Reminder: Prospect emails stuck: 34 follow-ups due and not going out", layout: null, delivery_state: "sent" },
    { to_addr: "o@example.com", subject: "Kindle: A Synthetic Book is live on Amazon", layout: "delivered", delivery_state: "sent" },
    { to_addr: "o@example.com", subject: "A send that failed", layout: "note", delivery_state: "failed" },
    { to_addr: "desk@prospect.example", subject: "Re: a reading partnership", layout: null, delivery_state: "sent" },
    { to_addr: "someone@example.com", subject: "Could not do: a synthetic job", layout: null, delivery_state: "sent" },
  ];
  it("counts her emails only: not outreach, not a test's row to another address, not a failed send", () => {
    const c = countOwnerMail(rows, "O@example.com");
    expect(c.emails).toBe(5);
    expect(c.asks).toBe(3);
    expect(c.asksNotHers).toBe(2);
    expect(c.notHers.map((r: any) => r.subject)).toEqual([rows[2]!.subject, rows[3]!.subject]);
  });
  it("negative: an approval that is hers is an ask but never 'not hers'; no rows is zero, not a crash", () => {
    expect(countOwnerMail([rows[1]], "o@example.com")).toMatchObject({ emails: 1, asks: 1, asksNotHers: 0 });
    expect(countOwnerMail([], "o@example.com")).toMatchObject({ emails: 0, asksNotHers: 0 });
  });
});

describe("a repair never turns an ask into 'Nothing to do'", () => {
  it("a block of text that says it needs her keeps its ask: line 1 says something is hers, and the phrase stays", () => {
    const text = "The cafe wants a card to hold the table.\n\nNothing to decide — this is just so you know.\n\nReply with the card to use, or reply no to let it go.";
    const d = throughTheDoor(as("Simone"), { from: as("Simone").from, to: [TO], reply_to: as("Simone").reply_to, subject: "Your request needs you: they want a card", text, html: null });
    expect(d.problems).toEqual([]);
    expect(d.payload.text.split("\n")[0]).not.toMatch(/Nothing to do/);
    expect(d.payload.text.split("\n")[0]).toMatch(/for you to answer below\.$/);
    expect(d.payload.subject).toMatch(/needs you/);
    // The older shape's "Nothing to decide" line would contradict line 1: it goes.
    expect(d.payload.text).not.toMatch(/Nothing to decide/);
    expect(d.repaired.join()).toMatch(/Nothing to decide/);
    expect(d.mustGo).toBe(true);
  });
});
