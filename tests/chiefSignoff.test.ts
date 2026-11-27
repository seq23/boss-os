import { expect, it } from "vitest";
import { chiefSignoff, SIGNOFF_NEEDS } from "../scripts/ops/simone/chief-signoff.mjs";

const head = "a".repeat(40);
const stamp = "Update layout\n\nCo-Authored-By: Simone <simone@sequoiataylor.com>\n";
const pr = { head, branch: "simone/layout", paths: ["src/client/example.tsx"], messages: [stamp], body: "", comments: [] as string[] };
const pass = (name: string, at = head) => `Ship-ready: PASS — ${name} looked at the rendered layout at ${at}; Engineering: PASS`;

it("allows a stamped feature diff and refuses an amended commit that lost its trailer", () => {
  expect(chiefSignoff(pr)).toBeNull();
  expect(chiefSignoff({ ...pr, messages: [stamp, "AMEND\n\nCo-Authored-By: Simone <simone@sequoiataylor.com>\n\nChanged body\n"] }))
    .toBe("SIMONE_TRAILER_REQUIRED");
});

it("refuses protected changes even when the same PR removes the checks and tests", () => {
  for (const branch of ["simone/layout", "noelle/cleanup", "work/rc-12abcdef"]) {
    const paths = [".github/workflows/chief-signoff.yml", "tests/chiefSignoff.test.ts"];
    expect(chiefSignoff({ ...pr, branch, paths, messages: branch.startsWith("simone/") ? [stamp] : ["Remove legacy checks"] }))
      .toBe("PROTECTED_PATH");
  }
});

/*
 * #582 review finding 5 (27 Nov 2026): the check refused EVERY PASS on a Simone PR, so once required it
 * would block her PRs forever. It now passes on its condition (an independent reviewer's PASS comment at
 * the current head) and every refusal says what it needs.
 */
it("passes a Simone PR on an independent reviewer's PASS comment at the head, and refuses every other PASS", () => {
  for (const branch of ["simone/layout", "work/renamed"]) {
    const signed = { ...pr, branch };
    expect(chiefSignoff(signed)).toBeNull();
    expect(chiefSignoff({ ...signed, comments: [pass("Another reviewer")] })).toBeNull();
    expect(chiefSignoff({ ...signed, comments: [pass("Another reviewer", head.slice(0, 8))] })).toBeNull();
    // Her own name, the PR body her broker writes, an older commit, or no commit named: refused.
    for (const name of ["Simone", "Simone (Chief of Staff)"]) {
      expect(chiefSignoff({ ...signed, comments: [pass(name)] })).toBe("INDEPENDENT_REVIEW_REQUIRED");
      expect(chiefSignoff({ ...signed, comments: [pass(name), pass("Another reviewer")] })).toBe("INDEPENDENT_REVIEW_REQUIRED");
    }
    expect(chiefSignoff({ ...signed, body: pass("Another reviewer") })).toBe("INDEPENDENT_REVIEW_REQUIRED");
    expect(chiefSignoff({ ...signed, comments: [pass("Another reviewer", "b".repeat(40))] })).toBe("INDEPENDENT_REVIEW_REQUIRED");
    expect(chiefSignoff({ ...signed, comments: ["Ship-ready: PASS — Another reviewer looked at the layout; Engineering: PASS"] }))
      .toBe("INDEPENDENT_REVIEW_REQUIRED");
    // land reads the LAST PASS line: an old-head line after a good one is what land would use.
    expect(chiefSignoff({ ...signed, comments: [pass("Another reviewer"), pass("Another reviewer", "c".repeat(40))] }))
      .toBe("INDEPENDENT_REVIEW_REQUIRED");
  }
  expect(chiefSignoff({ ...pr, branch: "noelle/feature", messages: ["Update layout"], comments: [pass("Simone")] }))
    .toBe("SIMONE_APPROVAL_RECORD_REQUIRED");
  expect(chiefSignoff({ ...pr, branch: "noelle/feature", messages: ["Update layout"], comments: [pass("Another reviewer")] }))
    .toBeNull();
});

it("says what each refusal needs", () => {
  for (const code of ["INCOMPLETE_PR_METADATA", "SIMONE_TRAILER_REQUIRED", "PROTECTED_PATH", "INDEPENDENT_REVIEW_REQUIRED", "SIMONE_APPROVAL_RECORD_REQUIRED"]) {
    expect(SIGNOFF_NEEDS[code], code).toMatch(/\w.{20,}/);
  }
  expect(SIGNOFF_NEEDS.INDEPENDENT_REVIEW_REQUIRED).toMatch(/PR comment by a reviewer other than Simone, naming the current head commit/);
});
