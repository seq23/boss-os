// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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

  it("her host in its fully-qualified form (trailing dot) or another case is still her host", () => {
    expect(surfaceFor("boss.sequoiataylor.com.", "/")).toBe("boss");
    expect(surfaceFor("Boss.SequoiaTaylor.com", "/")).toBe("boss");
    expect(surfaceFor("boss.sequoiataylor.com..", "/")).toBe("moved");
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function mountMoved(hash: string): HTMLElement {
  window.location.hash = hash;
  document.body.innerHTML = '<div id="root"></div>';
  const el = document.getElementById("root") as HTMLElement;
  root = createRoot(el);
  act(() => root!.render(createElement(Moved)));
  return el;
}

const href = (el: HTMLElement) => el.querySelector("a")?.getAttribute("href");

describe("the moved page", () => {
  it("names West Peek OS and links to the same page there", () => {
    const el = mountMoved("#/dealflow");
    expect(el.querySelector("h1")?.textContent).toBe("This page has moved");
    expect(href(el)).toBe("https://os.joinwestpeek.com/#/dealflow");
  });

  it("follows the address when only the hash changes (a second old link in the same tab)", async () => {
    const el = mountMoved("#/dealflow");
    await act(async () => {
      window.location.hash = "#/portfolio";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(href(el)).toBe("https://os.joinwestpeek.com/#/portfolio");
  });

  it("an odd address lands on West Peek OS's front door; the target origin is never built from it", () => {
    for (const hash of ["", "#", "#/", "#//evil.test", "#/a b", "#/<x>", `#/${"a".repeat(80)}`, "#dealflow"]) {
      expect(westPeekOsUrlFor(hash)).toBe("https://os.joinwestpeek.com/");
    }
    expect(westPeekOsUrlFor("#/fund-strategy")).toBe("https://os.joinwestpeek.com/#/fund-strategy");
  });
});
