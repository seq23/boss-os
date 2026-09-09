import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { deliverableAlerts, statusLine } from "../../src/worker/boss/today/deliverables";
import { credentialAlerts } from "../../src/worker/boss/today/credentials";

/**
 * THE ALERT SAYS WHAT IS TRUE NOW.
 *
 * ─── The defect, in her words ───────────────────────────────────────────────
 *
 * "the critical alerts for simone did not say anything about my oauth being disconnected and that is
 * a problem. it says something else"
 *
 * What it said was the diagnosis from a week earlier. Two things had happened since — the Gmail
 * connector's grant was revoked when she changed her Google password, and support named a completely
 * different root cause — and NEITHER REACHED THE SCREEN, because 0203 had removed the ability of any
 * run to write the deliverable's blocker.
 *
 * ─── What these tests are actually guarding ─────────────────────────────────
 *
 * The important one is `cannot diverge`: it reads the most recent determination out of the database
 * and asserts the rendered alert contains it. Not a fixed string, not a shape — THE ACTUAL LATEST
 * ROW. A test that checked for particular wording would have passed happily throughout the week the
 * alert was lying, because the wording it was checking was the stale wording.
 */

async function clean() {
  await env.DB.prepare(`DELETE FROM kdp_case_checks`).run();
}
beforeEach(clean);

const alertFor = async (id: string) => {
  const alerts = await deliverableAlerts(env as any);
  return alerts.filter((a) => a.source_id === id).map((a) => a.text).join(" ");
};

