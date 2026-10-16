#!/usr/bin/env python3
"""
DANIELLE'S OWN CRAWL OF A LIVE SITE — the URLs the Ahrefs mail never carries.

WHY THIS EXISTS (owner, 16 Oct 2026: "fix danielle's job so she can actually fix things").
The 15 and 16 Oct passes read every Ahrefs mail and fixed nothing: projects=24 fixed=0 surfaced=10,
then projects=10 fixed=0 surfaced=9. The mail says "Health Score 94, Errors 50" and links into an
app that needs a login, so the run wrote "Cannot confirm specific broken URLs without Ahrefs UI
access" and stopped. The mail is the TRIGGER and the headline; this script supplies the URLs.

Stdlib only, so it runs on any Mac and in CI without an install. Two modes:

  site-crawl.py crawl <domain> [--base https://host] [--cap 400] [--out file.json]
      sitemap -> pages (cap), every <a href>, canonical, hreflang and <img src> on each page,
      HEAD with a GET fallback under a browser UA. Reports broken internal/outbound links,
      redirect chains > 1 hop, non-200 sitemap pages, missing/duplicate titles and meta
      descriptions, noindex on a sitemap page, canonicals pointing at a non-200, Cloudflare
      `/cdn-cgi/l/email-protection` links, and slow pages.

  site-crawl.py probe <domain> [--base https://host] [--out file.json]
      For an Ahrefs "crawl failed / crawl error" mail: DNS, TLS, the start URL's redirects,
      robots.txt for AhrefsBot and AhrefsSiteAudit, the status those user agents get, and any
      Cloudflare challenge. Its `verdict` is one of
        AHREFS_SIDE_CRAWL_FAILURE  the site is reachable and robots allows Ahrefs — not a site defect
        ROBOTS_BLOCKS_AHREFS       robots.txt disallows an Ahrefs agent — a site defect, fixable at source
        SITE_UNREACHABLE           DNS, TLS or the start URL fails for a browser — a site defect
"""
import gzip
import json
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import zlib
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
AHREFS_UAS = {
    "AhrefsBot": "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "AhrefsSiteAudit": "Mozilla/5.0 (compatible; AhrefsSiteAudit/6.1; +http://ahrefs.com/robot/site-audit)",
}
TIMEOUT = 20
SLOW_SECONDS = 3.0
SAMPLE = 5  # source pages kept per issue

CTX = ssl.create_default_context()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=CTX))


def _headers(ua):
    return {"User-Agent": ua, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate"}


def _one(url, method, ua):
    req = urllib.request.Request(url, headers=_headers(ua), method=method)
    try:
        r = OPENER.open(req, timeout=TIMEOUT)
        body = r.read(3_000_000) if method == "GET" else b""
        enc = r.headers.get("Content-Encoding", "")
        if enc == "gzip":
            body = gzip.decompress(body)
        elif enc == "deflate":
            body = zlib.decompress(body)
        return r.status, r.headers, body, None
    except urllib.error.HTTPError as e:
        try:
            body = e.read(200_000) if method == "GET" else b""
        except Exception:
            body = b""
        return e.code, e.headers, body, None
    except Exception as e:  # noqa: BLE001 — every transport failure is evidence, not a crash
        return None, None, b"", f"{type(e).__name__}: {str(e)[:160]}"


def fetch(url, method="GET", ua=UA, hops=10):
    """Follow redirects by hand so the chain is visible. Returns a plain dict."""
    chain, cur, t0 = [], url, time.time()
    for _ in range(hops):
        st, h, body, err = _one(cur, method, ua)
        if err:
            return dict(status=None, final=cur, chain=chain, error=err, body=b"", headers={}, secs=time.time() - t0)
        if st in (301, 302, 303, 307, 308) and h and h.get("Location"):
            chain.append([st, cur])
            cur = urllib.parse.urljoin(cur, h.get("Location"))
            continue
        return dict(status=st, final=cur, chain=chain, error=None, body=body,
                    headers={k.lower(): v for k, v in (h.items() if h else [])}, secs=time.time() - t0)
    return dict(status=None, final=cur, chain=chain, error="too many redirects", body=b"", headers={}, secs=time.time() - t0)


HEAVY_BYTES = 1_000_000


def check(url):
    """HEAD first; a GET when HEAD is refused or odd, because plenty of servers lie to HEAD."""
    r = fetch(url, "HEAD")
    size = (r.get("headers") or {}).get("content-length")
    if r["error"] or r["status"] in (400, 403, 404, 405, 429, 501) or (r["status"] or 0) >= 500:
        r2 = fetch(url, "GET")
        if not (r2["error"] and not r["error"]):
            r = r2
    out = {k: r[k] for k in ("status", "final", "chain", "error")}
    out["bytes"] = int(size) if size and size.isdigit() else None
    return out


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.imgs, self.hreflang = [], [], []
        self.canonical, self.title, self.description, self.robots = None, None, None, ""
        self._in_title = False
        self._title_buf = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "").strip() for k, v in attrs}
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "img" and a.get("src"):
            self.imgs.append(a["src"])
        elif tag == "link":
            rel = a.get("rel", "").lower().split()
            if "canonical" in rel and a.get("href"):
                self.canonical = a["href"]
            if "alternate" in rel and a.get("hreflang") and a.get("href"):
                self.hreflang.append(a["href"])
        elif tag == "meta":
            name = a.get("name", "").lower()
            if name == "description":
                self.description = a.get("content", "")
            elif name in ("robots", "googlebot"):
                self.robots += " " + a.get("content", "").lower()
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "title" and self._in_title:
            self._in_title = False
            self.title = "".join(self._title_buf).strip()

    def handle_data(self, data):
        if self._in_title:
            self._title_buf.append(data)


