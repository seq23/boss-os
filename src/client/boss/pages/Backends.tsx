import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";
import { Panel, Row, asList, jsonList, text, usePanel } from "../components/panels";
import { usd } from "../../../shared/boss/types";

/**
 * STAGE 3 — THE SCREEN WHERE WORK IS LAUNCHED, AND WATCHED.
 *
 * `docs/boss/PLAN_v21.md` Stage 3: *"Launch — describe the task, see which backends can take it
 * and what each would cost, send it. Watch — a task's live state, its evidence as it accumulates,
 * cancel and requeue."* Stage 1 put the registry in the database and Stage 2 taught the Mac agent
 * to run one; without this, both are true and neither is reachable, which this repo's own history
 * says is indistinguishable from not working: *"959 tests pass and none of the buttons work."*
 *
 * THREE SURFACES, ONE IDEA — you should never have to guess where work went.
 *
 *   Launch    what you are asking for, who could take it, what each would cost, and — as loudly as
 *             the offers — who REFUSED and why.
 *   Watch     one run's live state and its evidence as it lands, including a failure's evidence.
 *             Stop it, or send it again.
 *   Backends  the registry itself: class, status, ceiling, what each may do and what it may NEVER
 *             do. A backend that is off says WHY, in its own words.
 *
 * A REFUSAL IS NOT A FAILURE AND IS NEVER COLOURED AS ONE. The migration says it outright: a
 * `refused` run is the backend declining deliberately — a forbidden action, a missing credential, a
 * breached ceiling, a task kind outside its list. Painting those red teaches the reader to ignore
 * red, and then a real failure goes unread too. The same rule governs the local runtime, whose
 * status reads `DEFERRED — NO LOCAL HOST`: that is a NAMED STOP, the defined slot Batch 2 fills,
 * and rendering it as a warning would be reporting a decision as a defect.
 *
 * NOTHING HERE ESTIMATES, CLASSIFIES OR DECIDES. Every number on this screen came from the server.
 * The client cannot know a backend's ceiling, its spend window or its allowed kinds better than the
 * table does, and a client-side guess that disagreed with the enforcement would be worse than no
 * number at all.
 */

/* ─── Shared vocabulary ───────────────────────────────────────────────────── */

/**
 * The status word, and the tone it is allowed to be shown in.
 *
 * Literal class names, chosen by a switch rather than interpolated, so the stylesheet scan can see
 * every class this file can apply. `refused` and `cancelled` sit in the NEUTRAL bucket on purpose:
 * see the note at the top.
 */
function toneFor(status: unknown): string {
  switch (String(status ?? "")) {
    case "succeeded":
    case "enabled":
      return "state-good";
    case "failed":
      return "state-bad";
    case "running":
      return "state-live";
    default:
      // refused · cancelled · registered · disabled — all deliberate, all quiet.
      return "state-quiet";
  }
}

