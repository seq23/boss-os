/**
 * THE PART'S OWN CHARSET WINS (26 Oct 2026 held mail: a windows-1252 em dash and curly apostrophe
 * came out as U+FFFD, because `utf8()` always decoded as UTF-8 regardless of what the part's own
 * `Content-Type` declared). A declared non-UTF-8 charset decodes as itself — even when the raw
 * bytes would also parse as valid UTF-8, so a declared charset is honoured, not just used as a
 * tie-breaker. An undeclared or UTF-8-declared part that is not actually valid UTF-8 (a client that
 * lied) falls back to windows-1252, the one real clients actually emit. Since 22 Nov 2026 postal-mime does the
 * decoding for every reader (the hand decoders in secretLines.mjs are gone), so these pins run whole messages.
 */
import { describe, expect, it } from "vitest";
import { readableText } from "../src/shared/boss/intake/messageBody.mjs";

const part = (charset: string | null, encoding: string, body: string) => [
  "From: Example Sender <sender@example.test>", "Subject: notice", "MIME-Version: 1.0",
  `Content-Type: text/plain${charset ? `; charset=${charset}` : ""}`, `Content-Transfer-Encoding: ${encoding}`, "", body, "",
].join("\r\n");
const read = async (charset: string | null, encoding: string, body: string) => (await readableText(part(charset, encoding, body))).text;
const b64 = (...b: number[]) => Buffer.from(b).toString("base64");

describe("quoted-printable honours its declared charset", () => {
  it("a declared charset overrides even bytes that would parse as valid UTF-8", async () => {
    expect(await read("utf-8", "quoted-printable", "Caf=C3=A9")).toBe("Café");
    expect(await read("windows-1252", "quoted-printable", "Caf=C3=A9")).toBe("CafÃ©");
  });
  it("a charset with a genuinely different mapping is used, not just the windows-1252 fallback", async () => {
    expect(await read("windows-1252", "quoted-printable", "x=E1y")).toBe("xáy");
    expect(await read("iso-8859-7", "quoted-printable", "x=E1y")).toBe("xαy");
  });
  it("undeclared, or a client that lied about UTF-8, falls back to windows-1252 (the held mail's em dash and curly apostrophe)", async () => {
    expect(await read(null, "quoted-printable", "folders =97 our mail")).toBe("folders — our mail");
    expect(await read("utf-8", "quoted-printable", "24 hours=92 notice")).toBe("24 hours’ notice");
  });
});

describe("base64 honours its declared charset", () => {
  it("a declared charset overrides even bytes that would parse as valid UTF-8", async () => {
    expect(await read("utf-8", "base64", b64(0x78, 0xc3, 0xa9, 0x79))).toBe("xéy");
    expect(await read("windows-1252", "base64", b64(0x78, 0xc3, 0xa9, 0x79))).toBe("xÃ©y");
  });
  it("a genuinely different mapping is used", async () => {
    expect(await read("iso-8859-7", "base64", b64(0x78, 0xe1, 0x79))).toBe("xαy");
  });
  it("undeclared falls back to windows-1252 when the bytes are not valid UTF-8", async () => {
    expect(await read(null, "base64", b64(0x78, 0x97, 0x79))).toBe("x—y");
  });
});

describe("a whole message read by readableText (postal-mime underneath)", () => {
  const msg = (contentType: string, encoding: string, body: string) => [
    "From: Example Sender <sender@example.test>", "Subject: notice", "MIME-Version: 1.0",
    `Content-Type: ${contentType}`, `Content-Transfer-Encoding: ${encoding}`, "", body, "",
  ].join("\r\n");

  it("a client that lied about UTF-8 still reads as the windows-1252 it is (the held mail)", async () => {
    const { text } = await readableText(msg("text/plain; charset=utf-8", "quoted-printable", "24 hours=92 notice =96 please"));
    expect(text).toBe("24 hours’ notice – please");
  });

  it("honest UTF-8 is left exactly as it was", async () => {
    const { text } = await readableText(msg('text/plain; charset="utf-8"', "quoted-printable", "Caf=C3=A9 =E2=80=94 deck"));
    expect(text).toBe("Café — deck");
  });
});
