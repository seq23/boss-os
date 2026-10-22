import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOSS_INTAKE_MAILBOX, BOSS_INTAKE_SENDERS } from "../src/shared/boss/intake/mail.mjs";
import { triage } from "../src/shared/boss/intake/triage.mjs";
import { dutyRequestIn } from "../src/shared/boss/duties/lane.mjs";
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
  it("names the address, every authorised sender, and every name@ inbox that is routed", () => {
    expect(DOC).toMatch(/^# How to give Boss OS work by email$/m);
    expect(DOC).toContain(`**${BOSS_INTAKE_MAILBOX}**`);
    for (const s of BOSS_INTAKE_SENDERS) expect(DOC).toContain(s);
    const inboxes = (RULES.rules as Array<{ matchers: Array<{ value: string }> }>).map((r) => String(r.matchers[0]?.value ?? "")).filter((a) => a.endsWith("@sequoiataylor.com") && a !== BOSS_INTAKE_MAILBOX);
    expect(inboxes.length).toBe(8);
    for (const a of inboxes) expect(DOC).toContain(a.split("@")[0] + "@");
    expect(DOC).not.toMatch(/westpeek|joinwestpeek/i);
  });

  it("has three examples, and each reaches the seat the page says", () => {
    const ex = examples();
    expect(ex.length).toBe(3);
    for (const e of ex) {
      const duty = dutyRequestIn(e.subject, e.body, ROSTER);
      const seat = duty && !("error" in duty) ? duty.seat.name : triage({ subject: e.subject, text: e.body, roster: ROSTER }).map((j) => j.seat.name).join(",");
      expect(seat, e.subject).toBe(e.seat);
    }
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

  it("OPERATIONS.md has the short section and links the page", () => {
    expect(OPS).toMatch(/^## How to give Boss OS work by email$/m);
    expect(OPS).toContain("HOW_TO_GIVE_BOSS_OS_WORK_BY_EMAIL.md");
  });
});
