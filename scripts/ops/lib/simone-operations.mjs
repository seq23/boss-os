import { execFile, execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findStrays, floorDate, isMonday } from "../../../src/shared/boss/scorecard/scorecard.mjs";
import { assertStatus } from "../../../src/shared/boss/pnp/outreach.mjs";
import { installedPlists, installerJobs, repoCronFiles, scheduleRepoDir, workflowEntry, wranglerCrons } from "./schedule.mjs";
import { BRAND_MAILBOXES } from "../../../src/shared/boss/commands/parse.mjs";
import { citedIn, isScanned, uncovered } from "./email-map.mjs";
import { gmailHeaders } from "./duty-kit.mjs";
import { googleAccess, macContext, readMetric } from "./scorecard-readers.mjs";
import { localConfig, senderClient } from "../pnp-corporate-outreach.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(join(ROOT, "src/shared/boss", file), "utf8"));
const command = promisify(execFile);
const WINDOW = 15 * 60;
const CAMPAIGN = "pnp-corporate-outreach";
const LAUNCHD = /^com\.seq\./;
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const WORKER = /(^|\/)wrangler\.(toml|jsonc?)$/;
const CODE = /^(scripts\/ops\/install[^/]*\.sh|.*\.plist|\.github\/workflows\/[^/]+\.ya?ml|(?:.*\/)?wrangler\.(toml|jsonc?))$/;

function result(state, evidence) { return { state, evidence }; }
const unknown = (description) => result("unknown", description);
const missing = (description) => result("missing", description);
const noProof = () => result("no_proof", "no proof yet");

