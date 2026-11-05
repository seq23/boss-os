/**
 * SUBJECTS DECODED ONCE (owner, 4 Nov 2026). Meeting preps showed "Jesse Ã¢Â€Â” your…", and the same
 * garbling went out in the subject of LP replies she SENT: a draft wrote the subject into its header as
 * raw 8-bit UTF-8, Gmail read those bytes as Latin-1/Windows-1252, and the next "Re: <subject>" was
 * built from the garbled words (and garbled again). Two rules:
 *   1. Every subject we WRITE is an RFC 2047 encoded word when it is not plain ASCII (`encodeSubject`).
 *   2. Every subject we READ is repaired when it is UTF-8 that was decoded as Windows-1252 once or more
 *      (`repairMojibake`), so a stored bad subject displays right and never seeds another "Re:".
 * Pure; shared by the Worker and the Mac scripts.
 */

// Windows-1252's 0x80–0x9F, the characters a mis-decoder writes for those bytes.
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };

/** A UTF-8 lead byte as Latin-1 (Â Ã â ð …) followed by a continuation byte as Latin-1/1252. */
const SUSPECT = /[Â-ô][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

function undoOnce(s) {
  const bytes = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0xff) bytes.push(c);
    else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
    else return null; // a character no single-byte mis-decode could have written: leave it alone
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return null; }
}

/** The subject as it was meant, undoing up to three rounds of UTF-8-read-as-1252. Unchanged when clean. */
export function repairMojibake(value) {
  let s = String(value ?? "");
  for (let i = 0; i < 3 && SUSPECT.test(s); i += 1) {
    const next = undoOnce(s);
    if (next === null || next === s) break;
    s = next;
  }
  return s;
}

/** "Re: <subject>", built from the repaired subject; never "Re: Re:". */
export function replySubject(subject, fallback = "our conversation") {
  const s = repairMojibake(subject).trim();
  return /^re:/i.test(s) ? s : `Re: ${s || fallback}`;
}

const utf8Base64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** The Subject header's value: plain ASCII as is, anything else one RFC 2047 UTF-8 encoded word. */
export function encodeSubject(subject) {
  const s = String(subject ?? "").replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8Base64(s)}?=`;
}
