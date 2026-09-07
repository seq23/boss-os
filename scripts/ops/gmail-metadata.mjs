/**
 * WHO SHE CORRESPONDS WITH, AND WHEN. NOTHING ELSE.
 *
 * The brokerage runs on referrals and network, and a referral business decays silently — nobody
 * ever says they stopped thinking of you, the calls just stop, and it feels like the market. The
 * one instrument that would show that is a list of who has actually been in her orbit and who has
 * gone quiet. It exists, in her inbox, and nothing has ever read it.
 *
 * ─── Why not Claude's Gmail connector ───────────────────────────────────────
 *
 * It holds ONE Google account at a time; connecting a second replaces the first. Hers is bound to
 * her personal Gmail, and the brokerage mailbox is a different Workspace account. The published
 * ways around that are to disconnect and reconnect every time, or to pay a third-party aggregator
 * to hold both. Neither is acceptable here: the first is a chore she would stop doing, and the
 * second puts her most confidential mail through a vendor for a problem she can solve with a
 * service account she already owns.
 *
 * And the deciding reason: the connector would pull her brokerage mail INTO A CLOUD CONVERSATION.
 * Live mandates, counterparties, terms. This reads it on her own machine instead, and the only
 * thing that leaves is a list of correspondents and dates.
 *
 * ─── What it emits, and what it refuses to ─────────────────────────────────
 *
 * Sender, recipient, and date headers. That is the whole extraction. NO SUBJECTS, NO SNIPPETS, NO
 * BODIES — `format=metadata` with an explicit header allowlist, so the Gmail API does not even
 * return them. That is not a policy this script applies afterwards; it is what it asks for.
 *
 * The second half of her ask — spotting clients who might want to buy something she has recently
 * discussed — genuinely needs subject lines, which is a bigger step than she has agreed to. It is
 * deliberately not here, and the run is told to say so rather than half-do it.
 *
 * ─── The authorisation, and its honest cost ────────────────────────────────
 *
 * Domain-wide delegation, scoped to `gmail.readonly` and one impersonated address. DWD is a real
 * power — a service account authorised for a scope can impersonate ANY user in the domain — so two
 * things are true and both are said out loud: the scope granted is read-only Gmail and nothing
 * else, and this script will only ever impersonate the one address it is given. The narrowness is
 * enforced at the grant in Google Admin, not by this file, which is the only place it can be
 * enforced properly.
 */

const SUBJECT = process.env.BROKERAGE_MAILBOX ?? "staylor@spry.vc";
const OUT_DIR = process.env.BOSS_OS_SOURCING_WORKSPACE ?? `${process.env.HOME}/.boss-os/sourcing`;
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const LOOKBACK_DAYS = Number(process.env.BROKERAGE_LOOKBACK_DAYS ?? 540);
/*
 * THE CAP HAS TO CLEAR THE LOOKBACK OR THE LOOKBACK IS A LIE.
 *
 * At 2,000 the first run covered about 110 days of a 540-day window — Gmail returns newest first,
 * so the cap silently truncated eighteen months to under four. Every contact's average gap then came
 * out at one to three days, which floors every cadence and would have marked all 114 people
 * permanently overdue. A touch list where everyone is overdue is a touch list she ignores.
 */
const MAX_MESSAGES = Number(process.env.BROKERAGE_MAX_MESSAGES ?? 12000);

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * A signed assertion, exchanged for an access token.
 *
 * Written out rather than pulled from a library because this runs unattended on her machine and a
 * dependency here is a supply-chain surface for a script whose entire job is touching her most
 * confidential mailbox. Node's crypto signs RS256 in four lines.
 */
