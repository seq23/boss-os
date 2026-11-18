/**
 * THE ONE LIST OF COMPANIES NOW PUBLIC (owner, 18 Nov 2026: "A PUBLIC COMPANY IS NOT A LIVE DEAL").
 * Stored in the `public_companies` setting; the seed and the rules are src/shared/boss/deals/
 * publicCompanies.mjs. Written by her reply "X is public", by the morning run when Camille's
 * briefing reports an IPO or a first trade (with the date and the headline), and read by every job
 * that matches, lists or features a company.
 */
import type { Env } from "../env";
import { getSetting, setSetting } from "../lib/settings";
import { audit } from "../lib/audit";
import { publicList, companyNorm } from "../../../shared/boss/deals/publicCompanies.mjs";

export const PUBLIC_KEY = "public_companies";

export async function publicCompanies(env: Env) {
  return publicList(await getSetting(env.DB, PUBLIC_KEY));
}

/** Add one company (idempotent by name). Returns whether it was new. */
export async function markPublic(env: Env, row: { company: string; evidence?: string | null; via: string; since?: string | null }, now = Date.now()): Promise<boolean> {
  const company = String(row.company ?? "").trim().slice(0, 80);
  if (!companyNorm(company)) return false;
  const raw = await getSetting(env.DB, PUBLIC_KEY);
  if (publicList(raw).some((r) => companyNorm(r.company) === companyNorm(company))) return false;
  let stored: any[] = [];
  try { const v = JSON.parse(raw ?? "[]"); stored = Array.isArray(v) ? v : []; } catch { stored = []; }
  stored.push({ company, since: row.since ?? new Date(now).toISOString().slice(0, 10), evidence: row.evidence ? String(row.evidence).slice(0, 240) : null, via: row.via });
  await setSetting(env.DB, PUBLIC_KEY, JSON.stringify(stored));
  await audit(env.DB, { actor: row.via === "reply" ? "owner" : "boss", lane: "ops", entityType: "public_company", entityId: company, action: "marked_public", detail: { via: row.via, evidence: row.evidence ?? null } });
  return true;
}
