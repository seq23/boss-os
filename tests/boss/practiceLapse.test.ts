import { env } from "cloudflare:test";
import CONTRACT from "../../docs/boss/A_PLAYER_MODE_OS_CONTRACT.md?raw";
import SENDER from "../../scripts/ops/practice-nudges.mjs?raw";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, all, insertApproval } from "./helpers";
import {
  lapseTier, lapseVerdict, lapseNotice, middayNotice, dueNudges, markNudgeSent, recordEngagement, daysBetween,
} from "../../src/worker/boss/practice/lapse";
import { LINES, BANNED_WORDS } from "../../src/worker/boss/practice/lines";
import { LAWS, COMMITMENTS } from "../../src/worker/boss/today/faculty";
import { cleanGateItems, GATE_DEFAULTS } from "../../src/worker/boss/today/list";
import { ancestralUrgent } from "../../src/worker/boss/practice/ancestralUrgent";
import { dayIdInZone } from "../../src/shared/boss/timezone";

/**
 * THE TOUGH-LOVE EMAILS AND THE NEW TODAY (owner, 31 Oct 2026).
 *
 *   "when i go on long streaks of not opening the boss os app and not doing coaching and not hitting
 *    my gates u should email me … remind me in some clever way that being a A player requires
 *    discipline. I need tough love sometimes and reminders to be consistent."
 *
 * Pinned here: the ladder's thresholds, at most one a day, the reset the moment she engages, nothing
 * she says stored, the line bank (≥20 lines, never body, weight, food or cruelty, no clichés), her
 * own words quoted verbatim, and Today's one list with its one count.
 */

// 10:30 and 08:30 Central on Tuesday 3 Nov 2026 (CST, UTC-6).
const AT_1030 = Date.UTC(2026, 10, 3, 16, 30);
const AT_0830 = Date.UTC(2026, 10, 3, 14, 30);
const TODAY = dayIdInZone(AT_1030);
const minus = (n: number) => dayIdInZone(AT_1030 - n * 86_400_000);
const ORIGIN = "https://boss.example";

