import type { Brief } from "../intake/firstRead";
import { riskAllows } from "../../../shared/boss/governance";
import type { Env } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { badRequest, conflict } from "../lib/http";
import { getSetting } from "../lib/settings";
import { isLane } from "../../../shared/boss/lanes";
import { classify, KIND_TO_DEPARTMENT, type Classification } from "../intake/classify";
import { prepareEnvelope } from "../intake/envelope";
import { startedBySystem } from "../../../shared/boss/mail/noticeGate.mjs";

/**
 * TASK INTAKE, IN ONE PLACE, BECAUSE THERE WERE TWO AND ONLY ONE OF THEM WORKED.
 *
 * WHAT WENT WRONG. `POST /api/boss/tasks` classified a task, gave it an execution assignment and a
 * permission envelope, wrote `intake_kind`, and then either queued it or raised an approval.
 * `duties/materialise.ts` — the thing that turns her standing duties into work every morning — did
 * none of that. It ran a bare INSERT with seven columns and stopped.
 *
 * The result is the portfolio's most-named defect wearing its most convincing disguise: RUNS BUT
 * INERT. The duty fired on time, every time. `standing_duties.last_run_at` advanced. A row appeared
 * in `tasks` with status 'queued'. Every observable signal said the system was working, and the
 * Executive Intelligence Report had never once been produced, because nothing was ever sent to the
 * queue — `boss_task_queue` was empty while two tasks sat "queued" since the 6th.
 *
 * `intake_kind` was null on those rows too, which is not cosmetic: the spend report groups by it,
 * the capability metrics filter on it, and the router uses it to decide which backend may take the
 * work. A task with no kind is invisible to all three.
 *
 * THE FIX IS NOT TO ADD A `TASKS.send()` TO MATERIALISE. That would leave two intake paths that
 * have to be kept in step by whoever notices next — "two components each keeping their own list
 * with no link", which is how this happened in the first place. Both callers now go through here,
 * so a task created by a duty is indistinguishable from one created by hand.
 */

export interface AdmitInput {
  title: string;
  lane?: string;
  input?: Record<string, unknown>;
  employee_id?: string | null;
  template_id?: string | null;
  intake_kind?: string | null;
  risk?: string | null;
  sensitivity?: string | null;
  /**
   * `public_model_approved` or `private_model_only`. WHICH MODELS MAY SEE THE INPUT.
   * Omitted means the classifier decides; see `intake/classify.ts`.
   */
  model_access?: string | null;
  /** `internal` or `external`. WHO MAY RECEIVE THE OUTPUT. It never reaches the router. */
  audience?: string | null;
  cost_mode?: string | null;
  /** R14: epoch ms before which the task must not run — a dated deferred item. Enqueued with that delay. */
  not_before?: number | null;
  /**
   * The email's one first read (inbound mail only). Its `outside`, `kind` and `risk` may only TIGHTEN or fill a
   * gap the keywords left: never a looser audience, never a lower risk, never over a declared kind.
   */
  brief?: Brief | null;
}

export interface AdmitResult {
  created: boolean;
  task_id: string | null;
  classification: ReturnType<typeof classify>;
  /** Present only when a task was actually created. */
  envelope?: { id: string; budget_micros: number };
  /** Whether it reached the queue, or is waiting on a person. */
  queued: boolean;
  cost_mode: string;
  reason?: string;
}

/**
 * IS THIS HOLD INTAKE'S OWN GUESS ON WORK BOSS OS STARTED ITSELF? Pure; the one reading admit and
 * the hourly sweep (routes/approvals.ts) share.
 *
 * True only when all four hold: the work was started by Boss OS (a duty's run or a repair:
 * `startedBySystem`), the lane is not trading, nobody declared the kind `trading`, and the
 * assignment is USER_ONLY. Outside the trading lane only the trading WORD rule produces USER_ONLY
 * (classify.ts RULES): money and an outward send end at AI_EXECUTE_WITH_APPROVAL, which queues and
 * keeps its approval at delivery. So money, a send in her name, legal and invitations keep their
 * approvals by construction, with no second list to keep in step.
 */
