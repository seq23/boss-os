/**
 * The ancestral-hour reminder rides the errand-reminders tick (owner, 31 Oct 2026). It sends only
 * when Boss OS says one is due, only to the owner, from Imani, and reports it sent. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { ancestralReminder } from "../scripts/ops/errand-reminders.mjs";

const fakeApi = (answer: any) => {
  const posts: string[] = [];
  return { posts, post: async (p: string) => { posts.push(p); return p.endsWith("/reminder") ? answer : { recorded: true }; } };
};
const notice = { subject: "Your ancestral hour: today is the last day", happened: "Today is the last day of October for your ancestral hour. When it is done, tap the button and the reminders stop for this month.", details: [], decide: [{ title: "Ancestral hour", body: "Today is the last day this month.", buttons: [{ label: "Done ✓", url: "https://boss.sequoiataylor.com/tap/ancAAAAAAAAAAAAAAAAAAAAAAAAAAAA?do=done" }] }] };
const senders = (who: string) => [{ name: who, from: `${who} <${who.toLowerCase()}@sequoiataylor.com>`, key: "test" }];

describe("the ancestral-hour reminder send", () => {
  it("due: one email to the owner only, from Imani, then reported sent", async () => {
    const api = fakeApi({ due: true, day: "2026-10-31", kind: "last", notice });
    const sent: any[] = [];
    const r = await ancestralReminder(api, (async (_u: string, init: any) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as any, senders);
    expect(r.sent).toBe(true);
    // Through postEmployeeMail, so the plain-email gate passed it: one email, to the owner only, from Imani.
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toContain("imani@sequoiataylor.com");
    expect([sent[0].to].flat()).toEqual([process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com"]);
    expect(sent[0].cc ?? sent[0].bcc ?? null).toBeNull();
    expect(sent[0].subject).toBe(notice.subject);
    expect(sent[0].text).toContain("Done ✓");
    expect(api.posts).toEqual(["/spirit/ancestral-hour/reminder", "/spirit/ancestral-hour/reminder/2026-10-31/sent"]);
  });
  it("not due: nothing sent, the reason said", async () => {
    const api = fakeApi({ due: false, day: "2026-10-31", reason: "done" });
    let calls = 0;
    const r = await ancestralReminder(api, (async () => { calls++; return new Response("{}"); }) as any, senders);
    expect(calls).toBe(0);
    expect(r.line).toContain("done");
  });
  it("a refused send is not reported sent, and is named", async () => {
    const api = fakeApi({ due: true, day: "2026-10-31", kind: "last", notice });
    const r = await ancestralReminder(api, (async () => new Response("no", { status: 403 })) as any, senders);
    expect(r.failed).toContain("403");
    expect(api.posts).toEqual(["/spirit/ancestral-hour/reminder"]);
  });
});
