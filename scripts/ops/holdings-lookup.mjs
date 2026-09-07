/**
 * "DO I HAVE ACCESS TO THIS STOCK?" — asked about ONE named company, answered in seconds.
 *
 *   npm run --silent vault:run -- node scripts/ops/holdings-index.mjs "Anthropic"
 *
 * ─── Why this replaced an index ─────────────────────────────────────────────
 *
 * The first attempt built an index of every company name it could discover across the mailbox. It
 * ran, and the top results were "Direct", "Securities. Such", "Anonymous", "Forward" and "Order" —
 * legal footers and platform boilerplate, because a capitalised word next to the word "shares" is
 * not a company. Six hundred messages produced 556 "companies", almost none of them real.
 *
 * The failure was in the framing, not the regex. SHE ALREADY KNOWS THE NAME. Someone messages
 * asking about a specific company, so the question is never "what companies exist in my mail" — it
 * is "does <this one> appear anywhere, and who said it". That is a search, and a search cannot
 * produce a list of things that are not companies, because the company is the input.
 *
 * It is also faster, needs no index to keep fresh, and reads far less: one Gmail query instead of
 * four thousand message fetches.
 *
 * ─── The negative is a real answer ──────────────────────────────────────────
 *
 * Her words: "otherwise it can say none found then ill know i need to go send some emails to
 * search." So a miss prints plainly and says what was searched. A tool that would rather return
 * something than nothing is worse than useless here — a firm surfaced by a fuzzy match costs her a
 * phone call and her credibility with a counterparty.
 *
 * ─── What is read and what survives ─────────────────────────────────────────
 *
 * This reads message bodies; it must, since the answer lives in prose. Nothing is stored: the
 * result is printed and the process exits. No index file, no cache, no corpus. Runs on her machine
 * against one mailbox, and nothing is sent to any model — the matching is the company name she
 * typed and a vocabulary of secondary-market terms.
 */

const SUBJECT = process.env.BROKERAGE_MAILBOX ?? "staylor@spry.vc";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const LOOKBACK_DAYS = Number(process.env.HOLDINGS_LOOKBACK_DAYS ?? 900);
const MAX_MESSAGES = Number(process.env.HOLDINGS_MAX_MESSAGES ?? 60);
const JSON_OUT = process.argv.includes("--json");
const QUERY = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken(creds) {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email, sub: SUBJECT, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(creds.private_key));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

/** The vocabulary that separates a real conversation from a mention in a newsletter. */
const SIGNAL = /\b(secondar\w+|shares?|share class|allocation|SPV|tender|cap table|common|preferred|bid|ask|indicat\w+|access|holding|position|sell(?:er|ing)?|buy(?:er|ing)?|block|forward|direct|RSU)\b/i;

const header = (msg, name) =>
  msg?.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

function textOf(payload, depth = 0) {
  if (!payload || depth > 6) return "";
  const data = payload.body?.data;
  if (data && /^text\/(plain|html)/.test(payload.mimeType ?? "")) {
    const raw = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return payload.mimeType.includes("html") ? raw.replace(/<[^>]+>/g, " ") : raw;
  }
  return (payload.parts ?? []).map((p) => textOf(p, depth + 1)).join("\n");
}

const addr = (raw) => (raw.match(/<([^>]+)>/)?.[1] ?? raw).toLowerCase().trim();

/**
 * Newsletters are not counterparties.
 *
 * THE FIRST LIVE RUN SURFACED A SUBSTACK AND A MEETING-NOTES BOT alongside real brokers, because a
 * market newsletter mentions SpaceX next to the word "shares" every week. Nothing is wrong with the
 * match — the line genuinely says both — but "who has access to this" is a question about people
 * who can sell her something, and a mailing list cannot.
 *
 * `List-Unsubscribe` is the honest test: bulk senders set it and correspondents do not. The address
 * patterns catch the few that skip the header.
 */
function isBulk(msg, from) {
  const headers = msg?.payload?.headers ?? [];
  if (headers.some((h) => /^list-(unsubscribe|id)$/i.test(h.name))) return true;
  if (/^(no-?reply|do-?not-?reply|newsletter|digest|updates?|notifications?|hello|team|info)@/i.test(from)) {
    // `info@` and `hello@` are used by small brokers too, so they only count as bulk when the sender
    // also looks like a mailing platform.
    return /substack|beehiiv|mailchimp|sendgrid|hubspot|\be\.[a-z]+\.[a-z]+$|convertkit|ghost\.io/i.test(from);
  }
  return /substack\.com$|beehiiv\.com$|@e\.[a-z-]+\.[a-z]+$|mailer|campaign/i.test(from);
}

