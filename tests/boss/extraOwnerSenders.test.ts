import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BOSS_INTAKE_MAILBOX, BOSS_INTAKE_SENDERS, SIMONE_MAILBOX, seatTag } from "../../src/shared/boss/intake/mail.mjs";
import { activeRoster, handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import type { Env } from "../../src/worker/boss/env";

describe.each([BOSS_INTAKE_MAILBOX, SIMONE_MAILBOX])("extra owners writing to %s", (to) => {
  async function receive(from: string, extra?: string, auth: string | null = "dmarc=pass") {
    const runtime = { ...env, BOSS_EXTRA_OWNER_SENDERS: extra } as Env;
    const seat = (await activeRoster(runtime)).find((s) => s.role !== "Chief of Staff")!;
    const body = `hey, could you look into this when you can? ${seatTag(seat.name)} draft a short summary please`;
    const headers = new Headers({ from, subject: "a quick ask", "x-boss-intake-origin": "console" });
    if (auth !== null) headers.set("authentication-results", auth);
    const raw = `From: ${from}\r\nSubject: a quick ask\r\n\r\n${body}`;
    const result = await handleBossInboundMail({
      from, to, headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length,
    }, runtime);
    const arrival = await env.DB.prepare("SELECT authorised, dmarc_pass, outcome, why FROM boss_inbound_mail WHERE id = ?")
      .bind(result.mailId).first();
    return { result, arrival, seat };
  }

  it.each(["work@example.com", "PRODUCT@EXAMPLE.COM"])("accepts %s and routes to the requested employee", async (from) => {
    // An owner instruction must not be consumed as an outside business's errand reply.
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO boss_commands (id, kind, state, spec, created_at, updated_at)
      VALUES ('cmd_extra_owner', 'errand', 'sent', ?, ?, ?)`)
      .bind(JSON.stringify({ to: from.toLowerCase(), ask: "A sample request" }), now, now).run();
    const { result, arrival, seat } = await receive(from, " , Work@Example.com , product@example.com, ,");
    expect(result.outcome).toBe("ROUTED");
    expect(result.employeeId).toBe(seat.id);
    expect(result.taskId).toBeTruthy();
    expect(arrival).toMatchObject({ authorised: 1, dmarc_pass: 1, outcome: "ROUTED" });
    const task = await env.DB.prepare("SELECT employee_id FROM tasks WHERE id = ?").bind(result.taskId).first();
    expect(task?.employee_id).toBe(seat.id);
  });

  it.each([
    ["unknown@example.com", "work@example.com", "dmarc=pass"],
    ["work@example.com", "work@example.com", "dmarc=fail"],
    ["work@example.com", "work@example.com", "spf=pass; dkim=pass"],
    ["work@example.com", "work@example.com", null],
    ["work@example.com", undefined, "dmarc=pass"],
    ["work@example.com", "", "dmarc=pass"],
    ["work@example.com", " , , ", "dmarc=pass"],
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
      expect(result.outcome).toBe("ROUTED");
      expect(arrival?.authorised).toBe(1);
    }
  });
});