export async function outreachReceipt(status, search) {
  const replies = assertStatus(status).replies.filter((reply) => reply.kind === "reply");
  let unmatched = 0;
  let uncertain = 0;
  // Never give the recipient or report the identities or contents of the correspondence.
  // The existing campaign API supplies sender and arrival time, but no stable Message-ID today.
  for (const reply of replies) {
    const sender = typeof reply.email === "string" && /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+$/.test(reply.email) ? reply.email : null;
    const seconds = Math.floor(Date.parse(reply.at) / 1000);
    if (!sender || !Number.isFinite(seconds)) { uncertain++; continue; }
    const id = typeof reply.message_id === "string" && /^<?[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+>?$/.test(reply.message_id)
      ? reply.message_id.replace(/[<>]/g, "") : null;
    try {
      const query = id ? `rfc822msgid:${id} -in:spam -in:trash`
        : `from:${sender} after:${seconds - WINDOW} before:${seconds + WINDOW} -in:spam -in:trash`;
      const messages = await search(query);
      if (!Array.isArray(messages)) { uncertain++; continue; }
      if (!messages.length) unmatched++;
      else if (!id) uncertain++;
    } catch { uncertain++; }
  }
  if (unmatched) return missing(`Owner's mailbox search found no copy for ${unmatched} recorded outreach ${unmatched === 1 ? "reply" : "replies"}${uncertain ? ` and couldn't confirm ${uncertain} more` : ""}.`);
  if (uncertain) return unknown(`Owner's mailbox couldn't confirm ${uncertain} recorded outreach ${uncertain === 1 ? "reply" : "replies"}.`);
  return result(replies.length ? "verified" : "nothing_due", replies.length
    ? `Owner's mailbox contains all ${replies.length} recorded replies by Message-ID.`
    : "The campaign intake has no human reply to check for delivery.");
}

function cronKey(repo, file, cron) { return `${repo}:${file}:${cron}`; }
function coverage(schedule, files, deployed) {
  const expected = new Map();
  for (const row of schedule.rows) {
    const trigger = row.trigger;
    if (!trigger?.repo || !trigger.file) continue;
    for (const cron of trigger.crons ?? []) expected.set(cronKey(trigger.repo, trigger.file, cron), { row, cron });
  }
  const defined = new Map();
  for (const { repo, files: entries } of files) {
    for (const file of entries) {
      const crons = new Set([...(file.crons ?? []), ...(deployed?.get(`${repo}:${file.file}`) ?? [])]);
      for (const cron of crons) defined.set(cronKey(repo, file.file, cron), { repo, file: file.file, cron });
    }
  }
  return { defined, expected };
}

async function proof(read, reason) {
  try { return await read(); } catch { return unknown(reason); }
}

export async function checkOperations({ schedule, scorecard, senders, sites, inputs, launchd, files, readSite, readOutreach, readScore, day, senderDrift = [], deployed = new Map() }) {
  if (!schedule.rows.length || !scorecard.rows.length || !senders.rows.length || !sites.rows.length
    || !inputs?.duties?.length || !inputs?.agents?.length || !inputs?.mailboxes?.length) {
    throw new Error("NAMED STOP [OPERATIONS_LIST_EMPTY] An operating inventory source returned zero rows.");
  }
  const rows = [];
  const add = (kind, id, name, aim, find, proofRead = noProof()) => {
    rows.push({ kind, id, name, aim, coverage: find, ...proofRead });
  };
  const dutyMap = new Map(inputs.duties.map((d) => [d.id, d]));
  const agents = new Set(inputs.agents.map((agent) => agent.id));
  const scheduleByDuty = new Map(schedule.rows.filter((r) => r.trigger?.duty).map((r) => [r.trigger.duty, r]));
  const scheduleByLabel = new Map(schedule.rows.flatMap((r) => (r.trigger?.launchd ?? []).map((label) => [label, r])));
  const initiatives = new Map(scorecard.rows.flatMap((r) => r.jobs.map((id) => [id, r])));
  const strays = new Set(findStrays({ schedule, scorecard }).map((r) => r.key));
  const launchLabels = new Set([...scheduleByLabel.keys(), ...launchd.configured, ...(launchd.loaded ?? [])]);
  const { defined, expected } = coverage(schedule, files, deployed);
  const campaign = proof(readOutreach, "Couldn't check campaign intake or the owner's mailbox.");
  for (const a of inputs.agents) add("agent", a.id, a.name, a.role, a.paused ? "paused" : "listed");
  for (const d of inputs.duties) {
    const row = scheduleByDuty.get(d.id);
    const held = d.paused || !agents.has(d.employeeId);
    add("duty", d.id, d.name, row?.what ?? "Produce the result specified in the duties registry.",
      held ? "paused" : d.scheduled ? "listed" : "not_running",
      row?.id === CAMPAIGN ? await campaign : noProof());
  }
  for (const label of launchLabels) {
    if (!LAUNCHD.test(label)) continue;
    const row = scheduleByLabel.get(label);
    const observed = launchd.loaded?.has(label);
    const find = !row ? "unlisted" : launchd.disabled?.has(label) ? "paused"
      : observed === undefined ? "unknown" : observed ? "listed" : "not_running";
    add("launchd", label, label, row?.what ?? "Find the schedule owner and intended result.", find,
      row?.id === CAMPAIGN ? await campaign : noProof());
  }
  const fileRepos = new Map(files.map((entry) => [entry.repo, entry]));
  for (const id of new Set([...defined.keys(), ...expected.keys()])) {
    const planned = expected.get(id);
    const row = planned?.row;
    const declared = defined.get(id);
    const { repo, file } = declared ?? row.trigger;
    const cron = declared?.cron ?? planned.cron;
    const observation = fileRepos.get(repo);
    const actual = observation?.files.find((entry) => entry.file === file);
    const dispatch = row?.trigger.clock === "worker";
    const kind = WORKFLOW.test(file) ? "workflow" : "worker_cron";
    const registered = deployed.get(`${repo}:${file}`);
    const codeHasTrigger = dispatch ? actual?.dispatch?.includes(row.trigger.event) : actual?.crons.includes(cron);
    const active = kind === "workflow" ? observation?.active?.has(file) : registered?.has(cron);
    const find = !row ? "unlisted" : !observation ? "unknown" : !codeHasTrigger || active === false ? "not_running"
      : active === undefined ? "unknown" : "listed";
    add(kind, id, row?.name ?? `${repo}/${file}`, row?.what ?? "Find the schedule owner and intended result.", find);
  }
  for (const row of schedule.rows) {
    const initiative = initiatives.get(row.id);
    const duty = row.trigger?.duty;
    const find = duty && !dutyMap.has(duty) ? "not_running" : strays.has(`schedule:${row.id}`) ? "unlisted" : "listed";
    add("schedule", row.id, row.name, initiative?.result ?? row.what, find, row.id === CAMPAIGN ? await campaign : noProof());
  }
  for (const s of senders.rows) add("sender", s.id, s.sender + " · " + s.id, s.what, "listed",
    s.id === CAMPAIGN ? await campaign : noProof());
  for (const path of senderDrift) add("sender", path, path, "Find the sender’s recipient and expected delivery.", "unlisted");
  for (const m of inputs.mailboxes) add("mailbox", m.id, m.name, `Receive mail and deliver it through ${m.handler}.`, "listed",
    m.id === CAMPAIGN ? await campaign : noProof());

  // Each scorecard metric belongs to the initiative. A healthy total can hide a dead contributor.
  const taskReads = [
    ...scorecard.rows.map((r) => async () => {
      const aim = await proof(() => readScore(r), `Couldn't check ${r.real.label}.`);
      add("initiative", r.id, r.initiative, r.result, "listed", aim);
    }),
    ...sites.rows.map((s) => async () => {
      const aim = s.status === "parked" ? noProof()
        : await proof(() => readSite(s), "Couldn't reach the public site.");
      add("site", s.id, s.name, s.status === "redirect" ? "Redirect visitors to the live guide." : "Open the published site for a visitor.",
        s.status === "parked" ? "paused" : "listed", aim);
    }),
  ];
  // Bound provider concurrency without skipping the rest of the inventory on a slow source.
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let task = taskReads.shift(); task; task = taskReads.shift()) await task();
  }));
  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const issues = [];
  // The campaign sits under several inventories. One delivery miss needs only one owner line.
  const reported = new Set();
  for (const row of rows) {
    if (row.coverage === "unlisted") issues.push(`NOT WORKING: ${row.name} — present in code or launchd, missing from the expected list.`);
    if (row.coverage === "not_running") issues.push(`NOT WORKING: ${row.name} — listed, but the configured trigger or active duty is missing.`);
    if (!["missing", "unknown"].includes(row.state) || reported.has(row.evidence)) continue;
    reported.add(row.evidence);
    issues.push(`${row.state === "missing" ? "NOT WORKING" : "COULDN'T CHECK"}: ${row.name} — ${row.evidence}`);
  }
  const needsProof = rows.filter((r) => r.coverage !== "paused" && r.state === "no_proof").length;
  if (needsProof) issues.push(`${needsProof} active or expected items have no proof yet.`);
  const unchecked = rows.filter((r) => r.coverage === "unknown").length;
  if (unchecked) issues.push(`COULDN'T CHECK: ${unchecked} triggers — live scheduler state was unavailable.`);
  const proposal = isMonday(day) && needsProof
    ? "This week, wire receiving-end reads for senders and handlers before using run receipts to judge reliability." : null;
  return { rows, issues, proposal };
}

