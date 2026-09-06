import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The deployed host serves Boss OS, and the fund OS nowhere on it.
 *
 * There is no server to assert against: Cloudflare's assets binding answers "/" without invoking
 * the Worker, which is why the first fix - a redirect in the fetch handler - deployed and did
 * nothing. So the decision lives in the client entry, and this checks the entry rather than a
 * request. A DOM test would prove React mounts; this proves the RULE, which is the part that was
 * wrong.
 */
const main = readFileSync(new URL("../src/client/main.tsx", import.meta.url), "utf8");

/** The predicate as the shipped file states it. */
const BOSS_HOSTS = new Set(
  JSON.parse((main.match(/const BOSS_HOSTS = new Set\((\[[^\]]*\])\)/) ?? [])[1] ?? "[]"),
);
const mounts = (hostname: string, pathname: string) =>
  BOSS_HOSTS.has(hostname) || pathname === "/boss" || pathname.startsWith("/boss/") ? "boss" : "chassis";

describe("which app the deployed host mounts", () => {
  it("mounts Boss OS at the root of boss.sequoiataylor.com", () => {
    expect(mounts("boss.sequoiataylor.com", "/")).toBe("boss");
  });

  it("mounts Boss OS everywhere on that host, so the fund UI has no entrance", () => {
    for (const p of ["/", "/dealflow", "/portfolio", "/fund-strategy", "/companies", "/anything"]) {
      expect(mounts("boss.sequoiataylor.com", p)).toBe("boss");
    }
  });

  it("still mounts the chassis on localhost, because 129 E2E journeys drive it at /", () => {
    expect(mounts("localhost", "/")).toBe("chassis");
    expect(mounts("127.0.0.1", "/dealflow")).toBe("chassis");
  });

  it("still reaches Boss OS at /boss anywhere, which is how the E2E suite drives it", () => {
    expect(mounts("localhost", "/boss")).toBe("boss");
    expect(mounts("localhost", "/boss/anything")).toBe("boss");
  });

  it("names the host rather than pattern-matching it", () => {
    // "Does this look like a Boss host" is a question with a wrong answer, and the wrong answer
    // here puts one business's interface on another's domain.
    expect(main).not.toMatch(/hostname\.(includes|startsWith|match)/);
    expect(BOSS_HOSTS.size).toBeGreaterThan(0);
  });
});
