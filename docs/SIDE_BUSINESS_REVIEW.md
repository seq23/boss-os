Source: https://claude.ai/artifact/2XkmYNmppidkqr4SU8xwiv

Repo copy; the page is the living version; refreshed when it changes.

Copied 12 Oct 2026 from the version last updated 11 Oct 2026, 13:40 CDT.

# Side Business Review

*Spry Labs side businesses · review as of Friday 9 October 2026 · search update Saturday 11 October 2026*

## Eight repos, seven businesses, one shared defect

Every site had been building search presence with nothing to sell and nobody being asked to buy. **Each one now has a price, a working checkout and a way to reach buyers**, and outreach runs by itself. None of it has had time to show revenue yet. The 11 October search update below adds the second shared defect: the sites were never submitted to Google.

| Count | Meaning |
|---|---|
| 7 | businesses fixed |
| 8 | repos changed (local guides is two) |
| 9 | sites sending outreach |
| 10/day | outreach cap per site, auto-pause on bounces |
| 2 live · 0 pending | affiliate programs (Amazon, Bookshop) |

## Search update (10–11 October 2026)

Search Console was read for every site for the first time (28 days, 11 September to 8 October). **About 1,600 impressions and 4 clicks a month across the whole portfolio.** Where Google shows a page at all it sits at position 45 to 100, which nobody sees. aplayermode.com had been published with a noindex tag and no robots, sitemap or llms file; all fixed and live on 10 October.

| Site | Impressions | Clicks | Where the impressions sit |
|---|---|---|---|
| theaccidentguides.com | 902 | 0 | average position 64 |
| dentistryguides.com | 482 | 0 | "&lt;state&gt; dental license" searches, dentists not patients, position 63 |
| porchandparty901.com (Kerseta) | 66 | 0 | party-planner queries on the homepage only, positions 22 to 34 |
| weddingbudgetspreadsheet.com | 57 | 0 | |
| weddingchecklistpdf.com | 51 | 1 | "printable wedding checklist"; money page at 63, elopement and courthouse guides at about 7 |
| neuroevalguides.com | 39 | 2 | both clicks on the testing-cost-by-state guide |
| hormonesivhair.com | 31 | 0 | all TRT/HRT intent; the red-flags guide ranks 2.5 when shown |
| theindustryguides.com | 13 | 0 | two queries, brand query at position 97 |
| approvalprep.com | 10 | 0 | legal and utility pages, positions 78 to 100 |
| uscisexam.com | 10 | 0 | USCIS field-office searches, not the doctor-lead intent |
| weddingseatingchartmaker.com | 8 | 0 | |
| weddingtimelinetemplate.com | 2 | 1 | |
| aplayermode.com | 1 | 0 | expected; first real read about four weeks after 10 October |

### What this says

- **The root cause is discovery, not content.** On porchandparty901.com, Google had indexed 1 of 116 pages; 37 were crawled and not indexed, 78 were unknown to Google. Sitemaps had never been submitted to Search Console. The same check is now running on every property.
- **Zero of the 240 target queries in the citation-velocity target set appear in any property.** The content programs optimise for searches Google has never shown these sites for.
- **What ranks when shown is a specific question guide** (TRT red flags, neuro testing cost by state, elopement checklist), never a state page or a hub.
- **Two sites draw the wrong audience:** dentistryguides pulls dentists checking licences; uscisexam pulls people looking for USCIS offices.
- **The technical layer was already strong:** Lighthouse SEO 92 to 100 on every homepage. Technical fixes alone will not move traffic.

### Done 10–11 October