async function readLaunchd() {
  const dir = join(homedir(), "Library", "LaunchAgents");
  const launch = async (...args) => {
    try { return (await command("launchctl", args, { timeout: 2_000 })).stdout; } catch { return null; }
  };
  const [list, disabled] = await Promise.all([launch("list"), launch("print-disabled", `gui/${process.getuid?.()}`)]);
  const configured = new Set();
  try { await stat(dir); for (const label of Object.keys(installedPlists(dir, LAUNCHD))) configured.add(label); } catch { /* The loaded list is read independently. */ }
  return {
    configured,
    loaded: list === null ? null : new Set(list.split("\n").map((line) => line.trim().split(/\s+/)[2]).filter((label) => LAUNCHD.test(label ?? ""))),
    disabled: disabled === null ? null : new Set([...disabled.matchAll(/"([^"]+)" => (?:disabled|true)/g)].map((match) => match[1])),
  };
}

async function readBossCode(senders) {
  const { stdout } = await command("git", ["-C", ROOT, "ls-files", "-z"], { timeout: 3_000 });
  const tracked = stdout.split("\0").filter(Boolean);
  const paths = tracked.filter((f) => CODE.test(f) && !/(^|\/)(?:fixtures?|tests?)\//.test(f));
  const labels = new Set();
  const files = [];
  for (const file of paths) {
    const content = await readFile(join(ROOT, file), "utf8");
    if (WORKFLOW.test(file)) {
      const entry = workflowEntry(file, content);
      if (entry) files.push(entry);
    } else if (WORKER.test(file)) {
      const crons = wranglerCrons(content);
      const worker = /^[ \t]*["']?name["']?[ \t]*[=:][ \t]*["']([a-z0-9-]+)["']/m.exec(content)?.[1];
      if (crons.length || worker) files.push({ file, crons, worker });
    } else {
      for (const label of Object.keys(installerJobs(content))) labels.add(label);
      for (const match of content.matchAll(/^LABEL="(com\.seq\.[\w.-]+)"$/gm)) labels.add(match[1]);
      if (file.endsWith(".plist")) labels.add(file.split("/").at(-1).replace(/\.plist$/, ""));
    }
  }
  const cited = citedIn(senders, "boss-os");
  const candidates = tracked.filter((file) => isScanned(file) && !cited.has(file));
  const code = [];
  // Batch filesystem reads so the scan does not exhaust the Mac's file table.
  for (let start = 0; start < candidates.length; start += 32) {
    code.push(...await Promise.all(candidates.slice(start, start + 32).map(async (file) => ({
      file, source: await readFile(join(ROOT, file), "utf8"),
    }))));
  }
  return { files, labels, senderDrift: uncovered(code, senders, "boss-os") };
}

async function activeWorkflows(repo, gh) {
  try {
    const { stdout } = await gh("gh", ["api", `repos/seq23/${repo}/actions/workflows?per_page=100`], { timeout: 4_000 });
    const list = JSON.parse(stdout);
    return Array.isArray(list.workflows) && list.total_count === list.workflows.length
      ? new Set(list.workflows.filter((w) => w.state === "active").map((w) => w.path)) : null;
  } catch { return null; }
}

async function workerSchedules(worker, { env, fetch }) {
  if (!worker || !env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return null;
  try {
    const account = encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID);
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/schedules`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
    if (!r.ok) return null;
    const body = await r.json();
    const schedules = body.result?.schedules;
    return body.success && Array.isArray(schedules) && schedules.every((row) => typeof row?.cron === "string")
      ? new Set(schedules.map((row) => row.cron)) : null;
  } catch { return null; }
}

async function readSite(site, fetch) {
  const target = new URL(site.url);
  const response = await fetch(target, { redirect: "manual" });
  try {
    if (site.status === "redirect" && [301, 302, 307, 308].includes(response.status) && response.headers.get("location")) {
      return result("verified", `${target.hostname} returns its public redirect.`);
    }
    if (response.status >= 500) return missing(`${target.hostname} returned HTTP ${response.status} to a visitor.`);
    if (response.status === 404 || response.status === 410) return missing(`${target.hostname} returned HTTP ${response.status} to a visitor.`);
    if (site.status !== "redirect" && response.ok && response.headers.get("content-type")?.includes("text/html")) {
      return result("verified", `${target.hostname} served its public HTML page.`);
    }
    return unknown(`${target.hostname} returned HTTP ${response.status}; the published page wasn't verified.`);
  } finally { await response.body?.cancel(); }
}

export async function runOperationsCheck(api, { env = process.env, fetchImpl = fetch } = {}) {
  const input = await api("GET", "/operations/inputs");
  if (input.checked || input.stopped) return;
  const [schedule, scorecard, senders, sites, readiness, launchd] = await Promise.all([
    readJson("schedule/manifest.json"), readJson("scorecard/manifest.json"), readJson("emailMap/manifest.json"),
    readJson("maps/sites.json"), readJson("searchReadiness/sites.json"), readLaunchd(),
  ]);
  const code = await readBossCode(senders);
  for (const label of code.labels) launchd.configured.add(label);

  const timeout = AbortSignal.timeout(45_000);
  const boundedFetch = (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.any([timeout, AbortSignal.timeout(7_000)]) });
  const ctx = { ...macContext({ env, sites: readiness }), fetch: boundedFetch,
    gh: (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 << 20, timeout: 4_000 }),
  };
  const deployed = new Map();
  await Promise.all(code.files.filter((file) => file.worker).map(async (file) => {
    const schedules = await workerSchedules(file.worker, ctx);
    if (schedules) deployed.set(`boss-os:${file.file}`, schedules);
  }));
  const repos = [...new Set(schedule.rows.map((row) => row.trigger?.repo).filter(Boolean))];
  const scans = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let repo = repos.shift(); repo; repo = repos.shift()) {
      try {
        const files = repo === "boss-os" ? code.files : scheduleRepoDir(repo, ROOT) && repoCronFiles(repo, ROOT, { fetch: false });
        if (files) scans.push({ repo, files, active: files.some((file) => WORKFLOW.test(file.file)) ? await activeWorkflows(repo, command) : null });
      } catch { /* No observation for this repo; its expected entries show unknown. */ }
    }
  }));
  const report = await checkOperations({
    schedule, scorecard, senders, sites, inputs: input, launchd, files: scans, day: input.day, deployed, senderDrift: code.senderDrift,
    readSite: (site) => readSite(site, boundedFetch),
    readScore: async (row) => {
      const metric = row.real;
      if (!row.start) return noProof();
      if (input.day < floorDate(metric.by, row.start)) {
        return result("nothing_due", `Scorecard proof for ${metric.label} is not due yet.`);
      }
      // GitHub reports may be produced by the job itself. Its roll-ups stay on the Scorecard.
      if (!["d1", "gsc", "gumroad", "stripe", "airtable", "t2r", "revenuecat"].includes(metric.reader)) return noProof();
      const read = await readMetric(metric, ctx);
      if (read.error || !Number.isFinite(read.raw)) return unknown(`Couldn't check ${metric.label}.`);
      if (metric.floor?.op !== ">=") return unknown(`Read ${metric.label}; a trend comparison needs the Scorecard's historical reading.`);
      return result(read.raw >= metric.floor.value ? "verified" : "missing", `${metric.label}: ${read.raw} (target ${metric.floor.value}).`);
    },
    readOutreach: async () => {
      const mailbox = env.PNP_OUTREACH_PROOF_MAILBOX?.trim().toLowerCase();
      if (!BRAND_MAILBOXES.some((brand) => brand.mailbox === mailbox)) return unknown("Couldn't check the owner's receiving mailbox; its approved connection is unavailable.");
      const gate = async () => {
        const state = await api("GET", "/operations/inputs?google_account=" + encodeURIComponent(mailbox));
        return state.day === input.day && state.googleEnabled === true && !state.stopped;
      };
      if (!await gate()) return unknown("Owner mailbox access is off.");
      const status = await senderClient(localConfig(env), boundedFetch).status();
      let token;
      return outreachReceipt(status, async (query) => {
        token ??= await googleAccess(ctx, "https://www.googleapis.com/auth/gmail.readonly", mailbox);
        if (!await gate()) throw new Error("Owner mailbox access is off");
        return gmailHeaders(token, query, 1, boundedFetch);
      });
    },
  });
  return api("POST", "/operations/report", { day: input.day, ...report });
}
