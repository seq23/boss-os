/**
 * THE TOUCH LIST, DERIVED — because asking her to type it was the wrong answer.
 *
 * The first version of the wealth contract opened with "name five people who have ever sent you a
 * deal". Her verdict: "relationship list is stupid. u should be able to peruse the email and find
 * out what u need to know."
 *
 * She is right, and the reason is not effort. A list she types is a list of who she REMEMBERS, and
 * the entire failure this instrument exists to catch is that a referral business decays silently —
 * the people who have gone quiet are exactly the ones that fall out of memory first. Asking the
 * person with the blind spot to enumerate the blind spot produces a list with the answer missing.
 *
 * The mailbox has no such blind spot. Eighteen months of who she actually corresponds with, how
 * often, and when it stopped.
 *
 * ─── Code names are generated, not chosen ───────────────────────────────────
 *
 * Her standing rule keeps counterparty names out of the OS. So each address gets a stable code name
 * derived from a hash — SANDPIPER, HERON — and THE MAPPING NEVER LEAVES THIS MACHINE. It is written
 * to a local file beside the extraction. Boss OS learns that SANDPIPER has gone 94 days; only her
 * laptop can say who that is.
 *
 * Deterministic on purpose: the same address is always the same bird, so a code name means the same
 * person next week, and re-running this does not shuffle her whole list.
 *
 * ─── Cadence is observed, not asked for ────────────────────────────────────
 *
 * The earlier design asked her to assign 30/60/90 days per person. That is another judgement she
 * would have to invent from memory. Someone she has exchanged mail with fortnightly for a year has
 * a cadence of about a fortnight — it is in the record, so it is measured rather than guessed, and
 * a person who is overdue is overdue against their OWN rhythm rather than an arbitrary default.
 *
 * ─── What it will not do ────────────────────────────────────────────────────
 *
 * It does not decide who matters. Everyone it finds lands as an ordinary active relationship, and
 * the ranking is by observable volume and recency. Whether a name is worth a phone call is her
 * judgement, and a system that quietly promoted a chatty vendor above a quiet referral source would
 * be worse than the empty list it replaces.
 */

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const IN_DIR = process.env.BOSS_OS_SOURCING_WORKSPACE ?? `${process.env.HOME}/.boss-os/sourcing`;
const MAP_DIR = process.env.BOSS_OS_CONTACTS_DIR ?? `${process.env.HOME}/.boss-os/contacts`;
const COMMIT = process.argv.includes("--commit");
const MIN_EXCHANGES = Number(process.env.CONTACTS_MIN_EXCHANGES ?? 3);

/**
 * The code-name vocabulary. Birds, because they are short, distinct out loud, and impossible to
 * mistake for a company. Two hundred is far more than she has counterparties, so collisions are
 * rare; when one happens the address suffix disambiguates rather than two people sharing a name.
 */
const BIRDS = (
  "SANDPIPER HERON KESTREL OSPREY MERLIN PLOVER CURLEW GANNET PUFFIN SKUA AVOCET BITTERN GODWIT " +
  "DUNLIN REDSHANK GREENSHANK TURNSTONE WHIMBREL OYSTERCATCHER LAPWING SNIPE WOODCOCK RAZORBILL " +
  "GUILLEMOT KITTIWAKE FULMAR SHEARWATER PETREL CORMORANT SHAG EIDER SCAUP POCHARD WIGEON TEAL " +
  "PINTAIL SHOVELER GADWALL GOLDENEYE SMEW GOOSANDER MERGANSER HARRIER BUZZARD GOSHAWK SPARROWHAWK " +
  "HOBBY PEREGRINE KITE FALCON EAGLE OWL NIGHTJAR SWIFT KINGFISHER HOOPOE WRYNECK WOODPECKER " +
  "SKYLARK SWALLOW MARTIN PIPIT WAGTAIL WAXWING DIPPER WREN DUNNOCK ROBIN NIGHTINGALE REDSTART " +
  "WHINCHAT STONECHAT WHEATEAR BLACKBIRD FIELDFARE SONGTHRUSH REDWING MISTLETHRUSH BLACKCAP " +
  "WHITETHROAT CHIFFCHAFF WILLOWWARBLER GOLDCREST FIRECREST FLYCATCHER TITMOUSE NUTHATCH TREECREEPER " +
  "SHRIKE JAY MAGPIE CHOUGH JACKDAW ROOK RAVEN STARLING SPARROW CHAFFINCH BRAMBLING GREENFINCH " +
  "GOLDFINCH SISKIN LINNET TWITE REDPOLL CROSSBILL BULLFINCH HAWFINCH YELLOWHAMMER BUNTING CORNCRAKE " +
  "MOORHEN COOT CRANE BUSTARD STILT PHALAROPE TERN NODDY ALBATROSS FRIGATEBIRD PELICAN BOOBY " +
  "ANHINGA IBIS SPOONBILL STORK FLAMINGO GREBE LOON DIVER"
).split(/\s+/).filter(Boolean);

async function codeName(email) {
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256").update(email.toLowerCase()).digest();
  return BIRDS[h.readUInt32BE(0) % BIRDS.length];
}