function when(v: unknown): string {
  const n = Number(v);
  if (!v || Number.isNaN(n) || n <= 0) return "—";
  return new Date(n).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Micros, or a plain dash — never `$0.00` standing in for "the server did not say". */
function money(v: unknown): string {
  return v === null || v === undefined ? "—" : usd(Number(v) || 0);
}

function Tags({ label, items, forbidden }: { label: string; items: unknown; forbidden?: boolean }) {
  const list = jsonList(items).map((v) => String(v));
  return (
    <div className="taglist">
      <span className="taglist-l">{label}</span>
      {list.length === 0 ? (
        <span className="taglist-none">none recorded</span>
      ) : (
        list.map((v) => (
          <span className={forbidden ? "pill pill-forbid" : "pill"} key={v}>
            {v.replace(/_/g, " ")}
          </span>
        ))
      )}
    </div>
  );
}

/* ─── Launch ──────────────────────────────────────────────────────────────── */

/**
 * WHY THE CANDIDATE LIST IS A SERVER CALL AND NOT A FILTER OVER `/backends`.
 *
 * Eligibility is the router's decision — privacy class, cost mode, per-lane and per-employee
 * budget stops, the allowed-kinds list, whether the credential is actually configured. All of that
 * is enforced server-side before any call is made. A client that filtered the registry itself
 * would be a second, quieter copy of those rules, and the day the two disagreed the screen would
 * be confidently wrong about what is about to happen.
 */
export function Launch() {
  const backends = usePanel(() => api.backends());
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<unknown>(null);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const [launched, setLaunched] = useState<{ id: string | null; note: string } | null>(null);

  /** Every task kind any registered backend will accept, so the picker cannot offer an orphan. */
  const kinds = [
    ...new Set(asList(backends.data).flatMap((b: any) => jsonList(b.allowed_kinds).map(String))),
  ].sort();

  useEffect(() => {
    if (!title.trim()) {
      setCandidates(null);
      setPriceError(null);
      return;
    }
    let live = true;
    setPricing(true);
    const timer = setTimeout(() => {
      api
        .backendCandidates({ title, prompt, kind: kind || undefined })
        .then((d) => {
          if (!live) return;
          setCandidates(asList(d));
          setPriceError(null);
        })
        .catch((e) => live && (setPriceError(e), setCandidates(null)))
        .finally(() => live && setPricing(false));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [title, prompt, kind]);

  /*
   * THE VERDICT SHAPE IS THE SERVER'S, AND IT IS READ RATHER THAN RE-DERIVED.
   *
   * `src/worker/boss/backends/guard.ts` returns a discriminated union: `{ refused: true, code,
   * sentence, detail, approvable }` or `{ refused: false, cost_rank, cost_basis, credential, spend }`.
   * `refused` is the discriminant and `sentence` is written to be read by the owner — so the screen
   * prints the sentence the guard wrote rather than composing its own from the code, which is how
   * a screen and its server start disagreeing about why something was refused.
   */
  const eligible = (c: any) => c?.refused !== true && c?.eligible !== false && !c?.refusal_reason;

  /** What this call may spend, in the guard's own words. Never a number the client invented. */
  function allowanceOf(c: any): string {
    const spend = c?.spend;
    if (spend?.kind === "no_cost") return "FREE";
    if (spend?.kind === "uncapped") return "NO CAP";
    if (spend?.kind === "capped") return `up to ${money(spend.allowance_micros)}`;
    if (c?.estimate_micros !== undefined) return money(c.estimate_micros);
    return "—";
  }

  const nameOf = (c: any, id: string) =>
    c.display_name ??
    asList(backends.data).find((b: any) => String(b.id) === id)?.display_name ??
    id;

  async function send() {
    setSending(true);
    setSendError(null);
    try {
      const res = await api.dispatchToBackend({
        title,
        prompt,
        kind: kind || undefined,
        backend_id: chosen,
      });
      const id = res?.run?.id ?? res?.run_id ?? res?.id ?? null;
      setLaunched({
        id: id ? String(id) : null,
        note: id
          ? "Sent. Its evidence appears below as it lands, and every run ends as a proposal in your inbox — nothing commits, merges or deploys."
          : "Sent, but Boss OS did not return a run reference. Open Watch to find it.",
      });
      setTitle("");
      setPrompt("");
      setChosen(null);
      setCandidates(null);
    } catch (e) {
      setSendError(e);
    } finally {
      setSending(false);
    }
  }

  if (launched) {
    return (
      <>
        <div className="standdown">
          <strong>Dispatched</strong>
          {launched.note}
        </div>
        {launched.id && <RunCard runId={launched.id} />}
        <button className="btn" onClick={() => setLaunched(null)}>Launch something else</button>
      </>
    );
  }

  return (
    <>
      <section className="panel">
        <p className="eyebrow">What needs doing</p>
        <ErrorNotice error={sendError} onDismiss={() => setSendError(null)} />

        <label className="field">
          <span>The task</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add the missing validator to the deploy script"
          />
        </label>

        <label className="field">
          <span>Detail (optional)</span>
          <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>

        {/*
          * THE KIND PICKER SPEAKS IN ALL THREE STATES TOO. A select rendered with no options while
          * the registry is still loading looks broken in exactly the way an empty list does.
          */}
        <label className="field">
          <span>Kind of work</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">
              {backends.error
                ? "The registry could not be read — send it unclassified"
                : backends.data === null
                  ? "Reading the registry…"
                  : kinds.length === 0
                    ? "No backend declares a task kind"
                    : "Any kind — let the router decide"}
            </option>
            {kinds.map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel">
        <p className="eyebrow">Who could take it</p>
        <ErrorNotice error={priceError} />
        {priceError ? null : !title.trim() ? (
          <Empty
            title="Nothing to price yet"
            hint="Describe the task above. Boss OS then asks every registered backend whether it can take it and what it would cost — and shows you the ones that refuse, with their reason."
          />
        ) : candidates === null || pricing ? (
          <Loading />
        ) : candidates.length === 0 ? (
          <Empty
            title="No backend answered"
            hint="Nothing in the registry is eligible for this task. Open Backends to see what each one is allowed to take, and why the others are off."
          />
        ) : (
          candidates.map((c: any, i: number) => {
            const ok = eligible(c);
            const id = String(c.backend_id ?? c.id ?? i);
            return (
              <button
                key={id}
                className="row-tap"
                aria-pressed={chosen === id}
                disabled={!ok}
                onClick={() => setChosen(id)}
              >
                <div className="row-main">
                  <div className="row-title">
                    {text(nameOf(c, id))}
                    {c.class && <span className="pill">{String(c.class).replace(/_/g, " ")}</span>}
                    {!ok && c.approvable && <span className="pill">you could unblock this</span>}
                  </div>
                  <div className="row-sub">
                    {ok
                      ? text(c.cost_basis?.basis ?? c.reason ?? c.note, "Eligible for this task.")
                      : text(
                          c.sentence ?? c.refusal_reason ?? c.reason,
                          "Refused, and gave no reason — which is itself worth reporting.",
                        )}
                  </div>
                  {ok && c.spend?.note && <div className="row-sub">{String(c.spend.note)}</div>}
                </div>
                <div className={ok ? "row-val" : "row-val state-quiet"}>
                  {ok ? allowanceOf(c) : "REFUSED"}
                </div>
              </button>
            );
          })
        )}
      </section>

      <button
        className="btn btn-approve btn-wide"
        disabled={sending || !title.trim() || !chosen}
        onClick={send}
      >
        {sending ? "Sending…" : chosen ? "Send it" : "Choose a backend first"}
      </button>
    </>
  );
}

/* ─── Watch ───────────────────────────────────────────────────────────────── */

export function Watch() {
  const runs = usePanel(() => api.backendRuns());
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId) {
    return (
      <>
        <button className="link-back" onClick={() => { setOpenId(null); runs.reload(); }}>
          ← All runs
        </button>
        <RunCard runId={openId} />
      </>
    );
  }

  return (
    <Panel
      title="Runs"
      hint="Nothing has been dispatched. A run is one attempt by one backend, and it is recorded whether it succeeded, failed or refused."
      state={runs}
    >
      {asList(runs.data).slice(0, 40).map((r: any, i: number) => {
        const id = String(r.id ?? i);
        return (
          <button key={id} className="row-tap" onClick={() => setOpenId(id)}>
            <div className="row-main">
              <div className="row-title">{text(r.requested ?? r.summary ?? r.id)}</div>
              <div className="row-sub">
                {[text(r.backend_id, ""), when(r.started_at)].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className={`row-val ${toneFor(r.status)}`}>{text(r.status).toUpperCase()}</div>
          </button>
        );
      })}
    </Panel>
  );
}

/**
 * ONE RUN, WHILE IT IS STILL HAPPENING.
 *
 * KEEPS THE LAST GOOD ANSWER WHILE POLLING. The shared `usePanel` clears its data before every
 * reload, which is right for a first load and wrong for a poll — the card would blink back to
 * skeletons every four seconds and the reader would lose their place mid-sentence. So this holds
 * what it has and only shows the loading state when it has nothing.
 *
 * IT STOPS POLLING WHEN THE RUN STOPS. A finished run cannot change, and a timer that outlives its
 * subject is how a phone screen quietly costs battery all afternoon.
 */
function useRun(id: string) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api.backendRun(id)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e));
    return () => { live = false; };
  }, [id, tick]);

  const run = data?.run ?? data;
  const live = String(run?.status ?? "") === "running";

  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setTick((n) => n + 1), 4000);
    return () => clearTimeout(t);
  }, [live, tick]);

  return { data, run, error, refresh: () => setTick((n) => n + 1) };
}

