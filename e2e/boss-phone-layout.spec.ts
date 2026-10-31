import { test, expect, type Page } from "@playwright/test";
import { provisionLocalD1 } from "./support/provision";
import { unlock, tab, PHONE } from "./support/boss";
import { MOVEMENT_LANES } from "../src/worker/boss/today/body";

/**
 * EVERY TAB, AT THE WIDTH OF HER PHONE, FITS THE SCREEN AND NOTHING SITS ON TOP OF ANYTHING.
 *
 * 31 Oct 2026, her iPhone shot of Spirit: "Somatic — today's rotation" printed each movement one
 * word per line and the monospace "Came up 2026-10-27; nothing was recorded either way." ran 67px
 * past the card, over the label. `.row-val` was `nowrap`, so a sentence in it squeezed the label to
 * nothing and pushed the page 227px wider than the screen — and an iPhone answers that by zooming
 * out, which is the "column narrower than the screen" she saw. Vault did the same with a long
 * filename. `expectNoSidewaysScroll` already existed and only Spirit's own journey called it, with
 * a rotation that never had the long sentence in it.
 *
 * So this walks all nine tabs at 390px, with every <details> open, and fails on:
 *   1. the page scrolling sideways;
 *   2. any element — or the TEXT inside it, which overflows without moving the element's own box —
 *      reaching past the right edge, unless it sits inside a strip that is meant to scroll sideways;
 *   3. two block-level siblings whose text overlaps (the label and its status line, in the defect).
 *
 * The rotation is seeded so every lane carries the long "Came up …" sentence: that is the exact
 * state of her screen, and the state the old CSS could not hold.
 */

const TABS = ["Today", "Inbox", "Capital", "Spirit", "Team", "Memory", "Trading", "Vault", "Systems"] as const;
const SEED = "e2e-phone-";

function seedRotationSql(): string {
  // Every movement in every lane was offered before and never marked done, so whichever one the
  // rotation picks reads "Came up <date>; nothing was recorded either way."
  const chosenAt = Date.UTC(2026, 9, 27, 12);
  const rows = MOVEMENT_LANES.flatMap((lane) =>
    lane.movements.map((m, i) => `('${SEED}${lane.key}-${i}', '2026-10-27', '${lane.key}', '${m.replace(/'/g, "''")}', ${chosenAt})`),
  );
  return `DELETE FROM movement_log WHERE id LIKE '${SEED}%'; INSERT INTO movement_log (id, day_id, lane, movement, chosen_at) VALUES ${rows.join(", ")}`;
}

type Defect = string;

async function phoneDefects(page: Page): Promise<Defect[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const sideways = document.documentElement.scrollWidth - vw;
    if (sideways > 0) out.push(`the page scrolls sideways by ${sideways}px`);

    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? "." + (el as HTMLElement).className.trim().split(/\s+/).join(".") : ""} «${(el.textContent ?? "").trim().slice(0, 50)}»`;
    const shown = (el: Element) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    // A strip built to scroll sideways (a wide table in a scroller, a segmented control) is allowed
    // to be wider than the screen — inside its scroller, never outside it.
    const inSidewaysScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
      }
      return false;
    };
    // The box the text actually paints in: an element's own rect does not grow when a word
    // overflows it, which is exactly how the squeezed label hid from a box-only check.
    const inkBox = (el: Element) => {
      const b = el.getBoundingClientRect();
      // A scroller's own text runs on inside it by design; its box is what sits on the page.
      if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(el).overflowX)) return b;
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      if (t.width === 0 && t.height === 0) return b;
      return { left: Math.min(b.left, t.left), right: Math.max(b.right, t.right), top: Math.min(b.top, t.top), bottom: Math.max(b.bottom, t.bottom) };
    };

    const main = document.querySelector("main.page");
    if (!main) return ["no main.page on screen"];
    for (const el of main.querySelectorAll("*")) {
      if (!shown(el)) continue;
      if (!inSidewaysScroller(el)) {
        const ink = inkBox(el);
        if (ink.right > vw + 1) out.push(`past the right edge by ${Math.round(ink.right - vw)}px: ${name(el)}`);
      }
      const kids = [...el.children].filter((k) => {
        if (!shown(k)) return false;
        const s = getComputedStyle(k);
        return s.display !== "inline" && s.display !== "contents" && s.position !== "absolute" && s.position !== "fixed" && s.position !== "sticky";
      });
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = inkBox(kids[i]!);
          const b = inkBox(kids[j]!);
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 2 && y > 2) out.push(`overlap ${Math.round(x)}×${Math.round(y)}px: ${name(kids[i]!)} / ${name(kids[j]!)}`);
        }
      }
    }
    return [...new Set(out)].slice(0, 20);
  });
}

test.describe("every tab fits a phone (390px)", () => {
  test.beforeAll(() => provisionLocalD1(seedRotationSql()));
  test.afterAll(() => provisionLocalD1(`DELETE FROM movement_log WHERE id LIKE '${SEED}%'`));

  test("Spirit's somatic rotation reads the long status line under the label, inside the card", async ({ page }) => {
    await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
    await unlock(page);
    await tab(page, "Spirit");
    const main = page.locator("main.page");
    await expect(main).toContainText("Somatic — today's rotation");
    const note = main.locator(".row-val", { hasText: "nothing was recorded either way" }).first();
    await expect(note).toBeVisible();
    const row = note.locator("xpath=..");
    const label = row.locator(".row-main");
    const [n, l, r] = [await note.boundingBox(), await label.boundingBox(), await row.boundingBox()];
    expect(n && l && r, "the row, its label and its status line all have boxes").toBeTruthy();
    // Under the label, not beside it; and the label keeps a readable width rather than a word a line.
    expect(n!.y, "status line starts below the label").toBeGreaterThanOrEqual(l!.y + l!.height - 1);
    expect(l!.width, "label width (px)").toBeGreaterThan(200);
    expect(n!.x + n!.width, "status line stays inside its row").toBeLessThanOrEqual(r!.x + r!.width + 1);
    expect(await phoneDefects(page)).toEqual([]);
  });

  for (const name of TABS) {
    test(`${name}: no sideways scroll, nothing past the edge, nothing on top of anything`, async ({ page }) => {
      await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
      await unlock(page);
      await tab(page, name);
      await page.waitForLoadState("networkidle");
      // Expanded sections are part of the screen she reads; open them all before measuring.
      await page.evaluate(() => document.querySelectorAll("main details").forEach((d) => ((d as HTMLDetailsElement).open = true)));
      expect(await phoneDefects(page), `${name} at ${PHONE.width}px`).toEqual([]);
    });
  }
});