- `live` **aplayermode.com:** noindex removed, robots/sitemap/llms/favicon served, full structured data (Organization, WebSite, SoftwareApplication with the three plan offers, Product, FAQPage, speakable), social tags with its own image, Clarity, 59-word definition under the H1. Lighthouse SEO 61 → 100, performance 88 → 97. app.aplayermode.com got a description, canonical and noindex on sign-up and billing routes.
- `live` **Porch & Party (Kerseta, not Spry):** phone 901-355-1518 and the Google Business Profile link on every page; Search Console collection wired into the daily cycle; homepage retitled to the party-planner queries Google already matches, new planner page, 22 measured targets replacing 120 unmeasured ones, new pages frozen until a query has a number, consolidation ledger (87 pages into 12) ready for next week's decision, sitemap dates honest again. Marketplaces, Instagram and review asks declined by the owner.
- `live` **Portfolio Search Console workflow** in local-guides-citation-velocity: one dispatch reads every property the service account can see.
- `landed 11 Oct` **Plan A, hygiene pass, every site verified live afterwards.** Each site now serves favicon, apple-touch icon and manifest; complete og and twitter tags with its own 1200×630 image; structured data to the aplayermode standard (WebSite, WebPage with speakable, Organization, Breadcrumb, FAQPage only where Q&A is visible); a 40–60 word definition under the H1; Clarity; an IndexNow key with a ping after every deploy; and one blocking validator per item, each proven by breaking it once. Rule applied in the two local-guides repos: new additions sit in a registry read by a hard-fail test, and brittle validators were rewritten rather than obeyed.

| Repo · sites | PRs | Beyond the checklist | Lighthouse SEO |
|---|---|---|---|
| sprylabs-hpc-site · aplayermode.com | #127 #128 | noindex removed; robots, sitemap, llms served by the Worker; internal-registry exclusion moved to config | 61 → 100 |
| aplayer-mode · app.aplayermode.com | #56 | description, canonical, noindex on sign-up and billing routes | n/a |
| p-n-p · porchandparty901.com | #25 #26 #27 #28 #29 | phone and Google listing everywhere; Search Console in the daily cycle; party-planner retitle and page; 22 measured targets; publishing freeze; honest sitemap dates | 100 → 100 |
| approvalprep · approvalprep.com | #43 | 8 guide pages were unreachable by any link, now linked; schema with no matching content removed; Product on the 7 kit pages; legal pages noindexed | 100 → 100 |
| dream-wedding-builder · 4 wedding sites | #28 | weddingchecklistpdf had no schema because its homepage is its own page, not the shared template: one builder now; meta description was hidden from non-bot user agents | 92 → 100 (three sites) |
| horse-legal-guide-velocity · horselegalguide.com | #47 #48 | sitemap index verified at 323 pages; lastmod now tracks content only; IndexNow 403 retry | 100 → 100 |
| authority-backlink-network · 3 library sites | #112 #113 | doubled homepage titles ("X \| X") fixed and guarded; footer contrast fixed; each publication's own editorial company in every schema node | 100 → 100 |
| local-guides-generator + citation-velocity · 6 sites | #55 · #178 | site-hygiene registry with a hard-fail test in both repos; two brittle validators rewritten; velocity at its 40-blocker cap | 100 → 100 |

