import { expect, it } from "vitest";
import { chiefSignoff } from "../scripts/ops/simone/chief-signoff.mjs";

const head = "a".repeat(40);
const stamp = "Update layout\n\nCo-Authored-By: Simone <simone@sequoiataylor.com>\n";
const pr = { head, branch: "simone/layout", paths: ["src/client/example.tsx"], messages: [stamp], ownerText: [] as string[] };
const pass = (name: string) => `Ship-ready: PASS — ${name} looked at the rendered layout at ${head}; Engineering: PASS`;

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

it("treats a trailer as provenance after a branch rename and rejects a free-text identity", () => {
  for (const name of ["Simone", "Simone (Chief of Staff)", "Another reviewer", "Noelle"]) {
    expect(chiefSignoff({ ...pr, branch: "work/renamed", ownerText: [pass(name)] })).toBe("INDEPENDENT_REVIEW_REQUIRED");
  }
  expect(chiefSignoff({ ...pr, branch: "noelle/feature", messages: ["Update layout"], ownerText: [pass("Simone")] }))
    .toBe("SIMONE_APPROVAL_RECORD_REQUIRED");
  expect(chiefSignoff({ ...pr, branch: "noelle/feature", messages: ["Update layout"], ownerText: [pass("Another reviewer")] }))
    .toBeNull();
});