function RunCard({ runId }: { runId: string }) {
  const { data, run, error, refresh } = useRun(runId);
  const [busy, setBusy] = useState<string | null>(null);
  const [actError, setActError] = useState<unknown>(null);
  const [acted, setActed] = useState<string | null>(null);

  const taskId: string | null = run?.task_id ? String(run.task_id) : null;
  const [task, setTask] = useState<any>(null);
  const [taskError, setTaskError] = useState<unknown>(null);

  /*
   * THE TASK IS THE THING THAT LIVES; THE RUN IS ONE ATTEMPT AT IT. A run row ends and never
   * changes again, so "what is happening now" and "may I still stop it" are questions only the
   * task can answer. Fetched separately rather than assumed to be embedded, and its absence is
   * stated rather than silently leaving the buttons off.
   */
  useEffect(() => {
    if (!taskId) return;
    let live = true;
    api.task(taskId)
      .then((t) => live && (setTask(t), setTaskError(null)))
      .catch((e) => live && setTaskError(e));
    return () => { live = false; };
  }, [taskId, acted]);

  async function act(what: "cancel" | "requeue") {
    if (!taskId) return;
    setBusy(what);
    setActError(null);
    try {
      if (what === "cancel") await api.cancelTask(taskId);
      else await api.requeueTask(taskId);
      setActed(what);
      refresh();
    } catch (e) {
      setActError(e);
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <section className="panel">
        <p className="eyebrow">Run {runId}</p>
        <ErrorNotice error={error} />
      </section>
    );
  }
  if (!run) {
    return (
      <section className="panel">
        <p className="eyebrow">Run {runId}</p>
        <Loading />
      </section>
    );
  }

  const status = String(run.status ?? "");
  const commands = jsonList(run.commands);
  const files = jsonList(run.files_touched);
  const taskStatus = String(task?.task?.status ?? task?.status ?? "");

  return (
    <>
      <section className="panel">
        <p className="eyebrow">The run</p>
        <div className="row">
          <div className="row-main">
            <div className="row-title">{text(run.requested)}</div>
            <div className="row-sub">
              {text(run.backend_id, "no backend recorded")} · started {when(run.started_at)}
              {run.finished_at ? ` · finished ${when(run.finished_at)}` : ""}
            </div>
          </div>
          <div className={`row-val ${toneFor(status)}`}>{text(status).toUpperCase()}</div>
        </div>

        {status === "running" && (
          <p className="row-sub">Live. This card refreshes itself every few seconds until the run ends.</p>
        )}

        {/*
          * A REFUSAL, SAID PLAINLY AND QUIETLY. `refused` means the backend declined on purpose —
          * a forbidden action, a missing credential, a breached ceiling, a task kind outside its
          * list. It is the system working, so it is not painted as damage.
          */}
        {run.refusal_reason && (
          <div className="standdown">
            <strong>Refused, deliberately</strong>
            {text(run.refusal_reason)}
          </div>
        )}
        {run.error && <div className="notice notice-error" role="alert"><strong>{text(run.error)}</strong></div>}

        <dl className="kv">
          <dt>cost</dt><dd className="mono">{money(run.cost_micros)}</dd>
          <dt>task</dt>
          <dd className="mono">
            {taskId ?? "none — this run was not raised from a task"}
            {taskError ? " · its state could not be read" : taskStatus ? ` · ${taskStatus.replace(/_/g, " ")}` : ""}
          </dd>
          <dt>evidence</dt><dd className="mono">{text(run.evidence_id, "not packaged yet")}</dd>
          <dt>rollback</dt><dd className="mono">{text(run.rollback_ref, "none recorded")}</dd>
        </dl>
      </section>

      <section className="panel">
        <p className="eyebrow">Evidence, as it arrives</p>
        {run.summary ? (
          <p className="row-sub">{text(run.summary)}</p>
        ) : (
          <Empty
            title={status === "running" ? "No summary yet" : "This run produced no summary"}
            hint={
              status === "running"
                ? "The backend writes its plain-English summary when it has something to say."
                : "A run that ends without a summary is worth reading the commands below for — and worth reporting."
            }
          />
        )}

        <Tags label="files touched" items={run.files_touched} />
        {files.length === 0 && status !== "running" && (
          <p className="row-sub">Nothing was written. For a review or a research run that is the expected shape.</p>
        )}

        <p className="eyebrow">Commands</p>
        {commands.length === 0 ? (
          <Empty
            title={status === "running" ? "Nothing has run yet" : "No commands were run"}
            hint="Every command the backend ran is recorded here with its exit code, successes and failures alike."
          />
        ) : (
          commands.map((c: any, i: number) => (
            <Row
              key={i}
              title={text(typeof c === "string" ? c : c.cmd ?? c.command)}
              val={typeof c === "object" && c ? `exit ${text(c.exit_code)}` : undefined}
            />
          ))
        )}

        <dl className="kv">
          <dt>checks</dt><dd>{text(run.checks_run, "none recorded")}</dd>
          <dt>risks left</dt><dd>{text(run.remaining_risks, "none stated")}</dd>
        </dl>
      </section>

      <section className="panel">
        <p className="eyebrow">Stop it, or send it again</p>
        <ErrorNotice error={actError} onDismiss={() => setActError(null)} />
        {acted && (
          <div className="standdown">
            <strong>{acted === "cancel" ? "Cancelled" : "Sent again"}</strong>
            {acted === "cancel"
              ? "The task will not be picked up again. Anything already written stays written — this stops the work, it does not undo it."
              : "Back in the queue. It will raise a fresh run, and a fresh proposal."}
          </div>
        )}
        {!taskId ? (
          <Empty
            title="Nothing to act on"
            hint="This run is not attached to a task, so there is no queued work to stop or send again."
          />
        ) : (
          <div className="decide">
            <button
              className="btn btn-reject"
              disabled={busy !== null || status !== "running"}
              onClick={() => act("cancel")}
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
            <button
              className="btn btn-defer"
              disabled={busy !== null || status === "running"}
              onClick={() => act("requeue")}
            >
              {busy === "requeue" ? "Sending…" : "Send it again"}
            </button>
          </div>
        )}
        {data?.task === undefined && taskId && !task && !taskError && (
          <p className="row-sub">Reading the task's live state…</p>
        )}
      </section>
    </>
  );
}