async function accessToken(creds) {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email,
    // THE IMPERSONATION, NAMED. Without `sub` the service account acts as itself and sees nothing.
    sub: SUBJECT,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(creds.private_key));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    /*
     * THE ERROR THAT WILL ACTUALLY HAPPEN, TRANSLATED. `unauthorized_client` here means exactly one
     * thing and it is not a bug: the delegation has not been granted yet. Saying so is the
     * difference between a two-minute fix and an afternoon.
     */
    if (detail.includes("unauthorized_client")) {
      throw new Error(
        `Domain-wide delegation is not granted for this service account.\n` +
        `  In Google Admin for the mailbox's domain: Security → Access and data control →\n` +
        `  API controls → Domain-wide delegation → Add new.\n` +
        `  Client ID: ${creds.client_id}\n` +
        `  Scope:     ${SCOPE}\n` +
        `  Then this reads ${SUBJECT} and nothing else.`,
      );
    }
    throw new Error(`token exchange failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()).access_token;
}

const header = (msg, name) =>
  msg?.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** "Jane Doe <jane@fund.com>" → { name, email }. Falls back to the raw string rather than dropping it. */
function parseAddress(raw) {
  const m = /<([^>]+)>/.exec(raw);
  const email = (m ? m[1] : raw).trim().toLowerCase();
  const name = (m ? raw.slice(0, m.index) : "").replace(/["']/g, "").trim();
  return { name: name || null, email };
}

async function main() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("No service account in the environment; no contact metadata written.");
    return;
  }
  const creds = JSON.parse(raw);
  const token = await accessToken(creds);
  const auth = { authorization: `Bearer ${token}` };

  const after = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "/");
  // Sent mail is the better signal for a relationship than received: anyone can email her, and what
  // decays is the conversation SHE keeps up. Both are read; the tally distinguishes them.
  const query = `after:${after} -in:draft -category:promotions -category:social`;

  const ids = [];
  let pageToken = null;
  do {
    const u = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    u.searchParams.set("q", query);
    u.searchParams.set("maxResults", "500");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await fetch(u, { headers: auth });
    if (!res.ok) throw new Error(`list failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const m of body.messages ?? []) ids.push(m.id);
    pageToken = body.nextPageToken ?? null;
  } while (pageToken && ids.length < MAX_MESSAGES);

  const people = new Map();
  const me = SUBJECT.toLowerCase();

  /*
   * FETCHED IN PARALLEL, because eighteen months is twelve thousand messages and one at a time is
   * half an hour of doing nothing. The holdings lookup already worked this way; this did not, and
   * the difference only showed once the cap was raised to cover the window it claimed.
   *
   * Eight is deliberate and modest: Gmail's per-user rate limit is generous, and a run that gets
   * itself throttled has to be re-run, which is slower than being polite.
   */
  const CONCURRENCY = 8;
  const wanted = ids.slice(0, MAX_MESSAGES);
  let cursor = 0;

  const worker = async () => {
    while (cursor < wanted.length) {
      const id = wanted[cursor++];
    /*
     * `format=metadata` WITH AN EXPLICIT HEADER LIST. This is the line that makes the privacy claim
     * true rather than aspirational: Gmail does not return a subject, a snippet or a body for this
     * request, so there is nothing to accidentally log, cache or pass on.
     */
    const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
    u.searchParams.set("format", "metadata");
    /*
     * `List-Unsubscribe` JOINS THE ALLOWLIST, AND IT IS NOT A WIDENING.
     *
     * It is a bulk-sender marker, not content: it says a message came from a mailing platform and
     * reveals nothing about what the message says. Without it a Substack that emails weekly outranks
     * a real broker on exchange volume — which it did on the first run, putting a newsletter in her
     * top contacts. The holdings lookup already used this test; the two now agree.
     */
    for (const h of ["From", "To", "Date", "List-Unsubscribe"]) u.searchParams.append("metadataHeaders", h);
    const res = await fetch(u, { headers: auth });
    if (!res.ok) continue;
    const msg = await res.json();

    const ts = Number(msg.internalDate);
    const from = parseAddress(header(msg, "From"));
    const tos = header(msg, "To").split(",").filter(Boolean).map(parseAddress);
    const outbound = from.email === me;

    // A mailing list is not a relationship, however often it writes.
    if (!outbound && (header(msg, "List-Unsubscribe") || /substack\.com$|beehiiv\.com$|@e\.[a-z-]+\.[a-z]+$|mailer|campaign/i.test(from.email))) continue;

    for (const p of outbound ? tos : [from]) {
      if (!p.email || p.email === me) continue;
      // Machines are not relationships. A newsletter that arrives weekly would otherwise top the
      // list of people she is closest to.
      if (/no-?reply|do-?not-?reply|notifications?@|mailer|bounce|support@|billing@/i.test(p.email)) continue;

      const key = p.email;
      const rec = people.get(key) ?? {
        email: key, name: p.name, domain: key.split("@")[1] ?? null,
        sent: 0, received: 0, first_at: ts, last_at: ts, last_outbound_at: null,
      };
      rec.name = rec.name ?? p.name;
      if (outbound) { rec.sent++; rec.last_outbound_at = Math.max(rec.last_outbound_at ?? 0, ts); }
      else rec.received++;
      rec.first_at = Math.min(rec.first_at, ts);
      rec.last_at = Math.max(rec.last_at, ts);
      people.set(key, rec);
    }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));

  const days = (ts) => (ts ? Math.floor((Date.now() - ts) / 86_400_000) : null);
  const contacts = [...people.values()]
    // A single stray message is not a relationship; two exchanges is the floor for "in her orbit".
    .filter((p) => p.sent + p.received >= 2)
    .map((p) => ({
      ...p,
      first_at: new Date(p.first_at).toISOString(),
      last_at: new Date(p.last_at).toISOString(),
      last_outbound_at: p.last_outbound_at ? new Date(p.last_outbound_at).toISOString() : null,
      days_since_last: days(p.last_at),
      days_since_she_wrote: days(p.last_outbound_at),
    }))
    .sort((a, b) => b.sent + b.received - (a.sent + a.received));

  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "CONTACTS.json"), JSON.stringify({
    mailbox: SUBJECT,
    computed_at: new Date().toISOString(),
    lookback_days: LOOKBACK_DAYS,
    messages_examined: Math.min(ids.length, MAX_MESSAGES),
    contains: "Correspondent addresses and dates only. No subjects, no snippets, no message bodies were requested from Gmail.",
    contacts,
  }, null, 2));

  console.log(`CONTACTS.json — ${contacts.length} correspondents from ${Math.min(ids.length, MAX_MESSAGES)} messages.`);
}

// NEVER THROWS INTO THE LAUNCH AGENT. This runs immediately before the sourcing sweep; a failure
// here must cost the email half, not the whole run. Same reasoning as the sky snapshot.
main().catch((err) => {
  console.error(`contact metadata failed: ${err?.message ?? err}`);
});