describe("the displayed alert and the most recent determination", () => {
  it("cannot diverge — whatever the last run said is what the screen says", async () => {
    for (const determination of [
      "Support named cover image processing as the cause and asked for finished covers.",
      "A second run found the case had been reassigned and nothing else had changed.",
    ]) {
      const res = await apiJson<any>("/api/kdp/check", {
        method: "POST",
        body: { sentinel: "replied", determination },
      });
      expect(res.status).toBe(201);

      /*
       * READ BACK FROM THE DATABASE RATHER THAN ASSERTING THE STRING WE JUST SENT. This is the
       * invariant: the alert shows the LATEST ROW of kdp_case_checks, whatever it happens to be.
       */
      const latest = await row<{ determination: string }>(
        `SELECT determination FROM kdp_case_checks ORDER BY checked_at DESC, rowid DESC LIMIT 1`,
      );
      const text = await alertFor("del_kdp_publication");
      expect(text).toContain(latest!.determination);
    }

    // And the first determination is genuinely gone, rather than both being shown.
    const text = await alertFor("del_kdp_publication");
    expect(text).not.toContain("Support named cover image processing");
  });

  it("carries the date of that determination, so a stale one is visibly stale", async () => {
    await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "no-reply", determination: "Nothing new from support." },
    });
    const today = new Date().toISOString().slice(0, 10);
    expect(await alertFor("del_kdp_publication")).toContain(today);
  });

  it("does not let a determination rewrite the standing reason", async () => {
    // The bug 0203 fixed, still fixed. Two fields, and only one of them is a run's to write.
    const before = await row<any>(`SELECT blocker FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "no-reply", determination: "Four threads, none answering the question." },
    });
    const after = await row<any>(`SELECT blocker FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    expect(after.blocker).toBe(before.blocker);
    expect(after.blocker).toMatch(/51496198/);
  });

  it("does not restart the escalation clock when the sentence changes", async () => {
    /*
     * THE NUMBER THAT MUST NOT BE RESETTABLE. A block that has sat for a week is a week old even
     * when today's reason for it is new — otherwise the ladder measures how recently somebody
     * rephrased the problem rather than how long the books have been stuck.
     */
    const before = await row<any>(`SELECT blocked_since FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "nudged", determination: "A completely new reason, filed today." },
    });
    const after = await row<any>(`SELECT blocked_since FROM owned_deliverables WHERE id = 'del_kdp_publication'`);
    expect(after.blocked_since).toBe(before.blocked_since);
  });
});

describe("a run that could not run", () => {
  it("does not render as a quiet week", async () => {
    await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: {
        sentinel: "needs-her",
        run_outcome: "could-not-run",
        determination: "The watcher could not run: the Gmail connector is no longer authorised.",
      },
    });

    const text = await alertFor("del_kdp_publication");
    // The distinction that did not exist on 7 September, when both facts rendered as silence.
    expect(text).toMatch(/COULD NOT RUN/);
    expect(text).toMatch(/not evidence/);

    const kdp = await apiJson<any>("/api/kdp");
    expect(kdp.body.data.action.headline).toMatch(/could not run/i);
    // A blocked run always needs her: nothing else can renew a credential.
    expect(kdp.body.data.latest.needs_owner).toBe(1);
  });

  it("is a different sentence from a run that ran and found nothing", async () => {
    const blocked = statusLine({
      current_status: "The connector is not authorised.",
      current_status_at: Date.now(),
      current_status_kind: "could-not-run",
    });
    const ran = statusLine({
      current_status: "Support has not written since Tuesday.",
      current_status_at: Date.now(),
      current_status_kind: "determined",
    });
    expect(blocked).not.toEqual(ran);
    expect(ran).toMatch(/^Latest, /);
  });

  it("says so plainly when nothing has ever reported", () => {
    // An empty status is not a calm one.
    expect(statusLine({ current_status: null, current_status_at: null, current_status_kind: null }))
      .toMatch(/No run has reported/);
  });
});

describe("the credential register", () => {
  it("puts a dead credential on Today with the steps to fix it", async () => {
    await apiJson<any>("/api/credentials/probe", {
      method: "POST",
      body: { probes: [{ id: "cred_gmail_connector", state: "dead", detail: "The call was refused." }] },
    });

    const alerts = await credentialAlerts(env as any);
    const connector = alerts.find((a) => a.source_id === "cred_gmail_connector");
    expect(connector?.severity).toBe("critical");
    // Self-explaining: an alert that says something is broken and cannot say what to do about it is
    // one more thing for her to research at the worst moment.
    expect(connector?.text).toMatch(/Settings/);
    expect(connector?.text).toMatch(/Connectors/);
  });

  it("refuses an address in a probe detail", async () => {
    // The prober reads a From header to decide whether Amazon mail is arriving. It may report the
    // count and never the header.
    const res = await apiJson<any>("/api/credentials/probe", {
      method: "POST",
      body: { probes: [{ id: "cred_kdp_mail_via_workspace", state: "live", detail: "Mail from kdp@amazon.com is readable." }] },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a probe run that examined nothing", async () => {
    // Rule 0. An empty report would leave every checked_at untouched while the log read as clean.
    const res = await apiJson<any>("/api/credentials/probe", { method: "POST", body: { probes: [] } });
    expect(res.status).toBe(400);
  });

  it("treats an unchecked credential as unknown rather than fine", async () => {
    await env.DB.prepare(`UPDATE credential_probes SET checked_at = NULL WHERE id = 'cred_westpeek_delegation'`).run();
    const alerts = await credentialAlerts(env as any);
    const wp = alerts.find((a) => a.source_id === "cred_westpeek_delegation");
    expect(wp?.text).toMatch(/Nothing has ever checked/);
  });

  it("reaches the Today screen itself, not just the function that computes it", async () => {
    /*
     * THE GUARD FOR THE DEFECT CLASS THIS REPOSITORY PRODUCES MOST OFTEN: a correct thing nothing
     * invokes. `credentialAlerts` passing its own tests proves nothing about whether Today calls it,
     * and that is exactly how the Pillar Contracts, the gratitude sentence and the agent runner all
     * came to be finished and absent from her side of the screen.
     *
     * So this renders the real Today response and looks for the alert IN IT.
     */
    await apiJson<any>("/api/credentials/probe", {
      method: "POST",
      body: { probes: [{ id: "cred_gmail_connector", state: "dead", detail: "Refused. The grant was revoked." }] },
    });

    const today = await apiJson<any>("/api/today");
    expect(today.status).toBe(200);
    const block = today.body.data.blocks.find((b: any) => b.key === "critical_alerts");
    const texts = (block?.content?.alerts ?? []).map((a: any) => a.text).join(" ");
    expect(texts).toMatch(/claude\.ai Gmail connector is not working/);
    expect(texts).toMatch(/Connectors/);

    await env.DB
      .prepare(`UPDATE credential_probes SET state = 'unknown', checked_at = NULL WHERE id = 'cred_gmail_connector'`)
      .run();
  });

  it("wakes the dormant duty the morning the grant actually works", async () => {
    /*
     * A DUTY THAT WAKES ITSELF, because the last thing waiting on this grant went unnoticed for
     * three weeks. `duty_lp_replies` is created suspended — nothing can read the West Peek mailbox
     * until Scooter grants delegation, and a duty erroring every morning while he gets round to it
     * would be noise on the one surface she has to keep reading. The probe is the condition; nobody
     * flips a switch.
     */
    const before = await row<any>(`SELECT suspended, suspended_reason FROM standing_duties WHERE id = 'duty_lp_replies'`);
    expect(before.suspended).toBe(1);
    expect(before.suspended_reason).toMatch(/Scooter/);

    // `unknown` is not `live` and wakes nothing.
    await apiJson<any>("/api/credentials/probe", {
      method: "POST",
      body: { probes: [{ id: "cred_westpeek_delegation", state: "unknown", detail: "Could not decide." }] },
    });
    expect((await row<any>(`SELECT suspended FROM standing_duties WHERE id = 'duty_lp_replies'`)).suspended).toBe(1);

    const res = await apiJson<any>("/api/credentials/probe", {
      method: "POST",
      body: { probes: [{ id: "cred_westpeek_delegation", state: "live", detail: "The impersonation succeeded." }] },
    });
    expect(res.body.data.woken).toContain("duty_lp_replies");
    const after = await row<any>(`SELECT suspended, suspended_reason FROM standing_duties WHERE id = 'duty_lp_replies'`);
    expect(after.suspended).toBe(0);
    expect(after.suspended_reason).toBeNull();

    await env.DB
      .prepare(`UPDATE standing_duties SET suspended = 1, suspended_reason = ? WHERE id = 'duty_lp_replies'`)
      .bind(before.suspended_reason).run();
    await env.DB
      .prepare(`UPDATE credential_probes SET state = 'unknown', checked_at = NULL WHERE id = 'cred_westpeek_delegation'`)
      .run();
    await env.DB
      .prepare(`UPDATE owned_deliverables SET state = 'blocked', done_at = NULL WHERE id = 'del_westpeek_reply_path'`)
      .run();
    await env.DB.prepare(`DELETE FROM judgement_calls WHERE deliverable_id = 'del_westpeek_reply_path'`).run();
    await env.DB.prepare(`DELETE FROM approvals WHERE id LIKE 'apr_done_%'`).run();
  });

  it("closes the West Peek deliverable only when the impersonation actually works", async () => {
    /*
     * An item she has to tick off by hand sits there wrongly for ever; one that never re-tests keeps
     * nagging after it is fixed. So the deliverable is closed by the probe succeeding and by nothing
     * else — not by the grant being requested, and not by `unknown`.
     */
    await apiJson<any>("/api/credentials/probe", {
      method: "POST",
      body: { probes: [{ id: "cred_westpeek_delegation", state: "unknown", detail: "Could not decide." }] },
    });
    await deliverableAlerts(env as any);
    let d = await row<any>(`SELECT state FROM owned_deliverables WHERE id = 'del_westpeek_reply_path'`);
    expect(d.state).not.toBe("done");

    await apiJson<any>("/api/credentials/probe", {
      method: "POST",
      body: { probes: [{ id: "cred_westpeek_delegation", state: "live", detail: "The impersonation succeeded." }] },
    });
    await deliverableAlerts(env as any);
    d = await row<any>(`SELECT state FROM owned_deliverables WHERE id = 'del_westpeek_reply_path'`);
    expect(d.state).toBe("done");

    await env.DB
      .prepare(`UPDATE owned_deliverables SET state = 'blocked', done_at = NULL WHERE id = 'del_westpeek_reply_path'`)
      .run();
    await env.DB
      .prepare(`UPDATE credential_probes SET state = 'unknown', checked_at = NULL WHERE id = 'cred_westpeek_delegation'`)
      .run();
  });
});
