/**
 * Run by tests/mimeMemory.test.ts in a child `node --max-old-space-size=128` (a Worker isolate's
 * limit): one message carrying a voice note of argv[2] MB goes through every reader a door uses, the
 * way a door does, holding the parse until the last reader is done. Prints `ok <heap MB>`; a heap
 * that runs out ends the process non-zero.
 */
import { parseMail, pdfAttachments, fileAttachments, messageText, unreadableDeckAttachments, base64OfBytes } from "../../src/worker/effects/mimeAttachments.ts";
import { taskBodyFrom } from "../../src/shared/boss/intake/messageBody.mjs";

const mb = Number(process.argv[2]);
const audio = Buffer.alloc(mb * 1024 * 1024);
for (let i = 0; i < audio.length; i += 1) audio[i] = (i * 2654435761) >>> 24;
const b64 = audio.toString("base64").replace(/.{76}/g, "$&\r\n");
const raw = Buffer.from(
  "From: Example Sender <sender@example.test>\r\nTo: inbox@example.test\r\nSubject: voice note\r\n" +
  'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n' +
  "--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease hear the note.\r\n" +
  '--b1\r\nContent-Type: audio/mp4; name="New Recording 4.m4a"\r\nContent-Disposition: attachment; filename="New Recording 4.m4a"\r\n' +
  "Content-Transfer-Encoding: base64\r\n\r\n" + b64 + "\r\n--b1--\r\n", "latin1").toString("latin1");

const parsed = await parseMail(raw);
if (!parsed.mail) throw new Error(`not parsed: ${parsed.failed}`);
const pdf = pdfAttachments(parsed);
const deck = unreadableDeckAttachments(parsed);
const text = messageText(parsed);
const body = await taskBodyFrom(parsed);
const files = fileAttachments(parsed);
const heard = base64OfBytes(files.attachments[0].content); // what the transcriber is handed
if (files.attachments.length !== 1 || heard.length < mb * 1024 * 1024 || !text.body.includes("hear the note") || !body.body.includes("hear the note") || pdf.attachments.length || deck.length) {
  throw new Error("the readers did not read the message");
}
console.log(`ok ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}`);
