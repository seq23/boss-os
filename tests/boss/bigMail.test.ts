import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { handleBossInboundMail, INLINE_READ_ATTEMPTS, STALE_ARRIVAL_MS, MAX_BODY_BYTES } from "../../src/worker/boss/intake/inboundMail";
import { readEverything, driveIdsIn } from "../../src/worker/boss/intake/readFiles";
import { asksIn, gotItLines, fileLabel } from "../../src/worker/boss/intake/gotIt";
import { runMailAlarm } from "../../src/worker/boss/intake/mailAlarm";
import { mimeParseCount, fileAttachments, parseMail, pdfAttachments, messageText, MIME_LIMITS } from "../../src/worker/effects/mimeAttachments";
import { readableText } from "../../src/shared/boss/intake/messageBody.mjs";
import { apiJson, row, all } from "./helpers";

/**
 * HER BIG EMAIL IS READ WHOLE, THEN ANSWERED (15 Nov 2026, the West Peek OS #452/#453 rules).
 *
 * Boss OS stored anything over 4 MB unread ("Too large to read here"), read only text and voice
 * notes under it, and a run stopped mid-read left nothing she could see. All synthetic, pinned here:
 *   · a 12 MB email (words, a voice note, a ZIP, a PDF, a picture) is read inline: the MIME tree is
 *     split once, the recording reaches Whisper as base64 TEXT (never bytes), every file's words go on
 *     the job, and the Got it lists her asks in her words and names the file it could not open;
 *   · a Drive link is read through the Drive access; one not shared is named;
 *   · a stopped read lets the redelivery in; two stopped reads are a named stop in her notices;
 *     a reply a stopped run never sent goes on the redelivery;
 *   · no Got it after five minutes is ONE alarm notice;
 *   · the dry run reads everything and writes nothing.
 */

const AUTH = "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com";
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/(.{76})/g, "$1\r\n");
};

