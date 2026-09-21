/**
 * THE REPO-CHANGE LANE — Danielle changes a grid repository on the owner's word.
 *
 * ─── What this is ──────────────────────────────────────────────────────────
 *
 * Owner, 20 September 2026 ("Plan B"): she emails `boss@sequoiataylor.com` with `#danielle`, a repo
 * name from the grid and/or a Google Drive folder, plus instructions. Danielle then does on her Mac
 * what a Claude Code session did by hand that day for the westpeek.ventures site: reads the
 * package, reads the target repo's RUNBOOK.md, writes a plan whose decisions are split into
 * "decided" and "ask", emails the asks, waits for her answers, builds in a worktree, proves it with
 * the repo's own validators plus screenshots and link checks, opens a PR, LANDS IT ON GREEN
 * (her decision — no second reply), proves it live, and emails the proof.
 *
 * ─── ONE PLACE FOR EVERYTHING THE THREE COMPONENTS MUST AGREE ON ───────────
 *
 * The Worker (intake, the claim routes, the guards), the Mac runner (`scripts/ops/repo-change.mjs`)
 * and the validator (`scripts/validate/the-repo-lane-lands-only-on-green.mjs`) all import THIS file.
 * The task kind, the executor script, the phases, the model per phase, the turn caps, the parse of
 * her sentence and the two guards live here and nowhere else — "two components each keeping their
 * own list" is this repository's most-named defect and this is the shape that prevents it.
 *
 * ─── THE TWO GUARDS ARE PURE FUNCTIONS OVER THE ROW ─────────────────────────
 *
 * `canEnterBuild(row)` and `canLand(row)` decide from the `repo_changes` row alone, so the route
 * that hands out a claim, the runner that would run the phase, and the validator that proves the
 * rule all call the SAME function. A copy of the rule in any one of them is what the validator
 * exists to catch.
 */

import { propertyForRepo, isExcluded, whyExcluded, GRID } from "../grid.mjs";

/** The task-kind token. The Mac lane and `validate:duty-delivery` cross-check it against the script. */
export const TASK_KIND = "repo_change";
/** The executor on her Mac, named once. `install-agent-launchd.sh` must name it too. */
export const EXECUTOR_SCRIPT = "repo-change.sh";
/** Danielle's seat. The lane exists on this desk and no other. */
export const REPO_CHANGE_SEAT = "emp_repo";

/**
 * THE ON-DEMAND LANE, AS ONE RECORD. A standing duty names its executor in its row and
 * `validate:duty-delivery` walks the chain; an on-demand lane has no duty row, so this is the
 * record that validator walks instead: the kind, the shell executor the installer names, the
 * runner the executor runs, the route the runner reports to, and the consumer that parks the kind.
 */
export const MAC_LANE = {
  kind: TASK_KIND,
  executor: EXECUTOR_SCRIPT,
  runner: "repo-change.mjs",
  prompt: "repo-change-prompt.md",
  route: "/api/repo-changes",
  seat: REPO_CHANGE_SEAT,
};

/**
 * The phases, in order. `asking` and `landing` are waiting states the Mac cannot claim: one waits on
 * her reply, the other on the PR's checks. `plan`, `build` and `land` are the three `claude -p` runs.
 */
export const PHASES = ["plan", "asking", "build", "preview", "previewing", "landing", "land", "done", "failed"];
/** The three `claude -p` phases, plus `preview` — the Mac's own deterministic step (find the URL, email her). */
export const RUNNABLE_PHASES = ["plan", "build", "preview", "land"];

/**
 * THE MODEL PER PHASE, IN ONE PLACE. Judgement on the plan (Opus), the edit on Sonnet, the landing on
 * the cheapest rung — `land` is `~/bin/land` plus a curl, and paying Opus prices to watch a script
 * run is the $3.88 briefing again. All three run on her Claude Code seat, so the API bill is $0 and
 * the posture ($2.50/day) is untouched; the caps below bound her Max plan's capacity instead.
 */
