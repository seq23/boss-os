/**
 * Cloudflare Email Routing's own Authentication-Results, in the exact shape it writes on her genuine
 * Gmail (read off two real arrivals in R2, 27 Nov 2026; local parts, IPs and the signature replaced).
 * The authserv-id appears again inside its own SPF comments, as it does in real mail.
 */
export function cloudflareAuth(from: string, dmarc: "pass" | "fail" | "none" = "pass"): string {
  const addr = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  const d = addr.slice(addr.lastIndexOf("@") + 1);
  return `mx.cloudflare.net; dkim=${dmarc === "pass" ? "pass" : "fail"} header.d=${d} header.s=20260707 header.b=AbCdEf12; `
    + `dmarc=${dmarc} header.from=${d} policy.dmarc=none; `
    + `spf=none (mx.cloudflare.net: no SPF records found for postmaster@mail-qk1-x72b.google.com) smtp.helo=mail-qk1-x72b.google.com; `
    + `spf=pass (mx.cloudflare.net: domain of ${addr} designates 2607:f8b0:4864:20::72b as permitted sender) smtp.mailfrom=${addr}; `
    + `arc=none smtp.remote-ip="2607:f8b0:4864:20::72b"`;
}
