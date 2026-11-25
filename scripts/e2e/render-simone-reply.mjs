import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sendNotice } from "../ops/task-notices.mjs";
import { runSimone } from "../ops/simone.mjs";

const directory = process.argv[2];
if (!directory) throw new Error("Provide an artifact directory");
const owner = "owner@example.test";
const original = "<venue-request@example.test>";
const reply = "<venue-reply@example.test>";
const taskId = "tsk_fixturevenue";
const providerId = "simone-fixture-reply";
const task = { input: {
  agent: "simone", source: "boss_inbound_mail", from: owner, to: "simone@example.test", message_id: original,
  body: "Find me three venues for Saturday and book the cheapest free one.",
} };
const lease = 1;
let recorded;
const run = await runSimone({
  api: async (_method, path, data) => {
    if (path === "/claim") return { call: { id: taskId, lease, message: task.input, roster: [] } };
    assert.equal(path, "/reply");
    assert.equal(data.id, taskId);
    assert.equal(data.lease, lease);
    assert.deepEqual(data.work, ["WebSearch"]);
    recorded = data.text;
    return { replied: true };
  },
  run: async (_call, prompt) => {
    assert.match(prompt, /book the cheapest free one/);
    return { successful: true, log: [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "venue-search", name: "WebSearch" }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "venue-search",
        content: "Maple Hall has a free noon slot and requires booking in person. Oak Room is $30 at 2 p.m. River Park is $45 at 3 p.m." }] } },
      { type: "result", subtype: "success", result: "Maple Hall has a free Saturday slot at noon. Oak Room is $30 at 2 p.m. and River Park is $45 at 3 p.m. Maple Hall takes reservations in person, so I couldn’t book the slot.\nOUTPUT: 1 done" },
    ].map((entry) => JSON.stringify(entry)).join("\n") };
  },
});
assert.deepEqual(run, { state: "done", id: taskId });
const notice = {
  id: "tnt_fixture", task_id: taskId, kind: "simone_result", from_name: "Simone", needs_her: 1,
  subject: "Venues for Saturday", body: recorded,
};
let messages = 0;
let payload, archived, refs;
process.env.BOSS_OS_MAIL_KEY = "fixture-only-key";
process.env.BOSS_EXTRA_OWNER_SENDERS = owner;
process.env.BOSS_PASSCODE = "fixture-passcode";
process.env.BOSS_OS_SENT_MAIL_DIR = join(directory, "pending");
const result = await sendNotice(notice, {
  task,
  to: "wrong@example.test",
  fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === `/emails/${providerId}`) return Response.json({ message_id: reply });
    if (path === "/api/boss/auth/unlock") return Response.json({}, { headers: { "set-cookie": "fixture=authenticated" } });
    if (path === "/api/boss/mail/sent") {
      archived = JSON.parse(init.body);
      return Response.json({});
    }
    if (path === "/api/boss/mail-refs") {
      refs = JSON.parse(init.body);
      return Response.json({});
    }
    assert.equal(path, "/emails");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], notice.id);
    payload = JSON.parse(init.body);
    messages++;
    return Response.json({ id: providerId });
  },
});
assert.equal(result, null);
assert.equal(messages, 1);
assert.deepEqual(payload.to, [owner]);
assert.equal(payload.headers["In-Reply-To"], original);
assert.equal(payload.headers.References, original);
assert.equal(payload.headers["X-Boss-Ref"], taskId);
assert.equal(archived.message_id, reply);
assert.equal(archived.in_reply_to, original);
assert.equal(refs.message_id, reply);
assert.deepEqual(refs.refs, [taskId]);
assert.match(payload.text, /Maple Hall has a free Saturday slot at noon/);
assert.match(payload.html, /Maple Hall takes reservations in person/);
await mkdir(directory, { recursive: true });
await writeFile(join(directory, "simone-reply.html"), payload.html);
console.log("Rendered one Simone reply, archived the mock delivery, and recorded its thread reference.");