export const PHASE_MODELS = {
  plan: "claude-opus-5",
  build: "claude-sonnet-5",
  land: "claude-haiku-4-5",
};
export const PHASE_MAX_TURNS = { plan: 60, build: 150, land: 40 };
/** A hard wall-clock cap per phase, in minutes. `timeout` in the shell wrapper enforces it. */
export const PHASE_TIMEOUT_MIN = { plan: 25, build: 90, land: 30 };

/** How long a claim is honoured before the Worker treats the run as dead and lets another claim it. */
export const CLAIM_LEASE_MS = 2 * 60 * 60 * 1000;

/**
 * THE DECISIONS POLICY — what she is asked and what Danielle decides. Rendered into the PLAN prompt
 * by the runner, and the same words the join-west-peek-main RUNBOOK carries under "Decisions an
 * employee must ask, not make". Kept as data so the prompt cannot drift from the rule.
 */
export const ASK_POLICY = {
  ask: [
    "brand or colourway",
    "the meaning of copy (what a sentence claims, promises or implies)",
    "legal or regulatory wording",
    "removing a public claim",
    "image rights",
    "anything about money",
  ],
  decide: [
    "structure and layout",
    "CSS and styling within the existing system",
    "validators and guards",
    "redirects",
    "asset handling",
    "build wiring and scripts",
  ],
};

/** `[rc_…]` — the token every email about a change carries, so her reply can name it without headers. */
export function changeToken(id) {
  return `[${String(id).trim()}]`;
}

