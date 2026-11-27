import { it, expect } from 'vitest';
import { orphanVerdict, blockedStopSentence, fixedNothingCause } from '../src/shared/boss/searchReadiness/orphanPr.mjs';
// @ts-expect-error Node-only ops module has no declaration.
import { landAll } from '../scripts/ops/site-audit-lib.mjs';
const row = { repo: 'approvalprep', disposition: 'in_flight', pr_url: 'https://github.com/seq23/approvalprep/pull/1' };
const sites = [{ repo: row.repo, domain: 'example.test' }];
const green = { state: 'OPEN', headRefName: 'danielle/site-audit-123', isDraft: false, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] };
it('recovers only green non-draft PRs of our lane and honours policy holds', () => {
  const verdict = (pr: any, extra: any = {}) => orphanVerdict(row, pr, { sites, ...extra });
  expect(verdict(green)).toBe('land');
  const blocked = { ...row, land: 'blocked', land_detail: 'draft_left_behind' };
  expect(blockedStopSentence([blocked, { disposition: 'none' }])).toContain('draft_left_behind');
  expect(blockedStopSentence([blocked, { disposition: 'surfaced' }])).toBe('');
  expect(blockedStopSentence([])).toBe('');
  expect(verdict({ ...green, state: 'MERGED' })).toBe('already_merged');
  expect(verdict({ ...green, isDraft: true })).toBe('draft_left_behind');
  expect(verdict({ ...green, headRefName: 'work/other' })).toBe('another_lane');
  expect(verdict({ ...green, statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })).toBe('checks_red');
  expect(verdict({ ...green, statusCheckRollup: [] })).toBe('checks_red');
  expect(verdict(green, { sites: [{ ...sites[0], client_approval: true }] })).toBe('client_approval');
  expect(verdict(green, { sites: [{ ...sites[0], owner_approval: true }] })).toBe('owner_approval');
  expect(orphanVerdict({ ...row, pr_url: 'https://github.com/other/approvalprep/pull/1' }, green, { sites })).toBe('refused_policy');
});
it('lands through the existing door once per PR; blocked and merged PRs never reach it', () => {
  for (const pr of [green, { ...green, isDraft: true }, { ...green, state: 'MERGED' }, { ...green, headRefName: 'work/other' }, { ...green, statusCheckRollup: [] }]) {
    const calls: string[] = [];
    const payload: any = { findings: [{ ...row }, { ...row }] };
    landAll(payload, { sites, run: (cmd: string, args: string[]) => { calls.push([cmd, ...args].join(' ')); return { status: 0, out: cmd === 'gh' ? JSON.stringify(pr) : 'ok' }; }, landBin: '/test/land' });
    expect(calls.filter(c => c.includes('/test/land'))).toHaveLength(pr === green ? 1 : 0);
    expect(payload.findings[0].land).toBe(pr === green ? 'landed' : pr.state === 'MERGED' ? 'already_merged' : 'blocked');
  }
});

it('7 Nov 2026: a MERGED PR is already_merged whoever opened it, never another_lane or blocked', () => {
  expect(orphanVerdict(row, { ...green, state: 'MERGED', headRefName: 'fix/sr-heygetonmylevel-6nov' }, { sites })).toBe('already_merged');
  // NEGATIVE: an OPEN PR off another branch is still refused.
  expect(orphanVerdict(row, { ...green, headRefName: 'fix/sr-heygetonmylevel-6nov' }, { sites })).toBe('another_lane');
  // The pre-fetch probe (no PR yet) still asks for the PR to be read.
  expect(orphanVerdict(row, null, { sites })).toBe('another_lane');
  const payload: any = { findings: [{ ...row }] };
  landAll(payload, { sites, run: (cmd: string) => ({ status: 0, out: cmd === 'gh' ? JSON.stringify({ ...green, state: 'MERGED', headRefName: 'work/other' }) : 'ok' }), landBin: '/test/land' });
  expect(payload.findings[0].land).toBe('already_merged');
});
it('fixedNothingCause names an all-merged round, a blocked round, and nothing else', () => {
  const m = { ...row, land: 'already_merged' };
  expect(fixedNothingCause([m, { ...m, pr_url: 'https://github.com/seq23/approvalprep/pull/2' }]).code).toBe('SR_AWAITING_HOST_PUBLISH');
  expect(fixedNothingCause([m]).sentence).toContain('pull/1');
  expect(fixedNothingCause([{ ...row, land: 'blocked', land_detail: 'checks_red' }, m])).toMatchObject({ code: 'SR_BLOCKED_BY_OPEN_PRS', sentence: expect.stringContaining('checks_red') });
  expect(fixedNothingCause([]).code).toBe('');
  expect(fixedNothingCause([m, { disposition: 'surfaced' }]).code).toBe('');
  expect(fixedNothingCause([{ ...row }]).code).toBe('');
});

