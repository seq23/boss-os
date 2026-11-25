import { EMPLOYEE_LOCAL_PARTS } from "../scripts/ops/notify.mjs";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOSS_INTAKE_MAILBOX, BOSS_INTAKE_SENDERS, SIMONE_MAILBOX, routeToSeat } from "../src/shared/boss/intake/mail.mjs";
import { readAssignments } from "../src/shared/boss/intake/simoneRouting.mjs";
import { readReply } from "../src/shared/boss/repoChange/lane.mjs";
import { blockReplyDoor } from "../src/shared/boss/service/waits.mjs";
import { readSecretLines, secretNameProblem } from "../src/shared/boss/service/secretLines.mjs";

/**
 * "How to give Boss OS work by email" is read by code (a spec no code reads is a wish): every
 * address, example, reply word and the secret line on the page is checked against what the mailbox
 * actually does.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = readFileSync(path.join(ROOT, "docs/HOW_TO_GIVE_BOSS_OS_WORK_BY_EMAIL.md"), "utf8");
const OPS = readFileSync(path.join(ROOT, "docs/boss/OPERATIONS.md"), "utf8");
const RULES = JSON.parse(readFileSync(path.join(ROOT, "scripts/validate/fixtures/email-routing-rules.json"), "utf8"));
const ROSTER = ([
  ["emp_chief", "Simone", "Chief of Staff"], ["emp_relationship", "Monique", "Director of Relationships"],
  ["emp_knowledge", "Zora", "Archivist"], ["emp_repo", "Danielle", "Technical Program Manager"],
  ["emp_continuity", "Kendra", "Systems Manager"], ["emp_risk", "Toni", "Chief Risk Officer"],
  ["emp_research", "Camille", "Director of Research"], ["emp_practice", "Imani", "Director of Practice"],
] as Array<[string, string, string]>).map(([id, name, role]) => ({ id, name, role, lane: "ops" }));

/** Each example: its code block, and the "Goes to: **Name**" line after it. */
function examples() {
  const out: Array<{ subject: string; body: string; seat: string }> = [];
  const re = /```\nTo:\s+(\S+)\nSubject:\s+(.+)\nBody:\s+(.+)\n```\s+Goes to: \*\*(\w+)\*\*/g;
  let m;
  while ((m = re.exec(DOC)) !== null) {
    expect(m[1]).toBe(BOSS_INTAKE_MAILBOX);
    out.push({ subject: m[2]!.trim(), body: m[3]!.trim(), seat: m[4]! });
  }
  return out;
}

describe("the email how-to page matches the mailbox", () => {
  it("names the address and the name@ inboxes while keeping the approved sender addresses out of the guide", () => {
    expect(DOC).toMatch(/^# How to give Boss OS work by email$/m);
    expect(DOC).toContain(`**${BOSS_INTAKE_MAILBOX}**`);
    expect(DOC).toContain("Only authenticated owner");
    for (const s of BOSS_INTAKE_SENDERS) expect(DOC).not.toContain(s);
    const inboxes = (RULES.rules as Array<{ matchers: Array<{ value: string }> }>).map((r) => String(r.matchers[0]?.value ?? "")).filter((a) => a.endsWith("@sequoiataylor.com") && a !== BOSS_INTAKE_MAILBOX);
    // Every employee's routed inbox (one per sender in notify.mjs's ROSTER, boss@ aside), none missed.
    expect(inboxes.length).toBe(EMPLOYEE_LOCAL_PARTS.length);
    expect(inboxes.length).toBeGreaterThan(0);
    for (const a of inboxes) expect(DOC).toContain(a.split("@")[0] + "@");
    expect(DOC).not.toMatch(/westpeek|joinwestpeek/i);
  });

  it("says simone@ and boss@ share an intake, and lists Danielle's direct mailbox", () => {
    expect(DOC).toContain(`**${SIMONE_MAILBOX} does exactly the same thing as boss@.**`);
    expect(DOC).toMatch(/"Tell Simone" box at the top of Today/);
    // simone@ is not listed among the direct-to-one-person addresses any more.
    const direct = /write to them directly:\n?([^.]+)\./.exec(DOC)?.[1] ?? "";
    expect(direct).toContain("danielle@");
    expect(direct).not.toContain("simone@");
    const ex = examples();
    expect(ex.length).toBe(3);
    for (const e of ex) {
      const text = `${e.subject}\n${e.body}`;
      const viaBoss = routeToSeat(text, ROSTER, BOSS_INTAKE_MAILBOX)!;
      const viaSimone = routeToSeat(text, ROSTER, SIMONE_MAILBOX)!;
      expect(viaSimone.outcome, e.subject).toBe("DEFAULTED");
      expect(viaSimone.outcome).toBe(viaBoss.outcome);
      expect(viaSimone.seat.id).toBe(viaBoss.seat.id);
      expect(viaSimone.tag).toBe(viaBoss.tag);
    }
    // Every OTHER name@ still routes straight to its person.
    expect(routeToSeat("look at this", ROSTER, "danielle@sequoiataylor.com")!.seat.name).toBe("Danielle");
    expect(routeToSeat("look at this", ROSTER, "danielle@sequoiataylor.com")!.outcome).toBe("ROUTED");
  });

  it("shows a repo handoff, a research handoff, and an instruction Simone can apply", () => {
    const ex = examples();
    expect(ex.map(({ subject, seat }) => ({ subject, seat }))).toEqual([
      { subject: "studio landing page", seat: "Danielle" },
      { subject: "hosting", seat: "Camille" },
      { subject: "studio recount", seat: "Simone" },
    ]);
    for (const [e, employee, delivery] of [[ex[0]!, "emp_repo", "repository"], [ex[1]!, "emp_research", "research_page"]] as const) {
      const call = { message: { body: `${e.subject}\n\n${e.body}` }, roster: ROSTER };
      expect(readAssignments([{ employee, words: e.body, delivery }], call)).toEqual([{ employee, words: e.body, delivery }]);
    }
    expect(OPS).toContain("**Change an existing duty** by telling Simone");
    // The examples carry no names of people (her rule for test mail and docs alike).
    for (const e of ex) for (const s of ROSTER) expect(`${e.subject} ${e.body}`).not.toContain(s.name);
  });

  it("the reply words do what the table says", () => {
    expect(readReply("approved").mode).toBe("approved");
    expect(readReply("changes: make it blue").mode).toBe("held");
    expect(readReply("stop").mode).toBe("held");
    expect(blockReplyDoor("try again")).toBe("RETRY");
    expect(blockReplyDoor("drop it")).toBe("DROP");
    for (const w of ["`approved`", "`changes: `", "`stop`", "`try again`", "`drop it`"]) expect(DOC).toContain(w);
  });

  it("the secret line on the page is one the secret door reads", () => {
    const line = /```\n(SECRET [^\n]+)\n```/.exec(DOC)?.[1] ?? "";
    const r = readSecretLines(line);
    expect(r.found.length).toBe(1);
    expect(secretNameProblem(r.found[0]!.name)).toBeNull();
  });

});
