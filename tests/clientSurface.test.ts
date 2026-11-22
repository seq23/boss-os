import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { surfaceFor, westPeekOsUrlFor } from "../src/client/surface";
import { Moved } from "../src/client/Moved";

describe("which surface a navigation gets (chassis retirement, 22 Nov 2026)", () => {
  it("her Boss OS host mounts Boss OS on every path, old fund hashes included", () => {
    for (const path of ["/", "/boss", "/anything"]) expect(surfaceFor("boss.sequoiataylor.com", path)).toBe("boss");
  });

  it("/boss mounts Boss OS on any host (local runs and the e2e suite reach it this way)", () => {
    expect(surfaceFor("localhost", "/boss")).toBe("boss");
    expect(surfaceFor("localhost", "/boss/today")).toBe("boss");
  });

  it("anywhere else gets the moved page, never the old fund screens", () => {
    expect(surfaceFor("localhost", "/")).toBe("moved");
    expect(surfaceFor("boss-os.example.workers.dev", "/")).toBe("moved");
    // A look-alike is not her host, and /bossy is not /boss.
    expect(surfaceFor("boss.sequoiataylor.com.evil.test", "/")).toBe("moved");
    expect(surfaceFor("localhost", "/bossy")).toBe("moved");
  });
});

describe("the moved page", () => {
  it("names West Peek OS and links to the same page there", () => {
    const html = renderToStaticMarkup(createElement(Moved, { hash: "#/dealflow" }));
    expect(html).toContain("<h1>This page has moved</h1>");
    expect(html).toContain('href="https://os.joinwestpeek.com/#/dealflow"');
  });

  it("an odd address lands on West Peek OS's front door; the target origin is never built from it", () => {
    for (const hash of ["", "#", "#/", "#//evil.test", "#/a b", "#/<x>", `#/${"a".repeat(80)}`, "#dealflow"]) {
      expect(westPeekOsUrlFor(hash)).toBe("https://os.joinwestpeek.com/");
    }
    expect(westPeekOsUrlFor("#/fund-strategy")).toBe("https://os.joinwestpeek.com/#/fund-strategy");
  });
});
