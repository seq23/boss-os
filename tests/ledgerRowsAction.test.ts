/**
 * H5's shared caller (.github/actions/ledger-rows): a posting job's confirmed posts reach the ledger, and
 * every way it can fail ends in a named stop with exit 1, never "OUTPUT" and exit 0.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendLedgerRows } from "../.github/actions/ledger-rows/ledger-rows.mjs";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "ledger-rows-"));
const file = (name: string, doc: unknown) => { const p = join(dir, name); writeFileSync(p, typeof doc === "string" ? doc : JSON.stringify(doc)); return p; };
// The real shape of Peace Be Still's data/instagram/posted.json.
const IG = { posts: { p6: { runs: [{ channel: "instagram", buffer_id: "ig6", queued_at: "2026-11-25T01:54:45.119Z", format: "carousel" }, { channel: "facebook", buffer_id: "fb6", queued_at: "2026-11-25T01:54:45.119Z" }, { channel: "instagram", queued_at: "2026-11-25T02:00:00Z" }] } } };
const env = (over: Record<string, string> = {}) => ({ LEDGER_BUSINESS: "peace-be-still", LEDGER_FILE: file("ig.json", IG), LEDGER_TOKEN: "olt_x", LEDGER_ORIGIN: "https://boss.example.test/", ...over });
const answering = (status: number, data: unknown, seen: any[] = []) => (async (url: string, init: any) => { seen.push({ url, init }); return new Response(JSON.stringify({ data }), { status }); }) as unknown as typeof fetch;

describe("ledger-rows: every confirmed post sent once, every failure a named stop", () => {
  it("sends only the runs with a receipt, facebook as facebook-page, with the machine token, and counts replays", async () => {
    const seen: any[] = [];
    const r = await sendLedgerRows(env(), answering(200, { written: 1, duplicate: 1, refused: [] }, seen), NOW);
    expect(r).toEqual({ code: 0, line: "OUTPUT: 2 rows sent (1 new, 1 already there)" });
    expect(seen[0].url).toBe("https://boss.example.test/api/boss/growth/noelle/ledger");
    expect(seen[0].init.headers.authorization).toBe("Bearer olt_x");
    expect(JSON.parse(seen[0].init.body).rows.map((x: any) => `${x.channel} ${x.item} ${x.receipt.id}`)).toEqual(["instagram p6:ig6 ig6", "facebook-page p6:fb6 fb6"]);
  });

  it("a threads file with no channel on its runs takes the channel input", async () => {
    const seen: any[] = [];
    const th = file("th.json", { posts: { pbs09: { runs: [{ buffer_id: "th9", queued_at: "2026-11-25T01:50:15.755Z" }] } } });
    await sendLedgerRows(env({ LEDGER_FILE: th, LEDGER_CHANNEL: "threads" }), answering(200, { written: 1, duplicate: 0, refused: [] }, seen), NOW);
    expect(JSON.parse(seen[0].init.body).rows[0]).toMatchObject({ channel: "threads", item: "pbs09:th9" });
  });

  it.each([
    ["no token", env({ LEDGER_TOKEN: "" }), answering(200, {}), /LEDGER_TOKEN_MISSING/],
    ["a missing file", env({ LEDGER_FILE: join(dir, "nope.json") }), answering(200, {}), /POSTED_UNREAD/],
    ["a file that is not JSON", env({ LEDGER_FILE: file("bad.json", "{oops") }), answering(200, {}), /POSTED_UNREAD/],
    ["no confirmed post in 8 days", env({ LEDGER_FILE: file("old.json", { posts: { a: { runs: [{ buffer_id: "x", queued_at: "2026-11-01T00:00:00Z" }] } } }) }), answering(200, {}), /NO_POSTS_TO_LEDGER/],
    ["Boss OS answering 401", env(), answering(401, { error: "no" }), /LEDGER_WRITE_FAILED\] Boss OS answered 401/],
    ["Boss OS unreachable", env(), (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch, /LEDGER_WRITE_FAILED\] getaddrinfo/],
    ["an answer with no counts", env(), answering(200, { ok: true }), /LEDGER_WRITE_FAILED\] Boss OS gave no counts/],
    ["a refused row", env(), answering(200, { written: 1, duplicate: 0, refused: ["peace-be-still:instagram:p6:fb6"] }), /LEDGER_WRITE_FAILED\] 1 rows refused/],
  ])("%s → a named stop, exit 1", async (_why, e, f, re) => {
    const r = await sendLedgerRows(e, f, NOW);
    expect(r.code).toBe(1);
    expect(r.line).toMatch(/^NAMED STOP \[/);
    expect(r.line).toMatch(re);
  });

  it("uses each platform's receipt and leaves out missing or unconfirmed receipts", async () => {
    const at = "2026-11-25T00:00:00Z";
    const fixtures = [
      [ { posts: { one: { tiktok: { buffer_id: "t1", queued_at: at }, instagram: { queued_at: at } } } }, "tiktok", "t1" ],
      [ { posted: [{ id: "internal", urn: "urn:li:share:100", at }, { id: "no-platform-id", urn: null, at }] }, "linkedin", "urn:li:share:100" ],
      [ [{ lane: "blogger", id: "https://example.test/post-one.html", url: "https://example.test/source.html", at }], "blogger", "post-one" ],
      [ [{ channel: "facebook", id: "studio1", at }], "facebook-page", "studio1" ],
    ] as const;
    for (const [doc, channel, id] of fixtures) {
      const seen: any[] = [];
      await sendLedgerRows(env({ LEDGER_FILE: file("receipt.json", doc), LEDGER_CHANNEL: channel }), answering(200, { written: 1, duplicate: 0 }, seen), NOW);
      expect(JSON.parse(seen[0].init.body).rows).toEqual([expect.objectContaining({ channel, receipt: { id } })]);
    }
  });

  it("reads a Pinterest receipt from its own RSS without sending the ledger token to Pinterest", async () => {
    const feed = "https://www.pinterest.com/aplayermode/feed.rss";
    const seen: any[] = [];
    const transport = async (url: string, init: any) => {
      if (url === feed) {
        expect(init.headers.authorization).toBeUndefined();
        return new Response("<rss><channel><item><guid>https://www.pinterest.com/pin/1234567/</guid><pubDate>Wed, 25 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>");
      }
      return answering(200, { written: 1, duplicate: 0 }, seen)(url, init);
    };
    const result = await sendLedgerRows(env({ LEDGER_FILE: "", LEDGER_FEED: feed }), transport as typeof fetch, NOW);
    expect(result.code).toBe(0);
    expect(JSON.parse(seen[0].init.body).rows[0]).toMatchObject({ channel: "pinterest", receipt: { id: "1234567" } });
    expect((await sendLedgerRows(env({ LEDGER_FILE: "", LEDGER_FEED: "https://example.test/feed.rss" }), transport as typeof fetch, NOW)).line).toMatch(/POSTED_UNREAD/);
    expect((await sendLedgerRows(env({ LEDGER_FILE: "", LEDGER_FEED: feed }), (async () => new Response("<html>login</html>")) as typeof fetch, NOW)).line).toMatch(/POSTED_UNREAD/);
  });

  it("the action runs this script from its own checkout of boss-os", () => {
    const yml = readFileSync(join(__dirname, "../.github/actions/ledger-rows/action.yml"), "utf8");
    expect(yml).toMatch(/run: node "\$\{\{ github\.action_path \}\}\/ledger-rows\.mjs"/);
    expect(yml).toMatch(/LEDGER_TOKEN: \$\{\{ inputs\.token \}\}/);
  });
});
