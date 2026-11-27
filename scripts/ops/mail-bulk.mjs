/** Structural email parsing shared by the LP readers. */

export const OUR_DOMAINS = Object.freeze(["westpeek.ventures", "sequoiataylor.com", "joinwestpeek.com"]);

/** The first address in a header value, lower-cased, or "". */
export const addressIn = (raw) => (String(raw ?? "").match(/[\w.+'-]+@[\w.-]+\.\w+/) ?? [""])[0].toLowerCase();

/**
 * The top header block of a raw RFC 822 message as a lower-cased map, continuation lines unfolded.
 * Repeated headers keep the first value except `References`, which is joined — a long thread
 * splits it across lines and every id in it matters.
 */
export function headersFromRaw(raw) {
  const i = String(raw).search(/\r?\n\r?\n/);
  const block = i === -1 ? String(raw) : String(raw).slice(0, i);
  const out = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (name === "references" && out[name]) out[name] += ` ${m[2]}`;
    else if (!(name in out)) out[name] = m[2];
  }
  return out;
}
