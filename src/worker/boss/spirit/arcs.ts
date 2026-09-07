/**
 * WHAT SHE IS ACTUALLY WORKING ON — §4 and §5, in code.
 *
 * The system knew her pillars, her floors and her laws, and did not know her GOALS. So the Run of
 * Show rendered seven correct block titles with nothing in them, and every screen that could have
 * said "do this, because of that" said neither.
 *
 * IN CODE RATHER THAN IN A TABLE, and the reason is §5.2's: "Do not treat every vehicle as an
 * active project at the same time. Only explicitly named projects are active in execution." These
 * are her standing commitments, not settings — a row anyone can edit is how a second active arc
 * appears without a decision behind it, and §4 opens by saying the system must not foreground too
 * many at once.
 */

export interface Arc {
  key: string;
  title: string;
  /** §4.1 active push, or §4.2 background maintenance. */
  push: boolean;
  pillar: "body" | "spirit" | "wealth" | "execution";
}

/** §4.1: exactly two are in active push, and the count is the point. */
export const ARCS: Arc[] = [
  { key: "brokerage", title: "Wealth execution — brokerage stabilization and compounding", push: true, pillar: "wealth" },
  { key: "keto", title: "Weight loss through strict keto food discipline", push: true, pillar: "body" },
  { key: "manifestation", title: "Manifestation mastery", push: false, pillar: "spirit" },
  { key: "investor_ai", title: "Investor + AI leverage", push: false, pillar: "execution" },
  { key: "identity", title: "A-player identity build", push: false, pillar: "execution" },
];

export interface Vehicle {
  key: string;
  name: string;
  /** §5.3: the protected daily engine, which gets right of first refusal every day. */
  engine?: boolean;
  /** §5.4/§5.5: when this vehicle is legitimately the day's work. */
  when: "daily" | "weekday" | "weekend";
  /** §5.5's build order, for the weekend vehicles. Lower runs first. */
  order?: number;
  note?: string;
}

/**
 * §5.1's five vehicles, with §5.3's protection and §5.5's build order attached.
 *
 * BROKERAGE HAS RIGHT OF FIRST REFUSAL EVERY DAY, in her words. That is not a preference the
 * scheduler weighs against others — it is the rule that decides the first money move unless
 * brokerage is blocked, and §5.3 says what may take its place when it is.
 */
export const VEHICLES: Vehicle[] = [
  {
    key: "brokerage", name: "Late-stage secondaries brokerage", engine: true, when: "daily",
    note: "Right of first refusal, every day. The first money move advances this unless it is blocked.",
  },
  {
    key: "west_peek", name: "West Peek Ventures", when: "weekday",
    note: "A weekday strategic vehicle, not a casual side project. Wednesday is the meeting. It does not displace brokerage unless she says so.",
  },
  { key: "industry_guides", name: "Industry Guides", when: "weekend", order: 1 },
  { key: "a_player_mode", name: "A Player Mode", when: "weekend", order: 2 },
  { key: "saas", name: "SaaS apps", when: "weekend", order: 3 },
];

export const ENGINE = VEHICLES.find((v) => v.engine)!;

/** §5.7, quoted, because it is the definition the Night Gate scores against. */
export const MEANINGFUL_WORK = "At least one concrete asset-advancing action.";

/**
 * Which vehicle the day's second block belongs to.
 *
 * §5.5 IS A BUILD ORDER, NOT A MENU. "Weekday side projects stay background unless strategically
 * justified", so a Tuesday afternoon is West Peek and a Saturday runs Industry Guides first. The
 * order is fixed so the answer never depends on what she feels like, which is the entire point of
 * the system.
 */
export function secondBlockVehicle(weekday: number): Vehicle {
  // 0 = Sunday. Weekends run the build order; weekdays are West Peek.
  const weekend = weekday === 0 || weekday === 6;
  if (!weekend) return VEHICLES.find((v) => v.key === "west_peek")!;
  return VEHICLES.filter((v) => v.when === "weekend").sort((a, b) => (a.order ?? 99) - (b.order ?? 99))[0]!;
}

/** §5.4: Wednesday is the West Peek cadence, and the day should say so rather than her remembering. */
export function isWestPeekDay(weekday: number): boolean {
  return weekday === 3;
}
