/**
 * WHAT SHE ACTUALLY WORKS ON, AS OPPOSED TO WHAT SHE OWNS.
 *
 * `arcs.ts` holds the five §5.1 vehicles — the shape of the portfolio. This holds the PROJECTS: the
 * specific lines inside those vehicles, what each one is for, and the one repeated act that moves
 * it. They are different questions. "Spry Labs" is a vehicle; "the ads business needs leads to sell
 * to service providers" is a project with a next action.
 *
 * The system knew the vehicles and did not know the projects, so the Run of Show could name her
 * lanes and never say what to DO in one. Every table that might have held this was empty:
 * `wealth_tracks` 0 rows, `deals` 0, `relationships` 0, `open_loops` 0.
 *
 * ─── Why this is code and not a table ───────────────────────────────────────
 *
 * Same reason as `arcs.ts`, and it is her rule, not a preference: §5.2 says "Do not treat every
 * vehicle as an active project at the same time. Only explicitly named projects are active in
 * execution." A row anyone can insert is exactly how a fourth active project appears without a
 * decision behind it, and the whole value of this file is the count.
 *
 * ─── Why exactly one active project per lane ────────────────────────────────
 *
 * Her own arithmetic, which is worth seeing before agreeing to it. Four revenue lines and two
 * weekend days means each line is worked about twice a month. That is the honest cost of §5.5
 * keeping side projects off weekdays. The answer is not more parallelism — that is how all four
 * stall — it is that PARKED IS A REAL STATE. A parked line is not dropped and not forgotten; it has
 * no next action until its turn comes, so it costs nothing to hold.
 *
 * ─── No company and no counterparty ever appears here ───────────────────────
 *
 * Her standing rule: "i wont put client names or company names in the OS — i can use code names."
 * These are her own properties, which are public sites she owns. Nothing about a buyer, a seller, an
 * LP or a client is in this file, and nothing about them belongs in it.
 */

export type ProjectLane = "brokerage" | "west_peek" | "spry";

export interface Project {
  key: string;
  name: string;
  lane: ProjectLane;
  /** Which of the four pillars it serves. */
  pillar: "wealth" | "execution";
  /**
   * ACTIVE means it has a next action today. PARKED means it is held, deliberately, with none.
   * MAINTAINED means it runs itself and is READ rather than worked.
   */
  status: "active" | "parked" | "maintained";
  /** What it is for, in her words, so the screen never has to guess the point of it. */
  purpose: string;
  /**
   * The repeated countable act that moves it. Not a to-do — a to-do is done once and then the
   * project has no next action again. "Two counterparty touches" survives being done.
   */
  next_action: string | null;
  /** Public properties only. Absent for the two lanes that carry confidential counterparties. */
  properties?: string[];
}

