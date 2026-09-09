/**
 * IS EVERY LOGIN THIS SYSTEM RUNS ON STILL WORKING? ASKED BEFORE SOMETHING NEEDS ONE AND FAILS.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * She changed her Google password. Google invalidates every OAuth refresh token the moment that
 * happens, so the claude.ai Gmail connector was revoked in the same instant — silently, with no
 * warning and no gradual signal. Simone's KDP watch ran blind for days, the escalation on Today
 * went on describing a week-old theory, and the only reason any of it surfaced is that a human ran
 * the watcher by hand and read the output.
 *
 * A CREDENTIAL CAN ONLY BE PROVEN ALIVE BY USING IT. There is no status endpoint for "is this OAuth
 * grant still valid" that is cheaper or more honest than making the call the real job makes. So this
 * makes four small real calls, daily, and posts four words back.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * This may not exit 0 having done nothing. A run that probes nothing, or cannot report, exits
 * non-zero with a named reason — because "no probe arrived" and "everything is fine" render
 * identically, and that confusion is the entire failure being fixed.
 *
 * ─── What crosses, and what does not ───────────────────────────────────────
 *
 * A state word, a date and a sentence of detail per credential. NO TOKEN, NO SECRET, NO ADDRESS.
 * The Workspace probe reads a `From` header in order to decide whether Amazon mail is arriving
 * there; what it reports is a COUNT. The endpoint refuses any detail containing an `@` and this
 * refuses it first, so a bad report fails here with a legible reason rather than as an HTTP 400 in
 * a launchd log at 06:15.
 *
 * The Gmail request is `format=metadata` with the same four-header allowlist every other caller in
 * this repository uses. `npm run validate:gmail` holds that true for this file exactly as it does
 * for the contact extractor: the privacy claim is what the request ASKS FOR.
 */

import { spawnSync } from "node:child_process";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const SUBJECT = process.env.BROKERAGE_MAILBOX ?? "staylor@spry.vc";
/* The West Peek sending address. A different Workspace tenant, so a different grant entirely. */
const WESTPEEK_SUBJECT = process.env.WESTPEEK_MAILBOX ?? "sequoia@westpeek.ventures";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const MODEL = process.env.CREDENTIAL_CHECK_MODEL ?? "claude-haiku-4-5-20251001";

/*
 * THE QUERY THAT DECIDES WHETHER THE FAILOVER IS REAL.
 *
 * `del_kdp_mail_failover` is closed by this search finding something. Not by the forwarding filter
 * existing, not by anyone saying they set it up — by an Amazon message actually being readable in
 * the Workspace mailbox with the service account she already owns. She could mistype the address,
 * forward to the wrong mailbox, or have Google stop honouring the rule, and in every one of those
 * cases the work would look done and Simone would go blind again on the next password change.
 */
const KDP_QUERY = 'newer_than:30d (from:amazon.com OR "Kindle Direct" OR kdp)';

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A signed assertion, exchanged for an access token. Written out for the same reason the contact
 *  extractor writes it out: a dependency here is a supply-chain surface on a credential path. */
async function accessToken(creds, subject = SUBJECT) {
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: creds.client_email,
    sub: subject,
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
    if (detail.includes("unauthorized_client")) {
      throw new Error("domain-wide delegation is not granted for this service account's client ID");
    }
    throw new Error(`token exchange failed with status ${res.status}`);
  }
  return (await res.json()).access_token;
}

// ─── Probe 1 and 2: the Google service account, and the failover it would carry ──

