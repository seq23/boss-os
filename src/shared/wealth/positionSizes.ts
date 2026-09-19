/**
 * Her position sizes, read the way she types them.
 *
 * ─── The defect this replaces, confirmed 19 September 2026 ─────────────────
 *
 *   "I cannot even input my position sizes; it doesn't record."
 *
 * The field on the Capital desk took ONE bare number in millions and ran `Number()` over it. She
 * works several positions at once and typed them the way anyone would — "$5M, 12M and 40M" — and
 * `Number("$5M, 12M and 40M")` is NaN. The only thing that happened was an error notice rendered at
 * the TOP of a page whose field sits ~3,000px further down (measured at phone width: the alert's
 * box was at y = −2980 with the input at y = 627). From where she was looking the press did
 * nothing. No request left the browser; production's `settings` table holds no position key and
 * the audit log holds no setting write for the day.
 *
 * So the parser lives here, shared by the field and the route, and accepts what she writes:
 *
 *   5            → $5,000,000       (a bare figure under 1,000 is millions — the field's own unit)
 *   5M / $5m     → $5,000,000
 *   500k / 500K  → $500,000
 *   1.2B         → $1,200,000,000
 *   5,000,000    → $5,000,000       (a bare figure of 1,000 or more is dollars)
 *   "5M, 12M and 40M" / "5 12 40" / "5M; 12M" → three positions
 *
 * Anything it cannot read is returned as a NAMED rejection carrying the offending token, so the
 * field can print it beside the input rather than somewhere else on the page.
 */

export interface ParsedSizes {
  ok: true;
  /** Every position, in whole dollars, largest first, duplicates removed. */
  positions_usd: number[];
}

export interface RejectedSizes {
  ok: false;
  /** The piece of what she typed that could not be read. */
  offending: string;
  message: string;
  hint: string;
}

const HINT = "Write each position in dollars with a unit — 5M, 500k, 1.2B — or a bare figure in millions (5 means $5M). Separate several with commas.";

const UNIT = { k: 1_000, m: 1_000_000, b: 1_000_000_000 } as const;

export function parsePositionSizes(input: string): ParsedSizes | RejectedSizes {
  const text = String(input ?? "").trim();
  if (!text) {
    return { ok: false, offending: "", message: "No size was typed.", hint: HINT };
  }

  /*
   * Split on the separators people actually use between figures: commas, semicolons, slashes,
   * newlines, the word "and", and plain runs of space between two figures. Commas INSIDE a figure
   * ("5,000,000") are thousands separators, so a comma only splits when what follows is not a
   * three-digit group.
   */
  const pieces = text
    .replace(/\band\b/gi, " ")
    .replace(/,(?!\d{3}\b)/g, " ")
    .split(/[;\/\n]+|\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: number[] = [];
  for (const piece of pieces) {
    const m = /^\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)\s*(k|m|mm|b|bn|million|thousand|billion)?$/i.exec(piece);
    if (!m) {
      return {
        ok: false,
        offending: piece,
        message: `"${piece}" is not a size.`,
        hint: HINT,
      };
    }
    const figure = Number((m[1] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(figure) || figure <= 0) {
      return { ok: false, offending: piece, message: `"${piece}" is not a size above zero.`, hint: HINT };
    }
    const unitWord = (m[2] ?? "").toLowerCase();
    let dollars: number;
    if (unitWord) {
      const key: keyof typeof UNIT = unitWord.startsWith("b") ? "b" : unitWord.startsWith("m") ? "m" : "k";
      dollars = figure * UNIT[key];
    } else if (figure >= 1_000) {
      dollars = figure;
    } else {
      dollars = figure * UNIT.m;
    }
    out.push(Math.round(dollars));
  }

  const unique = [...new Set(out)].sort((a, b) => b - a);
  return { ok: true, positions_usd: unique };
}

/** "$5M", "$500k", "$1.2B" — the shape the screen and the letter print. */
export function moneyShort(usd: number): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
  if (usd >= 1_000_000_000) return `$${fmt(usd / 1_000_000_000)}B`;
  if (usd >= 1_000_000) return `$${fmt(usd / 1_000_000)}M`;
  if (usd >= 1_000) return `$${fmt(usd / 1_000)}k`;
  return `$${usd}`;
}

/** "$5M, $12M and $40M" — a list the way a sentence says it. */
export function listSizes(positions: number[]): string {
  const parts = positions.map(moneyShort);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The setting keys. The singular one is kept for the ranking and always equals the largest. */
export const WORKING_POSITION_KEY = "brokerage_working_position_usd";
export const WORKING_POSITIONS_KEY = "brokerage_working_positions_usd";

/** Read the stored list back; a missing or malformed value is an empty list, never a throw. */
export function readStoredPositions(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
  } catch {
    return [];
  }
}