export const PROJECTS: Project[] = [
  /*
   * THE BROKERAGE IS THE ENGINE AND IT IS GOING BADLY, WHICH ARE RELATED FACTS.
   *
   * Her account: no system at all, taking calls as they come, working on what arrives. No deals
   * closed, not enough top of funnel, deals stalling or falling through. That is not a discipline
   * problem — it is that there is NO SOURCING MOTION. A business running purely on inbound has a
   * funnel fed by nothing, and a referral business decays silently: nobody tells you they stopped
   * thinking of you, the calls just stop, and it feels like the market.
   *
   * So the next action is a touch count, not a deal count. Deals are an outcome and cannot be
   * committed to on a Tuesday morning; touches can.
   */
  {
    key: "brokerage",
    name: "Brokerage — late-stage secondaries",
    lane: "brokerage",
    pillar: "wealth",
    status: "active",
    purpose:
      "Primary income. Right of first refusal on every day's first money move. The problem is top " +
      "of funnel, and the motion that has actually worked is referrals and network — so the daily " +
      "act is reaching people, not waiting for calls.",
    next_action: "Two counterparty touches, from the ranked list.",
  },

  /*
   * WEST PEEK ALREADY HAS THE SOURCING MOTION THE BROKERAGE LACKS. An external agent in Twin
   * surfaces LPs daily. That is the template, and it is also the gap: the output arrives in email
   * and a Sheet and has to be copied by hand into a second Sheet before Wednesday's meeting. The
   * flow works and the handling of it is manual.
   */
  {
    key: "west_peek_raise",
    name: "West Peek Fund I — the raise",
    lane: "west_peek",
    pillar: "wealth",
    status: "active",
    purpose:
      "Fundraising. Family offices and funds buying late-stage secondaries — the same universe the " +
      "brokerage needs, wearing a different hat. Wednesday is the standing meeting.",
    next_action: "Work today's LP list. Wednesday is the meeting.",
  },

  /*
   * SPRY IS MAINTAINED, NOT WORKED, and that correction came from her directly: the repos are
   * hands-off, they self-heal, they release content on their own. An earlier version of this plan
   * gave each Spry line a weekend slot, which assumed she had to do something to them. She does
   * not. That reclaims both weekend days and reduces the real constraint from three lanes to two.
   *
   * What they need is ATTENTION, occasionally — a weekly read, not a daily check. §21.2's Weekly
   * Debrief is the slot that already exists for it.
   */
  {
    key: "ads",
    name: "Industry Guides — ads and lead generation",
    lane: "spry",
    pillar: "wealth",
    status: "maintained",
    purpose: "Leads generated across five verticals, sold to service providers. Closest of the Spry lines to real revenue.",
    next_action: null,
    properties: ["theindustryguides.com", "local guides generator — 5 verticals"],
  },
  {
    key: "saas",
    name: "SaaS apps — partnerships",
    lane: "spry",
    pillar: "execution",
    status: "parked",
    purpose: "Two apps looking for partnership distribution rather than direct sales.",
    next_action: null,
    properties: ["time-2-read.com", "heygetonmylevel.com"],
  },
  {
    key: "digital_products",
    name: "Digital products",
    lane: "spry",
    pillar: "wealth",
    status: "maintained",
    purpose: "Three product sites that sell without attention.",
    next_action: null,
    properties: ["approvalprep.com", "weddingchecklistpdf.com", "billionairehighperformancecoach.com"],
  },
  {
    key: "youtube",
    name: "How We Know — YouTube",
    lane: "spry",
    pillar: "execution",
    status: "maintained",
    purpose: "The channel. Automated loop; not yet revenue.",
    next_action: null,
    properties: ["@howweknowdeep"],
  },

  /*
   * INFRASTRUCTURE IS NOT A PROJECT, and calling it one is how a cost centre quietly competes with
   * revenue lines for slots. The authority network exists to make the others findable; it earns
   * nothing on its own and is never the answer to "what should I work on today".
   */
  {
    key: "authority_network",
    name: "Authority backlink network",
    lane: "spry",
    pillar: "execution",
    status: "maintained",
    purpose: "Plumbing for the properties above. A cost centre, not a line — never a day's work.",
    next_action: null,
  },
];

/** §5.3's engine: the one project with right of first refusal on the first money move, every day. */
export const ENGINE_PROJECT = PROJECTS.find((p) => p.key === "brokerage")!;

export const activeProjects = () => PROJECTS.filter((p) => p.status === "active");

/**
 * The project whose next action belongs in today's first money move.
 *
 * BROKERAGE UNLESS IT IS BLOCKED, which is §5.3 quoted rather than a weighting this function gets
 * to reconsider each morning. The only reason it is a function at all is that "blocked" is a real
 * state and the rule names what may take its place.
 */
export function firstMoneyProject(opts: { brokerageBlocked?: boolean } = {}): Project {
  if (!opts.brokerageBlocked) return ENGINE_PROJECT;
  return PROJECTS.find((p) => p.key === "west_peek_raise") ?? ENGINE_PROJECT;
}
