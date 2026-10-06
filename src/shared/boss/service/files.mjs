/**
 * FILES FOR HER RIDE ON THE EMAIL THAT FINISHES THE WORK (R18, 6 Oct 2026).
 *
 * Copied from West Peek OS's `workCardFiles.ts#outboundFilesFor` and diverged: Boss OS's mail goes
 * out from her Mac (`scripts/ops/notify.mjs#employeeMail`, the one send every Mac lane uses), so the
 * files are files on her Mac. Every file is LISTED by name; files are ATTACHED in order until 10 MB
 * in total would be crossed; a file that does not fit says exactly where it is on her Mac (or the
 * Drive link, when one was given). Never a link into Boss OS, never partial silence.
 *
 * NO DRIVE UPLOAD, AND THAT IS THE DIVERGENCE. West Peek OS pushes a large file to the requesting
 * partner's Drive as viewer-only. The only Drive delegation on this Mac is West Peek's
 * (sequoia@westpeek.ventures), and putting her personal files into the fund's Drive is the blend she
 * has corrected more than once — so a large file stays on her own Mac and the email says where.
 */

export const OUTBOUND_ATTACHMENTS_MAX_BYTES = 10 * 1024 * 1024;

const size = (b) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * `files`: `{ name, bytes, path?, drive_url? }[]`. Returns which to attach (by index) and the lines
 * the email carries — one per file, always.
 */
export function outboundFilesPlan(files, cap = OUTBOUND_ATTACHMENTS_MAX_BYTES) {
  const attach = [];
  const lines = [];
  let used = 0;
  (files ?? []).forEach((f, i) => {
    const bytes = Number(f?.bytes ?? 0);
    const name = String(f?.name ?? `file ${i + 1}`);
    if (f?.path && bytes > 0 && used + bytes <= cap) {
      attach.push(i);
      used += bytes;
      lines.push(`${name} (${size(bytes)}) — attached`);
      return;
    }
    if (f?.drive_url) lines.push(`${name} (${size(bytes)}) — in Drive: ${f.drive_url}`);
    else if (f?.path) lines.push(`${name} (${size(bytes)}) — too large to attach with the rest; it is on your Mac at ${f.path}`);
    else lines.push(`${name} — not attached: the file could not be read`);
  });
  return { attach, lines, bytes: used };
}
