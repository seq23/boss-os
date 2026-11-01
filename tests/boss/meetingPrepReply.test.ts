/**
 * HER ANSWER TO "WHAT'S THIS MEETING ABOUT?" (owner, 26 Oct 2026), through the real intake: the prep
 * went with its row's code against its Message-ID; her reply in that thread (to simone@, from her own
 * Gmail) lands on the row through `commandFromMail`, her words become the purpose, and the Mac's next
 * tick gets the prep to finish with the thread to answer in. Then the row is done. Fixtures only.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { recordMailRefs } from "../../src/worker/boss/intake/mailRefs";
import { macWork, getCommand, openMeetingPrep, prepFinished, prepMentions, personalPreps } from "../../src/worker/boss/commands/run";
import { setCommandFetch } from "../../src/worker/boss/commands/google";
import { ERRAND_SENDERS } from "../../src/shared/boss/commands/parse.mjs";

const HER = ERRAND_SENDERS[0]!;
const NOW = Date.parse("2026-10-26T23:10:00Z");
const PREP_ID = "<prep-fake-1@mail.example.org>";
const REAL_NOW = Date.now;

function herReply(body: string, { to = "simone@sequoiataylor.com", inReplyTo = PREP_ID } = {}) {
  const headers = new Headers({
    from: `Sequoia <${HER}>`, subject: "Re: Prep: Jo (Fake Co), Tue 27 Oct, 10am ET",
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass",
    "message-id": `<her-${Math.random().toString(36).slice(2)}@mail.example.test>`,
    "in-reply-to": inReplyTo, references: inReplyTo,
  });
  const raw = `From: Sequoia <${HER}>\r\nSubject: Re: Prep\r\nContent-Type: text/plain\r\n\r\n${body}`;
  return handleBossInboundMail({ from: HER, to, headers, raw: new Response(raw).body!, rawSize: raw.length } as never, env as never);
}
const spec = { who: "Jo (Fake Co)", subject: "Prep: Jo (Fake Co), Tue 27 Oct, 10am ET", event: { title: "Sequoia + Jo (Fake Co)", scheduled_at: Date.parse("2026-10-27T14:00:00Z"), duration_min: 150 }, context: {} };

beforeEach(async () => {
  setCommandFetch((async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
  Date.now = (() => { let t = NOW; return () => (t += 1000); })();
  await env.DB.exec("DELETE FROM boss_commands");
  await env.DB.exec("DELETE FROM boss_mail_refs");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});
afterEach(() => { setCommandFetch(null); Date.now = REAL_NOW; });

describe("the reply round trip", () => {
  it("her one line in the prep's thread becomes the purpose, and the Mac gets the prep to finish in that thread", async () => {
    const id = await openMeetingPrep(env as never, { key: "jo1@google.com|2026-10-27", spec, asked: true });
    expect((await getCommand(env as never, id))!.state).toBe("asked");
    await recordMailRefs(env.DB, { messageId: PREP_ID, refs: [id], subject: spec.subject, sender: "simone@sequoiataylor.com" });

    await herReply("It's a hands-on setup session for their new tool.\n\nOn Mon, Oct 26, 2026 at 6:05 PM Simone wrote:\n> What's this meeting about?");
    const row = (await getCommand(env as never, id))!;
    expect(row.state).toBe("queued");
    expect(JSON.parse(row.result).purpose).toBe("It's a hands-on setup session for their new tool.");

    const work = await macWork(env as never);
    expect(work.preps).toHaveLength(1);
    expect(work.preps[0]).toMatchObject({ id, purpose: "It's a hands-on setup session for their new tool.", spec: { who: "Jo (Fake Co)", subject: spec.subject } });
    expect(work.preps[0]!.thread[0]).toBe(PREP_ID);

    expect(await prepFinished(env as never, id, { message_id: "em_fake9" })).toBe(true);
    expect((await getCommand(env as never, id))!.state).toBe("sent");
    expect((await macWork(env as never)).preps).toHaveLength(0);
  });

  it("works on boss@ too; a reply on the sent prep updates it; one row per prep key; cancel leaves it be", async () => {
    const id = await openMeetingPrep(env as never, { key: "k2|2026-10-27", spec, asked: false });
    expect(await openMeetingPrep(env as never, { key: "k2|2026-10-27", spec, asked: true })).toBe(id);
    await recordMailRefs(env.DB, { messageId: PREP_ID, refs: [id] });
    await herReply("Also: they want help with their invoices.", { to: "boss@sequoiataylor.com" });
    expect((await getCommand(env as never, id))!.state).toBe("queued");
    await prepFinished(env as never, id, {});
    await herReply("cancel");
    expect((await getCommand(env as never, id))!.state).toBe("cancelled");
  });

  it("her 'ignore, it's a brunch' cancels the prep, no prep is written, and the event is remembered as personal (owner, 1 Nov 2026)", async () => {
    const id = await openMeetingPrep(env as never, { key: "brunch1@google.com|2026-11-01", spec: { ...spec, who: "Reservation at Fake Cafe", event: { ...spec.event, title: "Reservation at Fake Cafe" } }, asked: true });
    await recordMailRefs(env.DB, { messageId: PREP_ID, refs: [id] });
    await herReply("Ignore this is brunch with a friend\n\n\nSent from my iPhone");
    const row = (await getCommand(env as never, id))!;
    expect(row.state).toBe("cancelled");
    expect(JSON.parse(row.result).purpose).toBeUndefined();
    expect((await macWork(env as never)).preps).toHaveLength(0);
    expect(await personalPreps(env as never)).toEqual({ series: ["brunch1@google.com"], titles: ["Reservation at Fake Cafe"] });
  });

  it("a reply on a thread with no prep code is not taken as a prep answer", async () => {
    const id = await openMeetingPrep(env as never, { key: "k3|2026-10-27", spec, asked: true });
    await herReply("It's about the setup.", { inReplyTo: "<some-other@mail.example.org>" });
    expect((await getCommand(env as never, id))!.state).toBe("asked");
    expect((await macWork(env as never)).preps).toHaveLength(0);
  });

  it("Boss OS cards that mention them are found by title, never the prep's own", async () => {
    await env.DB.prepare(`INSERT OR IGNORE INTO lanes (id, name) VALUES ('ops', 'ops')`).run().catch(() => {});
    const lane = (await env.DB.prepare(`SELECT id FROM lanes LIMIT 1`).first<{ id: string }>())!.id;
    await env.DB.prepare(`INSERT INTO tasks (id, lane, title, status, created_at) VALUES ('t_fake1', ?, 'Send Fake Co the setup kit', 'done', ?)`).bind(lane, NOW).run();
    await env.DB.prepare(`INSERT INTO tasks (id, lane, title, status, created_at) VALUES ('t_fake2', ?, 'Meeting prep: Fake Co', 'done', ?)`).bind(lane, NOW).run();
    expect(await prepMentions(env as never, ["Fake Co", "x"])).toEqual([{ title: "Send Fake Co the setup kit", date: "2026-10-26" }]);
  });
});
