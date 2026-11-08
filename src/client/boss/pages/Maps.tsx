import type { ReactNode } from "react";
import repos from "@shared/boss/maps/repos.json";
import domains from "@shared/boss/maps/domains.json";
import sites from "@shared/boss/maps/sites.json";
import accounts from "@shared/boss/maps/accounts.json";
import emailMap from "@shared/boss/emailMap/manifest.json";
import schedule from "@shared/boss/schedule/manifest.json";
import scorecard from "@shared/boss/scorecard/manifest.json";
import readiness from "@shared/boss/searchReadiness/sites.json";
import checklist from "@shared/boss/searchReadiness/checklist.json";
import social from "@shared/boss/socialMap/manifest.json";
import { MAP_ORDER, OUTSIDE, linksByRepo, notLinked, scorecardSites, registrable } from "@shared/boss/maps/chain.mjs";

/**
 * THE MAPS (owner, 8 Nov 2026: "do all the maps we maybe missing"; "looking at the first one should be
 * repos then domains then …"). Four pages, one chain: Repos (the front door) → Domains → Sites (with
 * each site's Scorecard and Search Readiness) → Accounts, then on to the Email Map, Social Map and
 * Schedule. Each renders its ONE manifest (src/shared/boss/maps/*.json, never a copy) joined through
 * src/shared/boss/maps/chain.mjs. Logins and mail routes are written masked, her way (8 Nov 2026):
 * st**@time-2-read.com. Nothing is fetched: the page is the manifests.
 *
 * Links in: /?tab=repos[&repo=x], /?tab=domains[&domain=x|&repo=x], /?tab=sites[&site=x|&repo=x|&domain=x],
 * /?tab=accounts[&account=x|&repo=x]. Every row says where it comes from ("← from repo x") and links on.
 */

type Row = Record<string, any>;
const R = repos as any, D = domains as any, S = sites as any, A = accounts as any;
const CTX = { repos: R, domains: D, sites: S, accounts: A, emails: emailMap as any, schedule: schedule as any, scorecard: scorecard as any, readiness: readiness as any, social: social as any };
export const LINKS = linksByRepo(CTX);
export const NOT_LINKED = notLinked(CTX);
export type MapTab = "repos" | "domains" | "sites" | "accounts";

