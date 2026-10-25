/**
 * ─── WHO HOLDS OR OFFERS THE BLOCK DECIDES THE SIDE (owner, 25 Oct 2026) ───
 *
 * 24 Oct 2026: she forwarded a broker's note — "He's got a $1 billion Anthropic block at 1.35T + 4%
 * sell side fees … Block is pre-approved and direct on the cap table" — asking "Can u find this
 * seller rep, it's a merchant bank out of Spain". The extractor stored it as a BUY, "your client",
 * shown as "Yours: buyer", and Monique then hunted sellers "for your $1B Anthropic buyer" and drafted
 * "I have an LP looking for $1B" notes that said the opposite of the truth.
 *
 * So the side is read from what the sentence says about the BLOCK, never from who wrote or forwarded
 * the email:
 *   - someone (I / we / he / she / they / my client / the seller) has, holds or offers a block, a
 *     block is available, "sell side fees", "looking for a buyer", "looking for bids" → SELL;
 *   - someone wants to buy, has buyers who want it, asks whether YOUR block is still available,
 *     "anyone have …" → BUY;
 *   - both, in a way the words cannot settle → UNSET, and the row says so. Never a default buy.
 *
 * `decideSide` is pure; the extractor (scripts/ops/interest-extract.mjs) applies it to every row
 * the model returns and to the ledger on `--recheck`, and tests/dealSide.test.ts pins the exact
 * wording above as a sell.
 */

const SENTENCES = (t) => String(t ?? "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\s+[—–]{1,2}-*\s+/).map((s) => s.trim()).filter(Boolean);

const AMOUNT = String.raw`(?:\$\s?[\d.,]+\s*(?:k|m|mm|mn|b|bn|t|million|billion)?|[\d.,]+\s*(?:k|m|mm|mn|b|bn|million|billion))`;
/**
 * THE WORDS THAT SAY SOMEBODY HOLDS OR OFFERS THE BLOCK. Deliberately narrow: a sentence that also
 * talks about buyers, bids, demand or interest, or asks a question, is left to the model and the
 * prompt — a guard that flips good rows is worse than the one bad row it was written for.
 */
const OFFERS = [
  new RegExp(String.raw`\b(?:i|we|he|she|they|my client|our client|the seller|seller|holder)(?:'s|'ve| has| have)?\s+(?:got|has|have|holds?)\s+(?:a |an |the |another |a new |new )?(?:${AMOUNT}\s+)?(?:[\w.&'-]+\s+){0,3}block\b`, "i"),
  /^(?:the |this |that |a |our )?(?:[\w$.,&'-]+\s+){0,3}block\b[^.?]{0,20}\b(?:is |are )?(?:still )?(?:available|for sale|on offer)\b/i,
  /\bsell[- ]side fees?\b/i,
];
const WANTS = /\bbuyers?\b|\bbids?\b|\bdemand\b|\binterest(?:ed)?\b|\bwants?\b|\bpurchase\b|\boffers?\b|\btakers\b|\bLOI\b|\bmandate\b/i;
const QUESTION = /\?|\b(?:is|are) your\b|\bdo (?:you|we)\b|\bif you\b|\blet me know\b/i;
/** A trade already done says nothing about which side wants something now. */
const DONE = /\b(?:closed|sold|bought|filled|settled|completed)\b/i;

/**
 * "sell" when a sentence says somebody holds or offers the block, else null with the reason.
 * Used to overrule a model's "buy" — never to invent a side or to turn a sell into a buy.
 */
export function offeredIn(text) {
  for (const s of SENTENCES(text)) {
    // "$110 all in to buyer", "net to seller" are price conventions, not somebody wanting.
    const bare = s.replace(/\b(?:gross|net|all[- ]in)\s+(?:to|for)\s+(?:the\s+)?(?:buyers?|sellers?)\b/gi, "");
    if (QUESTION.test(bare) || WANTS.test(bare) || DONE.test(bare)) continue;
    if (OFFERS.some((re) => re.test(s))) return { side: "sell", why: `the block is offered: "${s.slice(0, 80)}"` };
  }
  return { side: null, why: null };
}

/**
 * The side a row ends with. The model reads the message under the prompt's rule ("who holds or
 * offers the block decides the side"); these words overrule a "buy" when they plainly say the
 * block is on offer; a row the model could not place stays UNSET with the reason. Never a default buy.
 */
export function decideSide(row) {
  const model = row?.side === "buy" || row?.side === "sell" ? row.side : null;
  const offered = offeredIn(row?.quote);
  if (offered.side === "sell" && model !== "sell") return { side: "sell", side_note: model ? `side corrected from ${model}: ${offered.why}` : offered.why };
  if (model) return { side: model, side_note: null };
  return { side: null, side_note: String(row?.side_note ?? "").trim() || "side unclear — the message does not say who holds the block" };
}

/**
 * A NOTE SHE IS PASSING ON IS NOT HER ORDER. Her outbound email that carries somebody else's words
 * to her — it opens by addressing her ("Hi Sequoia"), or quotes a forwarded or replied-to message —
 * is the broker's order, never "Yours". "Yours" is only an order where she is the principal's
 * direct rep.
 */
export function isRelayedNote(msg) {
  if (!msg?.outbound) return false;
  const t = String(msg.excerpt ?? msg.text ?? "");
  if (/^\s*(?:hi|hey|hello|dear|morning)?[\s,]*sequoia\b/i.test(t)) return true;
  return /-{3,}\s*Forwarded message|Begin forwarded message|^\s*On .{5,80} wrote:\s*$|^-{2,}\s*Original Message/im.test(t);
}