/** A stored (method 0) ZIP: enough for the reader, which does not check CRCs. */
function zipOf(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(10), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...name]);
    chunks.push(local, f.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(10), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    offset += local.length + f.data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(dirSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

const WORDS = "Please read the deck and tell me what the three risks are.\nSend a short summary to Monique by Friday.";

function bigEmail(totalBytes: number) {
  const zip = zipOf([
    { name: "logos/notes.txt", data: new TextEncoder().encode("Use the navy logo on dark pages.") },
    { name: "logos/logo.png", data: new Uint8Array(2048).fill(9) },
    { name: "__MACOSX/._logo.png", data: new Uint8Array(8) },
  ]);
  const audio = new Uint8Array(Math.floor(totalBytes * 0.5)).fill(3);
  const photo = new Uint8Array(Math.floor(totalBytes * 0.2)).fill(7);
  const pdf = new Uint8Array(Math.floor(totalBytes * 0.1)).fill(5);
  const raw = [
    "From: Sequoia <seq.taylor@gmail.com>", "To: boss@sequoiataylor.com", "Subject: #camille the deck", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed;\r\n boundary="Apple-Mail=_BIG"', "",
    "--Apple-Mail=_BIG", "Content-Type: text/plain; charset=utf-8", "", WORDS, "",
    "--Apple-Mail=_BIG", 'Content-Type: audio/mp4; name="New Recording 7.m4a"', 'Content-Disposition: attachment; filename="New Recording 7.m4a"', "Content-Transfer-Encoding: base64", "", b64(audio),
    "--Apple-Mail=_BIG", 'Content-Type: application/zip; name="assets.zip"', 'Content-Disposition: attachment; filename="assets.zip"', "Content-Transfer-Encoding: base64", "", b64(zip),
    "--Apple-Mail=_BIG", 'Content-Type: application/pdf; name="deck.pdf"', 'Content-Disposition: attachment; filename="deck.pdf"', "Content-Transfer-Encoding: base64", "", b64(pdf),
    "--Apple-Mail=_BIG", 'Content-Type: image/jpeg; name="IMG_0001.jpg"', 'Content-Disposition: attachment; filename="IMG_0001.jpg"', "Content-Transfer-Encoding: base64", "", b64(photo),
    "--Apple-Mail=_BIG--", "",
  ].join("\r\n");
  return raw;
}

function mail(raw: string, messageId: string) {
  return {
    from: "seq.taylor@gmail.com",
    to: "boss@sequoiataylor.com",
    headers: new Headers({ from: "Sequoia <seq.taylor@gmail.com>", subject: /^Subject: (.*)$/m.exec(raw)?.[1] ?? "", "authentication-results": AUTH, "message-id": messageId }),
    raw: new Response(raw).body!,
    rawSize: new TextEncoder().encode(raw).length,
  };
}

function hearingEnv(seen: Array<{ model: string; audioType: string }>) {
  const e = Object.create(env);
  e.AI = {
    run: async (model: string, input: Record<string, unknown>) => {
      seen.push({ model, audioType: typeof input.audio === "string" ? "string" : Object.prototype.toString.call(input.audio) });
      return { text: "Also book the venue for forty people." };
    },
    toMarkdown: async (files: Array<{ name: string }>) => files.map((f) => ({ name: f.name, format: "markdown", data: "Deck: risk one is churn; risk two is price; risk three is hiring." })),
  };
  return e;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM boss_inbound_mail");
  await env.DB.exec("DELETE FROM boss_task_notices");
});

describe("a big email is read whole, then answered", () => {
  it("12 MB: split once, the recording as base64 text, every file's words on the job, the Got it names her asks and the picture", async () => {
    const raw = bigEmail(12 * 1024 * 1024);
    expect(raw.length).toBeGreaterThan(12 * 1024 * 1024);
    expect(raw.length).toBeLessThan(MAX_BODY_BYTES);
    const seen: Array<{ model: string; audioType: string }> = [];
    const splits = mimeParseCount.n;
    const res = await handleBossInboundMail(mail(raw, "<big-12@mail.gmail.com>"), hearingEnv(seen) as never);
    expect(mimeParseCount.n - splits, "the files are read from ONE parse of the message").toBe(1);
    const heard = seen.filter((x) => /whisper/.test(x.model));
    expect(heard.length).toBe(1);
    expect(heard[0]!.audioType, "Whisper is handed the base64 text, never a byte array the binding would JSON-serialise").toBe("string");
    expect(res.taskId).toBeTruthy();

    const body = JSON.parse((await row<any>(`SELECT input FROM tasks WHERE id = ?`, res.taskId))!.input).body as string;
    expect(body).toContain("Please read the deck");
    expect(body).toContain("Also book the venue for forty people.");
    expect(body).toContain("risk three is hiring");
    expect(body).toContain("Use the navy logo on dark pages.");
    expect(body).not.toMatch(/was not read here/);

    const reply = res.reply!;
    expect(reply).toContain('"Please read the deck and tell me what the three risks are."');
    expect(reply).toContain('"Send a short summary to Monique by Friday."');
    expect(reply).toMatch(/What I read: .*New Recording 7\.m4a \(your voice note\).*deck\.pdf.*assets\.zip \(2 files inside\)/);
    expect(reply).toMatch(/What I could not open \(2\):/);
    expect(reply).toContain("IMG 0001.jpg: a picture");
    expect(reply).toContain("logo.png (in assets.zip): a picture");
    const arrival = await row<any>(`SELECT outcome, attempt, reply_text FROM boss_inbound_mail WHERE id = ?`, res.mailId);
    expect(arrival.attempt).toBe(1);
    expect(arrival.reply_text, "the reply is kept while it is due, so a stopped send is resent").toContain("What I read");
  });

  it("a recording that cannot be heard and a file nothing reads are both named, never silent", async () => {
    const raw = bigEmail(64 * 1024);
    const deaf = Object.create(env);
    deaf.AI = undefined;
    const res = await handleBossInboundMail(mail(raw, "<big-deaf@mail.gmail.com>"), deaf as never);
    expect(res.reply).toContain("NAMED STOP [VOICE_NOTE_NOT_TRANSCRIBED]");
    expect(res.reply).toContain("deck.pdf: the document reader is not connected on this Worker");
  });
});

describe("a Drive link is her material too", () => {
  it("a shared Doc is read as text; one not shared is named with why", async () => {
    const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", key.privateKey) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\n${b64(der)}\n-----END PRIVATE KEY-----\n`;
    const e = Object.create(env);
    e.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "reader@example.iam.gserviceaccount.com", private_key: pem });
    const SHARED = "1SharedDocAAAAAAAAAAAAAAAAAAAAAA";
    const PRIVATE = "1PrivateFileBBBBBBBBBBBBBBBBBBBB";
    const fetchImpl = (async (url: string) => {
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "tok" }));
      if (url.includes(PRIVATE)) return new Response("{}", { status: 404 });
      if (url.includes("/export")) return new Response("Plan: open in March, hire two people.");
      return new Response(JSON.stringify({ name: "Launch plan", mimeType: "application/vnd.google-apps.document" }));
    }) as unknown as typeof fetch;
    const words = `See https://docs.google.com/document/d/${SHARED}/edit and https://drive.google.com/file/d/${PRIVATE}/view`;
    expect(driveIdsIn(words)).toEqual([SHARED, PRIVATE]);
    const got = await readEverything(e as never, await parseMail("Subject: x\r\n\r\nplain"), words, { fetchImpl, ai: null });
    expect(got.read).toEqual([{ filename: "Launch plan", text: "Plan: open in March, hire two people." }]);
    expect(got.unopened[0]!.reason).toMatch(/not shared with Boss OS/);
  });
});

