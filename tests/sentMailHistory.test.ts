import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSentMail, employeeMail, flushSentMail, postEmployeeMail, postErrandMail, errandMail, ERRAND_FROM, ERRAND_REPLY_TO } from "../scripts/ops/notify.mjs";

let dir: string;
const sender = { from: "Agent <agent@example.test>", reply_to: "agent@example.test", key: "fake-key", tag: null };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "boss-mail-test-"));
  vi.stubEnv("BOSS_OS_SENT_MAIL_DIR", dir);
  vi.stubEnv("BOSS_PASSCODE", "fixture-passcode");
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
function transport({ refuseArchive = false, refuseSend = false } = {}) {
  const sent: { url: string; body: any }[] = [];
  const fetcher = async (url: any, init: any = {}) => {
    sent.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith("/auth/unlock")) return new Response("{}", { headers: { "set-cookie": "boss_session=fake" } });
    if (String(url).endsWith("/mail/sent")) return new Response("{}", { status: refuseArchive ? 503 : 200 });
    return new Response(JSON.stringify({ id: "accepted-fixture" }), { status: refuseSend ? 400 : 200 });
  };
  return { sent, fetcher: fetcher as typeof fetch };
}

describe("every accepted Mac email reaches history", () => {
  it("archives a notice with no job references, preserving the actual laid-out words", async () => {
    const { sent, fetcher } = transport();
    const payload = employeeMail(sender, { to: "owner@example.test", subject: "An update", text: "Your table needs a card." });
    const res = await postEmployeeMail(sender, payload, fetcher);
    expect(res.ok).toBe(true);
    const archive = sent.find((r) => r.url.endsWith("/mail/sent"));
    expect(archive?.body).toMatchObject({ from: sender.from, employee_address: sender.reply_to, to: "owner@example.test", text: payload.text, html: payload.html });
    expect(readdirSync(dir)).toEqual([]);
  });
  it("archives the errand's exact words and thread association", async () => {
    const { sent, fetcher } = transport();
    const payload = errandMail({ to: "venue@example.test", subject: "A table", text: "Please hold a table.", inReplyTo: "<venue@example.test>" });
    expect(payload).toMatchObject({ from: ERRAND_FROM, reply_to: ERRAND_REPLY_TO });
    expect(await postErrandMail(payload, fetcher, { key: "fake-key", commandId: "cmd_fixture" })).toEqual({ ok: true, id: "accepted-fixture" });
    expect(sent.find((r) => r.url.endsWith("/mail/sent"))?.body).toMatchObject({ command_id: "cmd_fixture", text: "Please hold a table.", in_reply_to: "<venue@example.test>" });
  });
  it("keeps a durable private copy through an archive outage; retry saves it without resending", async () => {
    const broken = transport({ refuseArchive: true });
    const payload = employeeMail(sender, { to: "owner@example.test", subject: "Your update", text: "Here is the whole update." });
    expect((await postEmployeeMail(sender, payload, broken.fetcher)).ok).toBe(true);
    const files = readdirSync(dir); expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, files[0]!), "utf8")).text).toBe(payload.text);
    const restored = transport();
    expect(await flushSentMail(restored.fetcher)).toBe(true);
    expect(restored.sent.filter((r) => r.url === "https://api.resend.com/emails")).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });
  it("records the RFC Message-ID for threading, retaining the provider receipt separately", async () => {
    const base = transport();
    const fetcher: typeof fetch = async (url, init) => String(url).includes("/emails/") ? Response.json({ message_id: "<rfc-fixture@example.test>" }) : base.fetcher(url, init);
    await postEmployeeMail(sender, employeeMail(sender, { to: "owner@example.test", subject: "An update", text: "Here it is." }), fetcher);
    expect(base.sent.find((r) => r.url.endsWith("/mail/sent"))?.body).toMatchObject({ message_id: "<rfc-fixture@example.test>", provider_id: "accepted-fixture" });
  });
  it("never calls a refused send delivered", async () => {
    const { sent, fetcher } = transport({ refuseSend: true });
    const payload = employeeMail(sender, { to: "owner@example.test", subject: "Your update", text: "A plain update." });
    expect((await postEmployeeMail(sender, payload, fetcher)).ok).toBe(false);
    expect(sent.some((r) => r.url.endsWith("/mail/sent"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});
