export class ApiError extends Error {
  constructor(message: string, public hint?: string, public status?: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/boss${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      "Boss OS could not be reached",
      "Check your connection. Nothing was sent, so nothing was changed.",
    );
  }

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json?.ok === false) {
    throw new ApiError(json?.error ?? `Request failed (${res.status})`, json?.hint, res.status);
  }
  return json.data as T;
}

/**
 * A GET whose answer MUST be a list, checked rather than asserted.
 *
 * `call<any[]>` is a claim about the server that TypeScript cannot verify — the value crosses the
 * wire as `any` and the cast is believed. When a route answers `{entries: [...]}` instead, the
 * mismatch surfaces later, inside a `.map()` during render, where React's only move is to unmount
 * the tree. The reader gets a white page.
 *
 * So the check happens at the seam, where it is still an ordinary rejected promise every screen
 * already handles with `<ErrorNotice>`: a wrong shape becomes a sentence naming the endpoint, and
 * the rest of the app keeps working. `key` is the field to unwrap for routes that legitimately
 * wrap their list in an envelope carrying a `total` or a `reason` alongside it.
 */
async function listOf<T = any>(path: string, key?: string): Promise<T[]> {
  const data = await call<any>(path);
  const value = key !== undefined && data && typeof data === "object" ? data[key] : data;
  if (!Array.isArray(value)) {
    throw new ApiError(
      `${path} did not answer with a list`,
      `It returned ${value === undefined ? "nothing" : typeof value}. The screen and the endpoint disagree about this response's shape; nothing was changed.`,
    );
  }
  return value as T[];
}

const post = (path: string, body?: unknown) =>
  ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }) as RequestInit;

/**
 * A write that could not be sent is KEPT, not lost — Batch 7.
 *
 * Only a transport failure qualifies. A refusal, a validation error or any answer the server
 * actually gave is a real result and is thrown as one: queueing a rejected capture would build a
 * queue that can never drain and a badge that never clears.
 */
async function captureOffline<T>(
  attempt: () => Promise<T>,
  kind: import("./offline/outbox").OutboxKind,
  payload: Record<string, unknown>,
): Promise<T | { queued: true; id: string }> {
  try {
    return await attempt();
  } catch (err) {
    const unreachable = err instanceof ApiError && err.status === undefined;
    if (!unreachable) throw err;
    const { enqueue } = await import("./offline/outbox");
    const item = await enqueue(kind, payload);
    return { queued: true, id: item.recordId };
  }
}