export function overruledGuess(a: {
  lane: string | null | undefined;
  assignment: string | null | undefined;
  input: unknown;
  declaredKind?: string | null;
}): boolean {
  if (a.lane === "trading") return false;
  if (a.assignment !== "USER_ONLY") return false;
  if (a.declaredKind === "trading") return false;
  return startedBySystem(a.input);
}

/**
 * THE PRIVACY AXES OF AN OVERRULED GUESS. Pure; the one reading admit and the hourly sweep
 * (routes/approvals.ts) share.
 *
 * 16 Nov 2026: the monthly quality read was released from intake's USER_ONLY guess (15 Nov) and then
 * refused by every seat for an hour at a time: the row still carried the guess's `restricted`
 * sensitivity, and `restricted` asks for a sensitive-routing card (backends/guard.ts
 * `restricted_needs_routing_card`) that nothing raises for work Boss OS started itself. The two axes
 * are treated differently on purpose:
 * - `sensitivity` is RE-DERIVED from the real text (a declared sensitivity still wins, through
 *   classify). The trading word rule's `restricted` was part of the guess being overruled.
 * - `modelAccess` stays TIGHTEN-ONLY: `private_model_only` if either reading says so. It is the
 *   non-liftable guard (router/policy.ts) that keeps private text off every free and training route,
 *   and the real prompt earns it on its own account (fund terms), so nothing private is loosened.
 */
export function overruledAxes(
  was: { modelAccess: string | null | undefined },
  redone: { sensitivity: Classification["sensitivity"]; modelAccess: Classification["modelAccess"] },
): { sensitivity: Classification["sensitivity"]; modelAccess: Classification["modelAccess"] } {
  return {
    sensitivity: redone.sensitivity,
    modelAccess: was.modelAccess === "private_model_only" ? "private_model_only" : redone.modelAccess,
  };
}

/** The first active employee that fits the kind, then the lane, then nobody. */
export async function suggestOwner(
  env: Env, intakeKind: string, lane: string,
): Promise<{ id: string; name: string } | null> {
  const department = KIND_TO_DEPARTMENT[intakeKind as keyof typeof KIND_TO_DEPARTMENT];
  if (department) {
    const byDept = await env.DB
      .prepare(
        `SELECT id, name FROM employees
          WHERE lane = ? AND department = ? AND lifecycle IN ('active','provisional') AND status = 'active'
          ORDER BY created_at LIMIT 1`,
      )
      .bind(lane, department)
      .first<{ id: string; name: string }>();
    if (byDept) return byDept;
  }
  return env.DB
    .prepare(
      `SELECT id, name FROM employees
        WHERE lane = ? AND lifecycle IN ('active','provisional') AND status = 'active'
        ORDER BY created_at LIMIT 1`,
    )
    .bind(lane)
    .first<{ id: string; name: string }>();
}

/**
 * Admit one task: classify it, own it, envelope it, and then either queue it or raise the approval.
 *
 * Throws the same `AppError`s the route threw, so the HTTP behaviour is unchanged — they carry
 * their own status codes and are handled by the error middleware wherever they are raised.
 */
