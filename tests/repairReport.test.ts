/**
 * REPAIRS NEVER WAIT ON THE OWNER — the Mac half and the one plain report (owner, 25 Oct 2026).
 * The Worker half (the /plan route) is pinned by tests/boss/repairsNeverWait.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownerTextProblems, repairReport, STOCK, MAX_WORDS_PER_LINE } from "../src/shared/boss/repoChange/repairReport.mjs";
import { layoutProblem, plainProblems } from "../src/shared/boss/mail/plain.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { repairDoneMail } from "../scripts/ops/repo-change.mjs";

describe("the Mac runner sends no plan email for a repair (25 Oct 2026)", () => {
  it("the Mac runner sends no plan email for a repair: the repair branch returns before the plan email is sent", () => {
    const src = readFileSync("scripts/ops/repo-change.mjs", "utf8");
    const gate = src.indexOf("if (!planWaitsForOwner(row)) {");
    const send = src.indexOf("const messageId = await email(subject, text);");
    expect(gate).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(gate);
    const branch = src.slice(gate, send);
    expect(branch).toMatch(/ask_message_id: null/);
    expect(branch).toMatch(/return;/);
    expect(branch).not.toMatch(/await email\(/);
    // Every repair opener names its kind, so none of them lands as her request by accident.
    for (const f of ["scripts/ops/notify.mjs", "scripts/ops/your-day.mjs", "scripts/ops/lib/duty-kit.mjs", "scripts/ops/archive-audit.mjs"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/origin: "repair", repair_kind: /);
    }
  });

  it("the DONE email of a repair is the plain report, built from the plan's own sentences or the stock ones", () => {
    const at = Date.UTC(2026, 9, 25, 16, 0);
    const mail = repairDoneMail({ id: "rc_m5sd0byy3678wdjc", repair_kind: "held_mail" }, { in_plain: { what_broke: "a `--self-test` flag in plain.mjs", what_we_did: "Fixed the cleaner." } }, at);
    expect(mail.problems).toEqual([]);
    expect(ownerTextProblems(mail.text)).toEqual([]);
    expect(mail.text.split("\n")[0]).toBe("What broke: An email we meant to send you was stopped before it reached you.");
    expect(mail.refs).toEqual(["rc_m5sd0byy3678wdjc"]);
    // A failed job is named by its own title when the plan wrote nothing plain.
    const failed = repairDoneMail({ id: "rc_m5sbr6thvrbg6cxc", repair_kind: "failed_task", instruction: 'Find why "Executive Intelligence Report" failed\nseq23/boss-os — the task failed' }, {}, at);
    expect(failed.problems).toEqual([]);
    expect(failed.text.split("\n").slice(0, 3)).toEqual([
      'What broke: Your "Executive Intelligence Report" job stopped before it finished.',
      "What we did: We found what stopped it, fixed it, and set the job to run again.",
      "Status: Live since Sunday 25 October. Nothing needed from you.",
    ]);
  });
});

describe("the one report a repair sends is plain English (owner, 25 Oct 2026)", () => {
  const AT = Date.UTC(2026, 9, 25, 16, 0);

  it("every kind's report passes both checks, has the three parts, and nothing else", () => {
    for (const kind of [...Object.keys(STOCK), "unknown_kind"]) {
      for (const live of [true, false]) {
        const r = repairReport({ kind, live, at: AT });
        expect(ownerTextProblems(r.text), `${kind}`).toEqual([]);
        const lines = r.text.split("\n").filter(Boolean);
        expect(lines[0]).toMatch(/^What broke: /);
        expect(lines[1]).toMatch(/^What we did: /);
        expect(lines[2]).toMatch(live ? /^Status: Live since Sunday 25 October\./ : /^Status: Still working on it, as of Sunday 25 October\./);
        const laid = layoutProblem({ who: "Danielle", subject: r.subject, happenedLabel: "What broke:", happened: r.whatBroke, did: r.whatWeDid, status: r.status });
        expect(laid.problems, kind).toEqual([]);
        expect(plainProblems({ ...laid, kind: "problem" })).toEqual([]);
        expect(ownerTextProblems(laid.text)).toEqual([]);
      }
    }
  });

  it("the jargon Danielle actually wrote is replaced, never sent", () => {
    const r = repairReport({
      kind: "held_mail", live: true, at: AT,
      whatBroke: "The plan email was held by the outgoing-mail check: a `--self-test` flag and the 9000 character cap in plain.mjs.",
      whatWeDid: "Made the cleaner and the check agree on flags in backticks, and the fence wording in the prompt.",
    });
    expect(r.text).toBe([
      "What broke: An email we meant to send you was stopped before it reached you.",
      "What we did: We found why it was stopped and fixed it, so emails like it now reach you.",
      "Status: Live since Sunday 25 October. Nothing needed from you.",
      "", "— Danielle",
    ].join("\n"));
    // A plain sentence from the plan phase is kept as written.
    expect(repairReport({ kind: "failed_task", live: true, at: AT, whatBroke: "Your morning research report came out empty.", whatWeDid: "We fixed how the research is asked for, and it runs again tomorrow." }).text)
      .toMatch(/^What broke: Your morning research report came out empty\.\nWhat we did: We fixed how the research is asked for, and it runs again tomorrow\./);
  });

  it("the check rejects code words, file names, flags, backticks, markdown, ids and long lines", () => {
    const bad: Record<string, string> = {
      validator: "We added a validator.",
      fence: "We rewrote the firm-context fence.",
      cleaner: "The cleaner now agrees.",
      envelope: "The envelope was too big.",
      file: "We changed plain.mjs so it works.",
      path: "See scripts/ops/notify.mjs for more.",
      flag: "It no longer prints --self-test.",
      backticks: "We fixed `layoutEmail`.",
      markdown: "**Fixed** the email.",
      heading: "## What changed",
      bullet: "- the email",
      id: "Change rc_m5sd0byy3678wdjc is done.",
      commit: "Landed as 9f7e9d7 on main.",
      snake: "The repair_kind is held.",
      pr: "We opened a PR and it merged.",
      long: Array.from({ length: MAX_WORDS_PER_LINE + 1 }, () => "word").join(" ") + ".",
    };
    for (const [name, line] of Object.entries(bad)) expect(ownerTextProblems(line), name).not.toEqual([]);
    expect(ownerTextProblems(Array.from({ length: MAX_WORDS_PER_LINE }, () => "word").join(" ") + ".")).toEqual([]);
    expect(ownerTextProblems("An email we meant to send you was stopped before it reached you.")).toEqual([]);
  });
});
