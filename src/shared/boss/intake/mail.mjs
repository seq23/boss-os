/**
 * BOSS OS'S OWN INBOX. `boss@sequoiataylor.com`, and nothing to do with West Peek.
 *
 * Owner, 10 September 2026: "why are u sharing anything with west peek's os? why? this is a separate
 * repo and domain." Then, on how to build it: "u can copy the code thats fine."
 *
 * So this file is a COPY of the ideas in `src/shared/intake/emailTriggers.ts` and never an import of
 * them. The MIME decoding, the forwarded-origin parsing and the sender-is-the-authorisation rule are
 * all worth keeping and are kept. The ROUTING TABLE is not shared, and that is the whole point: a
 * shared table is two businesses' mail deciding each other's fate, and a change to West Peek's tags
 * would silently move hers. Two copies that diverge is the correct outcome here — these are two
 * companies, not two features.
 *
 * ─── WHAT A TAG IS, AND WHAT IT IS NOT ─────────────────────────────────────
 *
 * `#monique` NAMES AN EMPLOYEE. IT DOES NOT GRANT ANYTHING. A hashtag is a public word — anyone who
 * learns it can type it — so it may route and must never authorise. Authorisation is the VERIFIED
 * SENDER and only the verified sender: her own addresses, checked against the message's DMARC
 * result, in `src/worker/boss/intake/inboundMail.ts`. Mail from anybody else is recorded and
 * refused, whatever tag it carries.
 *
 * That rule is the reason the tag list can be published, put on a business card, or guessed.
 *
 * ─── THE TAGS ARE THE ROSTER, NOT A LIST BESIDE IT ─────────────────────────
 *
 * There is no table of tags in this file, deliberately. `#firstname` is DERIVED from the `employees`
 * table in D1 at the moment mail arrives, so hiring somebody gives them a working address with no
 * code change and retiring somebody takes theirs away in the same breath.
 *
 * This repo's most-named defect is "two components each keeping their own list with no link" — it
 * has produced a duty runner that never queued, an approval gate that could not see its own
 * approvals, and a nudge cadence invented out of two emails. A hardcoded `#monique` would be exactly
 * that defect with a friendly face: the day she renames a seat, mail addressed to it would route to
 * a person who no longer holds the work, and nothing would say so.
 */

/**
 * The mailbox itself, named once.
 *
 * ON THE APEX OF sequoiataylor.com, AND THAT IS SAFE HERE. Cloudflare Email Routing installs its own
 * MX at the zone apex, so enabling it on a domain that already receives mail takes that mail away.
 * Checked against the live zone on 10 Sep 2026 rather than assumed: `sequoiataylor.com` has NO apex
 * MX record at all — only `send.sequoiataylor.com`, which is Resend's bounce path and is a different
 * name that Email Routing does not touch. Nothing is currently delivered to this domain, so nothing
 * can be lost.
 */
export const BOSS_INTAKE_MAILBOX = "boss@sequoiataylor.com";

/** Everything Boss OS answers for. Mail to any other domain is not this system's business. */
export const BOSS_INTAKE_DOMAIN = "sequoiataylor.com";

/**
 * Addresses that may give this system instructions.
 *
 * THIS IS THE AUTHORISATION. Not the tag, not the mailbox, not the subject line. The same three
 * addresses `boss/routes/packets.ts` already treats as hers, kept as a copy for the same reason the
 * routing table is a copy: an intake that reads its allowlist out of another feature's module
 * inherits that feature's next change.
 *
 * `staylor@spry.vc` is on it because she reads and forwards from her Rainmaker mailbox and it is
 * genuinely her. Being ALLOWED TO SEND HERE is not the same as this system being allowed to send
 * FROM there, which it never may — see `validate:no-spry-sender`.
 *
 * HER WEST PEEK ADDRESS IS DELIBERATELY NOT ON IT, and this was a change of mind rather than an
 * oversight. `sequoia@westpeek.ventures` is on the equivalent list in `boss/routes/packets.ts` and
 * copying it here felt obviously right — until `validate:boss-intake-is-boss-only` named it on its
 * first run. The guard is correct and the instinct was wrong: Boss OS is her personal system, West
 * Peek is a fund, and putting the fund's address on the list of things that can instruct her
 * personal employees is the exact blend she has now corrected three times. It also costs nothing —
 * she has two other addresses here, and adding a third is one line she can ask for.
 */