const q = () => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search));
const href = (tab: string, key?: string, value?: string) => `/?tab=${tab}${key && value ? `&${key}=${encodeURIComponent(value)}` : ""}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const repoLabel = (r: string) => (r === OUTSIDE ? "outside any repo" : (R.rows.find((x: Row) => x.repo === r)?.label ?? r));
const bizLabel = (b: string) => R.businesses[b] ?? b;

/** The pinned Search Readiness Checklist page: "Where every site stands", from Monday's audit. */
export const READINESS_PAGE = "https://claude.ai/artifact/NeuuVmH18F9riJqYjVwTEy";
const CHECKS = (checklist as any).items as Row[];
/** How many automatic checks apply to a site of this kind (the Monday audit runs these). */
export const checksFor = (kind: string) => CHECKS.filter((i) => i.check?.mode === "auto" && (!i.check.applies_to || i.check.applies_to.includes(kind))).length;

/** The chain strip: where this map sits in the order she reads them. */
function Chain({ here }: { here: string }) {
  return (
    <nav className="maps-chain" aria-label="The maps, in order">
      {MAP_ORDER.map((m, i) => (
        <span key={m.tab}>
          {i ? <span className="maps-chain-sep"> › </span> : null}
          {m.tab === here ? <span className="maps-chain-here" aria-current="page">{m.label}</span> : <a href={href(m.tab)}>{m.label}</a>}
        </span>
      ))}
    </nav>
  );
}

/** The repo a deep link from the Repos map asked for (?repo=x), on any map page. */
export const repoOnly = (): string | null => q().get("repo");
/** The line the Email Map, Social Map and Schedule show when opened from a repo. */
export function FromRepoLine({ tab }: { tab: string }) {
  const r = repoOnly();
  if (!r) return null;
  return <p className="maps-filtered">Showing only {repoLabel(r)} · <a href={href("repos", "repo", r)}>← Back to Repos</a> · <a href={href(tab)}>Show all ✕</a></p>;
}

/** "Showing only … · Show all ✕" when a deep link filtered the page. */
function Filtered({ tab, words }: { tab: string; words: string | null }) {
  if (!words) return null;
  return <p className="maps-filtered">Showing only {words} · <a href={href(tab)}>Show all ✕</a></p>;
}

function Card({ id, title, sub, children, links }: { id: string; title: ReactNode; sub?: ReactNode; children?: ReactNode; links?: ReactNode }) {
  return (
    <div className="brain-card email-map-card" data-testid={`map-row-${id}`} id={`row-${id}`}>
      <span className="email-map-what">{title}</span>
      {sub ? <span className="brain-card-line">{sub}</span> : null}
      {links ? <span className="maps-links">{links}</span> : null}
      {children ? <details className="brain-rev"><summary>Show details ▾</summary><dl className="email-map-dl">{children}</dl></details> : null}
    </div>
  );
}
const L = ({ to, children }: { to: string; children: ReactNode }) => <a className="maps-link" href={to}>{children}</a>;
const From = ({ repo }: { repo: string }) => (repo === OUTSIDE ? <span className="maps-from">Outside any repo</span> : <L to={href("repos", "repo", repo)}>← from {repoLabel(repo)}</L>);

function Group({ title, count, open, children }: { title: string; count: string; open: boolean; children: ReactNode }) {
  return (
    <details className="brain-expander email-map-business" open={open}>
      <summary><span className="email-map-business-name">{title}</span><span className="email-map-count">{count} — tap to open ▾</span></summary>
      <div className="brain-cards">{children}</div>
    </details>
  );
}

/** "Mon 11 Jan 2027" from "2027-01-11": her dates are plain words. */
export const plainDate = (iso?: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "") : "");

// ─── Repos (the front door) ──────────────────────────────────────────────────────────────────

export function reposSummary(): string {
  const mine = R.rows.filter((r: Row) => r.category === "mine").length;
  return `${R.rows.length} repos: ${mine} for your businesses, ${R.rows.filter((r: Row) => r.category === "friends").length} for friends, ${R.rows.filter((r: Row) => r.category === "system").length} that run the system, ${R.rows.filter((r: Row) => r.category === "parked" || r.category === "retired").length} parked or retired.`;
}

export function ReposMap() {
  const only = q().get("repo");
  const rows = R.rows.filter((r: Row) => !only || r.repo === only);
  const nl = Object.entries(NOT_LINKED).filter(([, v]) => (v as string[]).length);
  return (
    <div className="brains" data-testid="map-repos">
      <Chain here="repos" />
      <p className="brain-summary">{reposSummary()}</p>
      <p className="brain-hint">Start here. Each repo links to its domains, sites, logins, emails, social accounts and timed jobs.</p>
      <Filtered tab="repos" words={only ? repoLabel(only) : null} />
      {Object.entries(R.categories).map(([cat, label]) => {
        const shown = rows.filter((r: Row) => r.category === cat);
        if (!shown.length) return null;
        return (
          <Group key={cat} title={label as string} count={plural(shown.length, "repo", "repos")} open={Boolean(only) || cat === "mine"}>
            {shown.map((r: Row) => <RepoCard key={r.repo} r={r} />)}
          </Group>
        );
      })}
      {nl.length ? <p className="brain-hint">Not linked to a repo yet: {nl.map(([k, v]) => `${(v as string[]).length} ${k === "emails" ? "emails" : k === "schedule" ? "timed jobs" : k === "scorecard" ? "Scorecard rows" : "social accounts"}`).join(", ")}. Each is still on its own map.</p> : null}
    </div>
  );
}

function RepoCard({ r }: { r: Row }) {
  const l = LINKS.get(r.repo);
  const n = (k: string) => (l?.[k as keyof typeof l] as string[] | undefined)?.length ?? 0;
  const rd = l?.readiness ?? [];
  const link = (tab: string, k: string, one: string, many: string, to = href(tab, "repo", r.repo)) => (n(k) ? <L key={k} to={to}>{plural(n(k), one, many)} ›</L> : null);
  return (
    <Card id={r.repo} title={r.label} sub={`${bizLabel(r.business)} · ${r.what}`}
      links={<>
        {link("domains", "domains", "domain", "domains")}
        {link("sites", "sites", "site", "sites")}
        {link("accounts", "accounts", "login", "logins")}
        {link("emails", "emails", "email", "emails")}
        {link("social", "social", "social account", "social accounts")}
        {link("schedule", "schedule", "timed job", "timed jobs")}
        {link("scorecard", "scorecard", "Scorecard row", "Scorecard rows", `/?tab=scorecard&row=${encodeURIComponent(l?.scorecard[0] ?? "")}`)}
        {rd.length ? <L to={href("sites", "repo", r.repo)}>{plural(rd.length, "Search Readiness site", "Search Readiness sites")} ›</L> : null}
      </>}>
      <dt>Repo</dt><dd>{r.repo}</dd>
      <dt>Business</dt><dd>{bizLabel(r.business)}</dd>
    </Card>
  );
}

// ─── Domains ─────────────────────────────────────────────────────────────────────────────────

const lapses = (d: Row) => d.tier === "keep" && d.auto_renew === false && !d.keep_until;
export function domainsSummary(): string {
  const t = (k: string) => D.rows.filter((d: Row) => d.tier === k).length;
  const lapse = D.rows.filter(lapses).length;
  return `${D.rows.length} domains: ${t("keep")} to keep${lapse ? ` (${lapse} set to lapse)` : ""}, ${t("retire")} to retire, ${t("sunset")} to let go at expiry, ${t("her-call")} friends' and ${t("not-decided")} not decided.`;
}

