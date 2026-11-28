import { env } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import { classify } from "../../src/worker/boss/intake/classify";
import { routeCompletion } from "../../src/worker/boss/router";
import { GEMINI_HOST } from "../../src/worker/boss/router/backends";
import { api, row, stubFetch } from "./helpers";

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

const MAIL = "Fictional fixture: Juniper Sample LP offered $73.25 per share. Summarise the email.";
const MARKED = " <!-- confidential -->Brain-only fixture<!-- /confidential -->";

it("routes the same synthetic deal email intact to Workers AI and free Gemini and cuts the marked brain section", async () => {
  await env.DB.prepare(`INSERT INTO prospects (id, email, name, source, created_at, updated_at, committed_at)
    VALUES ('prs_routing_fixture', 'juniper@example.test', 'Juniper Sample LP', 'test', 0, 0, 1)`).run();
  await env.DB.prepare("UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'").run();
  expect((await api("/api/models/provision/bk_workers_ai", { method: "POST", body: {} })).status).toBe(201);
  const calls = new Map<string, string>();
  const providers = Object.assign(Object.create(env), {
    GEMINI_API_KEY: "test-key-not-a-real-credential",
    AI: { async run(_model: string, body: unknown) {
      calls.set("prv_workers_ai", JSON.stringify(body));
      return { response: "Checked summary.", usage: { prompt_tokens: 20, completion_tokens: 10 } };
    } },
  });
  restore = stubFetch(async (req) => {
    expect(req.url.startsWith(GEMINI_HOST)).toBe(true);
    calls.set("prv_gemini", JSON.stringify(await req.json()));
    return Response.json({ candidates: [{ content: { parts: [{ text: "Checked summary." }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 } });
  });
  for (const provider of ["prv_workers_ai", "prv_gemini"]) {
    const result = await routeCompletion(providers, {
      routeId: "rt_ops_default", lane: "ops", intakeKind: "drafting", taskId: provider,
      onlyProviderId: provider, freeOnly: true, modelAccess: "private_model_only",
      messages: [{ role: "user", content: MAIL + MARKED }],
    });
    expect(result).toMatchObject({ providerId: provider, freeTier: true, costMicros: 0 });
    expect(calls.get(provider)).toContain(MAIL);
    expect(calls.get(provider)).not.toContain("Brain-only fixture");
    expect(await row("SELECT model_access FROM routing_decisions WHERE task_id = ?", provider))
      .toMatchObject({ model_access: "public_model_approved" });
  }
});

it("preserves the recipient approval axis for the same deal draft", () => {
  const base = { title: "Routing fixture", prompt: MAIL, intakeKind: "drafting", model_access: "private_model_only" };
  const own = classify({ ...base, audience: "internal" });
  const outside = classify({ ...base, audience: "external" });
  expect(own).toMatchObject({ audience: "internal", modelAccess: "public_model_approved" });
  expect(outside).toMatchObject({ audience: "external", modelAccess: "public_model_approved" });
});