- `landed 11 Oct` **Plan B, demand re-point per site.** Every site in the table further down now records Search Console queries and index coverage daily, carries a target set built only from queries Google has actually shown it for (unmeasured targets dropped with the reason), holds new pages until their query has a number, and has a consolidation ledger ready for the merge PRs.
- `done 11 Oct` **Portfolio index coverage, all 23 Search Console properties.** Sitemaps were already registered on 20 of 23; aplayermode.com, horselegalguide.com and detoxdenver.org had none, 26 sitemaps were submitted and accepted. Then URL Inspection on up to 111 pages per site (2,000 a day is Google's limit). So the earlier reading was wrong in one respect: missing sitemaps explain only the three new sites. On Porch & Party and the five local-guides canonicals Google has the sitemap, has fetched it, and has chosen not to index most of the pages. That is a page-quality and duplication verdict, and it is what Plan B's consolidation step answers.

| Site | Pages inspected | Indexed | Crawled, not indexed | Discovered, not crawled | Unknown to Google |
|---|---|---|---|---|---|
| professionalresourcelibrary.com | 110 | 110 | 0 | 0 | 0 |
| founderoperatorlibrary.com | 111 | 109 | 2 | 0 | 0 |
| horselegalguide.com | 111 | 104 | 4 | 0 | 3 |
| weddingbudgetspreadsheet.com | 25 | 24 | 0 | 0 | 0 |
| memphisvendorlibrary.com | 105 | 93 | 1 | 10 | 1 |
| weddingseatingchartmaker.com | 25 | 21 | 0 | 3 | 0 |
| virtualagency-os.com | 110 | 86 | 12 | 4 | 2 |
| weddingchecklistpdf.com | 54 | 40 | 2 | 9 | 2 |
| billionairehighperformancecoach.com | 111 | 71 | 0 | 27 | 13 |
| approvalprep.com | 99 | 58 | 1 | 34 | 6 |
| weddingtimelinetemplate.com | 27 | 15 | 0 | 9 | 2 |
| dentistryguides.com | 111 | 25 | 60 | 11 | 14 |
| theaccidentguides.com | 110 | 20 | 75 | 12 | 2 |
| neuroevalguides.com | 111 | 16 | 58 | 14 | 21 |
| hormonesivhair.com | 111 | 12 | 65 | 14 | 18 |
| theindustryguides.com | 110 | 12 | 10 | 70 | 17 |
| uscisexam.com | 110 | 7 | 32 | 49 | 18 |
| porchandparty901.com | 110 | 1 | 35 | 0 | 74 |
| aplayermode.com | 1 | 1 | 0 | 0 | 0 |

Not shown: spryexecutiveos.com and thedentistryguides.com (their sitemaps live on a sibling host, so inspection errored), detoxdenver.org (its sitemap names diannesplacerecoveryservices.com, which is not a property yet), hicksconsulting.org (91 of 111 indexed, no work requested). Read down the table: the library network and horselegalguide are healthy; the five local-guides canonicals and Porch & Party are where Google has seen the pages and declined them.

### Plan B ledger

| Repo · sites | PRs | Targets (measured only) | Pages strengthened | Consolidation candidates | Found and fixed on the way |
|---|---|---|---|---|---|
| p-n-p · porchandparty901.com | #27 #28 | 22 (from 120) | homepage + new birthday-party-planner page | 87 → 12 hubs | daily sitemap-date churn; URL Inspection too slow for the cycle, now 8 in parallel |
| local-guides-generator · 5 canonicals | #56 #57 | 368 | 6 (neuro cost, TRT red flags, dental implant cost…) | 69 | dentists on licence queries → $249 listing; USCIS field-office searchers → civil-surgeon finder + lead form; duplicate FAQPage blocks removed |
| local-guides-citation-velocity · theindustryguides.com | #180 | 8 (from 240) | 3 (links only; already strong) | 0 | one brittle validator rewritten; still at the 40-blocker cap |
| approvalprep · approvalprep.com | #44 #45 | 16 | employment-verification letter, SBA checklist, apartment approval, each with a buy button | 27 → 15 hubs | a query fell out of the 28-day window and reddened a run; a query-history file now keeps every measured query |
| dream-wedding-builder · 4 sites | #29 | 28 | elopement, courthouse, destination checklists; printable-checklist money page | 21 | no ceremony guide exists; its query is measured and waits for one |
| dianne-place-recovery-services · detoxdenver.org | #2 | GSC live, no query rows yet | ranking pages titled, FAQs, call button | 6 | **every canonical pointed at a Webador site you don't control**; fixed, sitemap accepted, 92/112 indexed; no Google Business Profile exists |
| WPP-llm · virtualagency-os.com | #37 #38 | 482 | the 3 pages Google shows; brand capture ("West Peak") | 191 | **149 ranked URLs returned 404** (72% of 90-day impressions); all now 301 to their live copies, guarded |
| horse-legal-guide-velocity · horselegalguide.com | #50 #51 #52 #53 | 84 (931 unmeasured phrasings dropped) | 4 (homepage, sale-and-purchase hub, two start-a-horse-business guides) | 20 thin pages → hubs | 315/323 indexed; IndexNow ping waited on a build a bot commit replaced; daily commits now rebase before push |
| authority-backlink-network · 3 library sites | #116 | 11 founder · 34 professional · 0 memphis (all its queries anonymised) | 12 (4 + 5 + 3), "Most-read guides" list on each homepage | 2 · 1 · 11 | coverage healthy (117/119, 421/422, 93/105); publishing freeze from 12 Oct; paid citation probe confirmed refusing with its named stop |
| hicks-consulting-canonical · hicksconsulting.org | #36 #37 | daily GSC truth live: 1,579 impr / 25 clicks / pos 7.5 | 2 (Black therapist Memphis page, homepage); client H1 untouched | — | apex now 301s to www (worker, smoke-tested); stale apex sitemap deleted from Search Console; Google Business Profile is the client's, not touched; client update email sent 11 Oct |
| sprylabs-hpc-site · billionairehighperformancecoach.com + spryexecutiveos.com | #132 #133 #134 | 15 + 9 families | 8 per host (AI executive coaching, coaching cost, BetterUp alternatives, review cadence; daily execution loop, AI chief of staff…) | ai-executive-coach split across both hosts → 25 Oct decision | **each host listed the other's sitemap** (the Search Console 400s and 109/110 failed Spry inspections); edge kept serving the old robots.txt; retrofit stacked up to 5 panels and wrote into the product page; 32 pages had 2–3 FAQ blocks, now one |

### The backlink network, measured 11 October

- **It was switched off at the link level.** The three library sites (memphisvendorlibrary, professionalresourcelibrary, founderoperatorlibrary) carried 341 links into the portfolio, every one marked `rel="nofollow sponsored"`, which tells Google to pass nothing. Every page's byline also said "a subsidiary of Spry Labs".
- **Your decision:** followed links, no Spry Labs mention. Landed as authority-backlink-network #114: 125 followed links pointing at the 63 pages Plan B strengthened, anchors matching the target titles, capped at 25% of a site's links per domain and 10 per URL (ApprovalPrep had 141 from one site, now 10); zero "Spry Labs" across 667 files and no parent company in any schema; client sites (Hicks, Dianne's Place) keep nofollow. The risk was stated and accepted: commonly owned sites passing link value is a pattern search engines treat as a link scheme, and Semrush already labels the network a PBN.
- **Kept, on your decision (11 Oct):** a one-line common-ownership disclosure ("under common ownership with…") near citations, in footers and on the masthead, with no company named. The libraries recommend your medical, legal and immigration properties, and undisclosed common ownership inside an endorsement is what the FTC acts on.

### Afternoon of 11 October: nothing paid, a weekly report, and the red sites explained

- **Nothing paid, anywhere.** The one OpenRouter key every site repo and How We Know used ("Repo Operator", in your seq.taylor account) had spent $98.84 of $110 since August on Sonnet and Haiku calls. It is capped at $0 a month in the dashboard, and every repo now routes every model call through one router that accepts only `:free` models (Nemotron 3 Ultra and Super, Gemma 4 31B and 26B), with `max_cost_usd 0` and a test that fails on any paid id. Probes run only by hand behind `confirm_paid=true`. The Twin discovery engine is paused on demand only. How We Know keeps working: a draft a free model fumbles retries free, then becomes the usual author-required note and returns next Monday.
- **A weekly search-outcome report replaces looking.** Every Monday 08:00 Chicago, local-guides-citation-velocity computes week-over-week for all 23 properties, emails the owner as The Industry Guides <hello@theindustryguides.com> (since 12 Oct), and opens one issue per RED site that closes itself when the number recovers. It now also runs free query discovery: 2,166 candidate questions from 224 measured seeds (Google autocomplete, $0), which feed FAQ and H2 questions on existing pages and cannot create a page until Google shows an impression for them.
- **Week 41's four RED sites, root-caused:** billionairehighperformancecoach 499→356 and hicksconsulting 569→305 were both the week after a one-week high (a title rewrite on 25 Sep; a batch of resources pages Google tested and dropped); named-query impressions on BHPC actually rose. spryexecutiveos 89→45 is its normal swing on ~10 a day. weddingbudgetspreadsheet 24→1 had a stale www sitemap, deleted. No page defect behind any of them, three real crawl defects fixed on the way (ledger above).
- **Measured loops now run daily in every site repo** (Search Console truth, index coverage, sitemap status, measured-only targets, strengthening ledger, consolidation candidates, publishing freeze). Horse legal, the three libraries and Hicks joined today; the ledger above has all nine repos.
- **Orphan Cloudflare Pages projects:** builds disabled (API delete refused); the Friday CI sweep finishes the delete.
- **Search Readiness Checklist page, version 2:** a "Doing all of it for $0" section with the before/after cost table, ten tickable items for the $0 posture in a new repo, and the five-step recipe naming the template files.

### Also on 11 October

- **Airtable click read-back fixed:** the LKG Pages Leads token gained `data.records:read`; the daily cycle now records clicks on the two audience CTAs (zero so far, they went live today).
- **Clarity:** a project created for Dianne's Place (you accepted Clarity's sensitive-data terms); it loads only after a visitor accepts analytics cookies.

