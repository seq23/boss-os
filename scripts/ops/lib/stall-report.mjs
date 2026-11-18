/**
 * A Mac job's stall, on the named-stop path (src/shared/boss/duties/stall.mjs says why).
 * `stall` from `stallFrom`, or null when the job moved: then the row is cleared and the red banner goes.
 * The alert email goes only when Boss OS says the row was opened or reopened: once per stall.
 * `post(path, body)` is the job's own Boss OS client; `send(mail)` its own way to email her.
 */
export const STALL_REPO = "seq23/boss-os";

export async function reportStall({ post, send, job, stall, log = console.log }) {
  if (!stall) {
    const stop = `STALLED_${String(job).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`.slice(0, 80);
    const r = await post("/open-loops/intake", { repo: STALL_REPO, stop, cleared: true }).catch(() => null);
    if (r?.action === "closed") log(`stall cleared: ${job} moved again; the red line leaves the morning email.`);
    return { action: r?.action ?? "not cleared", emailed: false };
  }
  const r = await post("/open-loops/intake", {
    repo: STALL_REPO, stop: stall.stop, title: stall.subject, finish_line: stall.finish_line,
    next_step: stall.next_step, owner: "claude", business: stall.business,
  });
  const fresh = r?.action === "opened" || r?.action === "reopened";
  console.error(`NAMED STOP [${stall.stop}] ${stall.subject.replace(/^🔴\s*/u, "")}`);
  if (!fresh) return { action: r?.action ?? "unknown", emailed: false };
  const ok = await send(stall.mail);
  return { action: r.action, emailed: Boolean(ok) };
}
