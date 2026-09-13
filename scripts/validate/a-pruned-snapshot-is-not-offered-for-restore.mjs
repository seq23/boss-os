#!/usr/bin/env node
/**
 * A SNAPSHOT YOU CANNOT RESTORE FROM IS NOT OFFERED AS A RESTORE SOURCE — AND DELETING BACKUPS
 * SAYS WHAT IT WILL DELETE FIRST.
 *
 * ─── The defect this is the guard for ───────────────────────────────────────
 *
 * `pruneSnapshots` marks a row `status = 'pruned'`, clears `r2_key`, zeroes `bytes` and KEEPS THE
 * ROW. That is deliberate and correct: the date, hash and table counts survive, so "did we have a
 * copy that night" stays answerable, and a restore attempt against one fails with "pruned" rather
 * than a missing-key error that reads like corruption.
 *
 * The consequence is the thing that needs guarding. Production held 68 `vault_snapshots` rows of
 * which 56 were tombstones. A restore picker that lists rows without filtering offers fifty-six
 * choices that cannot work, on the screen someone is using on the worst day of the system's life.
 *
 * And the other half: `pruneSnapshots` existed, `POST /vault/prune` existed, and NOTHING IN THE UI
 * CALLED EITHER. The owner asked to be able to clear old copies for space and there was no control.
 * The obvious fix — a button beside the restore buttons — is the wrong one, because it makes an
 * irreversible deletion exactly as easy to trigger as a verification.
 *
 * ─── What is actually checked ───────────────────────────────────────────────
 *
 *   1. ONE definition of "restorable", exported, and it tests `status === "complete"`. A row whose
 *      object never finished writing is not restorable either, so `r2_key` is required too.
 *   2. EVERY restore-source list on the Vault screen goes through it. This is the check that stops
 *      the next contributor adding a second picker that filters nothing — the defect is not "the
 *      current filter is wrong", it is "nothing stops a future list from having no filter".
 *   3. The prune control PREVIEWS BEFORE IT DELETES: a read-only preview endpoint exists, the page
 *      calls it, and the delete button is gated behind both a preview and a typed confirmation.
 *   4. The preview and the deletion SHARE ONE SELECTION in the Worker. A preview computed by its
 *      own second query is free to describe different rows from the ones removed, which is worse
 *      than no preview — it manufactures consent for something else.
 *   5. The prune control is NOT an unlabelled button among the restore controls: it carries its own
 *      heading and states what is removed and what is kept.
 *   6. The floor survives. `pruneSnapshots` clamps `keep` so the newest complete snapshot is never
 *      removed whatever number arrives from the screen.
 *   7. The rows are NOT deleted. The prune must still be an UPDATE to `status = 'pruned'`; a
 *      `DELETE FROM vault_snapshots` would destroy the evidence the design exists to preserve.
 *
 * RULE 0: finding zero restore-source lists, or no `restorable` definition, or no prune control, is
 * a HARD FAILURE. Checks 2 and 5 are loops, and a loop over an empty set is how a validator stays
 * green for ever while the thing it guards rots.
 *
 *   node scripts/validate/a-pruned-snapshot-is-not-offered-for-restore.mjs
 *   node scripts/validate/a-pruned-snapshot-is-not-offered-for-restore.mjs --self-test
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PAGE = "src/client/boss/pages/Vault.tsx";
const ROUTES = "src/worker/boss/routes/vault.ts";

/**
 * Every list this screen builds out of `snapshots` for the purpose of CHOOSING one.
 *
 * A `<select>`/`<option>` over snapshots, or any `.map` feeding one, is a restore source. The
 * history list below is deliberately NOT one — it renders rows, it does not offer them — so the
 * discriminator is whether the mapped list ends up inside an `<option>`.
 */
