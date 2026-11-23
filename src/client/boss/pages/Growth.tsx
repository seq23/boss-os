import { useEffect, useState } from "react";
import { api } from "../api";
import { Loading } from "../components/Shell";
import { shortDate } from "@shared/boss/scorecard/scorecard.mjs";
import { APART_KINDS } from "@shared/boss/growth/scoreboard.mjs";
import { ENGINE_LABEL } from "@shared/boss/growth/aiAnswers.mjs";

/**
 * THE GROWTH PAGE (21 Nov 2026). ☰ More → Growth, /?tab=growth. Noelle, Director of Growth.
 *
 * One section per growth business, in scoreboard order (Porch & Party first): Upcoming (her to-dos,
 * the rows her roster links — work in progress elsewhere says so — and her cards waiting in Decide),
 * Happening (this 28-day window's numbers and this week's decision with its evidence), Happened
 * (earlier decisions and finished to-dos, eight weeks). "Not read" is said, never shown as zero.
 * AI answers (ChatGPT, Gemini, Google AI Overviews citing the site, read weekly from OpenSEO) is its
 * own card beside the 28-day numbers, never added into them.
 * Phone first, calm: line 1 says what needs her, which is only a card in Decide.
 */
type Todo = { id: string; title: string; next: string; date: string | null; elsewhere: boolean };
type Card = { id: string; title: string; status: string; requested_at: number };
type Decision = { cycle: string; state: string; decision: string; evidence: string[]; test: any; actions: any[]; next_check: string | null };
type Channel = { label: string; kind: string; value: number | null; before: number | null; hold: string | null; unread: string | null };
type AiEngine = { engine: string; answered: number; mentioned: number; cited: number; before: { mentioned: number; cited: number } | null };
type Ai = { host: string; state: string; why?: string; week: string | null; day?: string; prompts?: number; cited?: number; mentioned?: number;
  before?: { week: string; cited: number; mentioned: number } | null; engines?: AiEngine[] };
type Biz = {
  key: string; label: string; paused: string | null; onRoster: boolean; ai: Ai | null;
  upcoming: { todos: Todo[]; cards: Card[] };
  happening: { board: { state: string; channels: Channel[] } | null; decision: Decision | null; last: string | null };
  happened: { decisions: Decision[]; done: { id: string; title: string; at: number; status: string }[]; answered: Card[] };
};
type Page = { day: string; problems: string[]; general: Todo[]; businesses: Biz[]; week: { decided: number; held: number } };

const num = (kind: string, v: number) => (kind === "money" ? `$${Math.round(v).toLocaleString("en-US")}` : v.toLocaleString("en-US"));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ACT: Record<string, string> = { queued: "Queued", ordered: "Requested from the backlink network", proposal: "Asked you", held: "Held", blocked: "Blocked by a rule", refused: "Refused" };

export function Growth() {
  const [data, setData] = useState<Page | null | undefined>(undefined);
  useEffect(() => { api.growthPage().then(setData).catch(() => setData(null)); }, []);
  if (data === undefined) return <Loading />;
  if (data === null) return <div className="brains"><p className="brain-summary">The Growth page did not load. Try again in a minute.</p></div>;
  const cards = data.businesses.reduce((n, b) => n + b.upcoming.cards.length, 0);
  const { decided, held } = data.week;
  return (
    <div className="brains" data-testid="growth">
      <p className="brain-summary" data-testid="growth-summary">
        {cards ? `${plural(cards, "growth idea")} waiting for you in Decide` : "Nothing needs you here"}
        {decided + held ? ` · this week ${decided} decided, ${held} held` : " · no decision written yet this week"}
      </p>
      <p className="brain-hint">Noelle, Director of Growth, counts what each business earns every morning and decides the week every Monday. She never posts, sends or spends; anything new comes to you as a card.</p>
      {data.problems.length > 0 && <p className="brain-hint" data-testid="growth-problems">The Growth roster needs a fix: {data.problems.slice(0, 3).map((p) => p.replace(/NAMED STOP \[[A-Z0-9_]+\]\s*/g, "")).join(" · ")}</p>}
      {data.general.length > 0 && (
        <section className="scorecard-business" data-testid="growth-general">
          <h2 className="email-map-business-name">Across the businesses</h2>
          <div className="brain-cards">{data.general.map((t) => <TodoCard key={t.id} t={t} />)}</div>
        </section>
      )}
      {data.businesses.map((b) => <Business key={b.key} b={b} />)}
    </div>
  );
}

function TodoCard({ t, label }: { t: Todo; label?: string }) {
  return (
    <div className="brain-card email-map-card">
      <span className="email-map-what">{t.title.replace(/^Growth Director:\s*/, "").replace(label ? `${label} — ` : "\u0000", "")}</span>
      {t.next ? <span className="brain-card-line">{t.next}</span> : null}
      <span className="brain-card-line">{t.elsewhere ? "In progress elsewhere · " : ""}{t.date ? `Next ${shortDate(t.date)}` : "No date"}</span>
    </div>
  );
}