export function DomainsMap() {
  const p = q();
  const only = p.get("domain"), repo = p.get("repo");
  const rows = D.rows.filter((d: Row) => (!only || d.domain === only) && (!repo || d.repo === repo));
  const order = ["keep", "retire", "sunset", "not-decided", "her-call"];
  return (
    <div className="brains" data-testid="map-domains">
      <Chain here="domains" />
      <p className="brain-summary">{domainsSummary()}</p>
      <Filtered tab="domains" words={only ?? (repo ? `the domains of ${repoLabel(repo)}` : null)} />
      {order.map((t) => {
        // A kept domain that is set to lapse is the one thing here that needs her: it sorts first.
        const shown = rows.filter((d: Row) => d.tier === t).sort((a: Row, b: Row) => Number(lapses(b)) - Number(lapses(a)));
        if (!shown.length) return null;
        return (
          <Group key={t} title={D.tiers[t]} count={plural(shown.length, "domain", "domains")} open={Boolean(only || repo) || t === "keep"}>
            {shown.map((d: Row) => <DomainCard key={d.domain} d={d} />)}
          </Group>
        );
      })}
    </div>
  );
}

function renewWords(d: Row): string {
  const when = d.expires ? `expires ${plainDate(d.expires)}` : "expiry not read";
  const ar = d.auto_renew === true ? "auto-renew on" : d.auto_renew === false ? "auto-renew off" : "auto-renew not known yet";
  return `${d.registrar} · ${when} · ${ar}`;
}

function DomainCard({ d }: { d: Row }) {
  const site = S.rows.find((s: Row) => s.id === d.site);
  return (
    <Card id={d.domain} title={d.domain}
      sub={<>{d.tier_why}{lapses(d) ? <span className="maps-lapse"> Kept, but set to lapse{d.expires ? ` on ${plainDate(d.expires)}` : ""}: turn auto-renew on.</span> : null}</>}
      links={<>
        <From repo={d.repo} />
        {site ? <L to={href("sites", "site", site.id)}>{d.redirects_to ? `Forwards to ${d.redirects_to} ›` : `Site: ${site.name} ›`}</L> : null}
        <L to={href("accounts", "account", d.dns === "second" ? "cloudflare-second" : d.dns === "main" ? "cloudflare-main" : registrarAccount(d.registrar))}>DNS: {D.dns[d.dns]} ›</L>
      </>}>
      <dt>Registrar</dt><dd>{renewWords(d)}{d.renew_read ? ` (read ${d.renew_read})` : ""}</dd>
      <dt>Mail</dt><dd>{d.mail_words}</dd>
      {d.mail_to?.length ? <><dt>Mail is forwarded to</dt><dd>{d.mail_to.join(", ")}</dd></> : null}
      <dt>Business</dt><dd>{bizLabel(d.business)}</dd>
      {d.note ? <><dt>Note</dt><dd>{d.note}</dd></> : null}
      {d.stale_copy ? <><dt>Tidy-up</dt><dd>{d.stale_copy}</dd></> : null}
    </Card>
  );
}
const registrarAccount = (reg: string) => ({ Squarespace: "squarespace-domains", Namecheap: "namecheap", GoDaddy: "godaddy" } as Record<string, string>)[reg] ?? "";

// ─── Sites ───────────────────────────────────────────────────────────────────────────────────

export function sitesSummary(): string {
  const live = S.rows.filter((s: Row) => s.status === "live").length;
  return `${S.rows.length} sites and apps: ${live} live, ${S.rows.filter((s: Row) => s.status === "redirect").length} that only forward, ${S.rows.filter((s: Row) => s.status === "parked").length} parked.`;
}

export function SitesMap() {
  const p = q();
  const only = p.get("site"), repo = p.get("repo"), dom = p.get("domain");
  const rows = S.rows.filter((s: Row) => (!only || s.id === only) && (!repo || s.repo === repo) && (!dom || s.domain === dom || (s.aliases ?? []).includes(dom)));
  const filtered = only ? S.rows.find((s: Row) => s.id === only)?.name : repo ? `the sites of ${repoLabel(repo)}` : dom;
  return (
    <div className="brains" data-testid="map-sites">
      <Chain here="sites" />
      <p className="brain-summary">{sitesSummary()}</p>
      <Filtered tab="sites" words={filtered ?? null} />
      {Object.entries(R.businesses).map(([b, label]) => {
        const shown = rows.filter((s: Row) => s.business === b);
        if (!shown.length) return null;
        return (
          <Group key={b} title={label as string} count={plural(shown.length, "site", "sites")} open={Boolean(only || repo || dom)}>
            {shown.map((s: Row) => <SiteCard key={s.id} s={s} />)}
          </Group>
        );
      })}
    </div>
  );
}