/*
 * THE DEADLOCK (9 Nov 2026): seven danielle/site-audit-* PRs sat 4-6 days. Each guard below is
 * proved negatively next to its positive case, and each fails on zero items.
 */
import { NEEDS_WORKER, clientApprovalHold, mergedOnMain } from '../src/shared/boss/searchReadiness/orphanPr.mjs';
// @ts-expect-error Node-only ops module has no declaration.
import { ownOpenPrs, staleGridHandoff } from '../scripts/ops/site-audit-lib.mjs';

it('cause 1+2: a draft or a conflicting own-lane PR is work for the next pass, listed first; a green one lands', () => {
  const v = (pr: any) => orphanVerdict(row, pr, { sites });
  expect(v({ ...green, isDraft: true })).toBe('draft_left_behind');
  expect(v({ ...green, mergeable: 'CONFLICTING' })).toBe('conflicting');
  expect(v({ ...green, mergeable: 'MERGEABLE' })).toBe('land');
  for (const x of ['draft_left_behind', 'conflicting', 'checks_red']) expect(NEEDS_WORKER).toContain(x);
  expect(NEEDS_WORKER).not.toContain('land');
  const listed = ownOpenPrs([
    { url: 'u1', headRefName: 'danielle/site-audit-1', isDraft: true, state: 'OPEN', title: 't1' },
    { url: 'u2', headRefName: 'danielle/site-audit-2', isDraft: false, mergeable: 'CONFLICTING', state: 'OPEN', title: 't2' },
    { url: 'u3', headRefName: 'fix/someone-else', isDraft: true, state: 'OPEN', title: 't3' },
  ]);
  expect(listed.length).toBeGreaterThan(0);
  expect(listed.map((p: any) => [p.url, p.why])).toEqual([['u1', 'draft_left_behind'], ['u2', 'conflicting']]);
  expect(ownOpenPrs([])).toEqual([]);
});

const horse = { repo: 'horse-legal-guide-velocity', domain: 'horse.test', client_approval: 'new posts wait', client_approval_queue_files: ['data/site_changes/queue.json'], client_approval_new_post_paths: ['content/', 'questions/', 'dist/'], client_approval_draft_paths: ['content/drafts/'], client_approval_record_files: ['data/system/editorial_backlog.json'] };
const hrow = { repo: horse.repo, disposition: 'in_flight', pr_url: `https://github.com/seq23/${horse.repo}/pull/78` };
const q = (changes: any[]) => JSON.stringify({ changes });
const approvedOne = { id: 'a', status: 'approved', title: 'live' };
const staged = { id: 'b', status: 'pending', title: 'waits for the owners' };
/*
 * NEW POSTS WAIT FOR THE CLIENT; FIXES SHIP (owner, 9 Nov 2026), replacing the 3 Nov "every live change
 * waits" reading that held Horse fix PRs. Both land paths (an orphan in_flight PR, a fixed_pr row).
 */