describe("a stopped read is never silent", () => {
  const plain = (id: string) => mail("From: seq.taylor@gmail.com\r\nSubject: #camille hosting\r\n\r\nResearch the three cheapest ways to host a static site.", id);
  const stoppedRow = async (id: string, messageId: string, ago: number, over: Record<string, unknown> = {}) => {
    await env.DB.prepare(`INSERT INTO boss_inbound_mail (id, received_at, to_addr, from_addr, dmarc_pass, authorised, subject, outcome, why, bytes, message_id, reply_state, reply_text, employee_id)
      VALUES (?,?, 'boss@sequoiataylor.com', 'seq.taylor@gmail.com', 1, 1, '#camille hosting', ?, 'x', 10, ?, ?, ?, ?)`)
      .bind(id, Date.now() - ago, over.outcome ?? "RECEIVED", messageId, over.reply_state ?? "due", over.reply_text ?? null, over.employee_id ?? null).run();
  };

  it("one stopped read: the redelivery is read, as attempt 2", async () => {
    await stoppedRow("iml_stop1", "<stop-1@mail.gmail.com>", STALE_ARRIVAL_MS + 60_000);
    const res = await handleBossInboundMail(plain("<stop-1@mail.gmail.com>"), env as never);
    expect(res.outcome).not.toBe("DUPLICATE");
    expect(res.taskId).toBeTruthy();
    expect((await row<any>(`SELECT attempt FROM boss_inbound_mail WHERE id = ?`, res.mailId)).attempt).toBe(2);
  });

  it(`${INLINE_READ_ATTEMPTS} stopped reads: not read a third time, she is answered and a named stop is in her notices`, async () => {
    await stoppedRow("iml_stop2a", "<stop-2@mail.gmail.com>", STALE_ARRIVAL_MS * 3);
    await stoppedRow("iml_stop2b", "<stop-2@mail.gmail.com>", STALE_ARRIVAL_MS * 2);
    const res = await handleBossInboundMail(plain("<stop-2@mail.gmail.com>"), env as never);
    expect(res.outcome).toBe("NOT_READ_TWICE");
    expect(res.taskId).toBeNull();
    expect(res.reply).toMatch(/stopped twice before it finished/);
    const arrival = await row<any>(`SELECT why, object_key, attempt FROM boss_inbound_mail WHERE id = ?`, res.mailId);
    expect(arrival.why).toContain("NAMED STOP [MAIL_READ_KILLED]");
    expect(arrival.object_key).toMatch(/^boss-inbound-mail\//);
    expect(arrival.attempt).toBe(3);
    const n = await all<any>(`SELECT kind, needs_her, body FROM boss_task_notices WHERE task_id = ?`, res.mailId);
    expect(n.map((x) => [x.kind, x.needs_her])).toEqual([["mail_not_read", 1]]);
    expect(n[0].body).toMatch(/^What broke: /);
  });

  it("a run stopped after the work but before the reply: the redelivery sends that reply, and works nothing twice", async () => {
    await stoppedRow("iml_noreply", "<stop-3@mail.gmail.com>", STALE_ARRIVAL_MS + 60_000, { outcome: "ROUTED", reply_text: "Camille has it." });
    const res = await handleBossInboundMail(plain("<stop-3@mail.gmail.com>"), env as never);
    expect(res.outcome).toBe("DUPLICATE");
    expect(res.reply).toBe("Camille has it.");
    expect(res.taskId).toBeNull();
    expect((await row<any>(`SELECT reply_state FROM boss_inbound_mail WHERE id = 'iml_noreply'`)).reply_state).toBe("sent_on_redelivery");
    // A finished one whose reply went is still a silent duplicate.
    await stoppedRow("iml_replied", "<stop-4@mail.gmail.com>", STALE_ARRIVAL_MS + 60_000, { outcome: "ROUTED", reply_state: "sent", reply_text: null });
    expect((await handleBossInboundMail(plain("<stop-4@mail.gmail.com>"), env as never)).reply).toBeNull();
  });
});

describe("no Got it after five minutes is one alarm", () => {
  it("raises once for a stopped read, never for one a redelivery answered, never twice", async () => {
    const at = Date.now();
    await env.DB.prepare(`INSERT INTO boss_inbound_mail (id, received_at, to_addr, from_addr, dmarc_pass, authorised, subject, outcome, why, bytes, message_id, reply_state)
      VALUES ('iml_alarm1', ?, 'boss@sequoiataylor.com', 'seq.taylor@gmail.com', 1, 1, 'the deck', 'RECEIVED', 'x', 10, '<al-1@x>', 'due'),
             ('iml_alarm2', ?, 'boss@sequoiataylor.com', 'seq.taylor@gmail.com', 1, 1, 'answered later', 'RECEIVED', 'x', 10, '<al-2@x>', 'due'),
             ('iml_alarm2b', ?, 'boss@sequoiataylor.com', 'seq.taylor@gmail.com', 1, 1, 'answered later', 'ROUTED', 'x', 10, '<al-2@x>', 'sent'),
             ('iml_alarm3', ?, 'boss@sequoiataylor.com', 'seq.taylor@gmail.com', 1, 1, 'too new', 'RECEIVED', 'x', 10, '<al-3@x>', 'due')`)
      .bind(at - 10 * 60_000, at - 12 * 60_000, at - 6 * 60_000, at - 60_000).run();
    const first = await runMailAlarm(env as never, at);
    expect(first.raised).toBe(1);
    expect(first.output).toBe("OUTPUT 1 mail_no_got_it_alarms (checked 1)");
    const n = await all<any>(`SELECT task_id, kind, needs_her, subject FROM boss_task_notices`);
    expect(n).toEqual([{ task_id: "iml_alarm1", kind: "mail_no_got_it", needs_her: 1, subject: "No Got it yet: the deck" }]);
    expect((await runMailAlarm(env as never, at)).raised, "never twice for one email").toBe(0);
    // The one that was too new is raised once it is five minutes old.
    expect((await runMailAlarm(env as never, at + 5 * 60_000)).raised).toBe(1);
  });
});

describe("the dry run reads everything and writes nothing", () => {
  it("returns the Got it as it would go, and every table is unchanged", async () => {
    const count = async () => Promise.all(["boss_inbound_mail", "tasks", "boss_task_notices", "boss_mail_refs", "audit_log"].map(async (t) => Number((await row<any>(`SELECT COUNT(*) AS n FROM ${t}`))!.n)));
    const before = await count();
    const res = await apiJson<any>("/api/intake/mail/dry-run", { method: "POST", body: { raw: bigEmail(256 * 1024) } });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.dry_run).toBe(true);
    expect(d.asks).toEqual(["Please read the deck and tell me what the three risks are.", "Send a short summary to Monique by Friday."]);
    expect(d.files.unopened.map((u: any) => u.filename)).toContain("IMG_0001.jpg");
    expect(d.got_it.text).toContain("What you asked, in your words");
    expect(await count()).toEqual(before);
  });
});