SKIP_SCHEMES = ("mailto:", "tel:", "#", "javascript:", "sms:", "data:")


def resolve(page_url, ref):
    if not ref or ref.lower().startswith(SKIP_SCHEMES):
        return None
    u = urllib.parse.urldefrag(urllib.parse.urljoin(page_url, ref))[0]
    return u if u.startswith(("http://", "https://")) else None


def bare(host):
    host = (host or "").lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def sitemap_pages(base):
    queue, seen, pages, notes = [f"{base}/sitemap.xml"], set(), [], []
    r = fetch(f"{base}/robots.txt")
    if r["status"] == 200:
        for line in r["body"].decode("utf-8", "replace").splitlines():
            if line.lower().startswith("sitemap:"):
                queue.append(line.split(":", 1)[1].strip())
    while queue:
        sm = queue.pop(0)
        if sm in seen or len(seen) > 50:
            continue
        seen.add(sm)
        r = fetch(sm)
        if r["status"] != 200:
            notes.append(f"sitemap {sm} -> {r['status'] or r['error']}")
            continue
        try:
            root = ET.fromstring(r["body"])
        except ET.ParseError:
            notes.append(f"sitemap {sm} does not parse")
            continue
        locs = [e.text.strip() for e in root.iter() if e.tag.split("}")[-1] == "loc" and e.text]
        (queue if root.tag.split("}")[-1] == "sitemapindex" else pages).extend(locs)
    return list(dict.fromkeys(pages)), notes


def link_verdict(st):
    """broken | blocked | ok. 401/403/429/999 is a site refusing a robot, which is not proof of death."""
    if st.get("error"):
        return "broken"
    s = st.get("status") or 0
    if s in (404, 410) or s >= 500:
        return "broken"
    if s in (401, 403, 429, 999):
        return "blocked"
    return "ok"


