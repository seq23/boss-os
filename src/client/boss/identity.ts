/**
 * WHO THESE PEOPLE ACTUALLY ARE — RESOLVED ON HER MACHINE, NEVER IN THE CLOUD.
 *
 * ─── Her words, 9 September 2026 ───────────────────────────────────────────
 *
 *   "the people tab has all these code names i dont know who these people are and it doesnt help
 *    its not useful."
 *
 * Two hundred rows reading PELICAN-71, GANNET-67, REDWING-72, BLACKBIRD-19. And beneath them, the
 * sentence that is the whole bug in one line:
 *
 *   "Only your Mac can say who each one is."
 *
 * The screen documented the locked door instead of opening it.
 *
 * ─── The privacy boundary was read one step too far ────────────────────────
 *
 * The rule is real and it is not weakened by a single character here: counterparty names and
 * addresses do not go into the cloud database. `contacts-sync.mjs` hashes each address to a stable
 * bird, writes the mapping to a file on her Mac, and sends only code names;
 * `POST /relationships/sync` REFUSES any payload containing an `@`. All of that stands, untouched.
 *
 * But that boundary is about WHAT LEAVES HER MACHINE. It was applied to WHAT SHE MAY SEE, and those
 * are not the same question. She is the one person on earth who already knows every one of these
 * identities. A screen that shows her pseudonyms of her own contacts protects nothing; it is simply
 * unreadable, and an unreadable screen is one she stops opening — which costs her the whole
 * instrument.
 *
 * ─── So resolution happens HERE, in the browser on her Mac ─────────────────
 *
 * The map is loaded from the same local file `contacts-sync.mjs` writes, through a file picker, and
 * kept in this browser's own storage. It is the identical split the sync already draws, one layer
 * further out: the Worker learns that SANDPIPER has gone 94 days, her screen says who SANDPIPER is,
 * and nothing carries the second fact between them.
 *
 * WHY NOT A LOCAL HTTP BRIDGE. A page on https://boss.sequoiataylor.com asking a localhost server
 * for the map needs a second process running, a port, a CORS grant and a mixed-content exemption
 * that Safari does not give — four moving parts, each of which fails silently and leaves her back at
 * bird names with no explanation. A file she picks once works in every browser, needs nothing
 * running, and fails visibly.
 *
 * WHY NOT ENCRYPT THE MAP INTO D1. Because then the names are in the cloud database, and the whole
 * argument for that is "but they are encrypted" — which is exactly the reasoning that ends with real
 * identities in a Worker. The names do not go there. That is the rule.
 *
 * ─── The one rule this module must never break ─────────────────────────────
 *
 * NOTHING RESOLVED HERE MAY BE SENT ANYWHERE. There is no fetch in this file, no POST, and
 * `scripts/validate/identity-stays-local.mjs` fails the build if a resolved name reaches an API
 * call. Resolution is a rendering step and nothing else.
 */

const KEY = "boss-os-identity-map";

export interface Identity {
  /** What she calls them. From the display name on their own mail, when there was one. */
  name: string | null;
  /** The address the code name was derived from. Shown small, because it is how she checks a match. */
  email: string;
}

export interface IdentityMap {
  loaded_at: number;
  /** How many code names the file covered, so the screen can say when it covers only some of them. */
  size: number;
  by_code: Record<string, Identity>;
}

/**
 * Read what is stored for this browser.
 *
 * NEVER THROWS. A private window, cleared site data, or a browser configured to refuse storage all
 * produce "no map", which the screen already renders honestly — an exception here would take the
 * People tab down over a convenience.
 */
export function loadIdentityMap(): IdentityMap | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.by_code !== "object") return null;
    return parsed as IdentityMap;
  } catch {
    return null;
  }
}

export function clearIdentityMap(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored is the desired end state anyway */ }
}

/**
 * Accept the file `contacts-sync.mjs` writes and store it for this browser.
 *
 * TWO SHAPES ARE ACCEPTED, on purpose. The original MAP.json is `{ map: { CODE: "a@b.com" } }`;
 * newer runs write `{ map: { CODE: { email, name } } }` so the screen can show a person's name
 * rather than only their address. A map she exported last month must keep working — asking her to
 * re-run a script before her own contacts become legible would be the same defect in a smaller hat.
 */
export function parseIdentityFile(text: string): IdentityMap {
  const parsed = JSON.parse(text);
  const map = parsed?.map ?? parsed;
  if (!map || typeof map !== "object") {
    throw new Error("That file has no `map` in it, so it is not the contacts map.");
  }
  const by_code: Record<string, Identity> = {};
  for (const [code, value] of Object.entries(map)) {
    if (typeof value === "string") by_code[code] = { name: null, email: value };
    else if (value && typeof value === "object") {
      const v = value as { email?: unknown; name?: unknown };
      if (typeof v.email === "string") {
        by_code[code] = { name: typeof v.name === "string" && v.name ? v.name : null, email: v.email };
      }
    }
  }
  const size = Object.keys(by_code).length;
  if (size === 0) {
    /*
     * RULE 0, IN THE BROWSER. Storing an empty map would leave the screen saying "identities loaded"
     * over two hundred bird names, which is worse than saying nothing — she would conclude the
     * feature is broken rather than that the file was wrong.
     */
    throw new Error("That file mapped nobody. Nothing was stored, so the screen is not pretending it can now read names.");
  }
  return { loaded_at: Date.now(), size, by_code };
}

export function storeIdentityMap(map: IdentityMap): void {
  localStorage.setItem(KEY, JSON.stringify(map));
}

/**
 * The name to put on screen for one code name.
 *
 * FALLS BACK TO THE CODE NAME AND SAYS SO. A row the map does not cover renders as the bird it
 * always was, with `resolved: false`, so the screen can distinguish "you have no map" from "your map
 * does not include this person" — which are different problems with different fixes, and the same
 * distinction the rest of this product now insists on everywhere.
 */
export function resolve(map: IdentityMap | null, codeName: string): { label: string; detail: string | null; resolved: boolean } {
  const hit = map?.by_code[codeName];
  if (!hit) return { label: codeName, detail: null, resolved: false };
  return {
    label: hit.name ?? hit.email,
    // The code name stays visible beside the real one: it is the key everything else in the system
    // uses, and hiding it would make a finding that names ROOK impossible to tie to a person.
    detail: hit.name ? `${hit.email} · ${codeName}` : codeName,
    resolved: true,
  };
}
