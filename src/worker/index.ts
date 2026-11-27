import type { Env } from "./env";
import { handleBossInboundMail, isBossMailbox } from "./boss/intake/inboundMail";
import { runMailAlarm, MAIL_ALARM_CRON } from "./boss/intake/mailAlarm";
import { runCloudClock as runBossCloudClock } from "./boss/cron/dispatch";
import { BOSS_INTAKE_MAILBOX } from "../shared/boss/intake/mail.mjs";
import { decodeHeader } from "../shared/mail/parseMail.mjs";
import { replyWithHistory } from "./boss/mail/history";
import { plainReply } from "./boss/intake/mailRefs";
// The structured event spine, for the one thing in this file that writes to it: a reply that did
// not go. Everything else here logs through the handlers it calls.
import { logEvent } from "./boss/lib/log";
import { operatingStopped } from "./boss/lib/operatingStop";
import { routeSimoneWhenMacIsDown } from "./boss/agents/simoneFallback";
import { isBossRoute, handleBossRequest, tapPageToBossPath, researchPageToBossPath, partnerPageToBossPath, drainBossTasks, runBossNightly, runBossDuties, runBossDutyClock, runBossReaper, runBossOutreach, runBossOpenLoops, runBossEightraise, runBossKendra, toBossEnv as toBossEnvForCron } from "./bossMount";
/** Where the West Peek fund screens and their API live now (the chassis retirement, 22 Nov 2026). */
function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

const WEST_PEEK_OS_ORIGIN = "https://os.joinwestpeek.com";

/*
 * THE COPIED FUND API IS RETIRED, AND SAYS SO.
 *
 * This Worker used to carry West Peek OS's whole fund API (about 490 routes behind the fund sign-in,
 * resolveFirmUser). Its sign-in could not succeed in production (no Access audience was ever set), so
 * nobody could use it; West Peek OS runs the real one. Every /api path that is not Boss OS's own and
 * not the health check now answers 410 with where to go instead: never a 500, never an empty 200,
 * and never data, whatever cookie or header comes with it. The tables stay (nothing is dropped).
 */