def crawl(domain, base=None, cap=400, workers=16):
    base = (base or f"https://{domain}").rstrip("/")
    site = bare(urllib.parse.urlsplit(base).netloc)
    pages, notes = sitemap_pages(base)
    sitemap_total = len(pages)
    if not pages:
        pages = [f"{base}/"]
        notes.append("no sitemap pages; homepage only")
    pages = pages[:cap]
    issues = {}

    def add(cls, url, source=None, detail=None):
        row = issues.setdefault(cls, {}).setdefault(url, {"url": url, "sources": [], "detail": detail})
        if source and len(row["sources"]) < SAMPLE and source not in row["sources"]:
            row["sources"].append(source)

    targets, titles, descs = {}, {}, {}
    canonicals = {}
    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(lambda u: (u, fetch(u, "GET")), pages))
        for url, r in results:
            if r["error"] or r["status"] != 200:
                add("sitemap_page_not_200", url, detail=r["status"] or r["error"])
                continue
            if r["chain"]:
                add("sitemap_page_redirects", url, detail=f"{len(r['chain'])} hop(s) to {r['final']}")
            if r["secs"] > SLOW_SECONDS:
                add("slow_page", url, detail=f"{r['secs']:.1f}s")
            if "html" not in r["headers"].get("content-type", "").lower():
                continue
            p = PageParser()
            try:
                p.feed(r["body"].decode("utf-8", "replace"))
            except Exception:  # noqa: BLE001
                pass
            if "noindex" in p.robots or "noindex" in r["headers"].get("x-robots-tag", "").lower():
                add("noindex_on_sitemap_page", url)
            if not p.title:
                add("missing_title", url)
            else:
                titles.setdefault(p.title, []).append(url)
            if not p.description:
                add("missing_meta_description", url)
            else:
                descs.setdefault(p.description, []).append(url)
            refs = [(h, "link") for h in p.links] + [(s, "image") for s in p.imgs] + [(h, "hreflang") for h in p.hreflang]
            if p.canonical:
                c = resolve(r["final"], p.canonical)
                if c:
                    canonicals[url] = c
                    refs.append((p.canonical, "canonical"))
            for ref, kind in refs:
                if "/cdn-cgi/l/email-protection" in ref:
                    add("cloudflare_email_protection_link", resolve(r["final"], ref) or ref, url,
                        detail="Cloudflare email obfuscation link; crawlers see a dead page. Use a plain mailto or a contact form.")
                    continue
                t = resolve(r["final"], ref)
                if t:
                    targets.setdefault(t, {"sources": [], "kinds": set()})
                    if len(targets[t]["sources"]) < SAMPLE:
                        targets[t]["sources"].append(url)
                    targets[t]["kinds"].add(kind)
        status = dict(zip(targets, pool.map(check, list(targets))))

    for t, meta in targets.items():
        st = status[t]
        v = link_verdict(st)
        internal = bare(urllib.parse.urlsplit(t).netloc) == site
        for src in meta["sources"]:
            if v == "broken":
                cls = "broken_internal_link" if internal else "broken_outbound_link"
                if "image" in meta["kinds"] and internal:
                    cls = "broken_internal_image"
                add(cls, t, src, detail=st["status"] or st["error"])
            elif "image" in meta["kinds"] and (st.get("bytes") or 0) > HEAVY_BYTES:
                add("heavy_image", t, src, detail=f"{st['bytes'] // 1024} KB")
            elif v == "blocked" and not internal:
                add("outbound_link_refuses_robots", t, src, detail=st["status"])
            if internal and len(st.get("chain") or []) > 1:
                add("redirect_chain", t, src, detail=f"{len(st['chain'])} hops to {st['final']}")
    # ORPHANS: a sitemap page no crawled page links to. Only meaningful when every page was crawled.
    if sitemap_total and sitemap_total <= cap:
        linked = {urllib.parse.urlsplit(t)._replace(query="").geturl().rstrip("/")
                  for t, m in targets.items() if "link" in m["kinds"]}
        for url in pages:
            if url.rstrip("/") not in linked and urllib.parse.urlsplit(url).path not in ("", "/"):
                add("orphan_sitemap_page", url, detail="in the sitemap, linked from no crawled page")
    for page, c in canonicals.items():
        st = status.get(c) or {}
        if st.get("error") or st.get("status") != 200 or st.get("chain"):
            add("canonical_not_200", c, page, detail=st.get("status") or st.get("error") or "redirects")
    for title, urls in titles.items():
        if len(urls) > 1:
            for u in urls:
                add("duplicate_title", u, detail=f"{len(urls)} pages share: {title[:90]}")
    for d, urls in descs.items():
        if len(urls) > 1:
            for u in urls:
                add("duplicate_meta_description", u, detail=f"{len(urls)} pages share it")

    out = {k: sorted(v.values(), key=lambda x: x["url"]) for k, v in sorted(issues.items())}
    return dict(domain=domain, base=base, sitemap_total=sitemap_total, pages_crawled=len(pages),
                capped=sitemap_total > cap, targets_checked=len(targets), notes=notes,
                counts={k: len(v) for k, v in out.items()}, issues=out)


# ─── Probe: why could Ahrefs not crawl it? ────────────────────────────────────