it('cause 3: on a client_approval site a fix PR lands; a new post, an approval change or an unread PR is held', () => {
  const QF = 'data/site_changes/queue.json';
  const mod = (path: string) => ({ path, status: 'modified' });
  const add = (path: string) => ({ path, status: 'added' });
  const hold = (files: any[] | null, contents: any = {}) => clientApprovalHold(horse, { files, contents });
  expect(hold([mod('scripts/lib/render_page.js'), mod('content/scenarios/a.md'), mod('dist/scenario/a/index.html')])).toBe('');
  expect(hold([add('content/drafts/generated/2027-03-04__new.md')])).toBe('');
  expect(hold([mod(QF)], { [QF]: { base: q([approvedOne]), head: q([approvedOne, staged]) } })).toBe('');
  // NEGATIVE: each of these waits, with its reason.
  expect(hold([mod('scripts/lib/render_page.js'), add('content/scenarios/new-post.md')])).toMatch(/^adds a new post \(content\/scenarios\/new-post\.md\)/);
  expect(hold([add('questions/new-q/index.html')])).toMatch(/^adds a new post/);
  expect(hold([{ path: 'content/hubs/x.md', status: 'renamed' }])).toMatch(/^adds a new post/);
  expect(hold([mod('data/system/editorial_backlog.json')])).toMatch(/approval record/);
  expect(hold([mod(QF)], { [QF]: { base: q([staged]), head: q([{ ...staged, status: 'approved' }]) } })).toMatch(/approved entry/);
  expect(hold([mod(QF)], { [QF]: { base: undefined, head: q([staged]) } })).toMatch(/approved entry/);
  expect(hold(null)).toMatch(/unclear/);
  expect(hold([])).toMatch(/unclear/);
  expect(clientApprovalHold({ ...horse, client_approval_new_post_paths: undefined }, { files: [mod('a.js')] })).toMatch(/unclear/);
  expect(orphanVerdict(hrow, green, { sites: [horse] })).toBe('client_approval');
  // Through landAll, both paths: the file list (and touched queue files) read from GitHub, then land.
  const run = (disposition: string, files: any[] | null) => {
    const calls: string[] = [];
    const payload: any = { findings: [{ ...hrow, disposition }] };
    landAll(payload, { sites: [horse], parked: () => false, landBin: '/test/land', run: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return { status: 0, out: JSON.stringify({ ...green, baseRefName: 'main', headRefOid: 'h1' }) };
      if (cmd === 'gh' && args[0] === 'api' && String(args[1]).includes('/pulls/')) return files ? { status: 0, out: files.map(f => `${f.status}\t${f.path}`).join('\n') } : { status: 1, out: 'HTTP 502' };
      if (cmd === 'gh' && args[0] === 'api') return { status: 0, out: String(args[1]).endsWith('ref=main') ? q([approvedOne]) : q([approvedOne, staged]) };
      return { status: 0, out: 'ok' };
    } });
    return { land: payload.findings[0].land, lands: calls.filter(c => c.includes('/test/land')).length };
  };
  for (const d of ['in_flight', 'fixed_pr']) {
    expect(run(d, [mod('scripts/build/write_public_indexes.js'), mod('content/scenarios/a.md')])).toEqual({ land: 'landed', lands: 1 });
    expect(run(d, [mod(QF)])).toEqual({ land: 'landed', lands: 1 });
    expect(run(d, [add('content/scenarios/new-post.md')])).toEqual({ land: d === 'fixed_pr' ? 'held_client_approval' : 'blocked', lands: 0 });
    expect(run(d, null)).toEqual({ land: d === 'fixed_pr' ? 'held_client_approval' : 'blocked', lands: 0 });
  }
});

