/**
 * Mail authentication, checked before every live send (9 Oct 2026).
 *
 * Gmail blocked two test sends that day ("550 5.7.26 Unauthenticated email from aplayermode.com is
 * not accepted due to domain's DMARC policy"): the domain published DMARC p=reject and an empty
 * DKIM key, so mail sent as hello@aplayermode.com through the Workspace mailbox could not align.
 * A domain therefore sends live only when its DNS shows all three:
 *   · SPF on the sender's domain that includes Google (`include:_spf.google.com`);
 *   · a Google Workspace DKIM key at `google._domainkey.<domain>` with a non-empty `p=`;
 *   · a DMARC record at `_dmarc.<domain>`.
 * A DNS lookup that fails reads as missing: the safe state is never a fallback's accident.
 */

export interface AuthRecords {
  /** TXT records at the domain itself. */
  root: string[];
  /** TXT records at google._domainkey.<domain>. */
  dkim: string[];
  /** TXT records at _dmarc.<domain>. */
  dmarc: string[];
}

const clean = (s: string) => s.replace(/"\s*"/g, "").replace(/"/g, "").trim();

/** What is missing, in words; empty when the domain may send. Pure. */
export function mailAuthGaps(r: AuthRecords): string[] {
  const gaps: string[] = [];
  const spf = r.root.map(clean).filter((t) => /^v=spf1\b/i.test(t));
  if (spf.length !== 1) gaps.push(spf.length ? "more than one SPF record" : "no SPF record");
  else if (!/\binclude:_spf\.google\.com\b/i.test(spf[0]!)) gaps.push("SPF does not include _spf.google.com");
  const dkim = r.dkim.map(clean).find((t) => /^v=DKIM1\b/i.test(t) || /\bp=/.test(t));
  if (!dkim) gaps.push("no Google DKIM key at google._domainkey");
  else if (!/\bp=[A-Za-z0-9+/=]{100,}/.test(dkim.replace(/\s+/g, ""))) gaps.push("the Google DKIM key at google._domainkey is empty or revoked");
  if (!r.dmarc.map(clean).some((t) => /^v=DMARC1\b/i.test(t))) gaps.push("no DMARC record");
  return gaps;
}

const DOH = "https://cloudflare-dns.com/dns-query";

async function txt(name: string, fetchImpl: typeof fetch): Promise<string[]> {
  const res = await fetchImpl(`${DOH}?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DNS lookup for ${name} returned ${res.status}`);
  const j = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
  // 0 = NOERROR, 3 = NXDOMAIN (no record, a real answer). Anything else is a failed lookup.
  if (j.Status !== 0 && j.Status !== 3) throw new Error(`DNS lookup for ${name} failed (status ${j.Status})`);
  return (j.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data);
}

/** null when the domain may send live; otherwise the refusal in words. Fails closed. */
export async function mailAuthRefusal(domain: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const [root, dkim, dmarc] = await Promise.all([
      txt(domain, fetchImpl), txt(`google._domainkey.${domain}`, fetchImpl), txt(`_dmarc.${domain}`, fetchImpl),
    ]);
    const gaps = mailAuthGaps({ root, dkim, dmarc });
    return gaps.length ? `${domain} mail authentication is incomplete: ${gaps.join("; ")}.` : null;
  } catch (err) {
    return `${domain} mail authentication could not be checked: ${(err as Error).message}.`;
  }
}
