import { describe, it, expect } from "vitest";
import { CHECKS, fixBriefs, loadChecklist, loadSites, ogImageSource } from "../src/shared/boss/searchReadiness/audit.mjs";

const site = loadSites().grid_repos.find((s: any) => s.domain === "porchandparty901.com");
const page = (path: string, html: string) => ({ url: `https://${site.domain}${path}`, status: 200, html });
const schema = (price: number) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Offer", price, priceCurrency: "USD" })}</script>`;

describe("p-n-p c5/e9 briefs must measure markup, not formatting or disclosure text", () => {
  it("c5 accepts the visible thousands-separated porch prices, including decimal cents", () => {
    const pages = ["millington-tn", "olive-branch-ms"].map((city) => page(`/areas/${city}-porch-decorating`,
      '<p>$1,200+ · $1,050+ · $1,600+</p>' + [1200, 1050, 1600].map(schema).join("")));
    expect(CHECKS.schema_supported!({ pages }).status).toBe("pass");
    expect(CHECKS.schema_supported!({ pages: [page("/pricing", '<p>$1,200.00</p>' + schema(1200))] }).status).toBe("pass");
  });

  it.each(["$11,200", "$1,200.50", "$1,050", "<script>const price = 1200</script>"])("c5 still rejects an absent exact price: %s", (visible) => {
    expect(CHECKS.schema_supported!({ pages: [page("/pricing", visible + schema(1200))] }).status).toBe("fail");
  });

  it("e9 permits a privacy disclosure and documentation link without a recording script", () => {
    const privacy = page("/privacy-policy", '<h2>Privacy choices</h2><p>We use Microsoft Clarity on our form. You can opt out.</p><a href="https://clarity.microsoft.com/">Microsoft Clarity</a>');
    expect(CHECKS.clarity_scoped!({ site, pages: [privacy] }).status).toBe("pass");
    // Disclosure is not proof of installation for e6 either, when there is a form to record.
    expect(CHECKS.clarity!({ site, home: privacy, files: {}, pages: [privacy, page("/request", "<form></form>")] }).status).toBe("fail");
  });

  it.each([
    '<script src="https://www.clarity.ms/tag/abc"></script>',
    '<script data-clarity-loader>const s=document.createElement("script");s.src="https://www.clarity.ms/tag/abc";document.head.append(s)</script>',
    '<script src="/clarity.js"></script>',
  ])("e9 still rejects an actual loader on privacy and accepts it on a form: %s", (loader) => {
    expect(CHECKS.clarity_scoped!({ site, pages: [page("/privacy-policy", "<p>Privacy choices</p>" + loader)] }).status).toBe("fail");
    expect(CHECKS.clarity_scoped!({ site, pages: [page("/request", "<form></form>" + loader)] }).status).toBe("pass");
  });

  it("e9 ignores loaders inside comments, templates, noscript and JSON-LD", () => {
    const loader = '<script src="https://www.clarity.ms/tag/abc"></script>';
    const inert = `<!--${loader}--><template>${loader}</template><noscript>${loader}</noscript><script type="application/ld+json">{"name":"Microsoft Clarity","url":"https://www.clarity.ms/tag/abc"}</script>`;
    expect(CHECKS.clarity_scoped!({ site, pages: [page("/privacy-policy", inert)] }).status).toBe("pass");
  });

  it("neither verified false positive becomes a new repair brief", () => {
    const pages = [page("/areas/millington-tn-porch-decorating", '<p>$1,200+</p>' + schema(1200)), page("/privacy-policy", '<p>Microsoft Clarity privacy choices</p>')];
    const results = [{ id: "c5", ...CHECKS.schema_supported!({ pages }) }, { id: "e9", ...CHECKS.clarity_scoped!({ site, pages }) }];
    expect(fixBriefs(loadChecklist(), [{ site, host: site.domain, results }])).toEqual([]);
  });
});

describe("b6 reads og:image from a page served on the site's own host", () => {
  // spryexecutiveos.com/ is a deliberate 301 to billionairehighperformancecoach.com/ (7 Nov 2026).
  const og = (img: string) => `<meta property="og:image" content="${img}">`;
  const home = { url: "https://spryexecutiveos.com/", final: "https://billionairehighperformancecoach.com/", status: 200,
    html: og("https://billionairehighperformancecoach.com/assets/og/default-billionairehighperformancecoach.png") };
  const own = { url: "https://spryexecutiveos.com/insights/x", final: "https://spryexecutiveos.com/insights/x", status: 200, html: og("/assets/og/default-spryexecutiveos.png") };
  const files = (src: any) => ({ __og_image: { url: src.image, status: 200, page: src.page } });

  it("skips a homepage that redirected to another site and judges the first own-host page", () => {
    const src = ogImageSource([home, own], "spryexecutiveos.com")!;
    expect(src).toEqual({ page: own.final, image: "https://spryexecutiveos.com/assets/og/default-spryexecutiveos.png" });
    expect(CHECKS.social_tags!({ host: "spryexecutiveos.com", pages: [], files: files(src) }).status).toBe("pass");
  });

  it("still reads the homepage first when it is served on the site's own host", () => {
    const h = { ...home, final: "https://www.spryexecutiveos.com/", html: og("https://spryexecutiveos.com/a.png") };
    expect(ogImageSource([h, own], "spryexecutiveos.com")!.page).toBe(h.final);
  });

  it("still fails an own-host page whose og:image sits on another host", () => {
    const foreign = { ...own, html: og("https://billionairehighperformancecoach.com/a.png") };
    const src = ogImageSource([home, foreign], "spryexecutiveos.com")!;
    const r = CHECKS.social_tags!({ host: "spryexecutiveos.com", pages: [], files: files(src) });
    expect(r.status).toBe("fail");
    expect(String(r.detail)).toContain("billionairehighperformancecoach.com");
  });

  it("finds no source when no page served on the host declares one", () => {
    expect(ogImageSource([home], "spryexecutiveos.com")).toBeNull();
  });
});
