/**
 * THE PART'S OWN CHARSET WINS (26 Oct 2026 held mail: a windows-1252 em dash and curly apostrophe
 * came out as U+FFFD, because `utf8()` always decoded as UTF-8 regardless of what the part's own
 * `Content-Type` declared). A declared non-UTF-8 charset decodes as itself — even when the raw
 * bytes would also parse as valid UTF-8, so a declared charset is honoured, not just used as a
 * tie-breaker. An undeclared or UTF-8-declared part that is not actually valid UTF-8 (a client that
 * lied) falls back to windows-1252, the one real clients actually emit. How the raw message is read
 * is unchanged: only what these two decoders do with the bytes they are already given.
 */
import { describe, expect, it } from "vitest";
import { decodeQuotedPrintable, decodeBase64Text } from "../src/shared/boss/intake/messageBody.mjs";

describe("quoted-printable honours its declared charset", () => {
  it("a declared charset overrides even bytes that would parse as valid UTF-8", () => {
    // 0xC3 0xA9 is "é" in UTF-8 but two separate windows-1252 characters.
    expect(decodeQuotedPrintable("Caf=C3=A9")).toBe("Café");
    expect(decodeQuotedPrintable("Caf=C3=A9", "windows-1252")).toBe("CafÃ©");
  });
  it("a charset with a genuinely different mapping is used, not just the windows-1252 fallback", () => {
    // 0xE1 is "á" in windows-1252 (and the fallback) but Greek alpha in ISO-8859-7.
    expect(decodeQuotedPrintable("x=E1y", "windows-1252")).toBe("xáy");
    expect(decodeQuotedPrintable("x=E1y", "iso-8859-7")).toBe("xαy");
  });
  it("undeclared, or a client that lied about UTF-8, falls back to windows-1252 (the held mail's em dash and curly apostrophe)", () => {
    expect(decodeQuotedPrintable("folders =97 our mail")).toBe("folders — our mail");
    expect(decodeQuotedPrintable("24 hours=92 notice", "utf-8")).toBe("24 hours’ notice");
  });
  it("an unknown or unsupported label is never fatal: it falls through to the same default", () => {
    expect(decodeQuotedPrintable("x=97y", "not-a-real-charset")).toBe(decodeQuotedPrintable("x=97y"));
  });
});

describe("base64 honours its declared charset", () => {
  const bytes = (...b: number[]) => Buffer.from(b).toString("base64");
  it("a declared charset overrides even bytes that would parse as valid UTF-8", () => {
    expect(decodeBase64Text(bytes(0x78, 0xc3, 0xa9, 0x79))).toBe("xéy");
    expect(decodeBase64Text(bytes(0x78, 0xc3, 0xa9, 0x79), "windows-1252")).toBe("xÃ©y");
  });
  it("a genuinely different mapping is used", () => {
    expect(decodeBase64Text(bytes(0x78, 0xe1, 0x79), "windows-1252")).toBe("xáy");
    expect(decodeBase64Text(bytes(0x78, 0xe1, 0x79), "iso-8859-7")).toBe("xαy");
  });
  it("undeclared falls back to windows-1252 when the bytes are not valid UTF-8", () => {
    expect(decodeBase64Text(bytes(0x78, 0x97, 0x79))).toBe("x—y");
  });
});