async function clean() {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM practice_engagement`),
    env.DB.prepare(`DELETE FROM practice_nudges`),
    env.DB.prepare(`DELETE FROM today_ticks`),
    env.DB.prepare(`DELETE FROM gate_templates`),
    env.DB.prepare(`DELETE FROM gate_days`),
    env.DB.prepare(`UPDATE days SET morning_completed_at = NULL, midday_completed_at = NULL, night_completed_at = NULL`),
  ]);
}
const engagedOn = (day: string, kind = "app_open") =>
  env.DB.prepare(`INSERT INTO practice_engagement (day_id, kind, first_at, last_at) VALUES (?,?,1,1)`).bind(day, kind).run();

describe("the lapse ladder", () => {
  beforeEach(clean);

  it("climbs on day 2 (firm), day 4 (tough), day 7 and every 3 days after (hard), and nowhere else", () => {
    const got = Array.from({ length: 17 }, (_, i) => [i, lapseTier(i)] as const).filter(([, t]) => t);
    expect(got).toEqual([[2, "firm"], [4, "tough"], [7, "hard"], [10, "hard"], [13, "hard"], [16, "hard"]]);
    expect(daysBetween("2026-10-30", "2026-11-01")).toBe(2);
  });

  it("waits for mid-morning, Central", () => {
    const last = { day: minus(2), tracking: true };
    expect(lapseVerdict(AT_0830, last).due).toBe(false);
    expect(lapseVerdict(AT_1030, last)).toMatchObject({ due: true, tier: "firm", streak_days: 2 });
  });

  it("sends nothing before she has ever opened the app: tracking starts there", () => {
    expect(lapseVerdict(AT_1030, { day: minus(9), tracking: false }).due).toBe(false);
  });

  it("sends at most one a day: a claimed day is offered until it is sent, then never again", async () => {
    await engagedOn(minus(4));
    const first = await dueNudges(env as any, ORIGIN, AT_1030);
    expect(first.due.map((d) => [d.kind, d.tier, d.streak_days])).toEqual([["lapse", "tough", 4]]);
    // The send failed (no mark): the same day is offered again, once.
    expect((await dueNudges(env as any, ORIGIN, AT_1030 + 600_000)).due).toHaveLength(1);
    expect(await markNudgeSent(env as any, TODAY, "lapse")).toBe(true);
    const again = await dueNudges(env as any, ORIGIN, AT_1030 + 1_200_000);
    expect(again.due).toEqual([]);
    expect(again.lines.join(" ")).toMatch(/already sent today/);
    expect((await all(`SELECT * FROM practice_nudges`)).length).toBe(1);
  });

  it("resets the moment she engages: an app open, a coach talk or a closed gate", async () => {
    await engagedOn(minus(7));
    expect((await dueNudges(env as any, ORIGIN, AT_1030)).due[0]?.tier).toBe("hard");
    await env.DB.prepare(`DELETE FROM practice_nudges`).run();
    await recordEngagement(env as any, "coach_morning", AT_1030 - 3_600_000);
    const after = await dueNudges(env as any, ORIGIN, AT_1030);
    expect(after.due.filter((d) => d.kind === "lapse")).toEqual([]);
    expect(after.lines.join(" ")).toMatch(/engaged today/);

    // A gate closed yesterday is engagement too: the streak is 1, which is not a rung.
    await clean();
    await engagedOn(minus(9));
    await env.DB.prepare(`INSERT INTO days (id, date_ts, created_at, night_completed_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET night_completed_at = excluded.night_completed_at`)
      .bind(minus(1), AT_1030 - 86_400_000, 1, AT_1030 - 80_000_000).run();
    expect((await dueNudges(env as any, ORIGIN, AT_1030)).due.filter((d) => d.kind === "lapse")).toEqual([]);
  });

  it("stores THAT she talked to the coach, never what she said", async () => {
    const marker = `zq-${Math.random().toString(36).slice(2)}-my-private-words`;
    // An exit phrase is a talk that happened, and reaches no model.
    const r = await apiJson("/api/today/coaching/turn", { method: "POST", body: { text: "I'm ready", turn: 1, phase: "evening" } });
    expect(r.status).toBe(200);
    // And words that would go to a model: with consent, whatever the model does, nothing keeps them.
    await apiJson("/api/today/coaching/consent", { method: "POST", body: { backend_id: "bk_workers_ai" } });
    await apiJson("/api/today/coaching/turn", { method: "POST", body: { text: marker, turn: 1 } }).catch(() => null);

    const kinds = (await all<{ kind: string }>(`SELECT kind FROM practice_engagement ORDER BY kind`)).map((k) => k.kind);
    expect(kinds).toContain("coach_evening");
    expect((await all<{ name: string }>(`PRAGMA table_info(practice_engagement)`)).map((c) => c.name)).toEqual(["day_id", "kind", "first_at", "last_at"]);
    const tables = await all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`);
    expect(tables.length).toBeGreaterThan(50); // Rule 0: the scan read the database
    const holding: string[] = [];
    for (const t of tables) {
      const rows = await all(`SELECT * FROM "${t.name}"`).catch(() => []);
      if (JSON.stringify(rows).includes(marker)) holding.push(t.name);
    }
    expect(holding, "tables holding her coaching words").toEqual([]);
    await env.DB.prepare(`DELETE FROM coaching_consent`).run();
  });
});

