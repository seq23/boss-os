import { mayAutoFix } from '../siteAudit/repoPolicy.mjs';
import { heldForOwner } from './ownerApproval.mjs';

/** Fail closed before recovering a PR left by our own audit lane. */
export function orphanVerdict(row, pr, { sites = [], approvedSites = [] } = {}) {
  const name = String(row.repo ?? '').split('/').pop();
  const match = /^https:\/\/github\.com\/seq23\/([^/]+)\/pull\/(\d+)$/.exec(row.pr_url ?? '');
  if (!match || match[1] !== name || !mayAutoFix(row.repo) || !sites.some(s => s.repo === name)) return 'refused_policy';
  const related = sites.filter(s => s.repo === name);
  if (related.some(s => s.client_approval)) return 'client_approval';
  if (related.some(s => heldForOwner(s, { approved: approvedSites.includes(s.domain), texts: row.pages?.length ? row.pages : [row.headline, row.because] }))) return 'owner_approval';
  if (!pr?.headRefName?.startsWith('danielle/site-audit-')) return 'another_lane';
  if (pr.state === 'MERGED') return 'already_merged';
  if (pr.state !== 'OPEN') return 'refused_policy';
  if (pr.isDraft) return 'draft_left_behind';
  const checks = pr.statusCheckRollup;
  if (!Array.isArray(checks) || !checks.length || checks.some(c => c.status ? c.status !== 'COMPLETED' || !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion) : c.state !== 'SUCCESS')) return 'checks_red';
  return 'land';
}

export function blockerLines(rows) {
  return [...new Set(rows.filter(r => r.disposition === 'in_flight' && r.land === 'blocked').map(r => `${r.pr_url ?? r.repo}: ${r.land_detail ?? 'unverified PR'}`))];
}
export function blockedStopSentence(rows) {
  rows = rows.filter(r => r.disposition !== 'none');
  if (!rows.length || rows.some(r => r.disposition !== 'in_flight' || r.land !== 'blocked' || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(r.pr_url ?? ''))) return '';
  return blockerLines(rows).join('; ');
}