async function probeGoogle() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    return [
      { id: "cred_google_service_account", state: "dead", detail: "The service account key is not in the environment at all. Run this through the vault." },
      { id: "cred_kdp_mail_via_workspace", state: "unknown", detail: "Cannot be checked while the service account is unavailable." },
      { id: "cred_westpeek_delegation", state: "unknown", detail: "Cannot be checked while the service account is unavailable." },
    ];
  }

  let token;
  try {
    const creds = JSON.parse(raw);
    token = await accessToken(creds);
  } catch (err) {
    const why = String(err?.message ?? err).replace(/[^\w .,:;()'-]/g, " ");
    return [
      { id: "cred_google_service_account", state: "dead", detail: `Could not authenticate: ${why}.` },
      { id: "cred_kdp_mail_via_workspace", state: "unknown", detail: "Cannot be checked while the service account cannot authenticate." },
      { id: "cred_westpeek_delegation", state: "unknown", detail: "Cannot be checked while the service account cannot authenticate." },
    ];
  }

  const auth = { authorization: `Bearer ${token}` };
  const out = [{
    id: "cred_google_service_account",
    state: "live",
    detail: "Authenticated and impersonated the Workspace mailbox successfully.",
  }];

  /*
   * A COUNT, AND THEN ONE HEADER READ TO CONFIRM IT IS REALLY AMAZON.
   *
   * A search query can match on a word in a subject, so a bare count would call the failover ready
   * on a message from a colleague mentioning Kindle. The `From` header settles it. That header is
   * read here and NEVER LEAVES THIS PROCESS — what is reported is the number.
   */
  try {
    const list = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    list.searchParams.set("q", KDP_QUERY);
    list.searchParams.set("maxResults", "5");
    const res = await fetch(list, { headers: auth });
    if (!res.ok) throw new Error(`Gmail list returned status ${res.status}`);
    const ids = (await res.json()).messages ?? [];

    let fromAmazon = 0;
    for (const { id } of ids) {
      const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      // METADATA ONLY, WITH THE SAME FOUR-HEADER ALLOWLIST AS EVERY OTHER CALLER IN THIS REPO.
      // No subject, no snippet, no body: the API does not even return them for this request.
      u.searchParams.set("format", "metadata");
      for (const h of ["From", "To", "Date", "List-Unsubscribe"]) u.searchParams.append("metadataHeaders", h);
      const m = await fetch(u, { headers: auth });
      if (!m.ok) continue;
      const msg = await m.json();
      const from = msg?.payload?.headers?.find((h) => h.name.toLowerCase() === "from")?.value ?? "";
      if (/amazon\.com|kdp/i.test(from)) fromAmazon += 1;
    }

    out.push(
      fromAmazon > 0
        ? {
            id: "cred_kdp_mail_via_workspace",
            state: "live",
            detail: `${fromAmazon} Amazon message(s) from the last 30 days are readable in the Workspace mailbox with the service account, so the publishing chase has a path that does not depend on the claude.ai connector.`,
          }
        : {
            id: "cred_kdp_mail_via_workspace",
            state: "dead",
            detail: "No Amazon mail from the last 30 days is readable in the Workspace mailbox, so the claude.ai connector is still the only path to the KDP correspondence.",
          },
    );
  } catch (err) {
    const why = String(err?.message ?? err).replace(/[^\w .,:;()'-]/g, " ");
    out.push({ id: "cred_kdp_mail_via_workspace", state: "unknown", detail: `The Workspace search could not be completed: ${why}.` });
  }

  /*
   * ── THE GRANT ONLY SCOOTER CAN GIVE, TESTED RATHER THAN REMEMBERED ────────
   *
   * Nothing can read `sequoia@westpeek.ventures`. 248 emails have gone out from it since 19 August
   * and every reply — interest, a question, a request for the deck, a request to be removed — is
   * equally invisible. During a raise, an unread reply is a lost LP.
   *
   * IT HAS BEEN ON THE WEDNESDAY PACKET, UNCHANGED, EVERY WEEK SINCE 19 AUGUST. That is how three
   * weeks passed with nobody noticing, and it is why this is a probe rather than a reminder: an item
   * she has to tick off by hand sits there wrongly for ever, and one that never re-tests keeps
   * nagging after it has been fixed. This attempts the impersonation the grant would authorise, so
   * the morning after he authorises it, the item closes itself and nobody marks anything done.
   *
   * `unauthorized_client` is the expected answer today and means exactly one thing: the delegation
   * has not been granted. It is not an error to investigate.
   */
  try {
    const creds = JSON.parse(raw);
    await accessToken(creds, WESTPEEK_SUBJECT);
    out.push({
      id: "cred_westpeek_delegation",
      state: "live",
      detail: "The service account can now read the West Peek sending address. LP replies are visible.",
    });
  } catch (err) {
    const why = String(err?.message ?? err);
    out.push({
      id: "cred_westpeek_delegation",
      state: /delegation is not granted/i.test(why) ? "dead" : "unknown",
      detail: /delegation is not granted/i.test(why)
        ? "Domain-wide delegation on the West Peek domain has still not been granted, so replies to that address cannot be read."
        : `The West Peek impersonation failed for another reason: ${why.replace(/[^\w .,:;()'-]/g, " ")}.`,
    });
  }

  return out;
}

// ─── Probe 3: the claude.ai Gmail connector ─────────────────────────────────

/*
 * THE ONE CREDENTIAL THAT CANNOT BE CHECKED FROM NODE.
 *
 * The connector is an OAuth grant held by claude.ai, not a secret on this machine, so the only way
 * to ask whether it still works is to make Claude use it. That costs about a cent a day on Haiku
 * with a prompt this short — a real cost, named rather than hidden, and cheap against the several
 * days of blind running it exists to prevent.
 *
 * THE RUN SEES ONE THREAD AND REPORTS ONE WORD. Nothing it reads leaves the machine, exactly as
 * with Simone's watch and Monique's sweep, and there is no path by which it could: this script
 * captures a sentinel and discards the rest of the output.
 */
const CONNECTOR_PROMPT = [
  "Load the Gmail tool `search_threads` with ToolSearch, then call it once with query",
  "`newer_than:2d` and a maximum of 1 thread. You are testing whether the connector is authorised,",
  "not reading mail: ignore whatever comes back.",
  "",
  "Then print EXACTLY one of these lines and nothing else at all:",
  "  CRED-GMAIL: live   — the call returned (even with zero threads)",
  "  CRED-GMAIL: dead   — the call failed because the Gmail connector is not connected or not authorised",
  "  CRED-GMAIL: unknown — it failed for some other reason",
  "",
  "Do not quote, summarise or describe any message. Do not print anything except that one line.",
].join("\n");

function probeConnector() {
  const claude = process.env.CLAUDE_BIN ?? "claude";
  const run = spawnSync(
    claude,
    ["-p", CONNECTOR_PROMPT, "--model", MODEL, "--dangerously-skip-permissions"],
    { encoding: "utf8", timeout: 180_000 },
  );

  if (run.error) {
    return {
      id: "cred_gmail_connector",
      state: "unknown",
      detail: "The Claude CLI could not be started on this machine, so the connector could not be tested.",
    };
  }

  const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const m = /CRED-GMAIL:\s*(live|dead|unknown)/i.exec(text);
  if (!m) {
    /*
     * NO SENTINEL IS NOT `live`. The run died halfway, or the CLI is not signed in at all, and both
     * of those are exactly the condition being watched for. Completion is proven by a sentinel and
     * never by output length — the same lesson kdp-watch.sh carries in its own header.
     */
    return {
      id: "cred_gmail_connector",
      state: "unknown",
      detail: "The connector test ran and never reached its sentinel, so whether it works is genuinely unknown. That is often the CLI itself not being signed in.",
    };
  }

  const state = m[1].toLowerCase();
  return {
    id: "cred_gmail_connector",
    state,
    detail:
      state === "live"
        ? "A Gmail call through the connector returned normally."
        : state === "dead"
          ? "A Gmail call through the connector was refused. Google revokes this grant whenever the account password changes, which is what happened last time."
          : "The connector test could not decide.",
  };
}

// ─── Report ─────────────────────────────────────────────────────────────────

async function main() {
  const probes = [...(await probeGoogle()), probeConnector()];

  /*
   * RULE 0. A prober that examined nothing must not exit 0 looking pleased — it would leave every
   * row's `checked_at` untouched, which the screen correctly reads as "nothing has checked this",
   * but the launchd log would read as a clean run.
   */
  if (probes.length === 0) {
    console.error("NAMED STOP [NOTHING_PROBED] no credential was examined. That is a broken prober, not a clean bill of health.");
    process.exit(2);
  }

  for (const p of probes) {
    if (typeof p.detail === "string" && p.detail.includes("@")) {
      console.error(`NAMED STOP [ADDRESS_IN_DETAIL] the detail for ${p.id} carries an '@'.`);
      console.error("  A probe reports whether a credential works, never who wrote to whom. Nothing was sent.");
      process.exit(3);
    }
    console.log(`${p.id}: ${p.state} — ${p.detail}`);
  }

  if (!process.env.BOSS_PASSCODE) {
    console.error("NAMED STOP [NO_PASSCODE] BOSS_PASSCODE is not in the environment.");
    console.error("  Run this through the vault: npm run credentials:check");
    process.exit(4);
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/credentials/probe`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ probes }),
  });
  if (!res.ok) throw new Error(`credential probe failed (${res.status}): ${(await res.text()).slice(0, 300)}`);

  const dead = probes.filter((p) => p.state === "dead");
  console.log(
    dead.length === 0
      ? `Reported ${probes.length} credential probe(s) to Boss OS. None dead.`
      : `Reported ${probes.length} credential probe(s) to Boss OS. DEAD: ${dead.map((d) => d.id).join(", ")} — named on Today with the steps to fix each.`,
  );
}

main().catch((err) => {
  console.error(`credential check failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