/** The change id in a subject or body, if it names one. */
export function tokenIn(text) {
  const m = /\[(rc_[a-z0-9]+)\]/i.exec(String(text ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/** A Drive folder URL in the text, normalised to the folder id. */
export function driveFolderIn(text) {
  const t = String(text ?? "");
  const m = /https?:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=)([A-Za-z0-9_-]{10,})/i.exec(t);
  return m ? { id: m[1], url: m[0] } : null;
}

/** Every repo name the grid knows, bare. */
export function gridRepoNames() {
  return GRID.flatMap((p) => p.repos);
}

/**
 * A grid repo named in the text. Bare name, `owner/name`, or a GitHub URL — the same three shapes
 * `isExcluded` reads, for the same reason. The longest match wins so `local-guides-citation-velocity`
 * is never read as `local-guides-generator`'s neighbour by prefix.
 */
export function repoIn(text) {
  const t = String(text ?? "").toLowerCase();
  const names = gridRepoNames().sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(`(?:^|[^a-z0-9_-])${name.replace(/[-]/g, "\\-")}(?![a-z0-9_-])`, "i");
    if (re.test(t)) return name;
  }
  return null;
}

/**
 * An EXCLUDED repo named in the text — West Peek, a client micro-site, anything the grid names as
 * out of scope. Returned so intake can refuse with the reason instead of quietly opening ordinary
 * work on a message that plainly asked for a repository change.
 */
export function excludedRepoIn(text) {
  const t = String(text ?? "");
  const m = /\b(?:github\.com\/[\w.-]+\/)?([a-z0-9][a-z0-9._-]{2,})\b/gi;
  let hit;
  while ((hit = m.exec(t)) !== null) {
    const name = hit[1];
    if (/[-_]/.test(name) && isExcluded(name) && whyExcluded(name)) return { repo: name, why: whyExcluded(name) };
  }
  return null;
}

/**
 * ─── HER SENTENCE, READ AS A REPO CHANGE ───────────────────────────────────
 *
 * A repo change is a message on Danielle's desk that names a grid repo, a Drive folder, or both.
 * Nothing else is inferred: no repo and no folder means an ordinary instruction, exactly as before.
 * The instruction is the whole readable text — the plan phase reads it in full, and the parse does
 * not try to be clever about which sentence is "the ask".
 *
 * Returns null when the text is not a repo change. Returns `{ excluded }` when it names a repo the
 * grid says is out of scope, so the caller can refuse with the reason rather than guess.
 */
export function parseRepoChange(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const repo = repoIn(t);
  const folder = driveFolderIn(t);
  if (!repo && !folder) {
    const excluded = excludedRepoIn(t);
    return excluded ? { excluded } : null;
  }
  if (!repo) {
    const excluded = excludedRepoIn(t);
    if (excluded) return { excluded };
  }
  return {
    repo,
    property: repo ? propertyForRepo(repo)?.key ?? null : null,
    drive_folder: folder ? folder.id : null,
    drive_url: folder ? folder.url : null,
    instruction: t.slice(0, 20_000),
  };
}

/**
 * ─── HER REPLY, READ AS ONE OF THREE THINGS ────────────────────────────────
 *
 * Owner, 21 Sep 2026: the approval step must have zero friction. The plan email carries the whole
 * plan and every ask with a recommended default, and she replies with ONE WORD.
 *
 *   approved   — "approved", "approve", "yes", "go", "land it", "ok" (the whole reply, case and
 *                punctuation aside): every ask takes its recommended default; BUILD starts.
 *   held       — a reply that STARTS with "no", "not approved", "stop" or "changes:": the task
 *                stays in `asking`, her words are kept, nothing builds until she writes again.
 *   answers    — anything else: recorded as her answers; BUILD starts and reads them.
 *
 * The quoted reply below her words is stripped by the mailbox before this sees the text, so
 * "approved" above a quoted plan is still exactly "approved".
 */
export const APPROVAL_WORDS = ["approved", "approve", "yes", "go", "land it", "ok", "okay", "lgtm"];
export const HOLD_PREFIXES = ["not approved", "no", "stop", "changes:", "change:", "hold"];
/** "preview" on a READY plan: approve it with every default, but hold the landing for a second word. */
export const PREVIEW_WORDS = ["preview", "preview only", "preview first", "preview it"];
/**
 * THE FORCE-TO-PRODUCTION BYPASS, NAMED (owner, 21 Sep 2026). She may decide the placeholders do
 * not matter. These exact phrases — and only these, never plain "approved" — take a not-ready plan
 * (or a preview) straight to land-on-green, with who/when/what recorded and a finding raised.
 */
export const FORCE_WORDS = ["approved to production", "force production", "ship it anyway", "land anyway"];
export const FORCED_TEXT = "approved to production — every ask takes the recommended default; the placeholders ship by her instruction";
export const APPROVED_DEFAULTS_TEXT = "approved — every ask takes the recommended default";
export const PREVIEW_DEFAULTS_TEXT = "preview — every ask takes the recommended default; land only after the preview is approved";

export function readReply(text) {
  const raw = String(text ?? "").trim();
  const first = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const norm = first.toLowerCase().replace(/[\s.!,;:'"“”‘’-]+$/g, "").replace(/^[\s"“'‘-]+/g, "").trim();
  if (!raw) return { mode: "empty", text: raw };
  const oneLine = raw.split(/\r?\n/).filter((l) => l.trim()).length === 1;
  if (APPROVAL_WORDS.includes(norm) && oneLine) return { mode: "approved", text: APPROVED_DEFAULTS_TEXT };
  if (PREVIEW_WORDS.includes(norm) && oneLine) return { mode: "preview", text: PREVIEW_DEFAULTS_TEXT };
  if (FORCE_WORDS.includes(norm) && oneLine) return { mode: "forced", text: FORCED_TEXT };
  const lower = first.toLowerCase();
  for (const p of HOLD_PREFIXES) {
    if (lower === p || lower.startsWith(p + " ") || lower.startsWith(p + ",") || lower.startsWith(p + ".") || lower.startsWith(p + "!") || (p.endsWith(":") && lower.startsWith(p))) {
      // "no" as a prefix must not swallow "note:" / "now use B"; the separators above make sure of it.
      return { mode: "held", text: raw };
    }
  }
  return { mode: "answers", text: raw };
}

/**
 * ─── THE GUARDS ─────────────────────────────────────────────────────────────
 *
 * A row may enter BUILD only when a plan exists AND her reply is on the record. "No asks" is not an
 * exemption: the plan always goes to her and her reply is the approval, so a plan with zero
 * questions still waits for "go". That is what makes "a recorded plan approval" a fact on the row
 * rather than an inference from an empty list.
 */
export function canEnterBuild(row) {
  if (!row) return { ok: false, why: "no row" };
  if (row.phase !== "build") return { ok: false, why: `phase is ${row.phase}, not build` };
  if (!row.plan_text) return { ok: false, why: "no plan on the record" };
  if (!row.answered_at || !row.answers_text) return { ok: false, why: "her reply is not on the record — a task with an unanswered ask cannot enter BUILD" };
  return { ok: true, why: "plan written, her reply recorded" };
}

/**
 * ─── A CHANGE THAT IS NOT PUBLISH-READY LANDS ONLY AFTER SHE HAS SEEN THE PREVIEW ──
 *
 * Owner, 21 Sep 2026. `publish_ready` is the PLAN phase's verdict — false whenever a placeholder
 * or a TODO would ship — and `preview_forced` is her word "preview" on a ready plan. Either one
 * means land-on-green does not apply: the PR goes up, the preview email goes, and LAND waits for
 * a SECOND "approved" recorded AFTER that email. `publish_ready` null (a plan that never said) is
 * treated as not ready: the safe direction.
 */
export function needsPreview(row) {
  if (!row) return true;
  if (Number(row.preview_forced) === 1) return true;
  return Number(row.publish_ready) !== 1;
}

/** Her explicit force to production: who and when, both on the row. */
export function isForced(row) {
  return Boolean(row?.forced_by && row?.forced_at);
}

/** The second approval: recorded, and recorded after the preview she was sent. */
export function previewApproved(row) {
  if (!row?.preview_sent_at || !row?.land_approved_at || !row?.land_approval_text) return false;
  return Number(row.land_approved_at) >= Number(row.preview_sent_at);
}

/**
 * A row may LAND only when the PR exists, its checks were recorded green by the lane (not assumed),
 * AND her reply — the plan approval — is on the record. Land-on-green was her decision on 20 Sep
 * 2026; the two recorded facts are what make it a decision she made and not a default she fell into.
 * A change that needs a preview ALSO needs her second "approved", after the preview email.
 */
export function canLand(row) {
  if (!row) return { ok: false, why: "no row" };
  if (row.phase !== "land") return { ok: false, why: `phase is ${row.phase}, not land` };
  if (!row.pr_url || !row.pr_number) return { ok: false, why: "no pull request on the record" };
  if (!row.checks_green_at) return { ok: false, why: "no recorded green check — land on green needs the green to be on the record" };
  if (!row.answered_at || !row.answers_text) return { ok: false, why: "no recorded plan approval — her reply is the approval and it is not on the record" };
  if (needsPreview(row) && !previewApproved(row) && !isForced(row)) {
    return { ok: false, why: !row.preview_sent_at
      ? "this change needs a preview (not publish-ready, or she asked for one) and no preview email is on the record"
      : "this change needs a preview and her second approval — an \"approved\" after the preview email — is not on the record" };
  }
  return { ok: true, why: isForced(row) ? `PR open, checks recorded green, forced to production by ${row.forced_by}` : needsPreview(row) ? "PR open, checks recorded green, her plan approval and her preview approval recorded" : "PR open, checks recorded green, her reply recorded" };
}

/** The preview step may run once the PR exists and no preview email has gone yet. */
export function canPreview(row) {
  if (!row) return { ok: false, why: "no row" };
  if (row.phase !== "preview") return { ok: false, why: `phase is ${row.phase}, not preview` };
  if (!row.pr_url || !row.pr_number) return { ok: false, why: "no pull request on the record" };
  if (row.preview_sent_at) return { ok: false, why: "the preview email already went" };
  return { ok: true, why: "PR open, preview not yet sent" };
}

/** Which phase a claim may run, given the row. Null when the row is waiting on something. */
export function claimablePhase(row) {
  if (!row) return null;
  if (row.phase === "plan") return "plan";
  if (row.phase === "build") return canEnterBuild(row).ok ? "build" : null;
  if (row.phase === "preview") return canPreview(row).ok ? "preview" : null;
  if (row.phase === "land") return canLand(row).ok ? "land" : null;
  return null;
}

/** Is the claim on this row still live? A lease that has run out is a dead run, not a live one. */
export function claimIsLive(row, now = Date.now()) {
  if (!row?.claimed_at) return false;
  return now - Number(row.claimed_at) < CLAIM_LEASE_MS;
}