it('cause 4: a land refusal for a PR already on main is already_merged and the leftover PR is closed', () => {
  const commits = [{ sha: 'c8833d7aaaa', subject: 'fix: repair malformed mortgage underwriting citation at source (#80)' }, { sha: 'b0', subject: 'other (#79)' }];
  expect(mergedOnMain({ number: 80, headRefOid: 'zzz' }, commits)).toBe('c8833d7aaaa');
  expect(mergedOnMain({ number: 8, headRefOid: 'zzz' }, commits)).toBeNull();
  expect(mergedOnMain({ number: 81, headRefOid: 'b0' }, commits)).toBe('b0');
  expect(mergedOnMain({ number: 80 }, [])).toBeNull();
  const attempt = (onMain: boolean) => {
    const calls: string[] = [];
    const payload: any = { findings: [{ ...row, disposition: 'fixed_pr', pr_url: 'https://github.com/seq23/approvalprep/pull/80' }] };
    landAll(payload, { sites, parked: () => false, landBin: '/test/land', run: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      if (args.includes('/test/land')) return { status: 1, out: 'STOPPED: could not verify (network)' };
      if (cmd === 'gh' && args.includes('.state')) return { status: 0, out: 'OPEN\n' };
      if (cmd === 'gh' && args[1] === 'view') return { status: 0, out: JSON.stringify({ number: 80, headRefOid: 'a74f', baseRefName: 'main' }) };
      if (cmd === 'gh' && args[0] === 'api') return { status: 0, out: JSON.stringify(onMain ? commits : commits.slice(1)) };
      return { status: 0, out: 'ok' };
    } });
    return { land: payload.findings[0].land, closed: calls.filter(c => c.startsWith('gh pr close')).length };
  };
  expect(attempt(true)).toEqual({ land: 'already_merged', closed: 1 });
  // NEGATIVE: not on main stays a refusal, and nothing is closed.
  expect(attempt(false)).toEqual({ land: 'land_refused', closed: 0 });
});

it('cause 5: a stale grid PR of our lane open >24h is acted on; fresh, foreign and closed ones are not', () => {
  const now = Date.parse('2026-11-09T14:00:00Z');
  const inbox = [
    'seq23/approvalprep\tpr_stale\thttps://github.com/seq23/approvalprep/pull/1\ttsk\tdraft, 3 days',
    'seq23/approvalprep\tpr_stale\thttps://github.com/seq23/approvalprep/pull/2\ttsk\tgreen, 3 days',
    'seq23/approvalprep\tpr_stale\thttps://github.com/seq23/approvalprep/pull/3\ttsk\tfresh',
    'seq23/approvalprep\tpr_stale\thttps://github.com/seq23/approvalprep/pull/4\ttsk\tanother lane',
    'seq23/approvalprep\tci_red\thttps://github.com/seq23/approvalprep/actions/runs/5\ttsk\tnot a PR',
  ].join('\n');
  const old = '2026-11-05T10:00:00Z', fresh = '2026-11-09T10:00:00Z';
  const prs: Record<string, any> = {
    1: { ...green, isDraft: true, createdAt: old }, 2: { ...green, createdAt: old },
    3: { ...green, isDraft: true, createdAt: fresh }, 4: { ...green, headRefName: 'fix/other', createdAt: old },
  };
  const pr = (url: string) => prs[/pull\/(\d+)/.exec(url)![1] ?? ''];
  const calls: string[] = [];
  const { lines, rearm } = staleGridHandoff(inbox, { now, sites, parked: () => false, landBin: '/test/land', view: pr, run: (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(' '));
    return { status: 0, out: cmd === 'gh' ? JSON.stringify(pr(args.find(a => a.includes('/pull/')) ?? '')) : 'ok' };
  } });
  expect(lines.length).toBe(2);
  expect(lines[0]).toMatch(/pull\/1: blocked \(draft_left_behind\) -> the next Search Readiness pass finishes it/);
  expect(lines[1]).toMatch(/pull\/2: landed/);
  expect(rearm).toBe(true);
  expect(calls.filter(c => c.includes('/test/land'))).toHaveLength(1);
  // NEGATIVE: an inbox with only fresh, foreign or non-PR rows does nothing and says so.
  const none = staleGridHandoff(inbox.split('\n').slice(2).join('\n'), { now, sites, view: pr, run: () => { throw new Error('must not run'); } });
  expect(none.rearm).toBe(false);
  expect(none.lines).toEqual([expect.stringMatching(/^HANDOFF none:/)]);
});

/*
 * 17 NOV 2026: ~/bin/land refused detoxdenver.org's PR #18 (components/ClarityLoader.tsx) with NAMED
 * STOP [NOT_CLICKED_THROUGH] in all three rounds, and nothing in this lane ever wrote the line. The
 * real landAll now clicks the PR's preview through (clickthrough.mjs) and lands again; a dirty or
 * unreadable click-through is clickthrough_failed with why, and is never landed.
 */
