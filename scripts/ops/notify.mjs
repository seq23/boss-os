/**
 * A WAY TO REACH HER THAT A GOOGLE PASSWORD CHANGE CANNOT KILL.
 *
 * ─── The defect this closes ────────────────────────────────────────────────
 *
 * THE NOTIFICATION SHARED ITS FAILURE MODE WITH THE WORK. `kdp-watch-prompt.md` told Simone to email
 * the owner whenever something needed her, and that email went through the SAME claude.ai Gmail
 * connector she reads the mailbox with. She changed her Google password, Google revoked the grant
 * instantly, and the one condition that most needed to reach her — "I cannot read your mail at all"
 * — was the exact condition that could not send.
 *
 * Resend is an entirely separate transport with its own key, already in the vault. Nothing Google
 * does can revoke it, which is the property that was missing.
 *
 * ─── It is still the SECOND channel ────────────────────────────────────────
 *
 * The Boss OS Inbox and Today remain the channel of record: they are read on a screen she opens
 * every morning, they hold the history, and they do not depend on a message arriving. This is the
 * push — the thing that tells her to go and look on a day she otherwise would not. A caller must
 * never treat a sent email as having told her anything, and every caller here posts to Boss OS
 * first and sends second.
 *
 * ─── Rule 0 ────────────────────────────────────────────────────────────────
 *
 * It may not exit 0 having sent nothing. A missing key, a missing sender address or a refused send
 * is a non-zero exit with a named reason — because a notifier that fails quietly is worse than none,
 * since its silence is indistinguishable from there being nothing to say.
 *
 *   npm run notify -- --from Simone --subject "KDP: needs you" --body "One or two sentences."
 *
 * `--from` is the employee who owns the work. Omitted, it sends as Boss OS itself, which is correct
 * only for system mail that no employee owns.
 */

const ARGS = process.argv.slice(2);
const arg = (name) => {
  const i = ARGS.indexOf(`--${name}`);
  return i === -1 ? null : (ARGS[i + 1] ?? null);
};

const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";

/*
 * THE SENDER MUST BE A DOMAIN VERIFIED IN RESEND, AND THE KEY MUST MATCH THE ACCOUNT THAT OWNS IT.
 *
 * `boss@sequoiataylor.com` was the configured sender for weeks and had never once been accepted:
 * the domain was not verified on the account whose key this used, so every send 403'd. That is the
 * defect a notifier can least afford — it fails silently in exactly the situation where something
 * needed to reach her.
 *
 * There are two Resend accounts, deliberately. The original holds the West Peek domains and had hit
 * its plan's domain limit; a second, under her personal address, holds sequoiataylor.com. A key from
 * one cannot send from the other's domains, and the refusal reads like a verification problem rather
 * than a wrong-key problem — so sender and key are paired here rather than left to a single ambient
 * key.
 *
 * BOSS OS IS PERSONAL, SO ITS EMPLOYEES WRITE FROM sequoiataylor.com. West Peek is a separate
 * business with its own OS. The West Peek sender remains only as a last resort, and if it is ever
 * used the run says so instead of letting a wrong identity pass unnoticed.
 */
/**
 * EVERY EMPLOYEE SIGNS HER OWN MAIL.
 *
 * The first version sent everything as a single `Boss OS <boss@...>` address, which is how a
 * notification stops meaning anything: eight employees own different work, and a message that could
 * have come from any of them tells her nothing before she opens it. She names an owner for a reason,
 * and the owner should be on the envelope.
 *
 * The roster is closed on purpose. `--from Simone` becomes simone@sequoiataylor.com; a name that is
 * not on the roster is REFUSED rather than turned into an address, because DKIM signs any local part
 * on a verified domain — so a typo would send successfully, from an address belonging to nobody, and
 * nothing would ever say so. `Boss OS` itself is the fallback for system mail that no employee owns.
 *
 * Roster as of 2026-09-09, from /api/boss/employees/roster.
 */
const ROSTER = {
  // Explicit only, for system mail no employee owns. Never a default.
  "boss os": "boss",
  imani: "imani", danielle: "danielle", simone: "simone", zora: "zora",
  monique: "monique", camille: "camille", toni: "toni", kendra: "kendra",
};

