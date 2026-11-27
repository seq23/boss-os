/**
 * A MODEL'S QUOTE, CHECKED AGAINST THE MAIL IT QUOTES (27 Nov 2026, review F2 of #583).
 *
 * Gmail bodies keep CRLF line endings and hard wraps; a model quoting a wrapped line writes a space or
 * a bare newline. So both sides are compared with every run of whitespace as one space. A quote that is
 * still not in the mail is dropped to "" rather than failing the read: the quote is only shown to her,
 * and a whole reply re-read forever over one display line is how one reply stalled a job.
 * Structure only: it compares characters and never decides what the mail means.
 */
const spaced = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/** The quote with its whitespace made single, when it is really in the body; otherwise "". Pure. */
export function quotedFrom(body, excerpt) {
  const quote = spaced(excerpt);
  return quote && spaced(body).includes(quote) ? quote : "";
}
