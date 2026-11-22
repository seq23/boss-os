/**
 * A VOICE NOTE NEVER RUNS A WORKER OUT OF MEMORY (review of #517, F1, 22 Nov 2026).
 *
 * A Worker isolate has 128 MB. The vitest Workers pool does not enforce that, so the readers are run
 * here in a child Node (the same V8) capped at 128 MB, on one message with a 12 MB and a 22 MB voice
 * note (the old hand splitter's ceiling was about 22 MB), through every reader a door uses. A parse
 * that builds the attachment as joined base64 strings ran out of memory at 12 MB; bytes do not.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = fileURLToPath(new URL("./fixtures/mimeMemoryChild.mjs", import.meta.url));

describe("the mail readers inside a Worker's 128 MB", () => {
  for (const mb of [12, 22]) {
    it(`a ${mb} MB voice note is read by every reader within the heap a Worker has`, () => {
      const out = execFileSync(process.execPath, ["--max-old-space-size=128", child, String(mb)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 90_000,
      });
      expect(out.trim()).toMatch(/^ok \d+$/);
    });
  }
});