export const api = {
  authState: () => call<{ unlocked: boolean }>("/auth/state"),
  unlock: (passcode: string) => call<{ unlocked: boolean }>("/auth/unlock", post("", { passcode })),
  lock: () => call("/auth/lock", post("")),

  today: (date?: string) => call<any>(`/today${date ? `?date=${date}` : ""}`),
  /**
   * One group of Today's blocks. The screen fires one of these per group, in parallel, and stitches
   * the answers back into canon §15's thirteen — see `TODAY_GROUPS` in the worker's today route for
   * why the day is not fetched whole.
   */
  todayBlocks: (blocks: readonly string[], date?: string) =>
    call<any>(`/today?blocks=${blocks.join(",")}${date ? `&date=${date}` : ""}`),
  days: () => call<any[]>("/today/days"),
  coachingState: () => call<any>("/today/coaching"),
  coachingConsent: (body: unknown) => call<any>("/today/coaching/consent", post("", body)),
  coachingTurn: (body: unknown) => call<any>("/today/coaching/turn", post("", body)),
  setDayMode: (body: unknown) => call<any>("/today/coaching/mode", post("", body)),
  todayGates: (date?: string) => call<any[]>(`/today/gates${date ? `?date=${date}` : ""}`),
  loops: (date?: string) => call<any[]>(`/today/loops${date ? `?date=${date}` : ""}`),
  openLoop: (body: Record<string, unknown>) =>
    captureOffline(() => call<any>("/today/loops", post("", body)), "open_loop", body),
  closeLoop: (id: string, action: "resolve" | "dismiss" | "defer", note?: string) =>
    call<any>(`/today/loops/${id}/${action}`, post("", { note })),
  morningGate: (body: unknown) => call<any>("/today/gates/morning", post("", body)),
  middayGate: (body: unknown) => call<any>("/today/gates/midday", post("", body)),
  nightGate: (body: unknown) => call<any>("/today/gates/night", post("", body)),
  runOfShowBlock: (key: string, body: unknown) => call<any>(`/today/run-of-show/${key}`, post("", body)),
  // Served rather than restated in the client: a screen that spelled the five floors itself would
  // be a second copy of her contract, free to drift from the one that scores the day.
  floors: () => call<any>("/today/floors"),
  /*
   * THE FIRST RECORD OF DOING IN BOSS OS. Until this existed, every "because" line under the
   * somatic lanes was a guess: the log held which movement was OFFERED and nothing held whether she
   * did it. One mark for the whole rotation, and it undoes.
   */
  markRotationDone: (done: boolean) => call<any>("/today/movement/done", post("", { done })),
  // The ancestor hour. `ts` is the day and time SHE names, never the moment of recording.
  recordAncestorHour: (body: unknown) => call<any>("/spirit/ancestors", post("", body)),

  status: () => call<any>("/system/status"),
  health: () => call<any>("/system/health"),
  diagnostics: (level?: string) => call<any>(`/system/diagnostics${level ? `?level=${level}` : ""}`),
  cost: (days = 30) => call<any>(`/system/cost?days=${days}`),
  usage: () => call<any[]>("/system/usage"),
  audit: () => call<any[]>("/system/audit"),
  settings: () => call<any[]>("/system/settings"),
  spendReconciliation: () => call<any>("/system/spend-reconciliation"),
  costModes: () => call<any[]>("/system/cost-modes"),
  setSetting: (key: string, value: string) =>
    call(`/system/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),
  /*
   * ── The spend lever. ──
   *
   * NOT A FOURTH BUDGET, and not a seventh cost mode. `src/worker/boss/router/spend.ts` is explicit
   * about both: the lever supplies the ALLOWANCE that a backend's sub-cap defers to, the lane
   * budget stays the outer authority, and the effective allowance is always the smallest of the
   * three — so no two numbers here can disagree. Cost mode is a different question entirely (which
   * model tiers are good enough), it never moves the lever, and the lever never moves it. They are
   * two controls on this screen for that reason and must never be merged into one list.
   *
   * THE POSITION AND THE FIGURE ARE TWO THINGS. `position` is FREE_ONLY | MODERATE | OPEN;
   * `moderate_micros` is MODERATE's allowance, which the owner sets and changes in place. Sending
   * the figure without a position is how she edits the number without moving the lever.
   */
  /*
   * ONE ANSWER TO "WHAT CAN THIS THING SPEND" — the lever, the cost mode, the plan and its reserve,
   * the lane budgets and every backend's ceiling, each figure carrying what KIND of figure it is.
   * Cost control had scattered into the Backends tab; this is what puts it back in one place.
   */
  costs: () => call<any>("/system/costs"),
  setPlan: (body: { tier?: string; reserve_pct?: number; capacity_micros?: number }) =>
    call<any>("/system/costs/plan", post("", body)),

  spendLever: () => call<any>("/system/spend-lever"),
  setSpendLever: (body: { position?: string; moderate_micros?: number }) =>
    call<any>("/system/spend-lever", post("", body)),

  deadLetters: () => call<any[]>("/system/dead-letters"),
  requeueDeadLetter: (id: string) => call(`/system/dead-letters/${id}/requeue`, post("")),
  dismissDeadLetter: (id: string) => call(`/system/dead-letters/${id}/dismiss`, post("")),

  /*
   * NOTICES ARE FETCHED SEPARATELY BECAUSE THEY ARE A DIFFERENT KIND OF THING.
   *
   * `approvals("pending")` returns only what needs an answer — the badge, the Today card and the
   * Inbox stat all count that and nothing else. A notice is something an employee told her; it goes
   * in its own section with one button that says what it does.
   */
  notices: () => call<any[]>("/approvals/notices"),
  approvals: (status = "pending") => call<any[]>(`/approvals?status=${status}`),
  approval: (id: string) => call<any>(`/approvals/${id}`),
  decide: (id: string, decision: string, note?: string) =>
    call<{ approval: any; execution: { status: string; detail: any } | null }>(
      `/approvals/${id}/decide`, post("", { decision, note }),
    ),

  /*
   * Work that needs her judgement, with the work itself attached. The Inbox asks for these
   * alongside the pending dockets so a judgement docket can render the covers rather than a
   * sentence about the covers.
   */
  judgementPending: () => call<{ items: any[] }>("/judgement/pending"),

  /* The diary. Manual entry is the primary route: a service account can never read a personal
   * Google calendar, so some of her meetings will always be ones she typed. */
  /*
   * The three things she can do with an alert. `resolveAlert` deliberately RE-VERIFIES rather than
   * closing on her say-so, and answers with a verdict either way — a human asserting something is
   * done is the same claim TERMINAL_CHECKS exists to refuse, wearing different clothes.
   */
  refreshAlerts: () => call<any>("/today/alerts/refresh", post("")),
  /*
   * BOTH ARGUMENTS TRAVEL. An owned deliverable is re-verified by its own terminal check; every
   * other alert is re-tested by recomputing the surface and looking for its key. The screen passes
   * whichever it has, so no alert is left without a way to be asked again — which is what "Mark
   * resolved" rendering on none of her alerts actually meant.
   */
  resolveAlert: (args: { deliverableId?: string | null; key?: string | null }) =>
    call<{ closed: boolean; verdict: string }>("/today/alerts/resolve", post("", {
      deliverable_id: args.deliverableId ?? "",
      key: args.key ?? "",
    })),
  dismissAlert: (body: Record<string, unknown>) => call<any>("/today/alerts/dismiss", post("", body)),

  diary: () => call<any>("/diary"),
  addMeeting: (body: Record<string, unknown>) => call<any>("/diary", post("", body)),
  cancelMeeting: (id: string) => call<any>(`/diary/${id}/cancel`, post("")),

  employees: () => call<any[]>("/employees"),
  employee: (id: string) => call<any>(`/employees/${id}`),
  sprawl: () => call<any>("/employees/review/sprawl"),
  reviewEmployee: (id: string, outcome: string, note?: string) =>
    call(`/employees/${id}/review`, post("", { outcome, note })),

  tasks: (status?: string) => call<any[]>(`/tasks${status ? `?status=${status}` : ""}`),
  task: (id: string) => call<any>(`/tasks/${id}`),
  classify: (body: unknown) => call<any>("/tasks/classify", post("", body)),
  createTask: (body: unknown) => call<any>("/tasks", post("", body)),
  requeueTask: (id: string) => call(`/tasks/${id}/requeue`, post("")),
  cancelTask: (id: string) => call(`/tasks/${id}/cancel`, post("")),

  templates: () => call<any[]>("/intake/templates"),
  workloads: () => call<any[]>("/intake/workloads"),
  assessments: () => call<any[]>("/intake/assessments"),
  assess: (body: unknown) => call<any>("/intake/assessments", post("", body)),
  proposals: () => call<any[]>("/intake/proposals"),

  models: () => call<any[]>("/models"),
  routes: () => call<any[]>("/models/routes"),
  decisions: () => call<any[]>("/models/decisions"),
  benchmarks: () => call<any[]>("/models/benchmarks"),

  memory: (tier?: string) => call<any[]>(`/memory${tier ? `?tier=${tier}` : ""}`),
  memoryItem: (id: string) => call<any>(`/memory/${id}`),
  rules: () => call<any[]>("/memory/rules"),
  promotionEvents: () => call<any[]>("/memory/events"),
  sweep: () => call<{ promoted: number; proposed: number; skipped: number }>("/memory/sweep", post("")),
  capture: (body: unknown) => call<any>("/memory", post("", body)),
  promote: (id: string, to_tier: string, reason?: string) =>
    call<any>(`/memory/${id}/promote`, post("", { to_tier, reason })),
  archiveMemory: (id: string, reason?: string) => call(`/memory/${id}/archive`, post("", { reason })),
  retireMemory: (id: string, reason: string) => call<any>(`/memory/${id}/retire`, post("", { reason })),
  unretireMemory: (id: string, reason?: string) => call<any>(`/memory/${id}/unretire`, post("", { reason })),
  retiredMemory: () => call<any[]>("/memory?retired=only"),

  // Phase 15 — Knowledge OS surfaces
  surfaces: () => call<any[]>("/knowledge/surfaces"),
  surface: (key: string) => call<any>(`/knowledge/surfaces/${key}`),
  fileToSurface: (key: string, body: unknown) => call<any>(`/knowledge/surfaces/${key}/items`, post("", body)),
  unfileFromSurface: (key: string, itemId: string) =>
    call<any>(`/knowledge/surfaces/${key}/items/${itemId}/remove`, post("")),
  manual: () => call<any>("/knowledge/manual"),
  generateManual: () => call<any>("/knowledge/manual/generate", post("")),
  manualVersions: () => call<any[]>("/knowledge/manual/versions"),
  knowledgeExports: () => call<any[]>("/knowledge/exports"),
  exportKnowledge: (body: unknown) => call<any>("/knowledge/exports", post("", body)),
  verifyKnowledgeExport: (id: string) => call<any>(`/knowledge/exports/${id}/verify`),

  /*
   * ─── PHASE 13, RELATIONSHIP CAPITAL: NO CLIENT SURFACE, ON PURPOSE ─────────
   *
   * Every method that reached `/relationships/*` from this file is gone, because the screen that
   * called them is gone. Her verdict, 9 September 2026: "i dont like this people tab at all id
   * rather just scrap it. id rather monique just send me deliverables she suggests about people to
   * speak to (no codenames needed)".
   *
   * THE ENDPOINTS AND THE DATA BOTH REMAIN, and the subsystem is more used than it was, not less:
   *
   *   - `contacts-sync.mjs` still POSTs to `/relationships/sync` from her Mac, and that endpoint's
   *     refusal of an '@' or a '.' in a code name is untouched.
   *   - `people-worth-a-call.mjs` reads the same correspondence locally, where the real names are,
   *     and mails her a handful of recommendations every Monday.
   *   - Commitments still surface on Today as open loops, which is where she actually reads them.
   *
   * Leaving dead methods here would have been worse than deleting them: a client method nothing
   * calls is exactly the "exists but nothing invokes it" shape the reachability validator exists to
   * catch, and keeping them would have hidden a real ten-method regression behind a comment.
   */

  // Phase 14 — Investor OS and Wealth Command Center
  deals: () => call<any>("/investor/deals"),
  createDeal: (body: unknown) => call<any>("/investor/deals", post("", body)),
  updateDeal: (id: string, body: unknown) =>
    call<any>(`/investor/deals/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  focusDeal: (id: string) => call<any>(`/investor/deals/${id}/focus`, post("")),
  releaseDeal: (id: string) => call<any>(`/investor/deals/${id}/release`, post("")),
  theses: () => call<any[]>("/investor/theses"),
  createThesis: (body: unknown) => call<any>("/investor/theses", post("", body)),
  opportunities: () => call<any>("/investor/opportunities"),
  createOpportunity: (body: unknown) => call<any>("/investor/opportunities", post("", body)),
  lps: () => call<any>("/investor/lps"),
  // `decisions` above is the model router's decision log; this is the journal.
  decisionJournal: (status?: string) => call<any[]>(`/investor/decisions${status ? `?status=${status}` : ""}`),
  decision: (id: string) => call<any>(`/investor/decisions/${id}`),
  createDecision: (body: unknown) => call<any>("/investor/decisions", post("", body)),
  redTeam: (id: string, body: unknown) => call<any>(`/investor/decisions/${id}/red-team`, post("", body)),
  commitDecision: (id: string, body: unknown) => call<any>(`/investor/decisions/${id}/commit`, post("", body)),
  resolveDecision: (id: string, body: unknown) => call<any>(`/investor/decisions/${id}/resolve`, post("", body)),
  predictions: (status = "open") => call<any[]>(`/investor/predictions?status=${status}`),
  createPrediction: (body: unknown) => call<any>("/investor/predictions", post("", body)),
  resolvePrediction: (id: string, body: unknown) => call<any>(`/investor/predictions/${id}/resolve`, post("", body)),
  calibration: () => call<any>("/investor/calibration"),
  wealth: () => call<any>("/wealth"),
  entities: () => call<any[]>("/wealth/entities"),
  createEntity: (body: unknown) => call<any>("/wealth/entities", post("", body)),
  vehicles: () => call<any[]>("/wealth/vehicles"),
  createVehicle: (body: unknown) => call<any>("/wealth/vehicles", post("", body)),
  tracks: () => call<any>("/wealth/tracks"),
  createTrack: (body: unknown) => call<any>("/wealth/tracks", post("", body)),
  allocations: () => call<any[]>("/wealth/allocations"),
  allocate: (body: unknown) => call<any>("/wealth/allocations", post("", body)),

  /*
   * THE BUYER LIST HAD NO WAY IN UNTIL NOW. `/wealth/sourcing` and its status endpoint were written
   * with 0185, are filled three mornings a week by Camille's sweep, and no page called either — so
   * every one of the eleven candidates sat at `new` for ever and the only trace of them on any
   * screen was a count in the Wealth pillar. That is this repo's signature defect: a correct thing
   * nothing invokes. It also broke the ledger below, whose brokerage outcome signal is candidates
   * moving out of `new` — a number that could not change because nothing could change it.
   */
  sourcing: (status?: string) => call<any>(`/wealth/sourcing${status ? `?status=${status}` : ""}`),
  setSourcingStatus: (id: string, body: unknown) => call<any>(`/wealth/sourcing/${id}/status`, post("", body)),
  /*
   * THE RECOMMENDATION, WHICH IS WHAT SHE ASKED THE DESK TO BE. A handful of firms with the reason
   * each is on the list and the letter composed in full — not the catalogue, which is still behind
   * `sourcing` and is now the justification rather than the screen.
   */
  buyerRecommendations: () => call<any>("/wealth/recommendations"),
  draftRecommendation: (id: string, note?: string) =>
    call<any>(`/wealth/recommendations/${id}/draft`, post("", { note: note ?? null })),

  // The return-on-effort ledger, and the LP × buyer overlaps. Both are filled by jobs on her Mac.
  lineReturns: (period?: string) => call<any>(`/wealth/returns${period ? `?period=${period}` : ""}`),
  /*
   * The letters a reviewed buyer produced, and the one act only she can perform. `outreachSent` is
   * how a draft becomes a sent approach: nothing else in this system may claim it.
   */
  outreach: () => call<{ approved: any[]; awaiting: any[] }>("/wealth/outreach"),
  outreachSent: (id: string) => call<any>(`/wealth/outreach/${id}/sent`, post("")),
  crossmatches: () => call<any>("/wealth/crossmatches"),
  setCrossmatchStatus: (id: string, body: unknown) => call<any>(`/wealth/crossmatches/${id}/status`, post("", body)),

  // Phase 16 — Spirit OS
  spiritDay: (date?: string) => call<any>(`/spirit/day${date ? `?date=${date}` : ""}`),
  spiritMonth: (month?: string) => call<any>(`/spirit/month${month ? `?month=${month}` : ""}`),
  // Imani's week. Delivered since 0200; before that the duty ran every Sunday into nothing.
  practiceWeek: () => call<any>("/spirit/practice-week"),
  almanac: () => call<any>("/spirit/astro/almanac"),
  natal: () => call<any>("/spirit/astro/natal"),
  manifestations: (status?: string) => call<any>(`/spirit/manifestations${status ? `?status=${status}` : ""}`),
  manifestation: (id: string) => call<any>(`/spirit/manifestations/${id}`),
  createManifestation: (body: unknown) => call<any>("/spirit/manifestations", post("", body)),
  addEvidence: (id: string, body: unknown) => call<any>(`/spirit/manifestations/${id}/evidence`, post("", body)),
  markManifested: (id: string) => call<any>(`/spirit/manifestations/${id}/manifested`, post("")),
  releaseManifestation: (id: string, body: unknown) => call<any>(`/spirit/manifestations/${id}/release`, post("", body)),
  rituals: () => call<any[]>("/spirit/rituals"),
  createRitual: (body: unknown) => call<any>("/spirit/rituals", post("", body)),
  ritualDone: (id: string, body?: unknown) => call<any>(`/spirit/rituals/${id}/done`, post("", body ?? {})),
  dreams: () => call<any[]>("/spirit/dreams"),
  recordDream: (body: unknown) => call<any>("/spirit/dreams", post("", body)),
  contributions: () => call<any>("/spirit/contributions"),
  recordContribution: (body: unknown) => call<any>("/spirit/contributions", post("", body)),
  removeContribution: (id: string) =>
    call<any>(`/spirit/contributions/${id}`, { method: "DELETE" }),
  ancestors: (month?: string) => call<any>(`/spirit/ancestors${month ? `?month=${month}` : ""}`),
  recordAncestorEntry: (body: unknown) => call<any>("/spirit/ancestors", post("", body)),

  // Phase 17 — Prompt Intelligence
  lenses: () => call<any>("/prompt/lenses"),
  lens: (key: string) => call<any>(`/prompt/lenses/${key}`),
  povCards: () => call<any[]>("/prompt/pov-cards"),
  promptTriggers: () => call<any>("/prompt/triggers"),
  compilePacket: (body: unknown) => call<any>("/prompt/packets", post("", body)),
  previewPacket: (body: unknown) => call<any>("/prompt/preview", post("", body)),
  packets: () => call<any[]>("/prompt/packets"),
  packet: (id: string) => call<any>(`/prompt/packets/${id}`),
  promotePacket: (id: string, body: unknown) => call<any>(`/prompt/packets/${id}/promote`, post("", body)),
  promptLibrary: (status?: string) => call<any[]>(`/prompt/library${status ? `?status=${status}` : ""}`),
  usePrompt: (id: string) => call<any>(`/prompt/library/${id}/use`, post("")),

  // Phase 18 — Capability Intelligence
  capabilities: () => call<any[]>("/capability"),
  capability: (key: string) => call<any>(`/capability/${key}`),
  capabilityCoverage: () => call<any>("/capability/coverage"),
  capabilityTriggers: () => call<any>("/capability/triggers"),
  resolveCapability: (jobType: string) => call<any>(`/capability/resolve/${jobType}`),
  benchCapability: (body: unknown) => call<any>("/capability/bench", post("", body)),
  promoteBench: (id: string, body: unknown) => call<any>(`/capability/bench/${id}/promote`, post("", body)),
  discoveries: (status?: string) => call<any[]>(`/capability/discovery/all${status ? `?status=${status}` : ""}`),
  raiseDiscovery: (body: unknown) => call<any>("/capability/discovery", post("", body)),
  reviewDiscovery: (id: string, body: unknown) => call<any>(`/capability/discovery/${id}/review`, post("", body)),
  capabilityPatches: () => call<any[]>("/capability/patches/all"),
  proposePatch: (body: unknown) => call<any>("/capability/patches", post("", body)),
  runAfterAction: (body: unknown) => call<any>("/capability/reviews/run", post("", body)),

  // Phase 19 — the Operating Governance Layer
  modeCard: () => call<any>("/governance/mode-card"),
  governanceState: () => call<any>("/governance/state"),
  recordState: (body: unknown) => call<any>("/governance/state", post("", body)),
  clearState: () => call<any>("/governance/state/clear", post("")),
  decisionRights: () => call<any>("/governance/decision-rights"),
  complianceFlags: (status = "open") => call<any[]>(`/governance/flags?status=${status}`),
  runSentinel: () => call<any>("/governance/sentinel/run", post("")),
  resolveFlag: (id: string, action: "clear" | "accept", note?: string) =>
    call<any>(`/governance/flags/${id}/${action}`, post("", { note })),
  antiDependency: () => call<any>("/governance/anti-dependency"),
  playbooks: () => call<any>("/governance/playbooks"),
  maintenance: () => call<any>("/governance/maintenance"),
  maintenanceDone: (key: string) => call<any>(`/governance/maintenance/${key}/done`, post("")),
  brandProfiles: () => call<any[]>("/governance/brand"),
  brandCheck: (body: unknown) => call<any>("/governance/brand/check", post("", body)),
  learningEntries: () => call<any[]>("/governance/learning"),
  recordLearning: (body: unknown) => call<any>("/governance/learning", post("", body)),

  // Phase 20 — the runtimes
  runtimeJobs: (runtime?: string) => call<any[]>(`/runtimes/jobs${runtime ? `?runtime=${runtime}` : ""}`),
  runtimeJob: (id: string) => call<any>(`/runtimes/jobs/${id}`),
  compilerSources: () => call<any>("/runtimes/compiler/sources"),
  compileDocument: (body: unknown) => call<any>("/runtimes/compiler/run", post("", body)),
  artifacts: () => call<any[]>("/runtimes/compiler/artifacts"),
  verifyArtifact: (id: string) => call<any>(`/runtimes/compiler/artifacts/${id}/verify`),
  artifactContent: (id: string) => call<any>(`/runtimes/compiler/artifacts/${id}/content`),
  runSeoAudit: (body: unknown) => call<any>("/runtimes/seo/run", post("", body)),
  seoAudits: () => call<any[]>("/runtimes/seo/audits"),
  seoDeferred: () => call<any>("/runtimes/seo/deferred"),

  // Phase 23 — the Emergency Sovereignty Package
  sovereignty: () => call<any>("/continuity"),
  sovereigntyPackages: () => call<any[]>("/continuity/packages"),
  buildSovereigntyPackage: (body?: unknown) => call<any>("/continuity/packages", post("", body ?? {})),
  verifySovereigntyPackage: (id: string) => call<any>(`/continuity/packages/${id}/verify`),
  runOfflineDrill: (body?: unknown) => call<any>("/continuity/drill", post("", body ?? {})),
  offlineDrills: () => call<any[]>("/continuity/drills"),
  runbook: () => call<any>("/continuity/runbook"),
  restoreChecklist: () => call<any>("/continuity/checklist"),

  /*
   * `/vault/entries` ANSWERS `{entries, total, reason?}`, NOT AN ARRAY — AND THIS LINE SAID `any[]`.
   *
   * That one word crashed the whole application. `Vault.tsx` stored the object in a state variable
   * typed `any[]`, `entries.length === 0` read `undefined === 0` and was false, and the next line
   * called `entries.map(...)` on an object. React unmounted the tree, and because nothing in this
   * app was a boundary the reader got a WHITE PAGE with no navigation — not a broken panel, the
   * entire product gone. Reproduced on 8 Sep 2026: `TypeError: n.map is not a function`.
   *
   * `any[]` is an assertion the compiler cannot check, because `call` returns whatever the server
   * sent. So the unwrap happens here, once, where the endpoint's real shape is known — and
   * `listOf` below turns any future disagreement of this kind into a sentence she can read rather
   * than a blank screen.
   */
  vaultEntries: () => listOf("/vault/entries", "entries"),
  snapshots: () => call<any[]>("/vault/snapshots"),
  restores: () => call<any[]>("/vault/restores"),
  takeSnapshot: () => call<any>("/vault/snapshots", post("", { label: "manual" })),
  verifySnapshot: (id: string) => call<any>(`/vault/snapshots/${id}/verify`),
  prunePreview: (keep?: number) =>
    call<any>(`/vault/prune-preview${keep === undefined ? "" : `?keep=${keep}`}`),
  pruneSnapshots: (keep?: number) => call<any>("/vault/prune", post("", { keep })),
  drill: () => call<any>("/vault/drill", post("")),
  restore: (body: unknown) => call<any>("/vault/restore", post("", body)),

  tradingOverview: () => call<any>("/trading/overview"),
  tradingAuthority: () => call<any>("/trading/authority"),
  setAuthority: (body: unknown) => call<any>("/trading/authority", { method: "PATCH", body: JSON.stringify(body) }),
  killSwitch: (engaged: boolean, reason?: string) =>
    call<any>("/trading/kill-switch", post("", { engaged, reason })),
  strategies: () => call<any[]>("/trading/strategies"),
  setStage: (id: string, stage: string) => call(`/trading/strategies/${id}/stage`, post("", { stage })),
  draftOrder: (body: unknown) => call<any>("/trading/orders", post("", body)),
  cancelOrder: (id: string, reason?: string) => call(`/trading/orders/${id}/cancel`, post("", { reason })),
  // ── AI Quant Fund (Phase 22). Read-only here except the three acts that are
  // themselves gated server-side: opening a rung, promoting a scorecard, and
  // probing a kill switch. ──
  quantLadder: () => call<any>("/quant/ladder"),
  quantSequence: () => call<any[]>("/quant/sequence"),
  advanceSequence: (week: string, action: string) => call<any>(`/quant/sequence/${week}/${action}`, post("")),
  quantDesks: () => call<any[]>("/quant/desks"),
  quantScorecards: () => call<any[]>("/quant/scorecards"),
  promoteScorecard: (id: string) => call<any>(`/quant/scorecards/${id}/promote`, post("")),
  quantRungs: () => call<any[]>("/quant/rungs"),
  openRung: (rung: string) => call<any>(`/quant/rungs/${rung}/open`, post("")),
  quantEngines: () => call<any[]>("/quant/engines"),
  probeKillSwitch: (id: string) => call<any>(`/quant/engines/${id}/kill-switch-probe`, post("")),
  quantNevers: () => call<any[]>("/quant/nevers"),
  quantValidation: () => call<any>("/quant/validation"),

  // ── Firm OS bridge (Phase 21). Every crossing is a proposal; nothing here executes. ──
  bridgeCategories: () => call<any>("/bridge/categories"),
  bridgeSeparation: () => call<any>("/bridge/separation"),
  handoffs: () => call<any[]>("/bridge/handoffs"),
  handoff: (id: string) => call<any>(`/bridge/handoffs/${id}`),
  proposeHandoff: (body: unknown) => call<any>("/bridge/handoffs", post("", body)),
  bridgeCheck: (direction: string, category: string) => call<any>(`/bridge/check/${direction}/${category}`),

  // ── The airlock, made legible (Batch 8) ──
  policyOverview: () => call<any>("/policy/overview"),
  policyFor: (entity: string, recordId?: string) =>
    call<any>(`/policy/for/${entity}${recordId ? `?record_id=${encodeURIComponent(recordId)}` : ""}`),
  tightenRecord: (body: unknown) => call<any>("/policy/tighten", post("", body)),

  // ── Sync: devices, conflicts, and the resolution of one (Batch 6) ──
  syncStatus: () => call<any>("/sync/status"),
  syncDevices: () => call<any>("/sync/devices"),
  syncConflicts: () => call<any>("/sync/conflicts"),
  resolveConflict: (id: string, body: unknown) => call<any>(`/sync/conflicts/${id}/resolve`, post("", body)),

  /*
   * ── Stage 3 — dispatch. Where work is launched, and watched. ──
   *
   * THE REGISTRY IS THE AUTHORITY, not this file. `execution_backends` carries each backend's
   * class, status, ceiling, what it may do and what it may NEVER do (migration
   * `0173_boss_execution_backends.sql`), and the screen renders those rows rather than a list
   * hard-coded here. A backend added to the table appears on the screen without a client change,
   * which is the whole reason it is a table.
   *
   * `candidates` BEFORE `dispatch`, ALWAYS. The launch screen asks the server which backends can
   * take a task and what each would cost, and shows the refusals alongside the offers — a backend
   * with no credential, one handed a task kind outside its allowed list, and one over its ceiling
   * are all deliberate refusals with a reason, not errors. Estimating in the client would mean
   * guessing at rules the server enforces, and a guess that disagrees with the enforcement is
   * worse than no estimate.
   *
   * CANCEL AND REQUEUE ACT ON THE TASK, not on the run. A run is the record of one attempt and is
   * immutable once it ends; the thing you stop or send again is the work. So the Watch screen uses
   * the task endpoints that already exist rather than inventing a second lifecycle beside them.
   */
  backends: () => call<any[]>("/backends"),
  backendCandidates: (body: unknown) => call<any>("/backends/candidates", post("", body)),
  dispatchToBackend: (body: unknown) => call<any>("/backends/dispatch", post("", body)),
  backendRuns: (status?: string) => call<any[]>(`/backends/runs${status ? `?status=${status}` : ""}`),
  backendRun: (id: string) => call<any>(`/backends/runs/${id}`),

  /*
   * ── Simone's publishing block. ──
   *
   * The state is READ here and WRITTEN by a job on her Mac, which is the shape of every piece of
   * work an agent cannot do: no credential reaches a Claude Code run, so the mailbox half executes
   * from launchd and posts a determination back. `setKdpTitleState` is the one thing the watcher
   * may never do — withdrawing a book, or marking one she published herself, is hers.
   */
  /*
   * The register of owned work — what each employee is on the hook for, and what is blocking it.
   * `setDeliverableState` is the only lever that closes a commitment without completing it, and it
   * refuses to be called with 'done': completion is granted by counting records, never declared.
   */
  deliverables: () => call<any>("/deliverables"),
  setDeliverableState: (id: string, body: unknown) => call<any>(`/deliverables/${encodeURIComponent(id)}`, post("", body)),

  kdp: () => call<any>("/kdp"),
  setKdpTitleState: (ref: string, body: unknown) => call<any>(`/kdp/titles/${encodeURIComponent(ref)}`, post("", body)),

  // ── Governance watch list — the sentinel's eleven items. ──
  watchList: () => call<any[]>("/governance/watch-list"),

  incidents: () => call<any[]>("/trading/incidents"),
};
