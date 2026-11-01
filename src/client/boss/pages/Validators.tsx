import { useEffect, useState } from "react";
import { api } from "../api";
import { Loading } from "../components/Shell";
import { KIND_WORDS, KINDS, matrixSummary, runsWords, type Kind, type Matrix, type MatrixRow } from "@shared/boss/validators/matrix.mjs";

/**
 * THE VALIDATOR MATRIX (owner, 1 Nov 2026: "every validator × repo, the behaviour it protects, why,
 * kind, when it runs; duplicates visible"). ☰ More → Validators, /?tab=validators.
 *
 * Rendered from the one snapshot her Mac posts on Sunday evenings (GET /api/boss/validators; the
 * checks are src/shared/boss/validators/matrix.mjs). Phone first (390px), calm: line 1 is one count,
 * then two pull-downs, then one folded block per repo with a card per validator (what it protects,
 * "Why: …", kind and when it runs). Anything to tidy is yellow, never red: it is the team's, and the
 * Monday line already says it. Not read yet is said, never shown as all clear.
 */
const when = (at?: number) => (at ? new Date(at).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function Validators() {
  const [m, setM] = useState<Matrix | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [repo, setRepo] = useState("all");
  const [kind, setKind] = useState<"all" | Kind>("all");
  useEffect(() => { api.validators().then((d) => setM(d.matrix)).catch(() => { setFailed(true); setM(null); }); }, []);

  if (m === undefined) return <Loading />;
  if (!m) {
    return (
      <div className="brains" data-testid="validators">
        <p className="brain-summary">{failed ? "The validator list did not load. Try again in a minute." : "The validator list has not been read yet."}</p>
        <p className="brain-hint">Your Mac reads every repo's validators on Sunday evening and sends them here.</p>
      </div>
    );
  }

  const rows = m.rows.filter((r) => (repo === "all" || r.repo === repo) && (kind === "all" || r.kind === kind));
  const repos = repo === "all" ? m.repos : [repo];
  const tidy = m.unlisted.length + m.unmatrixed.length;
  return (
    <div className="brains" data-testid="validators">
      <p className="brain-summary" data-testid="validators-summary">{matrixSummary(m)}</p>
      <p className="brain-hint">Each check that guards a repo: what it protects, why it exists, and when it runs.{when(m.at) ? ` Read from your Mac ${when(m.at)}.` : ""}</p>

      <label className="email-map-filter">Repo
        <select value={repo} onChange={(e) => setRepo(e.target.value)} data-testid="validators-repo">
          <option value="all">All repos</option>
          {m.repos.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label className="email-map-filter">Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as "all" | Kind)} data-testid="validators-kind">
          <option value="all">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
        </select>
      </label>

      {tidy > 0 && (
        <details className="brain-expander" data-testid="validators-tidy">
          <summary><span className="email-map-business-name">To tidy</span><span className="email-map-count">{plural(tidy, "validator")} listed in one place but not the other — tap to open ▾</span></summary>
          <ul className="schedule-list">
            {m.unlisted.map((u, i) => <li key={`u${i}`}><span className="brain-gap">{u.repo}: {u.name}</span> is in this list but not in its repo's own list.</li>)}
            {m.unmatrixed.map((u, i) => <li key={`x${i}`}><span className="brain-gap">{u.repo}: {u.name}</span> is in its repo but not in this list.</li>)}
          </ul>
        </details>
      )}

      {repos.map((r) => {
        const mine = rows.filter((x) => x.repo === r);
        if (!mine.length) return null;
        const safety = mine.filter((x) => x.kind === "safety").length;
        return (
          <details key={r} className="brain-expander email-map-business" data-testid={`validators-repo-${r}`} open={repo !== "all"}>
            <summary>
              <span className="email-map-business-name">{r}</span>
              <span className="email-map-count">{plural(mine.length, "validator")} · {safety} safety — tap to open ▾</span>
            </summary>
            <div className="brain-cards">{mine.map((v) => <Card key={v.name} v={v} />)}</div>
          </details>
        );
      })}
      {!rows.length && <p className="brain-hint">No validator matches these choices.</p>}

      {m.duplicates.length > 0 && (
        <details className="brain-expander" data-testid="validators-shared">
          <summary><span className="email-map-business-name">The same check in several repos</span><span className="email-map-count">{m.duplicates.length} — candidates for one shared check ▾</span></summary>
          <ul className="schedule-list">{m.duplicates.map((d) => <li key={d.key}>{d.key}: {d.repos.join(", ")}</li>)}</ul>
        </details>
      )}
      {m.not_imported.length > 0 && (
        <details className="brain-expander" data-testid="validators-not-imported">
          <summary><span className="email-map-business-name">Not in this list yet</span><span className="email-map-count">{plural(m.not_imported.length, "repo")} with validators — tap to open ▾</span></summary>
          <p className="brain-hint">Each joins the list when its clean-up writes down what its checks protect.</p>
          <ul className="schedule-list">{m.not_imported.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
      {m.problems.length > 0 && <p className="brain-hint" data-testid="validators-problems">Not everything could be read: {m.problems.slice(0, 3).join("; ")}.</p>}
    </div>
  );
}

function Card({ v }: { v: MatrixRow }) {
  return (
    <div className="brain-card email-map-card" data-testid="validator-card">
      <span className="email-map-what">{v.name}</span>
      <span className="brain-card-line">{v.protects}</span>
      {v.why ? <span className="brain-card-line">Why: {v.why}</span> : null}
      <span className="email-map-runs">{KIND_WORDS[v.kind]} · {runsWords(v.runs)}{v.also?.length ? ` · also in ${v.also.join(", ")}` : ""}</span>
      {v.listed === false ? <span className="brain-card-line"><span className="brain-gap">Not in its repo's own list yet</span></span> : null}
    </div>
  );
}
