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

const post = (path: string, body?: unknown) =>
  ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }) as RequestInit;

export const api = {
  authState: () => call<{ unlocked: boolean }>("/auth/state"),
  unlock: (passcode: string) => call<{ unlocked: boolean }>("/auth/unlock", post("", { passcode })),
  lock: () => call("/auth/lock", post("")),

  today: (date?: string) => call<any>(`/today${date ? `?date=${date}` : ""}`),
  days: () => call<any[]>("/today/days"),
  todayGates: (date?: string) => call<any[]>(`/today/gates${date ? `?date=${date}` : ""}`),
  loops: (date?: string) => call<any[]>(`/today/loops${date ? `?date=${date}` : ""}`),
  openLoop: (body: unknown) => call<any>("/today/loops", post("", body)),
  closeLoop: (id: string, action: "resolve" | "dismiss" | "defer", note?: string) =>
    call<any>(`/today/loops/${id}/${action}`, post("", { note })),
  morningGate: (body: unknown) => call<any>("/today/gates/morning", post("", body)),
  middayGate: (body: unknown) => call<any>("/today/gates/midday", post("", body)),
  nightGate: (body: unknown) => call<any>("/today/gates/night", post("", body)),

  status: () => call<any>("/system/status"),
  health: () => call<any>("/system/health"),
  diagnostics: (level?: string) => call<any>(`/system/diagnostics${level ? `?level=${level}` : ""}`),
  cost: (days = 30) => call<any>(`/system/cost?days=${days}`),
  usage: () => call<any[]>("/system/usage"),
  audit: () => call<any[]>("/system/audit"),
  settings: () => call<any[]>("/system/settings"),
  costModes: () => call<any[]>("/system/cost-modes"),
  setSetting: (key: string, value: string) =>
    call(`/system/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),
  deadLetters: () => call<any[]>("/system/dead-letters"),
  requeueDeadLetter: (id: string) => call(`/system/dead-letters/${id}/requeue`, post("")),
  dismissDeadLetter: (id: string) => call(`/system/dead-letters/${id}/dismiss`, post("")),

  approvals: (status = "pending") => call<any[]>(`/approvals?status=${status}`),
  approval: (id: string) => call<any>(`/approvals/${id}`),
  decide: (id: string, decision: string, note?: string) =>
    call<{ approval: any; execution: { status: string; detail: any } | null }>(
      `/approvals/${id}/decide`, post("", { decision, note }),
    ),

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

  // Phase 13 — Relationship Capital OS
  relationships: () => call<any[]>("/relationships"),
  relationship: (id: string) => call<any>(`/relationships/${id}`),
  updateRelationship: (id: string, body: unknown) =>
    call<any>(`/relationships/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  createRelationship: (body: unknown) => call<any>("/relationships", post("", body)),
  organizations: () => call<any[]>("/relationships/organizations"),
  createOrganization: (body: unknown) => call<any>("/relationships/organizations", post("", body)),
  people: () => call<any[]>("/relationships/people"),
  person: (id: string) => call<any>(`/relationships/people/${id}`),
  createPerson: (body: unknown) => call<any>("/relationships/people", post("", body)),
  meetings: (from?: number, to?: number) =>
    call<any[]>(`/relationships/meetings${from !== undefined && to !== undefined ? `?from=${from}&to=${to}` : ""}`),
  meeting: (id: string) => call<any>(`/relationships/meetings/${id}`),
  createMeeting: (body: unknown) => call<any>("/relationships/meetings", post("", body)),
  briefMeeting: (id: string) => call<any>(`/relationships/meetings/${id}/brief`, post("")),
  captureMeeting: (id: string, body: unknown) => call<any>(`/relationships/meetings/${id}/capture`, post("", body)),
  followUps: (status = "open") => call<any[]>(`/relationships/follow-ups?status=${status}`),
  createFollowUp: (body: unknown) => call<any>("/relationships/follow-ups", post("", body)),
  closeFollowUp: (id: string, action: "complete" | "drop") =>
    call<any>(`/relationships/follow-ups/${id}/${action}`, post("")),

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

  // Phase 16 — Spirit OS
  spiritDay: (date?: string) => call<any>(`/spirit/day${date ? `?date=${date}` : ""}`),
  spiritMonth: (month?: string) => call<any>(`/spirit/month${month ? `?month=${month}` : ""}`),
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

  vaultEntries: () => call<any[]>("/vault/entries"),
  snapshots: () => call<any[]>("/vault/snapshots"),
  restores: () => call<any[]>("/vault/restores"),
  takeSnapshot: () => call<any>("/vault/snapshots", post("", { label: "manual" })),
  verifySnapshot: (id: string) => call<any>(`/vault/snapshots/${id}/verify`),
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
  incidents: () => call<any[]>("/trading/incidents"),
};