/* ─── The registry ────────────────────────────────────────────────────────── */

/**
 * WHERE WORK MAY RUN — and, as prominently, where it may NOT.
 *
 * The forbidden list is carried as data rather than left to a prompt (canon §33), it is identical
 * across every backend on purpose, and it is enforced by the runner. Showing it here is not
 * decoration: it is the answer to "what could this thing possibly do to my repositories", and the
 * answer is meant to be checkable by reading, not by trusting.
 */
export function BackendRegistry() {
  const backends = usePanel(() => api.backends());
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Panel
      title="Where work may run"
      hint="The registry is empty. That is not a healthy state — migration 0173 seeds five backends, so an empty list means the migration has not been applied to this database."
      state={backends}
    >
      {asList(backends.data).map((b: any, i: number) => {
        const id = String(b.id ?? i);
        const status = String(b.status ?? "");
        const open = openId === id;
        return (
          <div key={id}>
            <button className="row-tap" aria-pressed={open} onClick={() => setOpenId(open ? null : id)}>
              <div className="row-main">
                <div className="row-title">
                  {text(b.display_name ?? b.id)}
                  <span className="pill">{text(b.class, "").replace(/_/g, " ")}</span>
                </div>
                <div className="row-sub">
                  ceiling {money(b.monthly_ceiling_micros)} · spent {money(b.spent_micros)}
                </div>
              </div>
              <div className={`row-val ${toneFor(status)}`}>{text(status).toUpperCase()}</div>
            </button>

            {open && (
              <div className="detail">
                {/*
                  * A BACKEND THAT IS NOT TAKING WORK SAYS WHY, IN ITS OWN WORDS.
                  *
                  * `status_reason` is quoted verbatim and never summarised. The local runtime's
                  * reason reads "DEFERRED — NO LOCAL HOST … it is not a gap", which is a decision
                  * the owner made and a slot the design leaves open. It is shown as a NAMED STOP:
                  * stated, quiet, and never dressed as an error or a warning, because reporting a
                  * decision as a defect is how a status board stops being read.
                  */}
                {status !== "enabled" && (
                  <div className="standdown">
                    <strong>
                      {status === "disabled" ? "Named stop — deliberately off" : "Registered, not commissioned"}
                    </strong>
                    {text(
                      b.status_reason,
                      status === "disabled"
                        ? "It is off and gives no reason, which is the one state a disabled backend must never be in."
                        : "Registered means known, not usable. Nothing takes work until it has been proved end to end.",
                    )}
                  </div>
                )}

                <Tags label="can do" items={b.capabilities} />
                <Tags label="may take" items={b.allowed_kinds} />
                <Tags label="may never" items={b.forbidden_actions} forbidden />

                <dl className="kv">
                  <dt>credential</dt>
                  <dd className="mono">
                    {text(b.credential_ref, "none — this backend cannot run until one is named")}
                  </dd>
                  <dt>ceiling</dt>
                  <dd className="mono">
                    {money(b.monthly_ceiling_micros)}
                    {Number(b.monthly_ceiling_micros ?? 0) === 0
                      ? " — a hard stop, not a warning: nothing paid runs until you raise it"
                      : ""}
                  </dd>
                  <dt>spent</dt><dd className="mono">{money(b.spent_micros)}</dd>
                  <dt>window</dt><dd className="mono">{when(b.window_started_at)}</dd>
                  <dt>review</dt><dd className="mono">{when(b.review_at)}</dd>
                </dl>

                <p className="eyebrow">What accepting it costs</p>
                <p className="row-sub">
                  {text(b.security_notes, "No security note was written down, which canon §33 asks for at the moment a backend is registered.")}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}
