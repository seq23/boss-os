/**
 * THE TAIL CANNOT END WITHOUT ITS REPORT, AND NEVER LOSES WORK (owner incident, 1 Nov 2026) — the
 * guard. The 17:48Z tail run found real friction, handed the fix to a background subagent, and
 * ended its own turn; the harness killed the background task 10 minutes later, the process exited
 * rc=0, and the report was never written. Fails if the pure recovery decisions regress, or if
 * boss-mail-tail-run.sh stops calling both the recovery module and the salvage mechanism, or if
 * boss-mail-tail.sh stops sending the agent into a worktree.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recoveryPlan, reportState, sessionIdIn } from "../scripts/ops/lib/tail-report.mjs";

const STREAM_LOG = [
  '{"type":"system","subtype":"init","cwd":"/Users/sequoiataylor/GitHub/boss-os","session_id":"55395904-1473-41d5-b374-ffad1d4bac7c","tools":[]}',
  '{"type":"assistant","session_id":"55395904-1473-41d5-b374-ffad1d4bac7c","message":{}}',
  '{"type":"result","subtype":"success","stop_reason":"end_turn","session_id":"55395904-1473-41d5-b374-ffad1d4bac7c"}',
].join("\n");

describe("sessionIdIn: the session a stream-json tail log was written under", () => {
  it("reads it out of a real stream log", () => {
    expect(sessionIdIn(STREAM_LOG)).toBe("55395904-1473-41d5-b374-ffad1d4bac7c");
  });
  it("is null for a log with no session id (not yet started, or empty)", () => {
    expect(sessionIdIn("")).toBeNull();
    expect(sessionIdIn('{"type":"system"}')).toBeNull();
  });
});

describe("reportState: whether a report is real or missing its sentinel", () => {
  it("a report without FRICTION_FIXED is missing, even with text in it", () => {
    expect(reportState("")).toBe("missing");
    expect(reportState("Your email \"x\"\n\nINCOMPLETE: the tail agent ended (rc=0) without its report.")).toBe("missing");
  });
  it("a report carrying the sentinel is complete", () => {
    expect(reportState("Your email \"x\"\n\nDanielle fixed it and it is live.\n\nFRICTION_FIXED: 1")).toBe("complete");
  });
});

describe("recoveryPlan: what the run script tries next, and in what order", () => {
  it("does nothing once the report is complete", () => {
    expect(recoveryPlan({ state: "complete", sessionId: "abc" })).toEqual({ action: "none" });
  });
  it("resumes the session that wrote the log, when there is one and it has not been tried yet", () => {
    expect(recoveryPlan({ state: "missing", sessionId: "abc", tried: [] })).toEqual({ action: "resume", sessionId: "abc" });
  });
  it("resumes exactly once — a session already tried falls through to salvage, never loops", () => {
    expect(recoveryPlan({ state: "missing", sessionId: "abc", tried: ["resume"] })).toEqual({ action: "salvage" });
  });
  it("salvages straight away when there is no session to resume", () => {
    expect(recoveryPlan({ state: "missing", sessionId: null })).toEqual({ action: "salvage" });
  });
});

describe("the run script actually calls the recovery module and the salvage mechanism — not just has them on disk", () => {
  const sh = readFileSync("scripts/ops/boss-mail-tail-run.sh", "utf8");

  it("lifts the harness's 10-minute background-task ceiling before launching the agent", () => {
    expect(sh.indexOf("CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0")).toBeGreaterThan(-1);
    expect(sh.indexOf("CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0")).toBeLessThan(sh.indexOf('"$CLAUDE" -p "$(cat "$PROMPT_FILE")"'));
  });

  it("reads the report's state through the recovery module, not an inline regex", () => {
    expect(sh).toMatch(/node "\$LIB" state "\$REPORT_FILE"/);
  });

  it("resumes the session the module names, bounded, before ever salvaging", () => {
    const resumeAt = sh.indexOf("--resume \"$SESSION_ID\"");
    const salvageAt = sh.indexOf("salvage-pass-worktrees.mjs");
    expect(resumeAt).toBeGreaterThan(-1);
    expect(salvageAt).toBeGreaterThan(resumeAt);
    expect(sh).toMatch(/timeout "\$RESUME_CAP"/);
  });

  it("salvages the agent's own worktree (never a bare worktree root) and names the branch in the INCOMPLETE report", () => {
    expect(sh).toMatch(/salvage-pass-worktrees\.mjs" --since "\$SINCE" --repo boss-os/);
    expect(sh).toMatch(/SALVAGED_BRANCH/);
    const reportBlock = sh.slice(sh.lastIndexOf('echo "$SUBJECT"'));
    expect(reportBlock).toMatch(/\$SALVAGED_BRANCH/);
  });

  it("takes the pass's own stamp as its 7th argument, never inventing one", () => {
    expect(sh).toMatch(/SINCE="\$\{7:-\}"/);
  });
});

describe("the agent is sent to work in a worktree, never in her own checkout", () => {
  const sh = readFileSync("scripts/ops/boss-mail-tail.sh", "utf8");

  it("cuts a worktree named so salvage-pass-worktrees.mjs's own naming rule finds it", () => {
    expect(sh).toMatch(/WORKTREE="\$HOME\/GitHub\/\.wt-danielle-boss-os-\$LOCAL_STAMP"/);
    expect(sh).toMatch(/git -C \$REPO worktree add \$WORKTREE/);
  });

  it("tells the agent $REPO itself must stay clean, and never to hand a fix to a background task and end its turn", () => {
    expect(sh).toMatch(/NEVER IN \$REPO ITSELF/);
    expect(sh).toMatch(/NEVER hand a fix to a background subagent and end your own turn/);
  });

  it("passes the same local stamp the worktree is named with on to the run script", () => {
    const runAt = sh.indexOf("boss-mail-tail-run.sh");
    const call = sh.slice(runAt, sh.indexOf("\n", runAt));
    expect(call).toMatch(/"\$LOCAL_STAMP"\s*<\/dev\/null/);
  });
});
