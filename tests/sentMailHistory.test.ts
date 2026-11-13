import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSentMail, employeeMail, flushSentMail, postEmployeeMail, postErrandMail, errandMail, ERRAND_FROM, ERRAND_REPLY_TO, mailStateDir, heldDir } from "../scripts/ops/notify.mjs";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { onlyTestAddresses } from "../src/shared/boss/mail/testAddress.mjs";

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
    const payload = employeeMail(sender, { to: "owner@example.test", subject: "An update for you", text: "Your table needs a card.", owner: { layout: "note", why: "An update on your table" } });
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
    const payload = employeeMail(sender, { to: "owner@example.test", subject: "Your update", text: "Here is the whole update.", owner: { layout: "note", why: "Your weekly update" } });
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

describe("a test can never put mail into her Mac's real folders (13 Nov 2026)", () => {
  // tests/noticeGate.test.ts sent "Could not do: a synthetic job" with no folder named; the archive
  // wrote it into the real ~/.boss-os/sent-mail-pending and the next real send uploaded it.
  const real = join(homedir(), ".boss-os");
  it("under the test runner, a folder no test named is a throwaway one; outside it, it is her real one", () => {
    for (const [name, leaf] of [["BOSS_OS_SENT_MAIL_DIR", "sent-mail-pending"], ["BOSS_OS_HELD_MAIL_DIR", "held-mail"]] as const) {
      expect(mailStateDir(name, leaf, { VITEST: "true" }).startsWith(real), leaf).toBe(false);
      expect(mailStateDir(name, leaf, { NODE_ENV: "test" }).startsWith(real), leaf).toBe(false);
      expect(mailStateDir(name, leaf, { [name]: "/named/by/a/test", VITEST: "true" })).toBe("/named/by/a/test");
      // Negative proof: with no test runner the same call is her real folder.
      expect(mailStateDir(name, leaf, {})).toBe(join(real, leaf));
    }
  });
  it("a real send path with no folder named writes its archive copy outside ~/.boss-os", async () => {
    vi.unstubAllEnvs();
    // No passcode, so the copy stays where it was written to be read below: a shell carrying her real
    // BOSS_PASSCODE (the repo-change runner, 13 Nov 2026) uploaded and removed it, and this failed.
    vi.stubEnv("BOSS_PASSCODE", "");
    const before = existsSync(join(real, "sent-mail-pending")) ? readdirSync(join(real, "sent-mail-pending")).length : 0;
    const { fetcher } = transport();
    await archiveSentMail(employeeMail(sender, { to: "owner@example.test", subject: "An update", text: "A synthetic update." }), "accepted-unnamed-folder", fetcher);
    expect(existsSync(join(real, "sent-mail-pending")) ? readdirSync(join(real, "sent-mail-pending")).length : 0).toBe(before);
    expect(heldDir().startsWith(real)).toBe(false);
    const temp = mailStateDir("BOSS_OS_SENT_MAIL_DIR", "sent-mail-pending");
    expect(readdirSync(temp).length).toBeGreaterThan(0);
    rmSync(temp, { recursive: true, force: true });
  });
  it("the reserved test domains are told apart from real mail", () => {
    for (const a of ["o@example.com", "Owner <owner@example.test>", "a@b.invalid", "a@example.org, b@example.net"]) expect(onlyTestAddresses(a), a).toBe(true);
    for (const a of ["someone@gmail.com", "a@example.com, someone@gmail.com", "a@notexample.com", ""]) expect(onlyTestAddresses(a), a).toBe(false);
  });
});