export function sendersFor(who) {
  /*
   * `--from` IS REQUIRED. There is no anonymous sender.
   *
   * "why only monique! that is stupid. either everyone has their name or everyone has boss@"
   *
   * She is right that the half-measure was the worst of the three options, and named-everyone is the
   * better of the two she offered: eight employees own different work, and a message that could have
   * come from any of them tells her nothing before she opens it.
   *
   * A DEFAULT WOULD HAVE QUIETLY RECREATED THE PROBLEM. If omitting the flag fell back to a generic
   * address, every caller that was never updated would keep sending anonymously and look fine doing
   * it — the same silent-wrong-default that made this inconsistent in the first place. So a caller
   * that names nobody is refused, loudly, and the fix is one flag.
   */
  if (!who) {
    console.error("NAMED STOP [NO_SENDER_NAMED] --from is required: every email is signed by the");
    console.error("  employee who owns the work.");
    console.error(`  One of: ${Object.keys(ROSTER).join(", ")}.`);
    console.error('  e.g. npm run notify -- --from Simone --subject "..." --body "..."');
    process.exit(7);
  }
  const key = String(who).trim().toLowerCase();
  const local = ROSTER[key];
  if (!local) {
    console.error(`NAMED STOP [UNKNOWN_SENDER] "${who}" is not on the Boss OS roster.`);
    console.error(`  Known: ${Object.keys(ROSTER).join(", ")}.`);
    console.error("  Refused rather than guessed: a verified domain signs any local part, so an");
    console.error("  invented address would send perfectly and belong to nobody.");
    process.exit(6);
  }
  const label = local === "boss" ? "Boss OS" : `${who.trim()} · Boss OS`;
  return [
    { from: `${label} <${local}@sequoiataylor.com>`, key: process.env.BOSS_OS_MAIL_KEY },
    { from: `${label} <${local}@westpeek.ventures>`, key: process.env.RESEND_API_KEY },
  ].filter((s) => Boolean(s.key));
}

async function main() {
  const subject = (arg("subject") ?? "").trim();
  const body = (arg("body") ?? "").trim();

  if (!subject || !body) {
    console.error("NAMED STOP [NOTHING_TO_SAY] --subject and --body are both required.");
    console.error("  A notification with no content is a push that teaches her to ignore the next one.");
    process.exit(2);
  }

  const SENDERS = sendersFor(arg("from") ?? process.env.BOSS_NOTIFY_AS ?? null);

  if (SENDERS.length === 0) {
    console.error("NAMED STOP [NO_RESEND_KEY] neither BOSS_OS_MAIL_KEY nor RESEND_API_KEY is set.");
    console.error("  Run this through the vault: npm run notify -- --subject ... --body ...");
    process.exit(4);
  }

  let lastErr = "";
  for (const { from, key } of SENDERS) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [TO],
        subject: subject.slice(0, 200),
        text: body.slice(0, 4000),
      }),
    });
    if (res.ok) {
      console.log(`Notified from ${from}: ${subject}`);
      if (from.includes("westpeek.ventures")) {
        console.log("  NAMED STOP [WRONG_SENDING_IDENTITY] this is a Boss OS message sent from a West");
        console.log("  Peek domain, because the Boss OS sender was refused. Check BOSS_OS_MAIL_KEY and");
        console.log("  that sequoiataylor.com is verified on that account. The message went; the");
        console.log("  identity on it is wrong.");
      }
      return;
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
    console.error(`  ${from} refused: ${lastErr}`);
  }

  console.error(`NAMED STOP [SEND_REFUSED] every sender was refused. Last: ${lastErr}`);
  console.error("  A 403 here is the sender domain not being verified on the account whose key was used.");
  console.error("  The Boss OS report is the channel of record and is unaffected — she will still see this on Today.");
  process.exit(5);
}

/**
 * Only run when invoked directly. `lp-outcomes.mjs` imports `sendersFor` from here so the roster
 * exists in exactly one place; without this guard that import would also fire the notifier and exit
 * the process on a missing --from.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
main().catch((err) => {
  console.error(`notify failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
}