export async function admitTask(env: Env, b: AdmitInput, handoff?: { id: string; researchQuestion?: string }): Promise<AdmitResult> {
  if (!b?.title) throw badRequest("A task needs a title", "Send { title, lane, input }.");
  const lane = isLane(b.lane) ? b.lane : "ops";
  const input = b.input ?? {};

  let templateId: string | null = null;
  let intakeKind = b.intake_kind ?? null;
  let employeeHint = b.employee_id ?? null;

  if (b.template_id) {
    const tpl = await env.DB
      .prepare(`SELECT id, lane, intake_kind, owner_employee_id, approval_rule FROM task_templates WHERE id = ? AND enabled = 1`)
      .bind(b.template_id)
      .first<{ id: string; lane: string; intake_kind: string; owner_employee_id: string | null; approval_rule: string }>();
    if (!tpl) throw badRequest("No enabled template with that id", "List templates at GET /api/intake/templates.");
    templateId = tpl.id;
    if (!intakeKind) intakeKind = tpl.intake_kind;
    if (!employeeHint) employeeHint = tpl.owner_employee_id;
  }

  /*
   * ─── "#danielle <grid repo> <drive folder> <instructions>" IS A REPO CHANGE ────────────
   *
   * Plan B, 20 Sep 2026. On Danielle's desk only, and only when the words name a grid repo or a
   * Drive folder: the task becomes a repo change — `input.repo_change` on the card, a `repo_changes`
   * row for the lane's state — and its kind is `repository`, the kind the classifier already keeps
   * behind approval. Her reply to the plan is that approval. A message naming a repo the grid
   * EXCLUDES (West Peek, a client micro-site) is refused here with the grid's own reason, so the
   * mailbox tells her why instead of quietly opening ordinary work on a request that plainly
   * asked for a change to a repository this desk may not touch.
   *
   * Every door passes through here — mail, Team → New task, the API — so the shape is one shape.
   */
  const { parseRepoChange, systemRepoChange, repairOriginOf, REPO_CHANGE_SEAT } = await import("../../../shared/boss/repoChange/lane.mjs");
  const repoChange = employeeHint === REPO_CHANGE_SEAT && !(input.repo_change && typeof input.repo_change === "object")
    ? parseRepoChange([b.title, input.body as string | undefined, input.prompt as string | undefined].filter(Boolean).join("\n"), { buildAsk: input.build_ask === true })
    : null;
  if (repoChange && "excluded" in repoChange) {
    throw badRequest(
      `${repoChange.excluded.repo} is out of scope for Danielle: ${repoChange.excluded.why}`,
      "Name a repository from the grid, any other repository by its GitHub address (github.com/owner/name), or a Drive folder for one of them.",
    );
  }
  let change = repoChange && !("excluded" in repoChange) ? repoChange : null;
  let changeId: string | null = null;
  const attachChange = (c: NonNullable<typeof change>): string => {
    const cid = newId("rc");
    (input as Record<string, unknown>).repo_change = {
      change_id: cid, repo: c.repo, property: c.property, github_repo: c.github_repo,
      drive_folder: c.drive_folder, drive_url: c.drive_url,
      ...(c.pre_approved_phrase ? { pre_approved_phrase: c.pre_approved_phrase } : {}),
      ...(c.force_phrase ? { force_phrase: c.force_phrase } : {}),
    };
    return cid;
  };
  if (change) {
    changeId = attachChange(change);
    if (!intakeKind) intakeKind = "repository";
  }

  let classification = classify({
    title: b.title, prompt: (input.prompt as string | undefined) ?? null, lane,
    intakeKind: intakeKind ?? undefined, risk: b.risk ?? undefined, sensitivity: b.sensitivity ?? undefined,
    model_access: b.model_access ?? undefined, audience: b.audience ?? undefined,
    // Mail-born work carries who wrote it, so her own errand (classify's one outbound carve-out) is known.
    sender: input.source === "boss_inbound_mail" ? String(input.from ?? "") : null,
  });
  /*
   * WHAT THE FIRST READ SAYS ABOUT THE WORK (eng sweep row 7b, #514 review: one read per email). The keywords need a
   * recipient AND a verb to call work external; her mail can say it other ways ("get this in front of the gallery
   * buyers"). The read's `outside` (her exact words, standing in her sentence) makes the work external, which waits on
   * her approval; its kind fills only a "no category matched"; its risk only raises. Nothing here ever loosens.
   */
  const brief = input.source === "boss_inbound_mail" ? b.brief ?? null : null;
  if (brief?.outside && classification.audience === "internal" && !b.audience) {
    classification = { ...classification, ...classify({
      title: b.title, prompt: (input.prompt as string | undefined) ?? null, lane,
      intakeKind: intakeKind ?? undefined, risk: b.risk ?? undefined, sensitivity: b.sensitivity ?? undefined,
      model_access: b.model_access ?? undefined, audience: "external",
      sender: String(input.from ?? ""),
    }) };
  }
  /*
   * THE READ'S KIND DECIDES (22 Nov 2026: meaning by the model, no keyword verdict in front of it). A declared kind
   * (a tag, a repo change) still wins: that is structure. The read names the kind; what that kind would make stricter
   * is taken (private access, higher risk, her own hands), and nothing it would loosen is: the keywords' access, risk,
   * hands-off level, sensitivity and audience stand otherwise.
   */
  if (brief?.kind && !intakeKind && brief.kind !== classification.intakeKind) {
    const byRead = classify({
      title: b.title, prompt: (input.prompt as string | undefined) ?? null, lane,
      intakeKind: brief.kind, risk: b.risk ?? undefined, sensitivity: b.sensitivity ?? undefined,
      model_access: b.model_access ?? undefined, audience: classification.audience,
      sender: String(input.from ?? ""),
    });
    classification = {
      ...classification,
      intakeKind: brief.kind,
      modelAccess: byRead.modelAccess === "private_model_only" ? "private_model_only" : classification.modelAccess,
      risk: riskAllows(classification.risk, byRead.risk) ? classification.risk : byRead.risk,
      executionAssignment: byRead.executionAssignment === "USER_ONLY" ? "USER_ONLY" : classification.executionAssignment,
      reason: `${classification.reason} Kind read from her words: ${brief.kind}.`,
    };
  }
  if (brief?.risk && !b.risk && !riskAllows(classification.risk, brief.risk)) {
    classification = { ...classification, risk: brief.risk };
  }

  /*
   * ─── A HIGH-RISK REPAIR ON DANIELLE'S SEAT THAT NAMES NO REPOSITORY IS A REPO CHANGE (17 Nov 2026) ─
   *
   * tsk_m7mjnn5amvqt1bzj: an overdue open loop ("Unsaved edits in ~/GitHub/boss-os") opened on this
   * seat, classified repository/high, named no repository the parse reads, so it became an ordinary
   * queued task and the cloud router refused it on every model (all are cleared to low risk). Only
   * this lane does high-risk repository work. Narrow on purpose: a repair Boss OS opened itself
   * (`repairOriginOf`), never her mail, and only at risk high — low and medium repairs keep the path
   * that already runs them. `systemRepoChange` reads a `~/GitHub/<name>` checkout as that repo and
   * anything else as Boss OS's own; a named exclusion is refused with the grid's reason, as above.
   */
  if (!change && repoChange === null && employeeHint === REPO_CHANGE_SEAT && classification.risk === "high" &&
      typeof input.mail_id !== "string" && !(input.repo_change && typeof input.repo_change === "object") &&
      repairOriginOf(input).origin === "repair") {
    const sys = systemRepoChange([b.title, input.body as string | undefined, input.prompt as string | undefined].filter(Boolean).join("\n"));
    if (sys && "excluded" in sys) {
      throw badRequest(
        `${sys.excluded.repo} is out of scope for Danielle: ${sys.excluded.why}`,
        "A repair names a repository from the grid, or Boss OS's own.",
      );
    }
    if (sys) {
      change = sys;
      changeId = attachChange(sys);
    }
  }

  /*
   * ─── "FIND FIRMS THAT DID X AND DRAFT THE ASK" IS ONE SHAPE OF WORK, ON EVERY DOOR ─────────
   *
   * Her instruction of 19 Sep 2026 — "find me a list of firms that have reported IPO participation
   * … and draft an email for me to ask if I can send investors to them" — used to reach a cloud
   * rung as free text and come back as a paragraph promising to look. `parseFirmScan` is a grammar
   * that recognises the shape here, at the one point every door passes through, so Team → New
   * task, the mail intake and the API all produce the same work: a `ask_scans` row owned by
   * Camille, run by `research/firmScan.ts`. A sentence the grammar cannot read is untouched.
   */
  const { parseFirmScan } = await import("../research/firmScan");
  const firmScan = input.firm_scan && typeof input.firm_scan === "object"
    ? null
    : parseFirmScan([b.title, input.prompt as string | undefined, input.body as string | undefined]);
  const scanId = firmScan ? newId("fsc") : null;
  if (firmScan && scanId) {
    (input as Record<string, unknown>).firm_scan = { scan_id: scanId, find: firmScan.find, ask: firmScan.ask };
    if (!employeeHint) employeeHint = "emp_research";
  }

  /*
   * ─── A JOB IN HER OWN CHROME IS A CHROME JOB, ON EVERY DOOR (1 Nov 2026) ─────────────────
   *
   * "One-time Chrome job … give it to whoever on the team already works in my Chrome" became a
   * research page (WebSearch/WebFetch, no Chrome). Her explicit Chrome words win over the research
   * reading: the task names Camille's Claude Code seat with `requested.browser: "chrome"`, which the
   * queue keeps on Claude's seat only (consumer.ts) and the runner turns into Claude in Chrome
   * (src/shared/boss/intake/chromeJob.mjs). Read before the research page, so it never becomes one.
   */
  const { chromeJobIn, composeChromePrompt, CHROME_JOB_SEAT, CHROME_JOB_BACKEND, CHROME_JOB_REQUESTED } =
    await import("../../../shared/boss/intake/chromeJob.mjs");
  const chromeAsk = !firmScan && !change && input.chrome_job === undefined && !(input.research_page && typeof input.research_page === "object") &&
      input.delivers === undefined && input.backend_id === undefined && input.spec_module === undefined &&
      (employeeHint === null || employeeHint === CHROME_JOB_SEAT) &&
      chromeJobIn([b.title, input.body as string | undefined].filter(Boolean).join("\n"));
  if (chromeAsk) {
    const ask = String((input.body as string | undefined) ?? b.title).replace(/^\s*research(?:\s+page)?\s*[:\-–—]\s*/i, "");
    Object.assign(input as Record<string, unknown>, {
      chrome_job: true,
      backend_id: CHROME_JOB_BACKEND,
      requested: { ...CHROME_JOB_REQUESTED, allowed_paths: [...CHROME_JOB_REQUESTED.allowed_paths] },
      prompt: composeChromePrompt({ ask }),
    });
    employeeHint = CHROME_JOB_SEAT;
  }

  /*
   * ─── "#camille research: <question>" IS A RESEARCH PAGE, ON EVERY DOOR (22 Oct 2026) ─────
   *
   * The owner: "give Camille a real executor for research deliverables (output: an HTML/markdown
   * page)". The task names her Claude Code seat and the delivery it owes, so the queue parks it for
   * her Mac (bk_claude_code, claimed through /backends/claim) and `deliverResearchPage` files the
   * page. A firm scan or a repo change keeps its own path; only Camille's desk (or no desk) reads it.
   */
  const { parseResearchPage, composeResearchPrompt, RESEARCH_PAGE_DELIVERS, RESEARCH_PAGE_SEAT, RESEARCH_PAGE_BACKEND, RESEARCH_PAGE_REQUESTED } =
    await import("../../../shared/boss/research/page.mjs");
  // HER WORDS ONLY: the title and the mail body. A duty's composed prompt (the briefing is Camille's
  // too, and its prompt has lines that start "Research…") already names its own delivery and backend,
  // so any task that arrives carrying `delivers`, `backend_id` or a spec module is never re-read here.
  const researchAsk = !firmScan && !change && !(input.research_page && typeof input.research_page === "object") &&
      input.delivers === undefined && input.backend_id === undefined && input.spec_module === undefined &&
      (employeeHint === null || employeeHint === RESEARCH_PAGE_SEAT)
    ? handoff?.researchQuestion
      ? { question: handoff.researchQuestion.slice(0, 2000) }
      : parseResearchPage([b.title, input.body as string | undefined])
    : null;
  const researchId = researchAsk ? newId("rpg") : null;
  if (researchAsk && researchId) {
    Object.assign(input as Record<string, unknown>, {
      research_page: { page_id: researchId, question: researchAsk.question },
      delivers: RESEARCH_PAGE_DELIVERS,
      backend_id: RESEARCH_PAGE_BACKEND,
      requested: { ...RESEARCH_PAGE_REQUESTED, allowed_paths: [...RESEARCH_PAGE_REQUESTED.allowed_paths], web_tools: [...RESEARCH_PAGE_REQUESTED.web_tools] },
      prompt: composeResearchPrompt({ id: researchId, question: researchAsk.question }),
    });
    employeeHint = RESEARCH_PAGE_SEAT;
    /*
     * A RESEARCH PAGE IS RESEARCH, WHATEVER ITS TITLE SAYS (22 Oct 2026). The kind was read from the
     * title before the page was recognised, so "static site hosting" became one_off and Camille's
     * own seat (bk_claude_code, research/repo_work/document only) refused it — the first research
     * question emailed without the word "research" in its subject failed on arrival.
     */
    if (classification.intakeKind !== "research") {
      classification = classify({
        title: b.title, prompt: (input.prompt as string | undefined) ?? null, lane,
        intakeKind: "research", risk: b.risk ?? undefined, sensitivity: b.sensitivity ?? undefined,
        model_access: b.model_access ?? undefined, audience: b.audience ?? undefined,
      });
    }
  }

  /*
   * ─── WORK BOSS OS STARTED ITSELF IS NEVER PARKED ON INTAKE'S OWN GUESS (15 Nov 2026) ─────
   *
   * The monthly quality read (a duty's run) quotes her briefing, and the trading WORD rule read
   * "Brokerage", "shares" and "stock" in those quotes as trading work: USER_ONLY, awaiting an
   * approval that is never shown to her (your-day.mjs `intakeHeldDutyRun`), so nothing released it.
   * `overruledGuess` is the one reading: see its comment for why money, sends and the trading lane
   * keep their approvals. The overruled classification is kept on the record.
   */
  let overruled: ReturnType<typeof classify> | null = null;
  if (overruledGuess({ lane, assignment: classification.executionAssignment, input, declaredKind: intakeKind })) {
    overruled = classification;
    const redone = classify({
      title: b.title, prompt: (input.prompt as string | undefined) ?? null, lane,
      intakeKind: input.duty_id != null ? "recurring_duty" : "one_off",
      risk: b.risk ?? undefined, sensitivity: b.sensitivity ?? undefined,
      model_access: b.model_access ?? undefined, audience: b.audience ?? undefined,
    });
    // Sensitivity re-derived, model access tighten-only: see `overruledAxes`.
    classification = {
      ...redone,
      ...overruledAxes(overruled, redone),
      reason: `${redone.reason} Boss OS started this itself, so a word in its own text does not park it (intake first read it as ${overruled.intakeKind}, ${overruled.executionAssignment}).`,
    };
  }

  const employeeId: string | null =
    employeeHint ?? (await suggestOwner(env, classification.intakeKind, lane))?.id ?? null;

  if (employeeId) {
    const emp = await env.DB
      .prepare(`SELECT id, lane, lifecycle FROM employees WHERE id = ?`).bind(employeeId)
      .first<{ id: string; lane: string; lifecycle: string }>();
    if (!emp) throw badRequest("No employee with that id");
    if (emp.lane !== lane) {
      throw conflict(
        `${emp.id} belongs to the ${emp.lane} lane, not ${lane}`,
        "Lanes are isolated. Pick an employee from the same lane.",
      );
    }
    if (["retired", "suspended", "merged"].includes(emp.lifecycle ?? "active")) {
      throw conflict(`That employee is ${emp.lifecycle}`, "Reinstate it in Team, or pick another.");
    }
  }

  const id = handoff?.id ?? newId("tsk");
  const now = Date.now();
  const costMode = b.cost_mode ?? (await getSetting(env.DB, "cost_mode")) ?? "NORMAL";
  const assignment = classification.executionAssignment;

  // DELETE is a real answer: the system is allowed to refuse fake work.
  if (assignment === "DELETE") {
    await audit(env.DB, {
      actor: "system", lane, entityType: "task", action: "refused",
      detail: { title: b.title, reason: classification.reason },
    });
    return { created: false, task_id: null, classification, queued: false, cost_mode: costMode, reason: classification.reason };
  }

  const queued = assignment === "AI_DRAFT" || assignment === "AI_EXECUTE_WITH_APPROVAL" ||
                 assignment === "AI_EXECUTE_WITH_NOTICE";
  const status = queued ? "queued" : "awaiting_approval";

  const { envelope, insert: insertEnvelope } = await prepareEnvelope(env.DB, { taskId: id, lane, employeeId, classification, costMode });
  const writes = [
    env.DB.prepare(
      `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at,
                          intake_kind, template_id, execution_assignment, risk, sensitivity,
                          model_access, audience, cost_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, lane, employeeId, b.title, Object.keys(input).length ? JSON.stringify(input) : null,
      status, now, classification.intakeKind, templateId, assignment,
      classification.risk, classification.sensitivity,
      // THE TWO AXES LAND ON THE ROW, so the card says what it is rather than leaving the router to
      // re-derive it from the prompt every time. The router still scans; this is the declaration
      // the scan corroborates.
      classification.modelAccess, classification.audience, costMode,
    ),
    env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'intake',?)`)
      .bind(newId("tev"), id, now, JSON.stringify(classification)),
    ...(overruled
      ? [env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'intake_overruled',?)`)
          .bind(newId("tev"), id, now, JSON.stringify({ reason: "Started by Boss OS: a word in its own text does not park it", was: overruled }))]
      : []),
  ];

  if (firmScan && scanId) {
    writes.push(env.DB
      .prepare(
        `INSERT INTO ask_scans (id, task_id, instruction, find_text, ask_text, state, requested_at, updated_at)
         VALUES (?,?,?,?,?,'queued',?,?)`,
      )
      .bind(scanId, id, firmScan.raw, firmScan.find, firmScan.ask, now, now));
  }

  if (researchAsk && researchId) {
    writes.push(env.DB
      .prepare(`INSERT INTO research_pages (id, task_id, question, state, requested_at, updated_at) VALUES (?,?,?,'queued',?,?)`)
      .bind(researchId, id, researchAsk.question, now, now));
  }

  if (change && changeId) {
    /*
     * PRE-APPROVAL IS WRITTEN HERE AND NOWHERE ELSE. The phrase comes out of HER request text —
     * this door is below the mailbox's sender refusal, and the console door is her own session —
     * so `pre_approved_by` is the verified sender and never a later correspondent. The finding
     * names the phrase, so "why did this build without asking me" has a one-line answer.
     */
    const repair = typeof input.mail_id === "string" ? { origin: "owner", repair_kind: null } : repairOriginOf(input);
    const preBy = change.pre_approved_phrase ? (typeof input.from === "string" ? input.from : "console") : null;
    writes.push(env.DB
      .prepare(
        `INSERT INTO repo_changes (id, task_id, mail_id, repo, property_key, drive_folder, drive_url, instruction, phase,
                                   pre_approved_phrase, pre_approved_by, force_phrase, created_at, updated_at, github_repo, origin, repair_kind)
         VALUES (?,?,?,?,?,?,?,?,'plan',?,?,?,?,?,?,?,?)`,
      )
      .bind(
        changeId, id, typeof input.mail_id === "string" ? input.mail_id : null,
        change.repo, change.property, change.drive_folder, change.drive_url,
        change.instruction, change.pre_approved_phrase, preBy, change.force_phrase, now, now, change.github_repo,
        /*
         * REPAIRS NEVER WAIT ON THE OWNER (25 Oct 2026). Only the API door's caller can declare a
         * repair — her mail never sets `input.origin` — and only with a known kind; anything else
         * is her request and keeps its approval email.
         */
        repair.origin, repair.repair_kind,
      ));
    /*
     * R24 (docs/SERVICE_RULES.md): a repo she named by its GitHub address that is not on the grid is
     * REGISTERED here, beside the grid, and the job proceeds. The named exclusions were refused above.
     */
    if (change.registered && change.repo && change.github_repo) {
      writes.push(env.DB
        .prepare(`INSERT INTO boss_repo_registry (name, github_repo, mail_id, registered_at) VALUES (?,?,?,?) ON CONFLICT(name) DO NOTHING`)
        .bind(change.repo, change.github_repo, typeof input.mail_id === "string" ? input.mail_id : null, now));
    }
    if (change.pre_approved_phrase) {
      writes.push(env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'repo_change_pre_approved',?)`)
        .bind(newId("tev"), id, now, JSON.stringify({ repo_change_id: changeId, phrase: change.pre_approved_phrase, by: preBy, force_phrase: change.force_phrase })));
    }
  }

  writes.push(insertEnvelope, env.DB.prepare(`UPDATE tasks SET envelope_id = ? WHERE id = ?`).bind(envelope.id, id));
  if (!queued) {
    // USER_ONLY, HUMAN_CONTRACTOR, and DEFER surface as a decision, not a run.
    const aprId = newId("apr");
    writes.push(
      env.DB.prepare(
        `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
         VALUES (?,?,?,?,'manual','tasks',?,?,?,'pending',?,?)`,
      ).bind(
        aprId, lane, b.title,
        `Intake assigned this ${assignment}. ${classification.reason}`,
        id, classification.risk, JSON.stringify({ task_id: id, assignment }), now,
        now + 7 * 24 * 60 * 60 * 1000,
      ),
      env.DB.prepare(`UPDATE tasks SET approval_id = ? WHERE id = ?`).bind(aprId, id),
    );
  }

  // A Queue retry can find the complete admission. A D1 failure rolls it all back.
  await env.DB.batch(writes);
  if (queued) {
    const delayMs = b.not_before && b.not_before > now ? b.not_before - now : 0;
    await env.TASKS.send({ taskId: id, lane }, delayMs ? { delaySeconds: Math.ceil(delayMs / 1000) } : undefined);
  }
  if (changeId && change?.pre_approved_phrase) {
    const by = typeof input.from === "string" ? input.from : "console";
    await logEvent(env.DB, { level: "warn", scope: "intake", event: "repo_change_pre_approved", lane, entityId: changeId,
      detail: { phrase: change.pre_approved_phrase, by, force_phrase: change.force_phrase, repo: change.repo } });
  }

  await audit(env.DB, {
    actor: "boss", lane, entityType: "task", entityId: id, action: "intake",
    detail: { kind: classification.intakeKind, assignment, risk: classification.risk },
  });
  await logEvent(env.DB, {
    level: "info", scope: "intake", event: "task_admitted", lane, entityId: id,
    detail: { kind: classification.intakeKind, assignment, cost_mode: costMode, budget_micros: envelope.budget_micros },
  });

  return { created: true, task_id: id, classification, envelope, queued, cost_mode: costMode };
}
