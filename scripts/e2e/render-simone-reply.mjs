import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sendNotice } from "../ops/task-notices.mjs";

const directory = process.argv[2];
if (!directory) throw new Error("Provide an artifact directory");
const owner = "owner@example.test";
const original = "<venue-request@example.test>";
const notice = {
  id: "tnt_fixture", kind: "simone_result", from_name: "Simone", needs_her: 1,
  subject: "Venues for Saturday",
  body: "I found three free venues for Saturday. Maple Hall opens at noon, the Oak Room opens at two, and River Park opens at three. Maple Hall has a spot at noon. I left the date open on your calendar until the venue confirms.",
};
const task = { input: { agent: "simone", source: "boss_inbound_mail", from: owner, message_id: original } };
let messages = 0;
let payload;
process.env.BOSS_OS_MAIL_KEY = "fixture-only-key";
process.env.BOSS_EXTRA_OWNER_SENDERS = owner;
const result = await sendNotice(notice, {
  task,
  to: "wrong@example.test",
  fetchImpl: async (url, init) => {
    assert.equal(new URL(url).pathname, "/emails");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], notice.id);
    payload = JSON.parse(init.body);
    messages++;
    return Response.json({});
  },
});
assert.equal(result, null);
assert.equal(messages, 1);
assert.deepEqual(payload.to, [owner]);
assert.equal(payload.headers["In-Reply-To"], original);
assert.equal(payload.headers.References, original);
assert.match(payload.text, /Maple Hall opens at noon/);
assert.match(payload.html, /River Park opens at three/);
await mkdir(directory, { recursive: true });
await writeFile(join(directory, "simone-reply.html"), payload.html);
console.log("Rendered one Simone reply in the original fixture thread without sending mail.");
