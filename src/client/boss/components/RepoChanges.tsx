import { api } from "../api";
import { Panel, usePanel } from "./panels";

/**
 * Danielle's repo changes — every `#danielle <repo> <package>` instruction and where it is.
 *
 * READ FROM ROWS. The sentence is composed by the Worker from the `repo_changes` row
 * (`describePhase`), never from a model's account of itself; the PR link and the merge commit are
 * the ones the Mac reported. A change that is waiting on her says so here in the same words the
 * plan email used, so the screen and the inbox cannot disagree.
 */

function tone(phase: string): string {
  switch (phase) {
    case "done": return "state-good";
    case "failed": return "state-bad";
    case "asking": case "previewing": return "state-live";
    default: return "state-quiet";
  }
}

function age(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function RepoChanges() {
  const view = usePanel(() => api.repoChanges());
  const data: any = view.data;
  const items: any[] = data?.items ?? [];
  const now = Date.now();

  return (
    <Panel
      title="Repo changes"
      hint="Nothing yet. Email boss@sequoiataylor.com with #danielle, a grid repo and/or a Drive folder link, and what you want changed — Danielle plans, asks, builds on your reply, and lands on green."
      state={{ data: items.length ? data : null, error: view.error }}
    >
      {data?.lane && (
        <p className="row-sub" style={{ marginBottom: 10 }} data-testid="repo-changes-lane">
          Plan on {data.lane.models.plan} · build on {data.lane.models.build} · land on {data.lane.models.land}, each a fresh run on your Mac, capped at {data.lane.max_turns.plan}/{data.lane.max_turns.build}/{data.lane.max_turns.land} turns. Your reply to the plan email is the approval; the landing needs no second reply.
        </p>
      )}
      {items.map((r) => (
        <article key={r.id} className="docket" data-testid={`repo-change-${r.id}`} data-phase={r.phase} style={{ marginBottom: 12 }}>
          <div className="row" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div className="row-main" style={{ minWidth: 0 }}>
              <div className="row-title">{r.repo ?? "package only"} <span className="pill">{r.id}</span></div>
              <div className="row-sub">{r.sentence} · {age(now - Number(r.updated_at))}</div>
              {r.publish_ready !== null && r.publish_ready !== undefined && (
                <div className="row-sub" data-testid="repo-change-readiness">
                  {Number(r.publish_ready) === 1 ? "Publish-ready." : `NOT publish-ready — ships with ${r.placeholders?.length ?? 0} placeholder${r.placeholders?.length === 1 ? "" : "s"}: ${(r.placeholders ?? []).join("; ")}`}
                  {r.needs_preview && !r.forced ? " Lands only after her second approval of the preview." : ""}
                </div>
              )}
              {r.forced && (
                <div className="row-sub" data-testid="repo-change-forced">
                  <span className="pill state-bad">FORCED TO PRODUCTION</span> by {r.forced_by} — {r.forced_placeholders?.length ?? 0} placeholder{r.forced_placeholders?.length === 1 ? "" : "s"} shipped by her instruction{r.forced_placeholders?.length ? `: ${r.forced_placeholders.join("; ")}` : ""}.
                </div>
              )}
              {r.preview_url && <div className="row-sub" style={{ overflowWrap: "anywhere" }}>Preview: <a href={r.preview_url} target="_blank" rel="noreferrer">{r.preview_url}</a></div>}
              {r.asks?.length > 0 && r.phase === "asking" && (
                <div className="row-sub">Waiting on {r.asks.length} question{r.asks.length === 1 ? "" : "s"} — reply to the plan email.</div>
              )}
              {r.pr_url && (
                <div className="row-sub" style={{ overflowWrap: "anywhere" }}>
                  <a href={r.pr_url} target="_blank" rel="noreferrer">{r.pr_url}</a>
                  {r.checks_state ? ` · checks ${r.checks_state}` : ""}
                  {r.merge_sha ? ` · merged ${String(r.merge_sha).slice(0, 10)}` : ""}
                </div>
              )}
              {r.failure && <div className="row-sub state-bad">{r.failure}</div>}
              {r.claim_live && <div className="row-sub">Running on {r.claimed_by} ({r.claimed_phase}).</div>}
            </div>
            <div className={`row-val ${tone(r.phase)}`}>{String(r.phase).toUpperCase()}</div>
          </div>
        </article>
      ))}
    </Panel>
  );
}