def probe_verdict(ev):
    """Pure: evidence in, verdict out. Tested without the network (tests/danielleAuditFixer.test.ts)."""
    if not ev.get("dns_ok"):
        return "SITE_UNREACHABLE", "DNS does not resolve: " + str(ev.get("dns_error"))
    if not ev.get("tls_ok"):
        return "SITE_UNREACHABLE", "TLS handshake fails: " + str(ev.get("tls_error"))
    start = ev.get("start") or {}
    if start.get("status") != 200:
        return "SITE_UNREACHABLE", f"start URL gives {start.get('status') or start.get('error')} to a browser"
    if start.get("challenge"):
        return "SITE_UNREACHABLE", "a browser gets a Cloudflare challenge page at the start URL"
    blocked = [ua for ua, ok in (ev.get("robots_allows") or {}).items() if ok is False]
    if blocked:
        return "ROBOTS_BLOCKS_AHREFS", "robots.txt disallows " + ", ".join(blocked)
    return ("AHREFS_SIDE_CRAWL_FAILURE",
            "reachable from outside: DNS, TLS and the start URL are fine and robots.txt allows Ahrefs. "
            "Status to spoofed Ahrefs agents: "
            + ", ".join(f"{k}={v.get('status') or v.get('error')}{' (challenge)' if v.get('challenge') else ''}"
                        for k, v in (ev.get("as_ahrefs") or {}).items())
            + ". A spoofed agent from a non-Ahrefs IP may be challenged by Cloudflare's verified-bot rules, "
              "so that status is evidence, not proof.")


def _challenge(r):
    h = r.get("headers") or {}
    body = (r.get("body") or b"")[:200_000].decode("utf-8", "replace").lower()
    return bool(h.get("cf-mitigated") or "challenge-platform" in body or "cf-chl" in body
                or "<title>just a moment" in body or "attention required! | cloudflare" in body)


def probe(domain, base=None):
    base = (base or f"https://{domain}").rstrip("/")
    parts = urllib.parse.urlsplit(base)
    host, port = parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)
    ev = {"domain": domain, "base": base}
    try:
        ev["dns"] = sorted({a[4][0] for a in socket.getaddrinfo(host, port)})
        ev["dns_ok"] = True
    except Exception as e:  # noqa: BLE001
        ev["dns_ok"], ev["dns_error"] = False, f"{type(e).__name__}: {e}"
    if parts.scheme == "https" and ev["dns_ok"]:
        try:
            with socket.create_connection((host, port), timeout=TIMEOUT) as s:
                with CTX.wrap_socket(s, server_hostname=host) as t:
                    ev["tls_not_after"] = t.getpeercert().get("notAfter")
            ev["tls_ok"] = True
        except Exception as e:  # noqa: BLE001
            ev["tls_ok"], ev["tls_error"] = False, f"{type(e).__name__}: {str(e)[:160]}"
    else:
        ev["tls_ok"] = ev["dns_ok"]
    r = fetch(f"{base}/")
    ev["start"] = dict(status=r["status"], error=r["error"], final=r["final"], chain=r["chain"],
                       challenge=_challenge(r))
    ev["as_ahrefs"] = {}
    for name, ua in AHREFS_UAS.items():
        r = fetch(f"{base}/", ua=ua)
        ev["as_ahrefs"][name] = dict(status=r["status"], error=r["error"], challenge=_challenge(r),
                                     cf_mitigated=(r.get("headers") or {}).get("cf-mitigated"))
    rr = fetch(f"{base}/robots.txt")
    ev["robots_status"] = rr["status"]
    ev["robots_allows"] = {}
    if rr["status"] == 200:
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(rr["body"].decode("utf-8", "replace").splitlines())
        for name in AHREFS_UAS:
            ev["robots_allows"][name] = rp.can_fetch(name, f"{base}/")
    ev["verdict"], ev["why"] = probe_verdict(ev)
    return ev


def main(argv):
    if len(argv) < 3 or argv[1] not in ("crawl", "probe", "verdict"):
        print(__doc__)
        return 2
    mode, domain, rest = argv[1], argv[2], argv[3:]
    opt = {rest[i].lstrip("-"): rest[i + 1] for i in range(0, len(rest) - 1, 2)}
    if mode == "verdict":  # evidence JSON on argv[2] -> verdict; the testable seam
        v, why = probe_verdict(json.loads(domain))
        print(json.dumps({"verdict": v, "why": why}))
        return 0
    if mode == "crawl":
        res = crawl(domain, opt.get("base"), int(opt.get("cap", 400)))
        line = (f"SITE-CRAWL {domain}: pages={res['pages_crawled']}/{res['sitemap_total']} "
                f"targets={res['targets_checked']} " + " ".join(f"{k}={v}" for k, v in res["counts"].items()))
    else:
        res = probe(domain, opt.get("base"))
        line = f"SITE-PROBE {domain}: {res['verdict']} — {res['why']}"
    if opt.get("out"):
        with open(opt["out"], "w") as f:
            json.dump(res, f, indent=1, default=list)
    else:
        print(json.dumps(res, indent=1, default=list))
    print(line, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