/**
 * A collision suffix that reveals nothing.
 *
 * THE FIRST VERSION LEAKED THE ADDRESS. It appended the first three characters of the local part —
 * producing `TERN-V.G` — which puts a fragment of the real address into the very field that exists
 * so the real address is never stored. The endpoint's guard rejected the batch for containing a
 * dot, which is the only reason it did not ship.
 *
 * A second slice of the same hash disambiguates just as well and says nothing about anybody.
 */
async function suffix(email) {
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256").update(email.toLowerCase()).digest();
  return String(h.readUInt16BE(4) % 100).padStart(2, "0");
}

/**
 * How often these two actually talk, in days.
 *
 * OBSERVED, WITH A FLOOR AND A CEILING. Fewer than 14 days would put a daily correspondent on the
 * overdue list constantly, which is noise; more than 120 means a relationship can decay for four
 * months before anything says so, which is the failure being prevented. Between those, it is simply
 * the average gap between exchanges.
 */
function observedCadence(c) {
  const exchanges = c.sent + c.received;
  const first = Date.parse(c.first_at);
  const last = Date.parse(c.last_at);
  const spanDays = Math.max(1, (last - first) / 86_400_000);
  const avgGap = spanDays / Math.max(1, exchanges - 1);
  return Math.round(Math.min(120, Math.max(14, avgGap * 1.5)));
}

/**
 * How much this looks like a relationship rather than a mailing list, 0–100.
 *
 * TWO-WAYNESS IS THE STRONGEST SIGNAL and it is weighted hardest: anyone can email her, and the ones
 * she writes back to are the ones that are real. Volume matters and saturates, because forty emails
 * is not four times the relationship of ten.
 */
function importance(c) {
  const exchanges = c.sent + c.received;
  const twoWay = c.sent > 0 && c.received > 0 ? 40 : 0;
  const balance = c.sent > 0 && c.received > 0
    ? 20 * (1 - Math.abs(c.sent - c.received) / exchanges)
    : 0;
  const volume = Math.min(30, Math.round(Math.log2(exchanges + 1) * 8));
  return Math.min(100, twoWay + Math.round(balance) + volume + 10);
}

async function main() {
  const { readFile, mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  let extract;
  try {
    extract = JSON.parse(await readFile(join(IN_DIR, "CONTACTS.json"), "utf8"));
  } catch {
    console.error(`No CONTACTS.json in ${IN_DIR}. Run: npm run contacts:extract`);
    process.exitCode = 1;
    return;
  }

  /*
   * TWO-WAY IS THE TEST FOR A TOUCH LIST, and it is what turns 382 rows into a book she can work.
   *
   * Anyone can email her; the ones she wrote BACK to are the ones with something to resume. A seller
   * who has only ever blasted offers at her is a real counterparty and belongs in the extraction —
   * but reaching out to them is a cold email, not a touch, and putting them here would bury the
   * people this instrument exists to surface.
   *
   * One-way contacts stay in CONTACTS.json on her machine, where the holdings lookup can still find
   * them. Nothing is discarded; it is just not on this particular list.
   */
  const candidates = (extract.contacts ?? []).filter(
    (c) => c.sent + c.received >= MIN_EXCHANGES && c.sent > 0 && c.received > 0,
  );
  const map = {};
  const rows = [];
  for (const c of candidates) {
    const name = await codeName(c.email);
    // A collision keeps both people distinct rather than merging two relationships into one.
    const key = map[name] && map[name] !== c.email ? `${name}-${await suffix(c.email)}` : name;
    map[key] = c.email;
    rows.push({
      code_name: key,
      cadence_days: observedCadence(c),
      strategic_importance: importance(c),
      last_contact_at: Date.parse(c.last_at),
      exchanges: c.sent + c.received,
      two_way: c.sent > 0 && c.received > 0,
      days_since: c.days_since_last,
      days_since_she_wrote: c.days_since_she_wrote,
    });
  }

  rows.sort((a, b) => b.strategic_importance - a.strategic_importance);

  await mkdir(MAP_DIR, { recursive: true });
  await writeFile(join(MAP_DIR, "MAP.json"), JSON.stringify({
    computed_at: new Date().toISOString(),
    note: "Code name to real address. THIS FILE NEVER LEAVES THIS MACHINE — Boss OS stores only the code names.",
    map,
  }, null, 2));

  console.log(`${rows.length} contacts with ${MIN_EXCHANGES}+ exchanges (of ${extract.contacts?.length ?? 0} found)`);
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.code_name.padEnd(16)} imp ${String(r.strategic_importance).padStart(3)} · every ~${r.cadence_days}d · ` +
      `${r.exchanges} exchanges · last ${r.days_since}d ago${r.two_way ? " · two-way" : ""}`);
  }
  console.log(`\nMapping written to ${join(MAP_DIR, "MAP.json")} (stays local).`);

  if (!COMMIT) {
    console.log("DRY RUN. Nothing sent to Boss OS. Re-run with --commit to populate the touch list.");
    return;
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/relationships/sync`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ contacts: rows }),
  });
  if (!res.ok) throw new Error(`sync failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  console.log(`Synced: ${out.data?.created ?? 0} created, ${out.data?.updated ?? 0} updated.`);
}

main().catch((err) => {
  console.error(`contacts sync failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