function Business({ b }: { b: Biz }) {
  const d = b.happening.decision;
  const ch = (b.happening.board?.channels ?? []).filter((c) => !APART_KINDS.includes(c.kind));
  const read = ch.filter((c) => c.value != null);
  const unread = ch.filter((c) => c.value == null);
  return (
    <section className="scorecard-business" data-testid={`growth-business-${b.key}`}>
      <h2 className="email-map-business-name">{b.label}</h2>
      {b.paused ? <p className="brain-hint">Paused: {b.paused}. Nothing is measured, queued or posted.</p>
        : !b.onRoster ? <p className="brain-hint">Not on the Growth roster yet, so nothing acts for it.</p> : null}

      <h3 className="growth-when">Upcoming</h3>
      {b.upcoming.cards.length + b.upcoming.todos.length === 0 ? <p className="brain-hint">Nothing queued.</p> : (
        <div className="brain-cards">
          {b.upcoming.cards.map((c) => (
            <a key={c.id} className="brain-card email-map-card" href="/?tab=today">
              <span className="email-map-what">{c.title}</span><span className="scorecard-state scorecard-gold">In Decide</span>
            </a>
          ))}
          {b.upcoming.todos.map((t) => <TodoCard key={t.id} t={t} label={b.label} />)}
        </div>
      )}

      {b.paused && !d ? null : <h3 className="growth-when">Happening</h3>}
      <div className="brain-cards">
        {b.paused && !d ? null : <div className="brain-card email-map-card">
          <span className="email-map-what">{d ? d.decision : b.happening.last ? `No decision this week yet (last: ${shortDate(b.happening.last)}). The next one is written on Monday morning.` : "No decision yet: the first one is written on Monday morning."}</span>
          {d ? <span className="brain-card-line">Week of {shortDate(d.cycle)}{d.next_check ? ` · next check ${shortDate(d.next_check)}` : ""}</span> : null}
          {d?.evidence?.length ? <ul className="schedule-list">{d.evidence.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
          {d?.test ? <span className="brain-card-line">Testing: {d.test.what} on {d.test.channel}, judged by {d.test.number}, stops {d.test.stop}</span> : null}
          {d?.actions?.length ? (
            <details className="brain-expander"><summary>What she did with it ▾</summary>
              <ul className="schedule-list">{d.actions.map((a, i) => <li key={i}>{ACT[a.kind] ?? a.kind}{a.item ? `: ${a.item.channel} ${a.item.format}${a.item.topic ? `, “${a.item.topic}”` : ""}` : a.proposal ? `: ${a.proposal.what}` : ""}{a.why ? ` — ${a.why}` : ""}</li>)}</ul>
            </details>
          ) : null}
        </div>}
        {!b.paused && (
          <div className="brain-card email-map-card">
            <span className="email-map-what">Last 28 days</span>
            {read.length === 0 ? <span className="brain-card-line">Not read yet</span>
              : <ul className="schedule-list">{read.slice(0, 6).map((c, i) => <li key={i}>{c.label}: {num(c.kind, c.value!)}{c.before != null ? ` (was ${num(c.kind, c.before)})` : ""}{c.hold ? ` · ${c.hold}` : ""}</li>)}</ul>}
            {unread.length > 0 && <details className="brain-expander"><summary>{plural(unread.length, "number")} not read ▾</summary>
              <ul className="schedule-list">{unread.map((c, i) => <li key={i}>{c.label}: {(c.unread ?? "not read").replace(/^not read: /, "")}</li>)}</ul></details>}
          </div>
        )}
        {!b.paused && b.ai ? <AiAnswers ai={b.ai} /> : null}
      </div>

      <h3 className="growth-when">Happened</h3>
      {b.happened.decisions.length + b.happened.done.length + b.happened.answered.length === 0 ? <p className="brain-hint">Nothing yet.</p> : (
        <ul className="schedule-list">
          {b.happened.done.map((t) => <li key={t.id}>Done: {t.title.replace(/^[^:]+:\s*/, "")}</li>)}
          {b.happened.answered.map((c) => <li key={c.id}>You answered: {c.title} ({c.status})</li>)}
          {b.happened.decisions.slice(0, 8).map((x) => <li key={x.cycle}>{shortDate(x.cycle)}: {x.decision}</li>)}
        </ul>
      )}
    </section>
  );
}

/** The site's AI answers week: cited and named out of its buyer questions, per engine, beside last week. */
function AiAnswers({ ai }: { ai: Ai }) {
  return (
    <div className="brain-card email-map-card" data-testid={`growth-ai-${ai.host}`}>
      <span className="email-map-what">AI answers{ai.state === "read" && ai.day ? `, ${shortDate(ai.day)}` : ""}</span>
      {ai.state !== "read" ? <span className="brain-card-line">Not read: {ai.why}</span> : (
        <>
          <span className="brain-card-line">
            Cited for {ai.cited} of {plural(ai.prompts!, "buyer question")}, named in {ai.mentioned}
            {ai.before ? ` (last week cited ${ai.before.cited}, named ${ai.before.mentioned})` : " · first week read"}
          </span>
          <ul className="schedule-list">
            {(ai.engines ?? []).map((e) => (
              <li key={e.engine}>{ENGINE_LABEL[e.engine] ?? e.engine}: cited {e.cited}, named {e.mentioned} of {e.answered} answered{e.before ? ` (was ${e.before.cited} and ${e.before.mentioned})` : ""}</li>
            ))}
          </ul>
        </>
      )}
      <span className="brain-card-line">ChatGPT, Gemini and Google AI Overviews, read every Tuesday; kept apart from Google search numbers.</span>
    </div>
  );
}
