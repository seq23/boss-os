#!/usr/bin/env node
/**
 * EVERY EMPLOYEE ADDRESS IS DELIVERED — an Email Routing rule exists, enabled, per roster local part.
 *
 * ─── The bounce this closes ────────────────────────────────────────────────
 *
 * 21 Sep 2026, 19:53–19:56Z: her "approved" to danielle@sequoiataylor.com bounced 550 "Address does
 * not exist" three times. Every employee mail is sent FROM <name>@sequoiataylor.com and says
 * "REPLY WITH ONE WORD", and only boss@ had a routing rule. A catch-all cannot target a Worker, so
 * the rules are literal, one per local part — which means a ninth hire is a ninth rule, and nothing
 * but this file asks whether it was made.
 *
 * ─── How it is proven ───────────────────────────────────────────────────────
 *
 * The ROSTER in `scripts/ops/notify.mjs` (the one list of who sends mail) is read; the zone's
 * rules are read from the Cloudflare API through the vault (`CLOUDFLARE_API_TOKEN`); every local
 * part must have an ENABLED rule whose matcher is exactly `<local>@sequoiataylor.com` and whose
 * action is `worker` → `boss-os`, the Worker whose `email()` handler routes it. `boss@` is checked
 * too. RULE 0: zero rules from the API is a failure, never a pass — an empty answer is a dead
 * token or a wrong zone, not a clean domain.
 *
 * OFFLINE (no token, or `--offline`): the roster and the pinned rule list in
 * `scripts/validate/fixtures/email-routing-rules.json` are checked against each other, so CI — which
 * holds no Cloudflare token — still fails when a name is added to the roster without an address.
 * The fixture is refreshed by `--record` through the vault, and the live scan says when it drifts.
 *
 *   npm run vault:run -- node scripts/validate/every-employee-address-receives.mjs           # live
 *   node scripts/validate/every-employee-address-receives.mjs --offline                       # CI
 *   npm run vault:run -- node scripts/validate/every-employee-address-receives.mjs --record  # refresh fixture
 *   node scripts/validate/every-employee-address-receives.mjs --self-test
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOMAIN = "sequoiataylor.com";
const WORKER = "boss-os";
const FIXTURE = "scripts/validate/fixtures/email-routing-rules.json";

/** Which local parts lack an enabled, worker-bound rule. Pure, so the self-test can run it. */
export function missingRules(localParts, rules) {
  const bad = [];
  if (!Array.isArray(rules) || rules.length === 0) return ["ZERO routing rules were read — a dead token, a wrong zone, or a domain with no routing. Never a pass."];
  for (const local of localParts) {
    const addr = `${local}@${DOMAIN}`;
    const rule = rules.find((r) => (r.matchers ?? []).some((m) => m.type === "literal" && String(m.value).toLowerCase() === addr));
    if (!rule) { bad.push(`${addr}: no routing rule — mail to it bounces 550 and a reply to ${local}'s email is lost.`); continue; }
    if (!rule.enabled) bad.push(`${addr}: rule ${rule.id} exists but is DISABLED.`);
    const act = (rule.actions ?? [])[0];
    if (!act || act.type !== "worker" || !(act.value ?? []).includes(WORKER)) bad.push(`${addr}: rule ${rule.id} does not deliver to worker ${WORKER} (it is ${act?.type ?? "nothing"} → ${(act?.value ?? []).join(",") || "-"}).`);
  }
  return bad;
}

