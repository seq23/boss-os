import { dutyStaleness, type DutyStalenessRow } from "../duties/staleness";

/**
 * WHO IS ON DUTY, ALL OF THEM, AND WHETHER EACH ONE IS ACTUALLY WORKING.
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "the ai employee status section does not have an accurate list of who is on duty and there
 *    prob needs to be better UX showing a green dot showing they are working correctly when they
 *    are and that changes to red when they are broken"
 *
 * ─── The accuracy half, which had to be settled before any dot ─────────────
 *
 * The block was not rendering a stale roster or a hardcoded one. It was rendering `busiest`:
 *
 *     SELECT e.id, e.name, e.role, e.lane, COUNT(t.id) AS open_tasks
 *       FROM employees e LEFT JOIN tasks t ON …
 *      WHERE e.status = 'active'
 *      ORDER BY open_tasks DESC, e.name ASC
 *      LIMIT 5
 *
 * EIGHT employees are active in production — Simone, Kendra, Zora, Imani, Monique, Danielle,
 * Camille and Toni. The block showed the five with the most open tasks, so THREE of the eight were
 * absent from "who is on duty" at any moment, and WHICH three changed as the queue moved. A roster
 * sorted by busyness is not a roster; it is a leaderboard with a cut-off, and the people it hides
 * are precisely the ones doing nothing — which is the state you most need to see.
 *
 * The count above the list was right all along (`8 active, 0 paused, 2 retired`), which is what made
 * the block feel almost-correct: the summary counted eight and the list showed five.
 *
 * ─── What green actually asserts ───────────────────────────────────────────
 *
 * A dot is a verdict and it has to mean something falsifiable, or it is decoration that makes a
 * dead employee look healthy.
 *
 *   GREEN — every standing duty this employee owns is on schedule, and none of their last runs
 *           failed. They are working correctly.
 *   RED   — a duty is overdue against ITS OWN schedule, or its last task failed. Broken.
 *   AMBER — nothing has ever run, or they hold no standing duty at all. NOT green: an employee who
 *           has never done anything is the case grey-as-green hides, and "we have no evidence" is a
 *           different statement from "it works".
 *
 * OVERDUE IS `duties/staleness.ts`, NOT A SECOND COPY. The same function the Critical Alert uses,
 * so the dot and the alert can never disagree — and so a Mon/Wed/Fri employee does not go red every
 * weekend, which is the false alert that check was rewritten to stop.
 *
 * EVERY STATE CARRIES ITS SENTENCE. A red dot with no reason is a puzzle, not an alert.
 */

export type EmployeeHealth = "green" | "amber" | "red";

export interface EmployeeDutyRow extends DutyStalenessRow {
  employee_id: string | null;
  /** The status of the duty's last task, where it has one. `failed` is what turns a dot red. */
  last_task_status: string | null;
}

export interface EmployeeRow {
  id: string;
  name: string;
  role: string;
  lane: string;
  open_tasks: number;
}

export interface RosterEntry extends EmployeeRow {
  health: EmployeeHealth;
  /** The word beside the dot, so the state survives greyscale and a colourblind reader. */
  label: string;
  /** Why it is that colour, in one sentence. */
  reason: string;
  duties: number;
}

/** The short word that carries the state when the colour cannot. */
const LABELS: Record<EmployeeHealth, string> = {
  green: "On schedule",
  amber: "No evidence",
  red: "Needs you",
};

export function employeeHealth(employee: EmployeeRow, duties: EmployeeDutyRow[], now = Date.now()): RosterEntry {
  const mine = duties.filter((d) => d.employee_id === employee.id);
  const base = { ...employee, duties: mine.length };

  const failed = mine.filter((d) => d.last_task_status === "failed");
  if (failed.length > 0) {
    return {
      ...base,
      health: "red",
      label: LABELS.red,
      reason:
        `${employee.name}'s last run of "${failed[0]!.name}" failed` +
        (failed.length > 1 ? `, and ${failed.length - 1} other duty of theirs failed too.` : "."),
    };
  }

  const late = mine.map((d) => ({ duty: d, state: dutyStaleness(d, now) })).filter((x) => x.state.stale);
  if (late.length > 0) {
    return {
      ...base,
      health: "red",
      label: LABELS.red,
      reason: late[0]!.state.reason,
    };
  }

  if (mine.length === 0) {
    return {
      ...base,
      health: "amber",
      label: LABELS.amber,
      reason: `${employee.name} holds no standing duty, so nothing here can say whether they work.`,
    };
  }

  if (mine.every((d) => d.last_run_at === null)) {
    return {
      ...base,
      health: "amber",
      label: LABELS.amber,
      reason:
        `None of ${employee.name}'s ${mine.length} dut${mine.length === 1 ? "y" : "ies"} has ever run, so there is ` +
        `nothing to judge them on yet. That is not the same as working.`,
    };
  }

  /*
   * A DUTY DUE TODAY AND NOT YET RUN IS STILL GREEN, and that is the grace the staleness rule
   * already grants — a closed laptop at 07:00 is not a broken employee. The sentence says so rather
   * than pretending the run has happened.
   */
  const pending = mine.filter((d) => dutyStaleness(d, now).missed > 0);
  return {
    ...base,
    health: "green",
    label: LABELS.green,
    reason: pending.length
      ? `${employee.name} is on schedule; "${pending[0]!.name}" is due today and has not run yet.`
      : `${employee.name}'s ${mine.length} dut${mine.length === 1 ? "y" : "ies"} ${mine.length === 1 ? "is" : "are"} on schedule.`,
  };
}

/**
 * The whole roster, every active employee, worst first.
 *
 * WORST FIRST, AND NOBODY CUT OFF. Sorting by health rather than by busyness answers the question
 * the block is for — who needs you — and the absence of a `LIMIT` is the fix: the employees a
 * busyness sort hid are exactly the ones with nothing happening, which is the state most worth
 * seeing.
 */
export function roster(employees: EmployeeRow[], duties: EmployeeDutyRow[], now = Date.now()): RosterEntry[] {
  const rank: Record<EmployeeHealth, number> = { red: 0, amber: 1, green: 2 };
  return employees
    .map((e) => employeeHealth(e, duties, now))
    .sort((a, b) => rank[a.health] - rank[b.health] || b.open_tasks - a.open_tasks || a.name.localeCompare(b.name));
}