export const BOSS_INTAKE_SENDERS = [
  "seq.taylor@gmail.com",
  "staylor@spry.vc",
];

/** The seat that takes mail nobody could place. Resolved from D1 by this role, never by name. */
export const BOSS_DEFAULT_ROUTE_ROLE = "Chief of Staff";

/** One active employee, as this module needs them. */
/**
 * The tag that reaches a seat, derived from the seat's own name.
 *
 * ONE FUNCTION, so the tag a reply advertises and the tag the router matches can never be two
 * different rules. Lower-cased and stripped of everything that is not a letter or a digit: a mail
 * client will happily turn `#Monique` into `#Monique's` or wrap it in punctuation, and a router that
 * only matched the exact spelling would drop mail that plainly said who it was for.
 */
export function seatTag(name) {
  return `#${String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

/** Every `#word` in the text, lower-cased, in the order they appear, without duplicates. */
export function hashtagsIn(text) {
  const found = String(text ?? "").toLowerCase().match(/#[a-z0-9][a-z0-9_-]*/g) ?? [];
  return [...new Set(found.map((t) => `#${t.slice(1).replace(/[^a-z0-9]+/g, "")}`))].filter((t) => t.length > 1);
}

/**
 * Which employee this message is for.
 *
 * NEVER RETURNS "NOBODY". Owner's rule, carried from the mailbox that came before this one: an inbox
 * that loses mail without saying so is worse than one that does not exist. So every branch here ends
 * on a real seat, and the branch that could not read a tag says as much in the reply rather than
 * quietly picking one and hoping.
 *
 * The DEFAULT is the Chief of Staff, resolved by role out of the same D1 rows as everything else.
 * That is the seat whose charter already is "read what comes in and decide what the Boss actually
 * needs to see" — so an unrouted message is not a fallback, it is her actual job.
 */
export function routeToSeat(text, roster) {
  const active = roster.filter((s) => s && s.id && s.name);
  if (active.length === 0) return null;

  const fallback =
    active.find((s) => String(s.role ?? "").toLowerCase() === BOSS_DEFAULT_ROUTE_ROLE.toLowerCase())
    ?? active[0];

  const typed = hashtagsIn(text);
  const byTag = new Map();
  for (const s of active) {
    const t = seatTag(s.name);
    if (!byTag.has(t)) byTag.set(t, []);
    byTag.get(t).push(s);
  }

  const unknownTags = typed.filter((t) => !byTag.has(t));

  for (const t of typed) {
    const hit = byTag.get(t);
    if (!hit) continue;
    /*
     * TWO SEATS, ONE FIRST NAME. Not a hypothetical — the roster is first names by design, and the
     * ninth hire could be a second Simone. Guessing would send her instruction to the wrong desk and
     * look exactly like it worked, so this asks instead. It is the one case where the mail does not
     * get worked on arrival, and it is still not dropped: the Chief of Staff holds it and the reply
     * names both candidates.
     */
    if (hit.length > 1) {
      return {
        outcome: "AMBIGUOUS", seat: fallback, tag: t, unknownTags, candidates: hit,
        why: `${t} matches ${hit.length} active employees (${hit.map((s) => `${s.name}, ${s.role}`).join("; ")}). `
          + `${fallback.name} is holding it until you say which.`,
      };
    }
    return {
      outcome: "ROUTED", seat: hit[0], tag: t, unknownTags, candidates: hit,
      why: `${t} is ${hit[0].name}, ${hit[0].role}.`,
    };
  }

  return {
    outcome: "DEFAULTED", seat: fallback, tag: null, unknownTags, candidates: [],
    why: unknownTags.length
      ? `No employee answers to ${unknownTags.join(" or ")}, so ${fallback.name} (${fallback.role}) has it.`
      : `No employee tag was in the message, so ${fallback.name} (${fallback.role}) has it.`,
  };
}

/**
 * What to write back, so she is never guessing where her own mail went.
 *
 * ALWAYS SENT, including on the happy path. A reply only on failure trains her to read silence as
 * success, and silence is also what a broken handler produces — the two become indistinguishable at
 * the exact moment she needs them not to be.
 */
export function replyBody(route, roster, subject) {
  const tags = [...roster].sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => `  ${seatTag(s.name).padEnd(12)} ${s.name} — ${s.role}`);
  const head = route.outcome === "ROUTED"
    ? [`${route.seat.name} has it.`, "", route.why]
    : route.outcome === "AMBIGUOUS"
      ? ["I did not route this, because I could not tell which of them you meant.", "", route.why]
      : ["I could not tell who this was for, so it went to the desk that sorts things.", "", route.why];

  return [
    ...head,
    ...(route.unknownTags.length && route.outcome !== "DEFAULTED"
      ? ["", `Also unrecognised: ${route.unknownTags.join(", ")}.`] : []),
    "",
    `Subject: ${subject || "(none)"}`,
    "",
    "Anyone here answers to their first name with a # in front of it:",
    "",
    ...tags,
    "",
    "The tag only says who. It never grants anything — this mailbox works because it knows your",
    "address, so a tag nobody recognises costs you a reply and never a mistake.",
    "",
    "— Boss OS",
  ].join("\n");
}

/**
 * An RFC 2047 encoded-word header, decoded. COPIED from West Peek's handler, which learned it the
 * expensive way: the first real message arrived with an em dash in the subject, the client encoded
 * the whole header, `#` became `=23`, and the tag survived only because the body repeated it.
 * Anybody putting `#monique` in the subject alone — the natural place — would be silently ignored
 * the moment their subject contained a dash, a curly quote or an accented name.
 */
export function decodeMimeHeader(value) {
  if (!value.includes("=?")) return value;
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (whole, _charset, enc, text) => {
      try {
        if (enc.toUpperCase() === "B") {
          const bin = atob(text);
          return new TextDecoder("utf-8").decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
        }
        const withSpaces = text.replace(/_/g, " ");
        const bytes = [];
        for (let i = 0; i < withSpaces.length; i += 1) {
          if (withSpaces[i] === "=" && i + 2 < withSpaces.length) {
            const hex = withSpaces.slice(i + 1, i + 3);
            if (/^[0-9a-fA-F]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; continue; }
          }
          bytes.push(withSpaces.charCodeAt(i));
        }
        return new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
      } catch { return whole; }
    });
}