import { fixedNothingCause as cause } from '../src/shared/boss/searchReadiness/orphanPr.mjs';
it('a NOT_CLICKED_THROUGH refusal is clicked through and landed; a dirty or unread click-through never lands', () => {
  const dpr = 'https://github.com/seq23/dianne-place-recovery-services/pull/18';
  const dsites = [{ repo: 'dianne-place-recovery-services', domain: 'detoxdenver.org' }];
  const rowsOf = () => [
    { repo: 'dianne-place-recovery-services', disposition: 'fixed_pr', pr_url: dpr, headline: 'e6: Clarity', because: 'renders the loader into the /contact/ HTML (never on /admin/)' },
    { repo: 'dianne-place-recovery-services', disposition: 'fixed_pr', pr_url: dpr, headline: 'i8: Clarity', because: '/about/ gets a question H2' },
  ];
  const go = (ct: { status: number; out: string } | null) => {
    let commented = false;
    const calls: string[] = [];
    const payload: any = { findings: rowsOf() };
    landAll(payload, { sites: dsites, parked: () => false, landBin: '/test/land', run: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      if (args.includes('/test/land')) return commented ? { status: 0, out: 'landed' } : { status: 1, out: '\u001b[31mSTOPPED: NAMED STOP [NOT_CLICKED_THROUGH] PR #18 changes screens people operate (components/ClarityLoader.tsx ) and carries no "Clicked through:" line.\u001b[0m' };
      if (args.some(a => a.endsWith('clickthrough.mjs'))) { if (ct?.status === 0) commented = true; return ct ?? { status: 0, out: '' }; }
      if (cmd === 'gh' && args.includes('state')) return { status: 0, out: 'OPEN' };
      if (cmd === 'gh' && args[0] === 'api') return { status: 0, out: '[]' };
      return { status: 0, out: '' };
    } });
    const ctCalls = calls.filter(c => c.includes('clickthrough.mjs'));
    return { rows: payload.findings, lands: calls.filter(c => c.includes('/test/land')).length, ctCalls };
  };
  const clean = go({ status: 0, out: 'CLICKED_THROUGH ok' });
  expect(clean.rows.map((r: any) => r.land)).toEqual(['landed', 'landed']);
  expect(clean.lands).toBe(2);
  expect(clean.ctCalls).toHaveLength(1);
  // The paths come from both briefs of the PR; /admin is never opened.
  expect(clean.ctCalls[0]).toContain(`${dpr} --paths /,/contact/,/about/`);
  expect(clean.ctCalls[0]).not.toContain('/admin');
  // NEGATIVE: a dirty console holds the PR with the error on the row; one land, never a second.
  const dirty = go({ status: 3, out: 'NAMED STOP [CLICKTHROUGH_DIRTY] /contact/: console: clarity is not defined' });
  expect(dirty.lands).toBe(1);
  expect(dirty.rows[0]).toMatchObject({ land: 'clickthrough_failed', land_detail: expect.stringContaining('console: clarity is not defined') });
  // NEGATIVE: no readable preview fails closed, never lands.
  const unread = go({ status: 2, out: 'NAMED STOP [PREVIEW_URL_UNREAD] no preview of the head' });
  expect(unread.lands).toBe(1);
  expect(unread.rows[1]).toMatchObject({ land: 'clickthrough_failed', land_detail: expect.stringContaining('PREVIEW_URL_UNREAD') });
  // The round that holds it names the gate, never "fixed nothing".
  expect(cause(unread.rows)).toMatchObject({ code: 'SR_LAND_GATE_UNMET', sentence: `${dpr} refused by PREVIEW_URL_UNREAD` });
});

