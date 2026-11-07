import { describe, it, expect } from "vitest";
import { CHECKS, loadSites } from "../src/shared/boss/searchReadiness/audit.mjs";

/**
 * c3 asks for "the business type THAT FITS, fully filled". Until 3 Nov 2026 it read the site's
 * `kind` to decide which shape it would accept, so cynthiabrowndds.com — a dentist's site with two
 * real offices, classed "brand" — was asked for a priced Offer, the one thing dental advertising
 * rules and that repo's own claims gate forbid it to publish. These pin the new truth: a fully
 * filled LocalBusiness counts on ANY site, and a site with neither shape still fails.
 */
const sites = loadSites().grid_repos;
const brand = sites.find((s: any) => s.domain === "cynthiabrowndds.com");
const hyperlocal = sites.find((s: any) => s.kind === "hyperlocal");

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const ctx = (site: any, html: string) => ({ site, pages: [{ url: `https://${site.domain}/`, status: 200, html }] });

const FILLED = {
  "@type": ["Dentist", "LocalBusiness"],
  name: "Dr. Cynthia Brown, DDS",
  url: "https://cynthiabrowndds.com",
  telephone: "+1-662-408-3352",
  address: { "@type": "PostalAddress", streetAddress: "8179 McGregor Crossing", addressLocality: "Olive Branch", addressRegion: "MS", postalCode: "38654" },
  areaServed: ["Olive Branch, Mississippi"],
};
const PRICED = { "@type": "Product", name: "A thing", offers: { "@type": "Offer", price: 29, priceCurrency: "USD" } };

describe("c3 accepts the business type that fits, whatever the site's kind", () => {
  it("a brand site passes on a fully filled LocalBusiness, with no price anywhere", () => {
    expect(brand, "cynthiabrowndds.com must still be in sites.json").toBeTruthy();
    expect(brand.kind).toBe("brand");
    const r = CHECKS.business_type!(ctx(brand, ld(FILLED)));
    expect(r.status).toBe("pass");
    expect(r.detail).toMatch(/telephone, address and areaServed/);
  });

  it("a brand site still passes on a priced Offer", () => {
    expect(CHECKS.business_type!(ctx(brand, ld(PRICED))).status).toBe("pass");
  });

  it("a brand site with neither shape still fails, and is told both are missing", () => {
    const r = CHECKS.business_type!(ctx(brand, ld({ "@type": "WebPage", name: "x" })));
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/priced Offer/);
    expect(r.detail).toMatch(/LocalBusiness with telephone, address and areaServed/);
  });

  it.each([
    ["no telephone", { ...FILLED, telephone: undefined }],
    ["no address", { ...FILLED, address: undefined }],
    ["no areaServed", { ...FILLED, areaServed: undefined }],
  ])("a half-filled LocalBusiness does not pass a brand site: %s", (_why, node) => {
    expect(CHECKS.business_type!(ctx(brand, ld(node))).status).toBe("fail");
  });

  it("a hyperlocal site is unchanged: filled passes, and its failure still names LocalBusiness only", () => {
    expect(hyperlocal, "sites.json must still have a hyperlocal site").toBeTruthy();
    expect(CHECKS.business_type!(ctx(hyperlocal, ld(FILLED))).status).toBe("pass");
    const r = CHECKS.business_type!(ctx(hyperlocal, ld(PRICED)));
    expect(r.status).toBe("fail");
    expect(r.detail).toBe("no LocalBusiness with telephone, address and areaServed on any sampled page");
  });
});