/** The bare address out of a `From:` header, which may be `Name <a@b.c>` or just `a@b.c`. */
export function extractAddress(header) {
  if (!header) return null;
  const angled = /<([^>]+)>/.exec(header);
  const candidate = (angled ? angled[1] : header).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * A subject with the tags and every stacked forwarding prefix removed, so the title of the work she
 * sees reads like a subject and not like a mail client's audit trail.
 */
export function strippedSubject(subject) {
  let out = String(subject ?? "").replace(/#[a-z0-9][a-z0-9_-]*/gi, "").trim();
  for (let i = 0; i < 6; i += 1) {
    const next = out.replace(/^\s*(re|fwd?|fw)\s*:\s*/i, "").trim();
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/**
 * Whether the message actually came from who it claims to.
 *
 * THE AUTHORISATION IS THE SENDER, SO THE SENDER HAS TO BE PROVEN. A `From:` header is a string
 * anybody can type; `seq.taylor@gmail.com` is trivial to forge, and an allowlist checked against a
 * forgeable header is not a control, it is a comment.
 *
 * Cloudflare Email Routing runs SPF, DKIM and DMARC before delivery and states the outcome in
 * `Authentication-Results`. This requires DMARC to have PASSED — not merely to be present, and not
 * SPF alone, because SPF authenticates the envelope and it is the `From:` header this system trusts.
 * `dmarc=pass` is the one result that binds the two together.
 *
 * ABSENT IS A FAIL. A missing header means nothing checked it, which is exactly the state a
 * forgery arrives in.
 */
export function dmarcPassed(authResults) {
  return /\bdmarc\s*=\s*pass\b/i.test(String(authResults ?? ""));
}

/** Is this address one of hers? Case-folded, because mail clients are not consistent about it. */
export function isOwner(address) {
  const a = String(address ?? "").trim().toLowerCase();
  return a.length > 0 && BOSS_INTAKE_SENDERS.includes(a);
}