it('fixedNothingCause: a named land gate on a fixed PR is SR_LAND_GATE_UNMET; no named gate is still a stall', () => {
  const pr = 'https://github.com/seq23/approvalprep/pull/9';
  const f = { repo: 'approvalprep', disposition: 'fixed_pr', pr_url: pr };
  expect(cause([{ ...f, land: 'land_refused', land_detail: 'STOPPED: NAMED STOP [NOT_CLICKED_THROUGH] PR #9' }])).toEqual({ code: 'SR_LAND_GATE_UNMET', sentence: `${pr} refused by NOT_CLICKED_THROUGH` });
  expect(cause([{ ...f, land: 'held_owner_approval', land_detail: 'hicks: waits' }]).code).toBe('SR_LAND_GATE_UNMET');
  expect(cause([{ ...f, land: 'held_owner_approval' }, { ...f, land: 'landed' }]).code).toBe('SR_LAND_GATE_UNMET');
  // NEGATIVE: no named stop, a red check, a fixed row with no PR, or a mixed surfaced row is a genuine stall.
  expect(cause([{ ...f, land: 'land_refused', land_detail: 'network error' }]).code).toBe('');
  expect(cause([{ ...f, land: 'checks_red', land_detail: 'NAMED STOP [X]' }]).code).toBe('');
  expect(cause([{ ...f, land: 'held_owner_approval' }, { ...f, land: 'checks_red' }]).code).toBe('');
  expect(cause([{ ...f, pr_url: undefined, land: 'held_owner_approval' }]).code).toBe('');
  expect(cause([{ ...f, land: 'held_owner_approval' }, { disposition: 'surfaced' }]).code).toBe('');
});

/*
 * 25 NOV 2026: ~/bin/land refused all 42 of the run's green fixes with a plain "STOPPED: PR #N needs
 * a review (its body has no `Review class:` line …)", no NAMED STOP, and the round read as "fixed
 * nothing". The REAL landAll now names land's review gate on the row from land's own words.
 */
