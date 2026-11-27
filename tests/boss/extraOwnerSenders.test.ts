import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BOSS_INTAKE_MAILBOX, BOSS_INTAKE_SENDERS, SIMONE_MAILBOX, seatTag } from "../../src/shared/boss/intake/mail.mjs";
import { activeRoster, handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { claimSimone, finishSimoneHandoff } from "../../src/worker/boss/agents/simone";
import type { Env } from "../../src/worker/boss/env";
import { cloudflareAuth } from "./cloudflareAuth";

describe.each([BOSS_INTAKE_MAILBOX, SIMONE_MAILBOX])("extra owners writing to %s", (to) => {
  async function receive(from: string, extra?: string, auth: string | null = cloudflareAuth(from)) {
    const runtime = { ...env, BOSS_EXTRA_OWNER_SENDERS: extra } as Env;
    const seat = (await activeRoster(runtime)).find((s) => s.role !== "Chief of Staff")!;
    const body = `hey, could you look into this when you can? ${seatTag(seat.name)} draft a short summary please`;
    const headers = new Headers({ from, subject: "a quick ask" });
    if (auth !== null) headers.set("authentication-results", auth);
    const raw = `From: ${from}\r\nSubject: a quick ask\r\n\r\n${body}`;
    const result = await handleBossInboundMail({
      from, to, headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length,
    }, runtime);
    const arrival = await env.DB.prepare("SELECT authorised, dmarc_pass, outcome, why FROM boss_inbound_mail WHERE id = ?")
      .bind(result.mailId).first();
    return { result, arrival, seat, runtime, body };
  }

  it.each(["work@example.com", "PRODUCT@EXAMPLE.COM"])("accepts %s and routes to the requested employee", async (from) => {
    // An owner instruction must not be consumed as an outside business's errand reply.
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO boss_commands (id, kind, state, spec, created_at, updated_at)
      VALUES ('cmd_extra_owner', 'errand', 'sent', ?, ?, ?)`)
      .bind(JSON.stringify({ to: from.toLowerCase(), ask: "A sample request" }), now, now).run();
    const { result, arrival, seat, runtime, body } = await receive(from, " , Work@Example.com , product@example.com, ,");
    expect(result).toMatchObject({ outcome: "SIMONE_QUEUED", employeeId: "emp_chief", reply: null });
    expect(arrival).toMatchObject({ authorised: 1, dmarc_pass: 1, outcome: "SIMONE_QUEUED" });
    const call = await claimSimone(runtime);
    expect(call).toMatchObject({ id: result.taskId, message: { from: from.toLowerCase() } });
    expect(await finishSimoneHandoff(runtime, { ...call!, assignments: [{ employee: seat.id, words: body, delivery: "ordinary" }] }))
      .toEqual({ replied: true, refused: false });
    const tasks = await env.DB.prepare(`SELECT employee_id FROM tasks WHERE json_extract(input, '$.simone_handoff') = ?`)
      .bind(result.taskId).all();
    expect(tasks.results).toEqual([{ employee_id: seat.id }]);
  });

  it.each([
    ["unknown@example.com", "work@example.com", cloudflareAuth("unknown@example.com")],
    ["work@example.com", "work@example.com", cloudflareAuth("work@example.com", "fail")],
    ["work@example.com", "work@example.com", "mx.cloudflare.net; spf=pass; dkim=pass"],
    ["work@example.com", "work@example.com", null],
    ["work@example.com", undefined, cloudflareAuth("work@example.com")],
    ["work@example.com", "", cloudflareAuth("work@example.com")],
    ["work@example.com", " , , ", cloudflareAuth("work@example.com")],
  ])("refuses %s with extras %s and auth %s", async (from, extra, auth) => {
    const { result, arrival } = await receive(from!, extra, auth!);
    expect(result).toMatchObject({ outcome: "REFUSED_SENDER", taskId: null, reply: null });
    expect(arrival).toMatchObject({ authorised: 0, outcome: "REFUSED_SENDER" });
    if (extra === from) expect(arrival?.why).toContain("one of yours, but DMARC did not pass");
    const tasks = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE json_extract(input, '$.mail_id') = ?")
      .bind(result.mailId).first();
    expect(tasks?.n).toBe(0);
  });

  it.each([undefined, ""])("keeps every original sender with extras %s", async (extra) => {
    for (const from of BOSS_INTAKE_SENDERS) {
      const { result, arrival } = await receive(from, extra);
      expect(result).toMatchObject({ outcome: "SIMONE_QUEUED", taskId: expect.any(String) });
      expect(arrival).toMatchObject({ authorised: 1, dmarc_pass: 1 });
    }
  });
});