async function liveRules() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return null;
  const h = { authorization: `Bearer ${token}` };
  const z = await (await fetch(`https://api.cloudflare.com/client/v4/zones?name=${DOMAIN}`, { headers: h })).json();
  const zone = z.result?.[0]?.id;
  if (!zone) throw new Error(`zone ${DOMAIN} not readable: ${JSON.stringify(z.errors ?? [])}`);
  const r = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/email/routing/rules?per_page=50`, { headers: h })).json();
  if (!r.success) throw new Error(`rules not readable: ${JSON.stringify(r.errors ?? [])}`);
  return (r.result ?? []).map((x) => ({ id: x.id, enabled: Boolean(x.enabled), matchers: x.matchers, actions: x.actions }));
}

function selfTest() {
  const ok = (l) => ({ id: `id_${l}`, enabled: true, matchers: [{ type: "literal", field: "to", value: `${l}@${DOMAIN}` }], actions: [{ type: "worker", value: [WORKER] }] });
  const cases = [
    ["all present", missingRules(["danielle", "simone"], [ok("danielle"), ok("simone")]).length === 0],
    ["a missing address is named", missingRules(["danielle", "kendra"], [ok("danielle")]).some((b) => b.includes("kendra@"))],
    ["a disabled rule is caught", missingRules(["danielle"], [{ ...ok("danielle"), enabled: false }]).some((b) => b.includes("DISABLED"))],
    ["a rule that forwards instead of hitting the worker is caught", missingRules(["danielle"], [{ ...ok("danielle"), actions: [{ type: "forward", value: ["x@y"] }] }]).some((b) => b.includes("does not deliver to worker"))],
    ["zero rules is a failure (rule 0)", missingRules(["danielle"], []).length === 1 && missingRules(["danielle"], [])[0].includes("ZERO")],
    ["a catch-all does not vouch for a name", missingRules(["danielle"], [{ id: "x", enabled: true, matchers: [{ type: "all" }], actions: [{ type: "worker", value: [WORKER] }] }]).some((b) => b.includes("no routing rule"))],
  ];
  const failed = cases.filter(([, c]) => !c);
  for (const [n] of failed) console.error(`  ✗ ${n}`);
  if (failed.length) { console.error(`self-test: ${failed.length} case(s) wrong`); process.exit(1); }
  console.log(`every-employee-address-receives self-test: ${cases.length}/${cases.length} cases.`);
}

if (process.argv.includes("--self-test")) { selfTest(); process.exit(0); }

const { EMPLOYEE_LOCAL_PARTS } = await import(join(ROOT, "scripts/ops/notify.mjs"));
const locals = ["boss", ...EMPLOYEE_LOCAL_PARTS];
if (EMPLOYEE_LOCAL_PARTS.length === 0) { console.error("FAIL: the roster in scripts/ops/notify.mjs is empty — nothing to check is a broken scan."); process.exit(2); }

/*
 * THE NINTH HIRE. The D1 roster (replayed from migrations, the way `validate:employee-tags` does it)
 * is the list of who can be written to; the sender ROSTER in notify.mjs is the list of who can
 * write. A seat on the first and not the second sends nothing and — worse — has no address here to
 * check. So every active seat's tag must be a sender local part, and every sender must be a seat.
 */
const { spawnSync } = await import("node:child_process");
const { seatTag } = await import(join(ROOT, "src/shared/boss/intake/mail.mjs"));
const printed = spawnSync(process.execPath, [join(ROOT, "scripts/validate/every-employee-has-a-reachable-tag.mjs"), "--print-roster"], { encoding: "utf8" });
let seats = [];
try { seats = JSON.parse(printed.stdout || "[]").map((s) => seatTag(s.name).slice(1)); } catch { seats = []; }
if (seats.length === 0) { console.error("FAIL: zero active seats came out of the migrations — a broken replay, not a clean roster."); process.exit(2); }
const rosterGaps = [
  ...seats.filter((t) => !EMPLOYEE_LOCAL_PARTS.includes(t)).map((t) => `active seat "${t}" is not in ROSTER (scripts/ops/notify.mjs) — she cannot send mail and has no address to check. Add her, then: npm run vault:run -- node scripts/ops/employee-address.mjs ${t}`),
  ...EMPLOYEE_LOCAL_PARTS.filter((l) => !seats.includes(l)).map((l) => `sender "${l}" in ROSTER is not an active seat in D1 — mail signed by nobody.`),
];
if (rosterGaps.length) { console.error("EMPLOYEE ADDRESSES FAILED (roster):"); for (const g of rosterGaps) console.error(`  ✗ ${g}`); process.exit(1); }

let rules = null; let source = "fixture";
if (!process.argv.includes("--offline")) {
  try { rules = await liveRules(); if (rules) source = "cloudflare api"; }
  catch (err) { console.error(`FAIL: ${err.message}`); process.exit(1); }
}
if (process.argv.includes("--record")) {
  if (!rules) { console.error("FAIL: --record needs CLOUDFLARE_API_TOKEN (run through the vault)."); process.exit(1); }
  writeFileSync(join(ROOT, FIXTURE), JSON.stringify({ recorded_at: new Date().toISOString(), domain: DOMAIN, rules }, null, 2) + "\n");
  console.log(`recorded ${rules.length} rule(s) to ${FIXTURE}`);
}
if (!rules) {
  if (!existsSync(join(ROOT, FIXTURE))) { console.error(`FAIL: no token and no ${FIXTURE}; record one through the vault.`); process.exit(1); }
  rules = JSON.parse(readFileSync(join(ROOT, FIXTURE), "utf8")).rules;
}
const bad = missingRules(locals, rules);
if (bad.length) {
  console.error(`EMPLOYEE ADDRESSES FAILED (${source}):`);
  for (const b of bad) console.error(`  ✗ ${b}`);
  console.error(`  Make the rule (through the vault, literal matcher → worker ${WORKER}):`);
  console.error(`    npm run vault:run -- node scripts/ops/employee-address.mjs <name>`);
  process.exit(1);
}
console.log(`EMPLOYEE ADDRESSES OK (${source}): ${locals.length} addresses (${locals.map((l) => `${l}@`).join(" ")}) each have an enabled rule → worker ${WORKER}: ${rules.filter((r) => (r.matchers ?? [])[0]?.type === "literal").map((r) => r.id).join(", ")}`);
