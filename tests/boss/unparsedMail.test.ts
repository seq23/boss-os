/**
 * A MESSAGE POSTAL-MIME CANNOT TAKE APART IS KEPT AND FLAGGED, NEVER DROPPED (row olp_m81m3hdh0dansp34). A forged nest past
 * MIME_LIMITS arrives from her: the raw is kept in R2, the task still opens with the words as they arrived, the card says
 * the message could not be taken apart (the files reader's named line, worker/effects/mimeAttachments.ts).
 */
import { env } from "cloudflare:test";
import forgedNest from "../fixtures/mail/malformed-nesting.eml?raw";
import { describe, expect, it } from "vitest";
import { BOSS_INTAKE_MAILBOX, BOSS_INTAKE_SENDERS } from "../../src/shared/boss/intake/mail.mjs";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";

describe("an unparseable message at the Boss door", () => {
  it("is kept in R2, opens its task with the text as it arrived, and is flagged on the card", async () => {
    const from = BOSS_INTAKE_SENDERS[0]!;
    const raw = forgedNest.replace(/^From: .*$/m, `From: ${from}`);
    const headers = new Headers({ from, subject: "nested forward", "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass" });
    const result = await handleBossInboundMail({ from, to: BOSS_INTAKE_MAILBOX, headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length }, env);
    expect(result.taskId).toBeTruthy();
    const row = await env.DB.prepare("SELECT object_key FROM boss_inbound_mail WHERE id = ?").bind(result.mailId).first<{ object_key: string | null }>();
    expect(row?.object_key).toBeTruthy();
    expect(await (await env.VAULT.get(row!.object_key!))!.text()).toBe(raw);
    const task = await env.DB.prepare("SELECT input FROM tasks WHERE id = ?").bind(result.taskId).first<{ input: string }>();
    expect(task!.input).toContain("the words at the bottom of a forged nest");
    expect(task!.input).toContain("could not be taken apart");
  });
});
