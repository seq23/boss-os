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
 *   npm run notify -- --subject "KDP: needs you" --body "One or two sentences."
 */

const ARGS = process.argv.slice(2);
const arg = (name) => {
  const i = ARGS.indexOf(`--${name}`);
  return i === -1 ? null : (ARGS[i + 1] ?? null);
};

const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
/*
 * THE SENDER MUST BE A DOMAIN VERIFIED IN RESEND, and if it is not, Resend refuses with a legible
 * message that this passes straight through. Guessing a sender and reporting success would produce a
 * notifier that has never delivered anything and does not know it.
 */
const FROM = process.env.BOSS_NOTIFY_FROM ?? "boss@sequoiataylor.com";

async function main() {
  const subject = (arg("subject") ?? "").trim();
  const body = (arg("body") ?? "").trim();

  if (!subject || !body) {
    console.error("NAMED STOP [NOTHING_TO_SAY] --subject and --body are both required.");
    console.error("  A notification with no content is a push that teaches her to ignore the next one.");
    process.exit(2);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("NAMED STOP [NO_RESEND_KEY] RESEND_API_KEY is not in the environment.");
    console.error("  Run this through the vault: npm run notify -- --subject ... --body ...");
    process.exit(4);
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      subject: subject.slice(0, 200),
      text: body.slice(0, 4000),
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error(`NAMED STOP [SEND_REFUSED] Resend answered ${res.status}: ${detail}`);
    console.error("  A 403 here is almost always the sender domain not being verified in Resend.");
    console.error("  The Boss OS report is the channel of record and is unaffected — she will still see this on Today.");
    process.exit(5);
  }

  console.log(`Notified: ${subject}`);
}

main().catch((err) => {
  console.error(`notify failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