describe("the line bank and the email", () => {
  const every = Object.values(LINES).flat();
  const banned = (text: string) => BANNED_WORDS.filter((w) => new RegExp(`\\b${w.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));

  it("holds at least 20 lines, at least 6 a tier, none repeated", () => {
    expect(every.length).toBeGreaterThanOrEqual(20);
    for (const t of ["firm", "tough", "hard"] as const) expect(LINES[t].length).toBeGreaterThanOrEqual(6);
    expect(new Set(every).size).toBe(every.length);
  });

  it("never says a word about body, weight or food, never shames, never reaches for a hustle cliché", () => {
    expect(BANNED_WORDS).toEqual(expect.arrayContaining(["keto", "weight", "body", "food", "diet", "lazy", "pathetic", "hustle", "grind"]));
    const hits = every.flatMap((l) => banned(l).map((w) => `${w}: ${l}`));
    expect(hits).toEqual([]);
  });

  it("quotes HER words verbatim: every commitment is still in her contract, every law in faculty.ts", () => {
    const contract = String(CONTRACT);
    for (const c of COMMITMENTS) expect(contract).toContain(`**${c.title}** = ${c.text}`);
    const theirs = [...LAWS.map((l) => l.text), ...COMMITMENTS.map((c) => c.text[0]!.toUpperCase() + c.text.slice(1))];
    for (const tier of ["firm", "tough", "hard"] as const) {
      for (const [streak, day] of [[tier === "firm" ? 2 : tier === "tough" ? 4 : 7, "2026-11-03"], [tier === "hard" ? 10 : tier === "firm" ? 2 : 4, "2026-11-04"]] as const) {
        const n = lapseNotice(tier, streak, day, ORIGIN);
        expect(n.happened).toBe(`${streak} days: no gates, no coaching, app not opened.`);
        const quoted = /"(.+)"$/.exec(n.details[0]!)?.[1];
        expect(theirs, `${tier}: the quote is hers`).toContain(quoted);
        expect(LINES[tier]).toContain(n.details[1]);
        expect(n.decide).toHaveLength(1);
        expect(n.decide[0]!.buttons).toHaveLength(1);
        expect(n.decide[0]!.buttons[0]!.url.startsWith(`${ORIGIN}/?view=`)).toBe(true);
        expect(banned([n.subject, n.happened, ...n.details, n.decide[0]!.title, n.decide[0]!.body].join(" "))).toEqual([]);
      }
    }
    expect(middayNotice(LAWS[3]!, ORIGIN).decide[0]!.buttons[0]!.url).toBe(`${ORIGIN}/?view=gate&gate=midday`);
  });

  it("goes to her only: the Mac sender addresses OWNER_TO and nothing else", () => {
    const src = String(SENDER);
    expect(src).toMatch(/to: OWNER_TO/);
    expect(src).not.toMatch(/notice\.to|\bcc\b|\bbcc\b/);
  });
});

describe("Today's one list", () => {
  beforeEach(clean);

  it("opens on the Morning gate, ends on the Night gate, and its count is the rows that need her", async () => {
    const appr = await insertApproval({ title: "Approve the example letter" });
    const r = await apiJson("/api/practice/list");
    expect(r.status).toBe(200);
    const rows = r.body.data.rows as { key: string; needs_you: boolean }[];
    expect(rows[0]!.key).toBe("gate:morning");
    expect(rows[rows.length - 1]!.key).toBe("gate:night");
    expect(rows.map((x) => x.key)).toContain("gate:midday");
    expect(rows.map((x) => x.key)).toContain(`approval:${appr}`);
    expect(r.body.data.needs_you).toBe(rows.filter((x) => x.needs_you).length);
    expect(r.body.data.needs_you).toBeGreaterThanOrEqual(1);
    await env.DB.prepare(`DELETE FROM approvals WHERE id = ?`).bind(appr).run();
  });

  it("ticks an item and keeps the time; the law's tick is one tick wherever it is pressed", async () => {
    const t = await apiJson("/api/practice/tick", { method: "POST", body: { key: "morning:law" } });
    expect(t.body.data.ticks["morning:law"]).toBeGreaterThan(0);
    const undo = await apiJson("/api/practice/tick", { method: "POST", body: { key: "morning:law", done: false } });
    expect(undo.body.data.ticks["morning:law"]).toBeUndefined();
    expect((await apiJson("/api/practice/tick", { method: "POST", body: { key: "DROP TABLE" } })).status).toBe(400);
  });

  it("keeps the default gates, lets her save her own as the default, and never loses a required item", async () => {
    // Today v4 (owner, 31 Oct 2026): gratitude, meditation, movement, medicine, the blood pressure tea,
    // then morning coaching ALWAYS last. Food left the Midday gate for its own 15:00 row.
    expect(GATE_DEFAULTS.morning.map((i) => i.kind)).toEqual(["gratitude", "practice", "move", "water", "bp_tea", "agree", "coach"]);
    expect(GATE_DEFAULTS.midday.map((i) => i.kind)).toEqual(["water_mid", "stand", "law_check", "what_changed"]);
    expect(GATE_DEFAULTS.night.map((i) => i.kind)).toEqual(["coach_evening", "floors", "attention", "law_reflect", "grateful", "tomorrow"]);
    const cleaned = cleanGateItems("morning", [{ key: "law" }, { key: "custom:abcd1234", label: "Light the candle" }]);
    expect(Array.isArray(cleaned) && cleaned.map((i) => i.key)).toEqual(["law", "custom:abcd1234", "agree"]);

    const saved = await apiJson("/api/practice/gates/morning", { method: "PUT", body: { scope: "default", items: [{ key: "law" }, { key: "water" }] } });
    const gate = saved.body.data.rows.find((x: any) => x.key === "gate:morning").gate;
    expect(gate.is_default).toBe(false);
    expect(gate.saved_default).toBe(true);
    expect(gate.items.map((i: any) => i.key)).toEqual(["law", "water", "agree"]);
    const reset = await apiJson("/api/practice/gates/morning", { method: "PUT", body: { scope: "reset" } });
    expect(reset.body.data.rows.find((x: any) => x.key === "gate:morning").gate.is_default).toBe(true);
  });

  it("records an app open as a day and a time, nothing more", async () => {
    expect((await apiJson("/api/practice/opened", { method: "POST", body: {} })).status).toBe(200);
    const rows = await all<{ kind: string }>(`SELECT kind FROM practice_engagement`);
    expect(rows.map((x) => x.kind)).toEqual(["app_open"]);
  });
});

describe("the ancestral hour, dangerously close", () => {
  // 31 Oct 2026 is the last day of the month; Central is UTC-5 (CDT) that day.
  const at = (h: number, m = 0) => Date.UTC(2026, 9, 31, h + 5, m);
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM ancestral_hour_reminders`),
      env.DB.prepare(`DELETE FROM ancestor_entries WHERE month = '2026-10'`),
      env.DB.prepare(`DELETE FROM practice_nudges`),
    ]);
  });

  it("sends one short urgent email on the last day from 6pm Central while the hour is not done", async () => {
    expect(await ancestralUrgent(env as any, at(17, 30), ORIGIN)).toEqual([]);
    const due = await ancestralUrgent(env as any, at(18, 10), ORIGIN);
    expect(due).toHaveLength(1);
    expect(due[0]!.kind).toBe("ancestral_urgent");
    expect(due[0]!.notice.subject).toMatch(/hours left in October/);
    expect(await ancestralUrgent(env as any, Date.UTC(2026, 9, 30, 23, 30), ORIGIN)).toEqual([]); // not the last day
  });

  it("reuses the reminder's Done tap, stays quiet when that reminder just went, and stops once done", async () => {
    await env.DB.prepare(`INSERT INTO ancestral_hour_reminders (day, month, kind, tap_token, claimed_at, sent_at, created_at) VALUES ('2026-10-31','2026-10','last','ancTESTTOKENabcdefghijklmnop',1,?,1)`).bind(at(10)).run();
    const due = await ancestralUrgent(env as any, at(18, 10), ORIGIN);
    expect(due[0]!.notice.decide[0]!.buttons[0]!.url).toBe(`${ORIGIN}/tap/ancTESTTOKENabcdefghijklmnop?do=done`);
    await env.DB.prepare(`UPDATE ancestral_hour_reminders SET sent_at = ?`).bind(at(18, 5)).run();
    expect(await ancestralUrgent(env as any, at(18, 20), ORIGIN)).toEqual([]);
    await env.DB.prepare(`UPDATE ancestral_hour_reminders SET sent_at = ?`).bind(at(10)).run();
    await env.DB.prepare(`INSERT INTO ancestor_entries (id, ts, month, who, relation, kind, minutes, note, created_at) VALUES ('anc_t1', 1, '2026-10', 'My ancestors', NULL, 'ritual', 60, 'test', 1)`).run();
    expect(await ancestralUrgent(env as any, at(19), ORIGIN)).toEqual([]);
  });

  it("goes once: the claim table holds one per day", async () => {
    const first = await dueNudges(env as any, ORIGIN, at(18, 10), (e, t) => ancestralUrgent(e, t, ORIGIN));
    expect(first.due.filter((d) => d.kind === "ancestral_urgent")).toHaveLength(1);
    await markNudgeSent(env as any, "2026-10-31", "ancestral_urgent");
    const again = await dueNudges(env as any, ORIGIN, at(18, 40), (e, t) => ancestralUrgent(e, t, ORIGIN));
    expect(again.due.filter((d) => d.kind === "ancestral_urgent")).toEqual([]);
  });
});