export function retiredApi(pathname: string): Response {
  return json(
    {
      error: "gone",
      message: "The West Peek fund API no longer lives on Boss OS. It is served by West Peek OS.",
      moved_to: WEST_PEEK_OS_ORIGIN,
      path: pathname,
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}

/**
 * The deploy check (scripts/deploy/production.mjs) and uptime read this without a session: is the
 * database reachable, at which schema version, and are the bindings present. Names only, no data.
 */
async function handleHealth(env: Env): Promise<Response> {
  let d1: { reachable: boolean; schemaVersion: string | null; error?: string } = {
    reachable: false,
    schemaVersion: null,
  };
  try {
    const row = await env.WP_OS_DB.prepare(
      "SELECT migration FROM schema_version ORDER BY migration DESC LIMIT 1",
    ).first<{ migration: string }>();
    d1 = { reachable: true, schemaVersion: row?.migration ?? null };
  } catch (err) {
    d1 = { reachable: false, schemaVersion: null, error: err instanceof Error ? err.message : String(err) };
  }

  return json({
    ok: d1.reachable,
    env: env.WP_OS_ENV,
    d1,
    bindings: {
      WP_OS_DB: typeof env.WP_OS_DB !== "undefined",
      WP_OS_DOCUMENTS: typeof env.WP_OS_DOCUMENTS !== "undefined",
      WP_OS_KV: typeof env.WP_OS_KV !== "undefined",
      ASSETS: typeof env.ASSETS !== "undefined",
    },
  });
}


/**
 * Pure request handler — exported so tests can exercise it directly with a
 * miniflare-backed Env, without standing up a server.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  // Her one-tap email buttons (`/tap/<token>`) are Boss OS's tap route, reached as a page (bossMount.ts).
  const tapPath = tapPageToBossPath(url.pathname);
  if (tapPath) {
    const inner = new URL(url.toString());
    inner.pathname = tapPath;
    return handleBossRequest(new Request(inner.toString(), request), env);
  }

  // A partner one-pager (`/p/<token>`) is a public page, the same way (bossMount.ts).
  const partnerPath = partnerPageToBossPath(url.pathname);
  if (partnerPath) {
    const inner = new URL(url.toString());
    inner.pathname = partnerPath;
    return handleBossRequest(new Request(inner.toString(), request), env);
  }

  // A research page's address (`/research/<id>`) is a page too, the same way (bossMount.ts).
  const researchPath = researchPageToBossPath(url.pathname);
  if (researchPath) {
    const inner = new URL(url.toString());
    inner.pathname = researchPath;
    const res = await handleBossRequest(new Request(inner.toString(), request), env);
    // Locked (no session on this browser): a calm page that says how in, never a JSON error.
    if (res.status === 401) {
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Research page</title></head>`
        + `<body style="font:17px/1.5 -apple-system,system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1.2rem;color:#2b2622;background:#fdf8f4">`
        + `<p>This research page is private. Unlock Boss OS on this browser, then tap the link in your email again.</p>`
        + `<p><a href="/" style="display:inline-block;padding:.6rem 1rem;border-radius:.6rem;background:#2b2622;color:#fff;text-decoration:none">Open Boss OS ›</a></p></body></html>`,
        { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
      );
    }
    return res;
  }

  if (!url.pathname.startsWith("/api/")) {
    if (typeof env.ASSETS === "undefined") {
      return json({ error: "assets binding unavailable" }, { status: 503 });
    }

    return env.ASSETS.fetch(request);
  }

  // Boss OS owns /api/boss/* outright, behind its own session check (passcode + KV): the owner
  // password opens every one of these doors, and nothing else in this file can stand in front of it.
  if (isBossRoute(url.pathname)) {
    const response = await handleBossRequest(request, env);

    /*
     * DRAIN WHAT THIS REQUEST MAY HAVE JUST QUEUED.
     *
     * Boss OS's employee work used Cloudflare Queues in the artifact; here it waits in D1 and
     * moves only when something drains it. That was the cron's job, and the cron was the ONLY
     * reason the trigger needed to be quarter-hourly - 96 wake-ups a day so that submitting a task
     * felt prompt.
     *
     * The owner asked for a less frequent cron. Draining here means the tick no longer carries
     * that responsibility: a task queued by a request is picked up by the same request, and the
     * hourly tick becomes a safety net for work nothing was watching - a retry with a delay, a
     * task enqueued while the Worker was mid-deploy.
     *
     * AFTER THE RESPONSE, NEVER BEFORE IT. `waitUntil` keeps canon's rule intact - work executes
     * outside the request/response cycle, never inside a handler that a person is waiting on - and
     * a failure here cannot turn a successful submission into an error the caller sees. Read-only
     * verbs are skipped because they cannot have queued anything.
     */
    /*
     * AND AFTER THE ONE READ THAT IS A PROGRESS POLL. `GET /api/boss/wealth/outreach/rewrites`
     * materialises the rewrites she is owed (a sent-back letter with a note = queued work) and is
     * polled by the desk and the Inbox while they say "rewriting now"; draining after it is what
     * makes "in minutes" true when the request that queued the work has already returned and the
     * hourly tick is fifty minutes away. Every other GET is skipped, as before.
     */
    const drainsOnRead = request.method === "GET" &&
      (url.pathname === "/api/boss/wealth/outreach/rewrites" || url.pathname.startsWith("/api/boss/research/firm-scans"));
    if (ctx && ((request.method !== "GET" && request.method !== "HEAD") || drainsOnRead)) {
      ctx.waitUntil(
        drainBossTasks(env, new Date(), 25, { fromRequest: true }).catch((err) => {
          console.error("boss task drain (on request) failed", err);
        }),
      );
    }
    return response;
  }

  if (url.pathname === "/api/health" && (request.method === "GET" || request.method === "HEAD")) {
    return handleHealth(env);
  }

  return retiredApi(url.pathname);
}