## Email and company update, Monday 12 October 2026

- **One company behind the guides: The Industry Guides.** All five local-guides canonicals (USCIS Exam Guides, The Dentistry Guides, Hormone Optimization Guides, Neuro Evaluation Guides, The Accident Guides) now carry the same footer, "A property of The Industry Guides · Contact: hello@theindustryguides.com", on every page, 404 included, and the About, Methodology, Contact, For Providers and Request Assistance pages say the same. Spry Labs and spryvc.com are gone from the sites, and a build check fails on any return. Monique's outreach footer names The Industry Guides too; the Clinica San Miguel follow-ups (16 Oct onward) carry it.
- **One contact address.** hello@theindustryguides.com routes through Cloudflare Email Routing to the cryptoclearr inbox. Lead emails from the five request-assistance forms send as The Industry Guides through its own Resend team (two proof leads delivered, two Airtable rows).
- **The weekly search report had never reached you.** Every Monday run since it was built failed on a self-comparison bug (it checked last week's discovery results against the list it had just rewritten). Fixed in local-guides-citation-velocity #192; the proof run delivered "Search outcomes 2026-W42: 4 RED, 11 WATCH, 8 GREEN", now sent as The Industry Guides (#191).
- **Who controls the outgoing email: not only the Mac.** 21 live Boss OS and side-business sending paths: 8 on Cloudflare, 6 on GitHub Actions, 6 Mac launchd, 1 only with a session open. Every path that reaches an outsider runs in the cloud; the Mac-only ones reach your own inbox. The full ledger, with cadence, sender, footer and how to pause each, is the Outbound Email Map page (https://claude.ai/artifact/8wsHZmD7QJEuNnZEPideCr), with a repo copy in boss-os docs/OUTBOUND_EMAIL_MAP.md that a test checks against the code.
- **Three Resend teams, kept apart.** Boss OS (sequoiataylor.com, mail.spryexecutiveos.com, mail.aplayermode.com; employees send as name@sequoiataylor.com and those addresses route into the boss-os Worker); The Industry Guides (theindustryguides.com, mail.weddingchecklistpdf.com; also the Boss OS fallback sender); and the fund's own team, never used by Boss OS or the guides. sequoiataylor.com already lives on the Boss OS team, so it cannot be added elsewhere.
- **Boss OS Team → Duties is the operations page.** A synopsis line (duties running today, scheduled email paths, sent today, what needs you) sits above the duties, with every email path and its owner seat listed from the map. West Peek rows were removed from Boss OS the same day; the fund's map lives in its own repo.

## Business by business

### time-2-read
*dailystory · time-2-read.com · subscription*

- **Was:** Checkout silently broken: the Stripe code never loaded. Deploys reported success with a dead key. No paywall; every story free.
- **Live now:** Checkout repaired. Paywall: 3 free stories, 7-day trial, $9.99/month or $79/year. Sitemap fixed; deploys fail loudly; new deploy key. Supabase AI data sharing switched off. Outreach from its own mailbox, st@time-2-read.com, with SPF, DKIM and DMARC all set.
- **Next:** Watch trial starts over the next 2–4 weeks.

### heygetonmylevel
*heygetonmylevel.com · bonus for Time2Read*

- **Was:** Eight-word homepage, invisible to search. No reason to exist on its own.
- **Live now:** Readable by search engines (homepage 8 → 265 words), 10-page sitemap, analytics. Positioned as "included free with Time2Read Premium".
- **Next:** Nothing. Permanently excluded from outreach, by your rule, with a test that enforces it.

### Local guides
*local-guides-generator + citation-velocity · theindustryguides.com + 5 canonicals · listings and leads*

- **Was:** No offer anywhere on the sites. Lead path never proven end to end. Thin metro pages; hub analytics broken.
- **Live now:** $249/month listing with 2 months free; $499 per state for injury firms on theaccidentguides.com. Lead form proven: a test lead reached the inbox. Five uscisexam metros enriched (NYC, LA, Chicago, Dallas, Houston). Dentistry: safety-net clinic sections live and indexed in 6 metros, every entry sourced from an official site. Hub analytics fixed; validators and citation work kept running.
- **Next:** Two new guides on theindustryguides.com ("free dental clinics", "dental school clinics") link to all six metro pages; a validator keeps those links intact. Watch lead-form submissions on the canonicals. **11 Oct:** 1,477 impressions a month across the six sites and 2 clicks; none of the 240 target queries appear. Plan A hygiene in flight; Plan B rebuilds the targets from what Google shows.

### Memphis Senior Care Homes
*local-guides-generator · memphisseniorcarehomes.com · a property of The Industry Guides · added 13 October 2026*

| Price | Checkout | Outreach |
|---|---|---|
| Exclusive routing seat: $249/month, first 2 months free, 6-month term, plus one month's rent per move-in. Open round: $800 per family, or one month's rent only if they move in | Stripe on the site (https://memphisseniorcarehomes.com/for-providers/) | Monique, hourly, from hello@theindustryguides.com (Outbound Email Map: memphis-senior-outreach); pitch chosen per send from the site's public seat file |

- **Who it writes to:** assisted living and memory care communities in Shelby County TN, then DeSoto County MS and Crittenden County AR; admissions and community-relations mailboxes first. The list is the site's own licensed directory (https://memphisseniorcarehomes.com/data/facilities.json, from the state licensure registries), read daily: a facility with a public business email becomes a prospect, one with only a website has its site read for a role mailbox. Public sources only, $0.
- **One sender for every guide (13 Oct 2026):** all six Industry Guides properties now send From and Reply-To hello@theindustryguides.com. The five per-site hello@ aliases (uscisexam, dentistryguides, hormonesivhair, neuroevalguides, theaccidentguides) are retired from outreach and left in the Workspace unused; the side businesses keep their own senders. The guides send again once that address is on the Workspace with DKIM and its one route proof passes.

### ApprovalPrep
*approvalprep.com · one-off kits*

- **Was:** Kits unpriced or inconsistent across pages. Auto-content churning daily. No About page; Search Console reporting broken.
- **Live now:** Kits at $15, $19, $29, $39 and $49 everywhere, including the Amazon landing pages, with a validator on the prices. About page and editorial byline. Automatic content paused; Search Console fixed. Affiliate slots for Self and Kikoff built, hidden until there is a link.
- **Next:** **16 Oct, closed:** Self and Kikoff off the pending list (FlexOffers declined; the Impact route depended on a Zola approval that never arrived). Slots stay built and hidden. **11 Oct:** 10 impressions a month, landing on privacy and terms pages. Plan A noindexes the legal pages and completes the schema; Plan B finds the queries.

### Wedding checklist
*dream-wedding-builder · weddingchecklistpdf.com · one-off PDF and bundle*

- **Was:** A builder with no product on it. Download emails failing silently; the July order never arrived.
- **Live now:** $9 PDF on the homepage, email-gated builder, $39 bundle. Delivery failures logged and alerted, retried hourly, with an admin Resend button; the July order delivered. Email from its own subdomain; Amazon registry tag and Zola verification live.
- **Next:** **16 Oct, closed:** Zola through Impact off the pending list; the plain Zola link keeps working, Amazon carries the registry commission. **11 Oct:** 118 impressions a month across the four sites, 2 clicks; the niche checklists (elopement, courthouse) rank about 7, the money page 63. weddingchecklistpdf.com had no structured data at all while its siblings did; Plan A root-causes that and installs Clarity on all four.

### A Player Mode
*aplayer-mode · aplayermode.com · subscription*

- **Was:** Two sales in total. Paid buyers could not reliably get into an account. No age gate or health-data consent. **10 Oct:** the public site carried a noindex tag; robots, sitemap and llms all redirected to the homepage; no structured data; no analytics.
- **Live now:** 18+ gate and health consent (mood and "head full" scores behind it). Founding 100 offer with a live "N of 100 left" counter and sell-out switch. New-buyer, existing-account and wrong-account purchases all tested live by you. Name and date on Today, plan shown in Settings, account menu on every page. Android build updated. **10 Oct:** indexable, crawl files served, full structured data and social tags, Clarity live, Lighthouse SEO 61 → 100. Search Console property exists.
- **Next:** App Store and Google Play developer accounts (yours, on Open Loops). First Search Console read about four weeks after 10 October.

### How We Know
*how-we-know · youtube.com/@howweknowdeep · affiliate links*

- **Was:** Weak titles. Too few deep-sea Shorts. No way to earn from the descriptions.
- **Live now:** Titles rewritten. Deep-sea Shorts 3:1 (about 6 a week), all three cuts of each episode published. Amazon tag and Bookshop ID in every description; book links kept.
- **Next:** Bookshop affiliate #129693 active (16 Oct); connect Stripe on its dashboard once money is payable.

### Outreach
*boss-os · Monique's lane · serves all of the above*

- **Was:** Did not exist.
- **Live now:** Fully automatic; no human review. Eight free hello@ aliases on st@time-2-read.com, Google signing keys on every domain. 10 emails a day per site, auto-pause on bounces over 3% or any complaint, suppression list, unsubscribe link, San Francisco mailbox in the footer. Sending live on 9 sites.
- **Next:** Record `?ref=` on checkouts for affiliate credit. Creator and blogger list sources for the consumer products.

## Affiliate programs

| Program | Status |
|---|---|
| Amazon Associates | live · seq23-20 |
| Bookshop.org | live · 129693 (dashboard read 16 Oct 2026, $0.00 payable) |
| Zola (Impact) | no approval · closed 16 Oct 2026; plain Zola link stays |
| Self, Kikoff (Impact) | closed with Zola 16 Oct 2026; slots built and hidden |
| FlexOffers | declined · closed |

## Where the money would come from

**By business**

- **Subscriptions:** time-2-read, A Player Mode.
- **One-off products:** ApprovalPrep kits, the wedding PDF and bundle.
- **Listings and leads:** the five local-guides canonicals.
- **Affiliate commissions:** all of the above, plus How We Know.

**What to watch, next 2–4 weeks**

- Outreach replies per site (Boss OS, Monique's card).
- The Founding 100 counter on aplayermode.com.
- Trial starts on time-2-read.
- Lead-form submissions on the local-guides canonicals.
- Index coverage per site (daily files in each repo since 11 October): the indexed share on the local guides and Porch & Party is the number consolidation has to move.
- virtualagency-os.com impressions: the 149 redirected URLs should bring most of the lost 72% back over 2–6 weeks.
- detoxdenver.org impressions: first site to show movement, since its pages already rank at position 4 when shown.
- Clicks on the two audience CTAs (dentist listing, USCIS civil-surgeon finder) in the local-guides click files.
- **25 October numbers check (calendar reminder set):** per site, 28-day impressions and clicks against the 11 Sep–8 Oct baseline; indexed share from each repo's coverage file; then the consolidation PRs where the data says to merge (Porch & Party 12 hubs, local guides 69, ApprovalPrep 15, wedding 21, WPP-llm 191 plus the 3,195 locked pages, memphis 11, horse legal 20); which host owns ai-executive-coach; whether the 25 Sep Hicks resources pages come back.
- Monday emails (first full one 13 Oct): any RED issue that stays open two weeks running is a defect, not volatility.

One numbers check in two weeks beats daily looking; nothing here moves faster than that.

---

Every item above was verified live on the day it shipped (checks run, pages fetched, emails delivered). Search figures: Search Console, 11 September to 8 October 2026, read 10 and 11 October. Page last updated 11 October 2026, 13:40 CDT, after all six afternoon agents landed. Full open items and their evidence: the Open Loops page. Handoff: `~/HANDOFF.md`.
