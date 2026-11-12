import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { READERS } from '../scripts/ops/lib/scorecard-readers.mjs';
import { judge } from '../src/shared/boss/scorecard/scorecard.mjs';

it('Dream Wedding reads production conversion, waits for launch, and cannot judge absent data as zero', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../src/shared/boss/scorecard/manifest.json', import.meta.url), 'utf8'));
  const row = manifest.rows.find((r: any) => r.id === 'dw-phone-app');
  expect(row).toBeDefined();
  const db = new DatabaseSync(':memory:');
  const now = Date.parse('2027-02-01T12:00:00Z');
  const ctx = { now, env: { CLOUDFLARE_ACCOUNT_ID: 'fixture', CLOUDFLARE_API_TOKEN: 'fixture' }, fetch: async (url: string, init?: any) => {
    if (!init?.body) return { ok: true, json: async () => ({ result: [{ name: 'dream-wedding-builder', uuid: 'fixture' }] }) };
    try {
      const results = db.prepare(JSON.parse(init.body).sql).all();
      return { ok: true, json: async () => ({ success: true, result: [{ results }] }) };
    } catch {
      return { ok: false, status: 400, json: async () => ({ success: false }) };
    }
  } };
  const read = async () => ({ started: await READERS.d1!(row.startWhen.params, ctx), first: await READERS.d1!(row.first.params, ctx), real: await READERS.d1!(row.real.params, ctx) });
  try {
    await expect(read()).rejects.toThrow(/D1_QUERY_FAILED/);
    db.exec('CREATE TABLE app_plan_reach (installation_hash TEXT PRIMARY KEY, reached_at INTEGER); CREATE TABLE app_confirmed_unlocks (transaction_hash TEXT PRIMARY KEY, purchased_at INTEGER)');
    const empty = await read();
    expect(empty.started.raw).toBeNull();
    expect(empty.first.raw).toBeNull();
    expect(judge({ row, record: null, reading: empty, today: '2027-02-01' }).state).toBe('Too early');
    // Old reach starts the launch clock but does not inflate the rolling denominator.
    db.prepare('INSERT INTO app_plan_reach VALUES (?, ?)').run('launch', Date.parse('2026-12-01T12:00:00Z'));
    for (let i = 0; i < 100; i++) db.prepare('INSERT INTO app_plan_reach VALUES (?, ?)').run(`phone-${i}`, now - 86400000);
    for (let i = 0; i < 3; i++) db.prepare('INSERT INTO app_confirmed_unlocks VALUES (?, ?)').run(`transaction-${i}`, now - 86400000);
    db.prepare('INSERT INTO app_confirmed_unlocks VALUES (?, ?)').run('old-sale', Date.parse('2026-12-01T12:00:00Z'));
    const measured = await read();
    expect(measured.started.raw).toBe('2026-12-01');
    expect(measured.first.raw).toBe(3);
    expect(measured.real.raw).toBe(3);
    expect(row.first.by).toBe(30);
    expect(row.first.floor.value).toBe(3);
    expect(row.real.by).toBe(60);
    expect(row.real.floor.value).toBe(6);
    const day30 = judge({ row, record: null, reading: { ...measured, first: { raw: 2 } }, today: '2026-12-31' });
    expect(day30.state).toBe('Trying version B');
    // Once launched, no reach is an unknown measurement, not a failed 0% conversion.
    db.exec('DELETE FROM app_plan_reach');
    const missing = await read();
    expect(missing.first.raw).toBeNull();
    expect(judge({ row, record: day30.record, reading: missing, today: '2027-02-01' }).state).toBe('No number');
  } finally { db.close(); }
});