import { rowStop } from '../src/shared/boss/searchReadiness/orphanPr.mjs';
// @ts-expect-error Node-only ops module has no declaration.
import { reviewGate } from '../scripts/ops/site-audit-lib.mjs';
const NO_CLASS = "\u001b[31mSTOPPED: PR #10 needs a review (its body has no `Review class:` line (add `Review class: none — <why>`, or the class: money, children, private-data, store, delete, launch)) and changes what people see (public/404.html public/_headers): add as a PR comment by the repo's owner account the line  Ship-ready: PASS — <fresh reviewer> looked at <the real output> at abc1234; Engineering: PASS\u001b[0m";
const NOT_LAUNCHED = "STOPPED: PR #43 needs a review (search-loop has not launched (not on seq-bin's live-repos.json: new until launched; a landed Launch-ready PASS adds it)) and changes code (engine/run.mjs): add as a PR comment by the repo's owner account the line  Ship-ready: PASS — <fresh reviewer> looked at <the diff> at abc; Engineering: PASS";
function landWith(out: string, extra: { merged?: boolean } = {}) {
  const pr = 'https://github.com/seq23/whisperalmanac-site/pull/10';
  const calls: string[] = [];
  const payload: any = { findings: [
    { repo: 'whisperalmanac-site', disposition: 'fixed_pr', pr_url: pr, headline: 'a9', suggested_action: 'the fix' },
    { repo: 'whisperalmanac-site', disposition: 'fixed_pr', pr_url: pr, headline: 'b2', suggested_action: 'the fix' },
  ] };
  landAll(payload, { sites: [{ repo: 'whisperalmanac-site', domain: 'whisperalmanac.com' }], parked: () => false, approvedSites: [], landBin: '/test/land', run: (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(' '));
    if (args.includes('/test/land')) return { status: 1, out };
    if (cmd === 'gh' && args.includes('state')) return { status: 0, out: extra.merged ? 'MERGED' : 'OPEN' };
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return { status: 0, out: JSON.stringify({ number: 10, headRefOid: 'abc1234', baseRefName: 'main' }) };
    if (cmd === 'gh' && args[0] === 'api') return { status: 0, out: '[]' };
    return { status: 0, out: '' };
  } });
  return { rows: payload.findings, lands: calls.filter(c => c.includes('/test/land')).length, cts: calls.filter(c => c.includes('clickthrough.mjs')).length };
}
it("25 Nov: land's missing-Review-class refusal is named REVIEW_CLASS_MISSING on every row of the PR; one land, no click-through", () => {
  const r = landWith(NO_CLASS);
  expect(r.lands).toBe(1);
  expect(r.cts).toBe(0);
  for (const row of r.rows) {
    expect(row.land).toBe('land_refused');
    expect(row.land_detail).toMatch(/^NAMED STOP \[REVIEW_CLASS_MISSING\] STOPPED: PR #10 needs a review \(its body has no `Review class:` line/);
    expect(row.suggested_action).toContain('Review class: none');
    expect(rowStop(row)).toEqual({ kind: 'gate', code: 'REVIEW_CLASS_MISSING' });
  }
  expect(cause(r.rows)).toEqual({ code: 'SR_LAND_GATE_UNMET', sentence: 'https://github.com/seq23/whisperalmanac-site/pull/10 refused by REVIEW_CLASS_MISSING' });
});
it("25 Nov: a review refusal that is not the body line (a repo not launched) is REVIEW_PASS_MISSING; an unreasoned none is CLASS_MISSING", () => {
  const r = landWith(NOT_LAUNCHED);
  expect(r.rows[0].land_detail).toMatch(/^NAMED STOP \[REVIEW_PASS_MISSING\] /);
  expect(r.rows[1].suggested_action).toContain('fresh reviewer');
  expect(cause(r.rows).sentence).toContain('refused by REVIEW_PASS_MISSING');
  expect(reviewGate('STOPPED: PR #1 needs a review (its `Review class: none` gives no reason (3+ words after the dash)) and changes code (a.mjs)')?.code).toBe('REVIEW_CLASS_MISSING');
  expect(reviewGate("STOPPED: PR #1 puts something new in public (public/logo.svg): add as a PR comment … Launch-ready: PASS — <fresh reviewer>")?.code).toBe('REVIEW_PASS_MISSING');
});
it('NEGATIVE: a refusal that is not a review (red check, network blip), one land already named, or a merged PR keeps its own outcome', () => {
  for (const out of ['STOPPED: checks are not green on PR #10 (validate failed)', 'error: could not resolve host: api.github.com']) {
    const r = landWith(out);
    expect(r.rows[0].land).toBe('land_refused');
    expect(r.rows[0].land_detail).not.toContain('NAMED STOP');
    expect(r.rows[0].suggested_action).toBe('the fix');
    expect(cause(r.rows).code).toBe('');
  }
  expect(reviewGate('STOPPED: PR #1 needs a review (NAMED STOP [LIVE_REPOS_UNREAD] x could not be read)')).toBeNull();
  const m = landWith(NO_CLASS, { merged: true });
  expect(m.rows[0]).toMatchObject({ land: 'merged_deploy_failed' });
  expect(m.rows[0].land_detail).not.toContain('REVIEW_CLASS_MISSING');
});
it('the rebuilt reduction: a policy row with no PR is not evidence; an unexplained row keeps the stall', () => {
  const pr = 'https://github.com/seq23/approvalprep/pull/9';
  const gate = { repo: 'approvalprep', disposition: 'fixed_pr', pr_url: pr, land: 'land_refused', land_detail: 'NAMED STOP [REVIEW_CLASS_MISSING] x' };
  const policy = { repo: 'dailystory', disposition: 'in_flight', land: 'blocked', land_detail: 'refused_policy' };
  expect(rowStop(policy)).toEqual({ kind: 'skip' });
  expect(cause([gate, policy, policy]).code).toBe('SR_LAND_GATE_UNMET');
  // NEGATIVE: only policy rows is no cause; an in-flight row with no PR blocked for another reason is unexplained.
  expect(cause([policy]).code).toBe('');
  expect(cause([gate, { ...policy, land_detail: 'checks_red' }]).code).toBe('');
  // A fixed PR that landed with nothing gated is not a stop this names.
  expect(cause([{ ...gate, land: 'landed' }]).code).toBe('');
  expect(cause([{ ...gate, land: 'landed' }, { ...gate, disposition: 'in_flight', land: 'blocked', land_detail: 'draft_left_behind' }]).code).toBe('');
});
