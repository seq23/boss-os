/**
 * THREE REAL-SHAPED MESSAGES THROUGH THE ONE PARSE (row olp_m81m3hdh0dansp34, 22 Nov 2026): a Gmail-style multipart with a
 * file, RFC 2047 headers (Q, B, a folded run, windows-1252) and a forged nest past MIME_LIMITS. postal-mime reads them all;
 * nothing home-made is left; a message it cannot take apart is kept as text, never empty.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeHeader, parseMail } from "../src/shared/mail/parseMail.mjs";
import { readableText } from "../src/shared/boss/intake/messageBody.mjs";
import { carriesSecretValue, scrubSecretValues } from "../src/shared/boss/service/secretLines.mjs";

const eml = (name: string) => readFileSync(new URL(`./fixtures/mail/${name}`, import.meta.url), "utf8");
const header = (raw: string, name: string) =>
  new RegExp(`^${name}:([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`, "im").exec(raw)?.[1]?.replace(/\r?\n[ \t]/g, " ").trim() ?? "";

describe("the three fixtures through postal-mime", () => {
  it("a multipart with a PDF: her words joined across the soft break, the file whole as bytes", async () => {
    const parsed = await parseMail(eml("multipart-attachment.eml"));
    expect(parsed.failed).toBeNull();
    expect((await readableText(parsed)).text).toBe("#monique here is the deck — can you pull the three numbers on page 2 before Thursday?");
    const [pdf] = parsed.mail!.attachments;
    expect(pdf).toMatchObject({ filename: "Q3 deck.pdf", mimeType: "application/pdf" });
    expect(new TextDecoder().decode(new Uint8Array(pdf!.content as ArrayBuffer))).toMatch(/^%PDF-1\.4[\s\S]*%%EOF\n$/);
  });

  it("encoded headers: a tag survives the dash, a folded B word joins the run, windows-1252 reads as itself", async () => {
    const raw = eml("encoded-headers.eml");
    expect(decodeHeader(header(raw, "Subject"))).toBe("#simone Café booking — Friday “your call”");
    expect(decodeHeader(header(raw, "From"))).toBe("Renée O’Brien <owner@example.com>");
    expect(decodeHeader(header(raw, "Thread-Topic"))).toBe("“old label”");
    expect((await parseMail(raw)).mail!.subject).toBe(decodeHeader(header(raw, "Subject")));
    // Never throws: a broken word is the header as it came; empty is empty.
    expect(decodeHeader("=?UTF-8?Q?broken")).toBe("=?UTF-8?Q?broken");
    expect(decodeHeader(null)).toBe("");
  });

  it("a forged nest past MIME_LIMITS is refused by the parse and still read as text, never as empty", async () => {
    const parsed = await parseMail(eml("malformed-nesting.eml"));
    expect(parsed.mail).toBeNull();
    expect(parsed.failed).toBeTruthy();
    const read = await readableText(parsed);
    expect(read.format).toBe("unparsed");
    expect(read.text).toContain("#simone the words at the bottom of a forged nest");
  });
});

describe("the secret scrub reads with postal-mime and rewrites from its parse", () => {
  const v = "rk_live_9f8e7d6c5b4a";
  const withSecretIn = (encoding: "base64" | "quoted-printable") => [
    "From: Owner Example <owner@example.com>", "Subject: key", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="m"', "", "--m",
    "Content-Type: text/plain; charset=utf-8", `Content-Transfer-Encoding: ${encoding}`, "",
    encoding === "base64" ? Buffer.from(`SECRET RESEND_API_KEY=${v}\nthanks`).toString("base64") : `SECRET RESEND_API_KEY=3D${v.slice(0, 6)}=\r\n${v.slice(6)}`,
    "--m", 'Content-Type: application/pdf; name="a.pdf"', "Content-Transfer-Encoding: base64", "",
    Buffer.from("%PDF-1.4 keep me").toString("base64"), "--m--", "",
  ].join("\r\n");

  it.each(["base64", "quoted-printable"] as const)("a value hidden in a %s part is gone, and the file is kept byte for byte", async (enc) => {
    const raw = withSecretIn(enc);
    expect(raw.includes(v)).toBe(false);
    expect(await carriesSecretValue(raw, [v])).toBe(true);
    const clean = await scrubSecretValues(raw, [v]);
    expect(await carriesSecretValue(clean, [v])).toBe(false);
    const after = (await parseMail(clean)).mail!;
    expect(after.text).toContain("SECRET RESEND_API_KEY=[secret redacted]");
    expect(new TextDecoder().decode(new Uint8Array(after.attachments[0]!.content as ArrayBuffer))).toBe("%PDF-1.4 keep me");
    expect(after.subject).toBe("key");
  });

  it("a message with no encoded copy is left exactly as the literal replace made it", async () => {
    const raw = `From: a@example.com\r\nSubject: k\r\n\r\nSECRET RESEND_API_KEY=${v}\r\n`;
    expect(await scrubSecretValues(raw, [v])).toBe(raw.split(v).join("[secret redacted]"));
  });

  it("a message postal-mime cannot take apart keeps its headers and loses its body (fails closed)", async () => {
    const forged = eml("malformed-nesting.eml").replace("the words at the bottom", `SECRET X_KEY=${Buffer.from(v).toString("base64")} the words at the bottom`);
    const clean = await scrubSecretValues(forged, [v]);
    expect(clean).toMatch(/^From: Owner Example/);
    expect(clean).not.toContain("forged nest");
    expect(clean).toContain("X-Boss-OS-Scrubbed: body withheld");
  });
});