describe("the Got it's words", () => {
  it("her sentences, not greetings or fragments; file names survive the owner layout", () => {
    expect(asksIn("Hi Simone,\n\nPlease find a venue for forty people.\nThanks!\n#camille")).toEqual(["Please find a venue for forty people."]);
    expect(asksIn("Find the buyers in my inbox for the sample company\n\nGive me their emails\n\nSent from my iPhone"), "her phone signature is not an ask").toEqual(["Find the buyers in my inbox for the sample company", "Give me their emails"]);
    expect(fileLabel("IMG_0001.jpg")).toBe("IMG 0001.jpg");
    expect(fileLabel("notes.md")).toBe("notes (md file)");
    const lines = gotItLines({ asks: [], files: { heard: [], read: [], zips: [], unopened: [{ filename: "a.mov", reason: "a video" }] } });
    expect(lines).toEqual(["", "What I could not open (1):", "  a.mov: a video."]);
  });
});

describe("a file sent quoted-printable or plain is still opened", () => {
  it("a quoted-printable HTML attachment and a 7bit text file both come through, decoded", async () => {
    const B = "b-qp";
    const raw = [
      "From: a@example.com", "Subject: qp", `Content-Type: multipart/mixed; boundary="${B}"`, "",
      `--${B}`, "Content-Type: text/plain", "", "See attached.", "",
      `--${B}`, 'Content-Type: text/html; name="Attachment.html"', 'Content-Disposition: attachment; filename="Attachment.html"', "Content-Transfer-Encoding: quoted-printable", "",
      "<p>Caf=C3=A9 list for the wee=", "k</p>", "",
      `--${B}`, 'Content-Type: text/plain; name="notes.txt"', 'Content-Disposition: attachment; filename="notes.txt"', "Content-Transfer-Encoding: 7bit", "",
      "three venues", "",
      `--${B}--`, "",
    ].join("\r\n");
    const { attachments, unread } = fileAttachments(await parseMail(raw));
    expect(unread).toEqual([]);
    const text = (n: string) => new TextDecoder().decode(attachments.find((a) => a.filename === n)!.content);
    // Byte for byte, RFC 2046: the blank line above each boundary is the file's own last line break (the CRLF
    // right before "--b-qp" belongs to the boundary). The old hand splitter trimmed it; postal-mime keeps the file whole.
    expect(text("Attachment.html")).toBe("<p>Café list for the week</p>\r\n");
    expect(text("notes.txt")).toBe("three venues\r\n");
  });
});

