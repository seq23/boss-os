export const SIMONE = "emp_chief";
export const SIMONE_TOOL_STEPS = 100;

// The employee roster is the source of authority. A new active or paused Ops seat joins the
// managed roster through the same lifecycle as every other seat. The trading lane stays separate.
export const SIMONE_MANAGED_SEATS = `SELECT id FROM employees WHERE lane = 'ops' AND id <> '${SIMONE}'
  AND lifecycle IN ('active', 'provisional') AND status IN ('active', 'paused')`;