async function main() {
  if (!QUERY) {
    console.error('Name the company: node scripts/ops/holdings-lookup.mjs "Anthropic"');
    process.exitCode = 2;
    return;
  }
  const creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON ?? "null");
  if (!creds) throw new Error("No service account in the environment.");
  const token = await accessToken(creds);
  const auth = { authorization: `Bearer ${token}` };
  const me = SUBJECT.toLowerCase();

  const after = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "/");
  // The company name is the search. Gmail does the work; this side only ranks and quotes.
  const q = `after:${after} -in:draft -category:promotions "${QUERY}"`;

  const list = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${MAX_MESSAGES}`,
    { headers: auth },
  );
  if (!list.ok) throw new Error(`search failed (${list.status}): ${(await list.text()).slice(0, 200)}`);
  const ids = ((await list.json()).messages ?? []).map((m) => m.id);

  const hits = [];
  let filtered = 0;
  for (const id of ids) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth });
    if (!res.ok) continue;
    const msg = await res.json();
    const ts = Number(msg.internalDate);
    const from = addr(header(msg, "From"));
    const outbound = from === me;
    // Her own outbound mail is never bulk, whatever headers a thread picked up on the way.
    if (!outbound && isBulk(msg, from)) { filtered++; continue; }
    const other = outbound ? addr(header(msg, "To").split(",")[0] ?? "") : from;

    const body = `${header(msg, "Subject")}\n${textOf(msg.payload)}`;
    const needle = QUERY.toLowerCase();
    for (const rawLine of body.split(/[\n\r]+/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (line.length < 10 || line.length > 400) continue;
      if (!line.toLowerCase().includes(needle)) continue;
      /*
       * THE NAME ALONE IS NOT A SIGNAL. A funding-round newsletter mentions twenty companies. The
       * line has to also carry the vocabulary of a secondary for it to be about access.
       */
      if (!SIGNAL.test(line)) continue;
      hits.push({
        at: new Date(ts).toISOString().slice(0, 10),
        ts,
        who: other || "unknown",
        // WHO RAISED IT IS THE WHOLE ANSWER. Inbound means someone asked her or offered her
        // something; outbound means she was already chasing it.
        direction: outbound ? "she wrote" : "they wrote",
        subject: header(msg, "Subject").slice(0, 120),
        line: line.slice(0, 240),
      });
      break; // One line per message: enough to recognise the thread, not a transcript.
    }
  }

  hits.sort((a, b) => b.ts - a.ts);

  if (JSON_OUT) {
    console.log(JSON.stringify({ query: QUERY, searched_days: LOOKBACK_DAYS, messages_matched: ids.length, hits }, null, 2));
    return;
  }

  if (hits.length === 0) {
    /*
     * SAID PLAINLY, WITH WHAT WAS SEARCHED. "None found" is only useful if she can tell the
     * difference between "it is not in your mail" and "the tool did not look properly".
     */
    console.log(`NONE FOUND — "${QUERY}"`);
    console.log(`Searched the last ${LOOKBACK_DAYS} days of ${SUBJECT}: ${ids.length} message(s) mention it${filtered ? `, ${filtered} of them newsletters` : ""}, none alongside secondary-market terms from a real correspondent.`);
    console.log("Nobody in your mail has discussed access to this. Go ask.");
    return;
  }

  const people = new Map();
  for (const h of hits) {
    const p = people.get(h.who) ?? { who: h.who, n: 0, last: h.at, they: 0, she: 0 };
    p.n++;
    if (h.direction === "they wrote") p.they++; else p.she++;
    people.set(h.who, p);
  }

  console.log(`"${QUERY}" — ${hits.length} relevant message(s) across ${people.size} contact(s), last ${hits[0].at}` +
    `${filtered ? ` (${filtered} newsletter${filtered === 1 ? "" : "s"} filtered out)` : ""}\n`);
  for (const p of [...people.values()].sort((a, b) => b.n - a.n)) {
    console.log(`  ${p.who.padEnd(38)} ${String(p.n).padStart(2)} msg · last ${p.last} · ${p.they} from them, ${p.she} from you`);
  }
  console.log("\nMost recent:");
  for (const h of hits.slice(0, 5)) {
    console.log(`  ${h.at}  ${h.direction.padEnd(10)} ${h.who}`);
    console.log(`      ${h.line}`);
  }
}

main().catch((err) => {
  console.error(`lookup failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