function SiteCard({ s }: { s: Row }) {
  const grid = (readiness as any).grid_repos.find((g: Row) => g.domain === s.domain && s.status !== "redirect");
  const cards = (scorecard as any).rows.filter((c: Row) => scorecardSites(c, CTX).some((x: Row) => x.id === s.id));
  const host = new URL(s.url).hostname;
  return (
    <Card id={s.id} title={s.name} sub={`${S.hosts[s.host]} · ${S.statuses[s.status]}`}
      links={<>
        <From repo={s.repo} />
        {s.domain ? <L to={href("domains", "domain", registrable(s.domain) ?? "")}>{registrable(s.domain)} ›</L> : null}
        <a className="maps-link" href={s.url} target="_blank" rel="noreferrer">Open {host} ›</a>
        {cards.length ? <L to={`/?tab=scorecard&row=${encodeURIComponent(cards[0].id)}`}>Scorecard{cards.length > 1 ? ` (${cards.length})` : ""} ›</L> : null}
        {grid ? <a className="maps-link" href={READINESS_PAGE} target="_blank" rel="noreferrer">Search readiness: {checksFor(grid.kind)} checks every Monday ›</a> : null}
      </>}>
      <dt>How it ships</dt><dd>{s.deploy}</dd>
      <dt>Hosted on</dt><dd>{S.hosts[s.host]} ({s.project})</dd>
      {s.aliases?.length ? <><dt>Also answers on</dt><dd>{s.aliases.join(", ")}</dd></> : null}
      {s.no_domain_why ? <><dt>Domain</dt><dd>{s.no_domain_why}</dd></> : null}
      {grid ? <><dt>Search Readiness</dt><dd>{grid.label} · {grid.kind} site{grid.search_loop ? ` · search loop wave ${grid.search_loop.wave}` : ""}{grid.lead_source?.kind ? ` · leads counted by: ${grid.lead_source.kind}` : ""}</dd></> : null}
    </Card>
  );
}

// ─── Accounts ────────────────────────────────────────────────────────────────────────────────

export function accountsSummary(): string {
  const unknown = A.rows.filter((a: Row) => a.owner === "unknown").length;
  const move = A.rows.filter((a: Row) => a.move_to_brand).length;
  return `${A.rows.length} outside logins. ${unknown} still say "not known yet" for who owns them${move ? `; ${move} sit on a personal address and are better on a brand's` : ""}.`;
}

export function AccountsMap() {
  const p = q();
  const only = p.get("account"), repo = p.get("repo");
  const rows = A.rows.filter((a: Row) => (!only || a.id === only) && (!repo || (a.repos ?? []).includes(repo)));
  const filtered = only ? A.rows.find((a: Row) => a.id === only)?.service : repo ? `the logins ${repoLabel(repo)} uses` : null;
  return (
    <div className="brains" data-testid="map-accounts">
      <Chain here="accounts" />
      <p className="brain-summary">{accountsSummary()}</p>
      <p className="brain-hint">Addresses show their first two letters and the domain only. Keys are listed by name, never their values.</p>
      <Filtered tab="accounts" words={filtered ?? null} />
      {Object.entries(R.businesses).map(([b, label]) => {
        const shown = rows.filter((a: Row) => a.business === b);
        if (!shown.length) return null;
        return (
          <Group key={b} title={label as string} count={plural(shown.length, "login", "logins")} open={Boolean(only || repo)}>
            {shown.map((a: Row) => <AccountCard key={a.id} a={a} />)}
          </Group>
        );
      })}
    </div>
  );
}

function AccountCard({ a }: { a: Row }) {
  const owner = A.owners[a.owner] ?? a.owner;
  return (
    <Card id={a.id} title={a.service}
      sub={<>{a.owner === "unknown" ? "Owner: not known yet" : `Owner: ${owner}`}{a.login && a.login !== "not known yet" ? ` (${a.login})` : ""}{a.move_to_brand ? <span className="maps-move"> {a.move_to_brand}</span> : null}</>}
      links={<>{(a.repos ?? []).map((r: string) => <From key={r} repo={r} />)}</>}>
      <dt>What uses it</dt><dd>{a.used_by}</dd>
      <dt>2-step and recovery</dt><dd>{a.security}</dd>
      {a.vault_keys?.length ? <><dt>Vault keys (names only)</dt><dd className="email-map-code">{a.vault_keys.join(", ")}</dd></> : null}
      {a.note ? <><dt>Note</dt><dd>{a.note}</dd></> : null}
      <dt>Business</dt><dd>{bizLabel(a.business)}</dd>
    </Card>
  );
}