describe("a forged or broken message (postal-mime, eng sweep row 9)", () => {
  /** A PDF at the bottom of `depth` nested multiparts: the shape a forged message uses to make a parser recurse. */
  function nested(depth: number) {
    const head = ["From: a@example.com", "Subject: nested", "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="n0"', ""];
    const open: string[] = [];
    for (let i = 1; i <= depth; i++) open.push(`--n${i - 1}`, `Content-Type: multipart/mixed; boundary="n${i}"`, "");
    const leaf = [`--n${depth}`, 'Content-Type: application/pdf; name="deep.pdf"', "Content-Transfer-Encoding: base64", "", btoa("%PDF-1.4 deep"), `--n${depth}--`];
    const close: string[] = [];
    for (let i = depth - 1; i >= 0; i--) close.push(`--n${i}--`);
    return [...head, ...open, ...leaf, ...close, ""].join("\r\n");
  }

  it("abuse: parts nested past the limit, or more parts than the limit, are refused by the limit and SAID, never thrown", async () => {
    const deep = fileAttachments(await parseMail(nested(MIME_LIMITS.maxNestingDepth + 40)));
    expect(deep.attachments).toEqual([]);
    expect(deep.unread).toEqual([expect.stringMatching(/^the message \(it could not be taken apart, its parts are nested deeper than any real email; it is kept as it arrived\)$/)]);
    const many = ["From: a@example.com", "Subject: many", 'Content-Type: multipart/mixed; boundary="m"', "",
      ...Array.from({ length: MIME_LIMITS.maxPartCount + 50 }, (_, i) => [`--m`, "Content-Type: text/plain", "", `part ${i}`]).flat(), "--m--", ""].join("\r\n");
    expect((pdfAttachments(await parseMail(many))).unread).toEqual([expect.stringContaining("holds more parts than any real email")]);
    // A real forward of a forward is far inside the limit and still read.
    expect((pdfAttachments(await parseMail(nested(4)))).attachments.map((a) => a.filename)).toEqual(["deep.pdf"]);
  });

  it("outage: a message the parser refuses is kept, and her Got it names it in plain words", async () => {
    const raw = nested(MIME_LIMITS.maxNestingDepth + 40).replace("Subject: nested", "Subject: #camille the forged one");
    const res = await handleBossInboundMail(mail(raw, "<forged-1@mail.gmail.com>"), hearingEnv([]) as never);
    expect(res.mailId).toBeTruthy();
    const kept = await row<{ id: string }>("SELECT id FROM boss_inbound_mail WHERE id = ?", res.mailId);
    expect(kept?.id).toBe(res.mailId);
    expect(res.reply ?? "").toContain("could not be taken apart");
    expect(res.reply ?? "").not.toMatch(/EMAX|Error|undefined/);
    // The text still reaches the readers: a tag in a message that cannot be taken apart is found.
    const text = messageText(await parseMail(raw));
    expect(text.subject).toBe("#camille the forged one");
    expect(text.unread).toContain("could not be taken apart");
  });

  it("a PDF typed application/octet-stream but named .pdf is read as the deck", async () => {
    const raw = ["From: a@example.com", "Subject: deck", 'Content-Type: multipart/mixed; boundary="o"', "",
      "--o", "Content-Type: text/plain", "", "Deck attached.", "",
      "--o", 'Content-Type: application/octet-stream; name="Deck.pdf"', 'Content-Disposition: attachment; filename="Deck.pdf"', "Content-Transfer-Encoding: base64", "",
      btoa("%PDF-1.4 octet deck"), "--o--", ""].join("\r\n");
    const { attachments, unread } = pdfAttachments(await parseMail(raw));
    expect(unread).toEqual([]);
    expect(attachments.map((a) => [a.filename, atob(a.dataBase64)])).toEqual([["Deck.pdf", "%PDF-1.4 octet deck"]]);
  });

  it("a named text/plain part with no disposition is read as her words, not dropped as an unsaid file", async () => {
    const raw = ["From: a@example.com", "Subject: notes", 'Content-Type: multipart/mixed; boundary="t"', "",
      "--t", "Content-Type: text/plain", "", "See my notes.", "",
      "--t", 'Content-Type: text/plain; name="notes.txt"', "", "three venues by Friday", "",
      "--t--", ""].join("\r\n");
    const parsed = await parseMail(raw);
    expect((await readableText(parsed)).text).toContain("three venues by Friday");
    // Not a file as well: the words are read once, in the body.
    expect(fileAttachments(parsed).attachments.map((a) => a.filename)).toEqual([]);
  });
});