export function restoreSourceLists(source) {
  const out = [];
  // Every `{ <expr>.map((x) => ( … <option … ) ) }` block on the page.
  for (const m of source.matchAll(/\{\s*([A-Za-z_$][\w$.]*)\s*\.map\(/g)) {
    const from = m.index;
    // The body of this map call, bounded by the next map or the end of file — enough to see whether
    // an <option> is produced without swallowing the whole component.
    const nextMap = source.indexOf(".map(", from + m[0].length);
    const body = source.slice(from, nextMap === -1 ? source.length : nextMap);
    if (/<option\b/.test(body)) out.push({ list: m[1], body });
  }
  return out;
}

export function check({ page, routes }) {
  const problems = [];

  // Comments are stripped before any "does the code do X" test, for the reason a sibling validator
  // had to learn: a paragraph explaining that the code does the right thing must not be read as
  // evidence that it does the wrong one.
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const pageCode = code(page);
  const routesCode = code(routes);

  // ── 1. One exported definition of restorable, and it tests the right things ──
  const definition = /export\s+function\s+restorable\s*\([\s\S]*?\n\}/.exec(pageCode);
  if (!definition) {
    problems.push(
      `${PAGE} does not export a \`restorable()\` helper. With no single definition, every list that ` +
      `offers a restore source keeps its own idea of what can be restored from, and they are free to ` +
      `disagree — which is this repository's named defect, applied to backups.`,
    );
    return problems; // RULE 0: nothing further can be checked meaningfully.
  }
  const body = definition[0];
  if (!/status\s*===\s*["']complete["']/.test(body)) {
    problems.push(
      `restorable() in ${PAGE} does not test \`status === "complete"\`. Pruned rows keep their id, ` +
      `date and hash and lose their bytes, so without that test the picker offers snapshots that ` +
      `cannot be restored from — 56 of the 68 rows in production.`,
    );
  }
  if (!/r2_key/.test(body)) {
    problems.push(
      `restorable() in ${PAGE} does not require an \`r2_key\`. A row can read 'complete' while its ` +
      `object never finished writing; offering it promises a restore from a file that is not there.`,
    );
  }

  // ── 2. Every restore-source list goes through it ──────────────────────────
  const lists = restoreSourceLists(pageCode);
  if (lists.length === 0) {
    problems.push(
      `${PAGE} builds ZERO <option> lists. Either the restore picker is gone, or this scan can no ` +
      `longer see it. Both are failures: a scan that examined nothing has proved nothing.`,
    );
  }
  for (const list of lists) {
    // The list must be a name assigned from restorable(...), or restorable(...) inline.
    const assigned = new RegExp(`(?:const|let)\\s+${list.list}\\s*=\\s*restorable\\(`).test(pageCode);
    const inline = /restorable\(/.test(list.list);
    if (!assigned && !inline) {
      problems.push(
        `${PAGE} offers \`${list.list}\` as a restore source and it does not come from restorable(). ` +
        `A picker that lists snapshots without that filter offers tombstones as somewhere to restore ` +
        `from, on the screen someone is using on the worst day of the system's life.`,
      );
    }
  }

  // ── 3. Preview before delete, and a typed confirmation ────────────────────
  if (!/prune-preview/.test(routesCode)) {
    problems.push(
      `${ROUTES} has no read-only prune preview endpoint. Deleting backups must be able to say how ` +
      `many and how many bytes BEFORE it happens; without a preview the only possible control is a ` +
      `button that deletes on the first tap.`,
    );
  }
  if (!/api\.prunePreview\(/.test(pageCode)) {
    problems.push(
      `${PAGE} never calls the prune preview. An endpoint nothing calls is the defect this repository ` +
      `names — \`pruneSnapshots\` and POST /vault/prune both already existed and no screen reached ` +
      `either, which is why there was no way to clear old copies at all.`,
    );
  }
  if (!/api\.pruneSnapshots\(/.test(pageCode)) {
    problems.push(`${PAGE} never calls the prune. The control does not reach the thing it claims to do.`);
  }

  const gate = /confirm\s*!==\s*["']DELETE["']|confirm\s*===\s*["']DELETE["']/.test(pageCode);
  if (!gate) {
    problems.push(
      `${PAGE} does not gate the prune behind a typed DELETE confirmation. A destructive action as ` +
      `easy to trigger as a safe one is a trap regardless of how clear the label is — the same reason ` +
      `Replace demands the literal string REPLACE.`,
    );
  }

  /*
   * The delete button must be unreachable until a preview has been read. Expressed as: the JSX that
   * renders the confirmation and the delete button sits inside a `{preview && ( … )}` guard.
   */
  if (!/\{\s*preview\s*&&\s*\(/.test(pageCode)) {
    problems.push(
      `${PAGE} renders the prune's delete control without a \`{preview && …}\` guard. There must be ` +
      `no path from a single tap to a deletion: the button that deletes should not exist until the ` +
      `reader has been shown what it would remove.`,
    );
  }

  // ── 4. One selection, shared ──────────────────────────────────────────────
  const sharedSelector = /function\s+staleSnapshots\s*\(/.test(routesCode);
  if (!sharedSelector) {
    problems.push(
      `${ROUTES} has no shared selection behind the preview and the prune. Two queries with their own ` +
      `ORDER BY and their own OFFSET arithmetic are free to disagree, and a confirmation that ` +
      `describes different rows from the ones it removes is worse than no confirmation.`,
    );
  } else {
    for (const fn of ["prunePreview", "pruneSnapshots"]) {
      const decl = new RegExp(`async function ${fn}\\s*\\([\\s\\S]*?\\n\\}`).exec(routesCode);
      if (!decl) {
        problems.push(`${ROUTES} no longer declares \`${fn}\` in a shape this scan can read. That is a broken scan, not a clean file.`);
      } else if (!/staleSnapshots\(/.test(decl[0])) {
        problems.push(
          `${ROUTES}'s \`${fn}\` does not use staleSnapshots(). The preview and the deletion must ` +
          `choose the same rows by construction, not by two pieces of matching arithmetic.`,
        );
      }
    }
  }

  // ── 5. Its own labelled section, saying what goes and what stays ──────────
  if (!/Clear old snapshots/.test(page)) {
    problems.push(
      `${PAGE} has no "Clear old snapshots" heading. Deleting backups must not be an unlabelled ` +
      `button among the restore controls; it is the one action on this screen that reduces what the ` +
      `system can recover from.`,
    );
  }
  for (const [what, pattern] of [
    ["what it removes", /Removes \{/],
    ["what it keeps", /Keeps \{/],
    ["that this cannot be undone", /cannot be undone/i],
    // Whitespace-tolerant: JSX prose wraps, and a sentence that means the right thing must not fail
    // this scan because a line break landed in the middle of it.
    ["that the newest is never removed", /newest\s+complete\s+snapshot\s+is\s+never\s+removed/i],
  ]) {
    if (!pattern.test(page)) {
      problems.push(
        `${PAGE}'s prune control does not state ${what}. A destructive confirmation that does not ` +
        `say plainly what will be removed and what will be kept is not a confirmation.`,
      );
    }
  }

  // ── 6. The floor ──────────────────────────────────────────────────────────
  if (!/Math\.max\(1,\s*keep\)/.test(routesCode)) {
    problems.push(
      `${ROUTES} does not clamp \`keep\` with Math.max(1, keep). A retention bug that empties the ` +
      `vault is strictly worse than one that keeps too much, and the screen can now send any number.`,
    );
  }

  // ── 7. The rows outlive their objects ─────────────────────────────────────
  if (/DELETE\s+FROM\s+vault_snapshots/i.test(routesCode)) {
    problems.push(
      `${ROUTES} contains a DELETE FROM vault_snapshots. The row must survive its object — that is ` +
      `what keeps vault history readable and makes a restore against a pruned snapshot say "pruned" ` +
      `rather than fail with a missing key that reads like corruption.`,
    );
  }
  if (!/status\s*=\s*'pruned'/.test(routesCode)) {
    problems.push(`${ROUTES} no longer marks rows 'pruned'. A prune that leaves no tombstone leaves no evidence.`);
  }

  return problems;
}

// ─── Self-test ──────────────────────────────────────────────────────────────

function selfTest() {
  const goodPage = `
import { api } from "../api";
export function restorable(snapshots: any[]) {
  return snapshots.filter((s) => s.status === "complete" && s.r2_key);
}
function RestorePanel({ snapshots }) {
  const options = restorable(snapshots);
  return (
    <select>
      {options.map((s) => (
        <option key={s.id} value={s.id}>{s.label}</option>
      ))}
    </select>
  );
}
function PrunePanel() {
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState("");
  async function look() { setPreview(await api.prunePreview(asked)); }
  return (
    <>
      <p className="eyebrow">Clear old snapshots</p>
      <p>the newest complete snapshot is never removed whatever number you choose</p>
      <button onClick={look}>Show me what this would remove</button>
      {preview && (
        <div>
          <div>Removes {preview.removing} snapshots</div>
          <div>Keeps {preview.keeping} snapshots</div>
          <span>This cannot be undone. Type DELETE to confirm.</span>
          <button disabled={confirm !== "DELETE"} onClick={() => api.pruneSnapshots(asked)}>go</button>
        </div>
      )}
    </>
  );
}
`;
  const goodRoutes = `
async function staleSnapshots(env, keep) {
  const floor = Math.max(1, keep);
  return { floor, rows: [] };
}
export async function prunePreview(env, keep = SNAPSHOT_KEEP) {
  const { floor, rows } = await staleSnapshots(env, keep);
  return { keep: floor };
}
export async function pruneSnapshots(env, keep = SNAPSHOT_KEEP) {
  const { floor, rows } = await staleSnapshots(env, keep);
  for (const r of rows) {
    await env.DB.prepare("UPDATE vault_snapshots SET status = 'pruned' WHERE id = ?").run();
  }
}
vault.get("/prune-preview", async (c) => ok(c, await prunePreview(c.env)));
`;

  const cases = [
    { name: "the shipped shape passes", page: goodPage, routes: goodRoutes, expect: 0 },
    {
      name: "THE DEFECT: the picker maps raw snapshots instead of restorable()",
      page: goodPage.replace("const options = restorable(snapshots);", "const options = snapshots;"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "a SECOND picker added later with no filter is caught",
      page: goodPage.replace(
        "function PrunePanel() {",
        `function QuickRestore({ snapshots }) {
  return <select>{snapshots.map((s) => (<option key={s.id}>{s.label}</option>))}</select>;
}
function PrunePanel() {`,
      ),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "restorable() that forgets the status test",
      page: goodPage.replace('s.status === "complete" && s.r2_key', "s.r2_key"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "restorable() that forgets r2_key",
      page: goodPage.replace('s.status === "complete" && s.r2_key', 's.status === "complete"'),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "RULE 0 — restorable() removed entirely",
      page: goodPage.replace(/export function restorable[\s\S]*?\n\}/, ""),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "RULE 0 — no <option> list on the page at all",
      page: goodPage.replace(/<option[\s\S]*?<\/option>/, "<div>{s.label}</div>"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "a delete button with no preview guard",
      page: goodPage.replace("{preview && (", "{true && (").replace(/\{\s*preview\s*&&\s*\(/, "{(").replace("{(", "{ ("),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "a delete with no typed confirmation",
      page: goodPage.replace('disabled={confirm !== "DELETE"}', "disabled={false}"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "the page never calls the preview endpoint",
      page: goodPage.replace("await api.prunePreview(asked)", "null"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "no preview endpoint in the Worker",
      page: goodPage,
      routes: goodRoutes.replace(/vault\.get\("\/prune-preview"[\s\S]*?\n/, "").replace("prune-preview", "x"),
      expect: 1,
    },
    {
      name: "the preview computing its own second selection",
      page: goodPage,
      routes: goodRoutes.replace(
        "export async function prunePreview(env, keep = SNAPSHOT_KEEP) {\n  const { floor, rows } = await staleSnapshots(env, keep);",
        "export async function prunePreview(env, keep = SNAPSHOT_KEEP) {\n  const rows = await env.DB.prepare('SELECT id FROM vault_snapshots ORDER BY ts DESC LIMIT -1 OFFSET ?').all();",
      ),
      expect: 1,
    },
    {
      name: "the floor removed, so a keep of 0 could empty the vault",
      page: goodPage,
      routes: goodRoutes.replace("Math.max(1, keep)", "keep"),
      expect: 1,
    },
    {
      name: "the prune deleting rows instead of marking them",
      page: goodPage,
      routes: goodRoutes.replace(
        `"UPDATE vault_snapshots SET status = 'pruned' WHERE id = ?"`,
        `"DELETE FROM vault_snapshots WHERE id = ?"`,
      ),
      expect: 1,
    },
    {
      name: "the control losing its own heading and becoming a bare button",
      page: goodPage.replace("Clear old snapshots", "Prune"),
      routes: goodRoutes,
      expect: 1,
    },
    {
      name: "a confirmation that does not say what is kept",
      page: goodPage.replace("<div>Keeps {preview.keeping} snapshots</div>", ""),
      routes: goodRoutes,
      expect: 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const found = check({ page: c.page, routes: c.routes }).length;
    const ok = c.expect === 0 ? found === 0 : found >= 1;
    if (!ok) {
      failed += 1;
      console.error(`  FAIL  ${c.name} — expected ${c.expect === 0 ? "no" : "at least one"} problem, found ${found}`);
    }
  }

  if (failed) {
    console.error(`\na-pruned-snapshot-is-not-offered-for-restore self-test: ${failed}/${cases.length} fixtures wrong.`);
    process.exit(1);
  }
  console.log(`a-pruned-snapshot-is-not-offered-for-restore self-test: ${cases.length}/${cases.length} fixtures detected correctly.`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const missing = [PAGE, ROUTES].filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(
      `a-pruned-snapshot-is-not-offered-for-restore FAILED — ${missing.join(" and ")} missing. A scan ` +
      `whose subject does not exist has examined nothing and must fail.`,
    );
    process.exit(1);
  }

  const problems = check({
    page: readFileSync(join(ROOT, PAGE), "utf8"),
    routes: readFileSync(join(ROOT, ROUTES), "utf8"),
  });

  if (problems.length) {
    console.error("a-pruned-snapshot-is-not-offered-for-restore FAILED\n");
    for (const p of problems) console.error(`  • ${p}\n`);
    process.exit(1);
  }

  const lists = restoreSourceLists(readFileSync(join(ROOT, PAGE), "utf8"));
  console.log(
    `a-pruned-snapshot-is-not-offered-for-restore: ${lists.length} restore-source list(s), all filtered ` +
    `through restorable(); the prune previews before it deletes, shares one selection with it, and ` +
    `keeps the newest. OK.`,
  );
}
