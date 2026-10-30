/**
 * ONE PLACE SAYS WHAT A BLANK AUDIT FIELD MEANS (30 Oct 2026, the #177 follow-up).
 *
 * A model sometimes leaves a finding's next action or its reason blank. #177 filled the next
 * action for outcomes that need no new fix, in the reporter only. Here every outcome has a
 * plain-English default, a confirmed defect included (its action names the defect, from the
 * headline), and a blank reason gets one too. The reporter and the ingest endpoint both call this,
 * so a row the script would send is a row the endpoint keeps. A finding still needs a project and
 * a headline: those say WHAT was found, and no default can.
 */
export const DEFAULT_ACTIONS = Object.freeze({
  fixed_pr: "A fix was opened; we'll confirm the result next week.",
  off_limits: "This repository is outside the automatic repair scope, so we logged it and will check again next week.",
  no_repo: "No repo is linked to this site, so we logged it and will check again next week.",
  none: "Nothing to change: the audit found no site defect to fix.",
  ahrefs_side: "The site is reachable; we'll check whether Ahrefs can crawl it next week.",
  client_repo: "This client repository is report-only, so we logged the finding without changing the site.",
  in_flight: "A fix is already open; we'll confirm it next week.",
  ahrefs_credits: "Ahrefs ran out of crawl credits; we'll check the next audit without buying more credits.",
});

export const DEFAULT_BECAUSE = "The weekly site audit flagged this; it gave no further reason.";

const blank = (v) => v == null || (typeof v === "string" && !v.trim());

/** The default next action for a disposition; a confirmed defect's names the defect itself. */
export function defaultAction(disposition, headline) {
  if (disposition === "surfaced") {
    const what = typeof headline === "string" && headline.trim() ? headline.trim().slice(0, 200) : null;
    return what ? `Fix this on the site: ${what}. It goes into the next fix pass.` : null;
  }
  return DEFAULT_ACTIONS[disposition] ?? null;
}

/** Returns the finding with its blank next action and reason filled; never touches a supplied value. */
export function fillBlankFields(f) {
  if (!f || typeof f !== "object") return f;
  const out = { ...f };
  if (blank(out.suggested_action)) out.suggested_action = defaultAction(String(out.disposition ?? ""), out.headline) ?? out.suggested_action;
  if (blank(out.because)) out.because = DEFAULT_BECAUSE;
  return out;
}