export { BrainReader } from "./boss/brains/brainReader";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      // Fail closed, no internals leaked.
      console.error("worker error", err);
      return json({ error: "internal_error" }, { status: 500 });
    }
  },

  /**
   * Inbound mail, delivered by Cloudflare Email Routing, ROUTED BY RECIPIENT.
   *
   * Only Boss OS's own mailboxes are read (isBossMailbox). West Peek's fund mailbox handler retired
   * with the chassis (22 Nov 2026); its mail goes to the west-peek-os Worker, never here. A mailbox
   * this Worker was never told about is not hers by default: it is logged loudly and left alone,
   * because quietly treating it as hers is how one business's mail ends up in the other's system.
   */
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (isBossMailbox(message.to)) {
      /*
       * AWAITED, NOT `waitUntil`ed. `message.raw` is a stream tied to the delivery of THIS message;
       * returning early and reading it afterwards fails with "ReadableStream received over RPC
       * disconnected prematurely" and loses the mail with no record at all.
       */
      const result = await handleBossInboundMail(message, toBossEnvForCron(env)).catch((err) => {
        console.error("boss inbound mail failed", err);
        return null;
      });

      /*
       * SHE ALWAYS GETS AN ANSWER — and `reply()` is the mechanism precisely because it needs
       * nothing this account does not have. Replying to an inbound message is native to Email
       * Routing: no `send_email` binding, no Workers Paid plan, no Resend key, and no outbound
       * identity that could be pointed at a stranger. It can only ever answer the person who wrote,
       * which is the correct blast radius for a mailbox whose whole job is talking to one person.
       *
       * A refused sender gets NO reply, and `handleBossInboundMail` returns a null reply for that
       * case: answering would confirm the address is live and turn this into a way to make Boss OS
       * mail somebody. The refusal is recorded for HER instead.
       */
      /*
       * ─── A REPLY THAT DID NOT GO SAYS WHY, DURABLY ────────────────────────
       *
       * This used to end at `console.error("boss inbound reply failed", err)`. Workers Logs keep
       * three days, so the reason for a failure was gone before anybody thought to ask for it, and
       * the only surviving trace was a null `replied_at` — which, as migration 0272 sets out, also
       * means "she typed it here and the answer went back on screen". Three different facts wearing
       * one shape, and the one that mattered had no detail attached to it at all.
       *
       * So the outcome of the send is written to the arrival row and to the event log, on BOTH
       * branches, with everything `err` carries plus the shape of the message that provoked it.
       * The next failure is diagnosable from the table alone.
       *
       * WHAT CLOUDFLARE DOCUMENTS ABOUT `reply()` FAILING, checked 22 Sep 2026: the inbound message
       * must have a valid DMARC result; a message may be replied to once per event; the reply's
       * recipient must be the inbound sender; the outgoing sender domain must match the domain that
       * received it; and a `References` header with more than 100 entries is refused as a loop.
       * NONE of those explains `iml_m351xdg27p30hj5k` — DMARC passed, one reply, one References
       * entry, same domain both ways. No exception text is documented for any failure mode. That is
       * precisely why this capture exists rather than a fix asserting a cause nobody has evidence
       * for.
       */
      if (result?.reply) {
        /*
         * The reply text, captured once. `result.reply` is narrowed by the `if`, but the failure
         * handler below is an async closure and TypeScript will not carry the narrowing into it —
         * and it is exactly right not to, since `result` is a mutable object reference.
         */
        const replyText: string = result.reply;
        /*
         * THE SUBJECT IS DECODED, FLATTENED AND TRIMMED BEFORE IT GOES BACK OUT.
         *
         * It was the raw header. An RFC 2047 encoded-word subject (`=?utf-8?B?…?=`) would have been
         * echoed back to her as those bytes — the intake decodes headers everywhere else and this
         * one call did not. Worse, a header value is terminated by CRLF, so a subject carrying one
         * puts whatever follows it into the reply's header block. Nothing observed has done that;
         * it costs one line to make it impossible. The trailing space on
         * "Fwd: Shorts lane #simone " — the one genuine failure in the table — is removed by the
         * same line, which is a plausible contributor and is NOT claimed as the cause.
         */
        const subject = `Re: ${decodeHeader(message.headers.get("subject") ?? "") || "your message"}`
          .replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
        const recordReply = async (state: "sent" | "failed", error: string | null) => {
          await env.WP_OS_DB.prepare(
            `UPDATE boss_inbound_mail SET replied_at = ?, reply_state = ?, reply_error = ? WHERE id = ?`,
          ).bind(state === "sent" ? Date.now() : null, state, error, result.mailId).run();
        };
        /*
         * THE REPLY IN THE ONE PLAIN LAYOUT (owner, 22 Oct 2026). `fromLegacy` takes the job codes out
         * of what she reads; they are recorded against HER message's Message-ID, which her next reply
         * in this thread quotes in References, so "approved" still lands on the draft it answers.
         */
        const laid = await plainReply(env.WP_OS_DB, { text: replyText, subject, signer: result.signer, messageId: result.messageId, from: BOSS_INTAKE_MAILBOX });
        await replyWithHistory(message, toBossEnvForCron(env), { message_id: `reply:${result.mailId}`, from: BOSS_INTAKE_MAILBOX, to: message.from, subject, text: laid.text, html: laid.html, in_reply_to: result.messageId ?? null, employee_id: result.employeeId, layout: (laid as { layout?: string }).layout ?? null, minimum: (laid as { minimum?: any }).minimum ?? null }).then(
          async () => {
            await recordReply("sent", null);
          },
          // A failed reply must not also lose the work. The row and the task already exist; this
          // records that she was not told, AND what stopped it, rather than pretending she was.
          async (err: unknown) => {
            const e = err as { name?: unknown; message?: unknown; stack?: unknown };
            const reason = [
              typeof e?.name === "string" && e.name ? e.name : null,
              err instanceof Error ? err.message : String(err),
            ].filter(Boolean).join(": ").slice(0, 900);
            console.error("boss inbound reply failed", err);
            /*
             * EACH WRITE IS INDEPENDENTLY GUARDED. A throw from the row update would take the event
             * log down with it and we would be back to nothing at all — which is the exact failure
             * being fixed, reintroduced in the handler that fixes it.
             */
            await recordReply("failed", reason).catch((e2) => console.error("reply_error not recorded", e2));
            await logEvent(env.WP_OS_DB, {
              level: "error", scope: "intake", event: "boss_mail_reply_failed", lane: "ops",
              entityId: result.mailId,
              detail: {
                error: reason,
                stack: typeof e?.stack === "string" ? e.stack.slice(0, 1200) : null,
                outcome: result.outcome,
                task_id: result.taskId,
                reply_chars: laid.text.length,
                subject_sent: subject,
                // The shape of the message, because the one real failure was a forward and nothing
                // recorded that at the time. Two of these is a pattern; one is a note.
                inbound_bytes: message.rawSize,
                forwarded_subject: /^\s*fwd:/i.test(message.headers.get("subject") ?? ""),
                has_in_reply_to: Boolean(message.headers.get("in-reply-to")),
                references_count: (message.headers.get("references") ?? "").split(/\s+/).filter(Boolean).length,
                message_id: (message.headers.get("message-id") ?? "").slice(0, 200) || null,
                content_type: (message.headers.get("content-type") ?? "").slice(0, 120) || null,
                mailer: (message.headers.get("x-mailer") ?? "").slice(0, 80) || null,
              },
            }).catch((e2) => console.error("reply failure event not logged", e2));
          },
        );
      }
      return;
    }

    console.error(
      `inbound mail for an unrecognised recipient, not processed: ${message.to}. `
      + `This Worker answers for ${BOSS_INTAKE_MAILBOX} only.`,
    );
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    /*
     * THE FIVE-MINUTE TICK is the one tick that MOVES WORK (27 Nov 2026, Camille's briefing late for the
     * morning email): the duty clock and then the queue drain, so a duty due at 04:00 is a run parked for
     * her Mac at 04:00 and claimed at the 04:05 slot. Both rode the hourly tick, so a due duty waited up to
     * an hour to become a task and a task waited for the next drain to reach a seat. In ONE waitUntil and
     * in that order on purpose: a duty that comes due on this tick is drained on this tick, and the drain
     * still runs when the clock fails. Only here: this tick fires at :00 too, and two ticks materialising
     * the same duty at once would race on its clock. Beside them, each in its own waitUntil, the "no Got it
     * yet" alarm and Boss OS's own clock for its GitHub jobs (21 Nov 2026: GitHub's schedule event stopped
     * being a clock). wrangler.toml [triggers].
     */
    if (event?.cron === MAIL_ALARM_CRON) {
      ctx.waitUntil(runMailAlarm(toBossEnvForCron(env), now.getTime()).then(() => undefined).catch((err) => console.error("boss mail alarm failed", err)));
      // The owner's stop ("stop everything") holds everything below; only the alarm above still runs.
      if (!(await operatingStopped(env.WP_OS_DB))) {
        ctx.waitUntil(runBossCloudClock(toBossEnvForCron(env), now.getTime()).then(() => undefined).catch((err) => console.error("boss cloud clock failed", err)));
        ctx.waitUntil(routeSimoneWhenMacIsDown(toBossEnvForCron(env), now.getTime())
          .catch(() => console.error("Simone’s cloud fallback could not finish")));
        ctx.waitUntil(
          runBossDutyClock(toBossEnvForCron(env), now.getTime())
            .then((r) => { if (r.fired.length) console.log("boss duties materialised", JSON.stringify(r.fired)); })
            .catch((err) => console.error("boss duties failed", err))
            // The drain reads the clock when it starts, never the tick's: a task enqueued a moment ago is
            // visible from its own enqueue time, which is after `now`.
            .then(() => drainBossTasks(env, new Date()))
            .then((r) => { if (r.ran || r.failed || r.dead) console.log("boss task drain", JSON.stringify(r)); })
            .catch((err) => console.error("boss task drain failed", err)),
        );
      }
      return;
    }
    if (await operatingStopped(env.WP_OS_DB)) return;
    // The copied West Peek fund jobs (runDueJobs) no longer run here: West Peek OS runs them itself
    // and the pause migration in #531 switched off diagnostics_sweep, deck_reading and network_sync
    // (chassis retirement, her yes 22 Nov 2026).
    // THE HOURLY TICK keeps the chores that need no five-minute clock. Each lane below is its own
    // waitUntil so a failure in one cannot swallow another. Boss OS's employee work waits in D1 and is
    // drained on the five-minute tick above (and after every request that queues it).
    // The rewrites she is owed, the weekly brains check and Hicks's quarterly update (runDuties).
    ctx.waitUntil(
      runBossDuties(toBossEnvForCron(env), now.getTime()).catch((err) => {
        console.error("boss hourly chores failed", err);
      }),
    );
    // A run a machine claimed and never reported is failed here, on the hour, rather than left
    // reading `running` until somebody notices. See boss/backends/reap.ts.
    ctx.waitUntil(
      runBossReaper(toBossEnvForCron(env), now.getTime()).then((r) => {
        if (r.reaped.length) console.log("boss silent runs reaped", JSON.stringify(r.reaped));
      }).catch((err) => {
        console.error("boss reaper failed", err);
      }),
    );
    // Monique's outreach: replies, brakes, sends inside the cap and window, list building.
    ctx.waitUntil(
      runBossOutreach(toBossEnvForCron(env), now.getTime()).then((r) => {
        console.log("boss outreach tick", JSON.stringify({ sent: r.sent, replies: r.replies, paused: r.paused, stop: r.stop ?? null }));
      }).catch((err) => {
        console.error("boss outreach failed", err);
      }),
    );
    ctx.waitUntil(
      runBossEightraise(toBossEnvForCron(env), now.getTime()).then((r) => {
        if (r.ran || /NAMED STOP/.test(r.reason ?? "")) console.log("boss eightraise", JSON.stringify(r));
      }).catch((err) => console.error("boss eightraise failed", err)),
    );
    // Open Loops: once a day from 05:00 Central, the morning section and the overdue repairs.
    ctx.waitUntil(
      runBossOpenLoops(toBossEnvForCron(env), now.getTime()).then((r) => {
        if (r.ran || /NAMED STOP/.test(r.reason ?? "")) console.log("boss open loops", JSON.stringify(r));
      }).catch((err) => {
        console.error("boss open loops failed", err);
      }),
    );
    // Kendra's alarms (owner, 5 Nov 2026: stop "green but did nothing"): output floors, first-run
    // checks and tasks stuck "running". Its own waitUntil, so it can neither swallow nor be swallowed.
    ctx.waitUntil(
      runBossKendra(toBossEnvForCron(env), now.getTime()).then((r) => {
        const moved = r.floors.opened.length + r.floors.cleared.length + r.first_run.opened.length + r.first_run.closed.length + r.stale.opened.length + r.stale.cleared.length;
        if (moved) console.log("boss kendra", JSON.stringify(r));
      }).catch((err) => {
        console.error("boss kendra failed", err);
      }),
    );
    ctx.waitUntil(
      runBossNightly(toBossEnvForCron(env)).catch((err) => {
        console.error("boss nightly failed", err);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
