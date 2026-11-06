/**
 * THE SUBJECT OF A FINISHED JOB'S EMAIL SAYS WHETHER IT WAS DONE (6 Nov 2026 live read: "Done: Send one
 * gentle nudge to Lauren Taylor (lauren@…), in our…" over a body whose first line was "The nudge to
 * Lauren has not been sent", with a red "needs you" item). A result that says it did not do the thing,
 * or hands her a step, is "Needs you:"; only the rest is "Done:". Addresses and over-long titles are
 * cut, never shown half. Pure.
 */
const NOT_DONE = /\b(?:has not been|have not been|was not|were not|wasn't|weren't|could not|couldn't|did not|didn't|not done|not sent|unable to|needs you|needs your)\b|🔴/i;

export function shortJobTitle(title, max = 70) {
  let t = String(title ?? "").replace(/\s*\([^()]*@[^()]*\)/g, "").replace(/\s+/g, " ").trim();
  if (t.length > max) t = `${t.slice(0, max).replace(/[\s,;:—-]+\S*$/, "")}…`;
  return t;
}

export function doneSubject(title, text) {
  const head = String(text ?? "").trim().split(/\n\s*\n/)[0] ?? "";
  return `${NOT_DONE.test(head) ? "Needs you" : "Done"}: ${shortJobTitle(title)}`;
}
