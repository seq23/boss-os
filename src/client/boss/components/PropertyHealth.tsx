import { api } from "../api";
import { Panel, usePanel } from "./panels";

/**
 * THE HEALTH OF EVERY GRID PROPERTY, ONE CARD EACH, FOUR READERS ON EVERY CARD.
 *
 * Her words, 19 September 2026: "Connect all the GSC and whatever else to measure the health and
 * GitHub and all."
 *
 * ─── Every cell says one of four true things ───────────────────────────────
 *
 *   a reading      what the reader saw, with its age and the thing she can open
 *   BLOCKED        the reader ran and could not read, and the sentence says why (no key, not a
 *                  user on the Search Console property, no project on the account)
 *   CANNOT         the registry says this reader does not apply to this property, and why (a
 *                  YouTube channel has no domain; the wedding domains are not recorded)
 *   NOT READ YET   the reader is wired and has never run, and the line names what runs it
 *
 * A blank cell is the one thing this card may not show: `every-property-has-its-readers.mjs`
 * fails the build if a property × reader pair has neither a code path nor a named reason, and the
 * route fills every pair from the registry before the screen sees it.
 *
 * NO NUMBER WITHOUT ITS SOURCE. Every reading carries `evidence_url` — the site, the Actions
 * page, the Search Console property, the Pages project — rendered as the link on the row.
 */

const READER_LABEL: Record<string, string> = {
  uptime: "Up",
  github: "GitHub",
  gsc: "Search Console",
  cloudflare: "Cloudflare",
};

function age(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function tone(state: string): string {
  switch (state) {
    case "ok": return "state-good";
    case "warn": case "blocked": return "state-bad";
    case "never": return "state-live";
    default: return "state-quiet";
  }
}

function label(state: string): string {
  switch (state) {
    case "ok": return "OK";
    case "warn": return "ATTENTION";
    case "blocked": return "BLOCKED";
    case "never": return "NOT READ YET";
    case "cannot": return "N/A";
    default: return state.toUpperCase();
  }
}

export function PropertyHealth() {
  const health = usePanel(() => api.propertyHealth());
  const data: any = health.data;
  const totals = data?.totals;

  return (
    <Panel
      title="Properties"
      hint="The grid is empty, which cannot be right — src/shared/boss/grid.mjs is the list."
      state={health}
    >
      {totals && (
        <p className="row-sub" style={{ marginBottom: 10 }} data-testid="property-health-totals">
          {totals.properties} properties · {totals.wired} reader cells wired, {totals.read} read so far, {totals.cannot} not applicable by name.
          Uptime and Search Console are read by the Worker on their duties; GitHub and Cloudflare are posted by your Mac's grid watch.
        </p>
      )}
      {(data?.properties ?? []).map((p: any) => (
        <article key={p.key} className="docket" data-testid={`property-health-${p.key}`} style={{ marginBottom: 12 }}>
          <div className="row-title">{p.label}</div>
          <div className="row-sub">
            {[p.owner === "client" ? "client property" : null, p.tier, p.domains.length ? p.domains.join(", ") : "no canonical domain recorded"].filter(Boolean).join(" · ")}
          </div>
          {p.readers.map((r: any) => (
            <div key={r.reader} className="row" style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }} data-reader={r.reader} data-state={r.state}>
              <div className="row-main" style={{ minWidth: 0 }}>
                <div className="row-title" style={{ fontSize: 13 }}>
                  {READER_LABEL[r.reader] ?? r.reader}
                  <span className="pill">{r.runs_on === "worker" ? "worker" : "her mac"}</span>
                </div>
                {r.state === "cannot" && <div className="row-sub">{r.cannot}</div>}
                {r.state === "never" && <div className="row-sub">{r.never_read_hint}</div>}
                {r.readings.map((x: any) => (
                  <div key={x.target} className="row-sub" style={{ overflowWrap: "anywhere" }}>
                    <span className={tone(x.state)}>{label(x.state)}</span>{" "}
                    {x.summary}{" "}
                    <span className="row-val" style={{ whiteSpace: "normal" }}>{age(x.age_ms)}</span>
                    {x.evidence_url && (
                      <>
                        {" · "}
                        <a href={x.evidence_url} target="_blank" rel="noreferrer">open</a>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className={`row-val ${tone(r.state)}`}>{label(r.state)}</div>
            </div>
          ))}
        </article>
      ))}
    </Panel>
  );
}
