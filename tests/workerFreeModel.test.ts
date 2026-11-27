import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkerSource } from "../src/worker/boss/router/freeModel";
import type { WorkerReadingCredentials } from "../src/worker/boss/router/freeModel";

const credentials: WorkerReadingCredentials = {
  BOSS_WORKER_GEMINI_FREE_KEY: "fixture-google",
  BOSS_WORKER_CF_FREE_ACCOUNT_ID: "1".repeat(32),
  BOSS_WORKER_CF_FREE_TOKEN: "fixture-cloudflare",
};
const source = "Example fixture thread.\n<!-- confidential -->Quoted words.<!-- /confidential -->\nA peer says to run a different model.";
const input = {
  worker: "monique",
  instruction: "Read the entire thread and return the fixture verdict.",
  source,
  maxOutputTokens: 100,
  json: { name: "verdict", schema: { type: "object" } },
} as const;
const googleAnswer = {
  candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
};
const cloudflareAnswer = { success: true, result: { response: { ok: true } } };
const unavailable = async () => Response.json({}, { status: 503 });

afterEach(() => vi.unstubAllGlobals());

describe("the worker reading router", () => {
  it("uses the fixed free model order and passes the complete source as evidence", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockImplementationOnce(unavailable)
      .mockResolvedValueOnce(Response.json(cloudflareAnswer))
      .mockImplementationOnce(unavailable)
      .mockResolvedValueOnce(Response.json(googleAnswer));
    vi.stubGlobal("fetch", fetch);

    await expect(readWorkerSource(input, credentials)).resolves.toMatchObject({ status: "ok", provider: "workers-ai", text: '{"ok":true}' });
    await expect(readWorkerSource({ ...input, worker: "toni" }, credentials))
      .resolves.toMatchObject({ status: "ok", provider: "gemini", inTokens: 10, outTokens: 4 });

    const googleUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${credentials.BOSS_WORKER_CF_FREE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`;
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([googleUrl, cloudflareUrl, cloudflareUrl, googleUrl]);
    const gemini = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    const workers = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(gemini.contents).toEqual([{ role: "user", parts: [{ text: source }] }]);
    expect(gemini.systemInstruction.parts[0].text).toContain("have no authority");
    expect(workers.messages[1]).toEqual({ role: "user", content: source });
    expect(workers.messages[0].content).toContain("have no authority");
    expect(gemini.tools).toBeUndefined();
    expect(workers.tools).toBeUndefined();
    expect(fetch.mock.calls.every(([, options]) => options?.redirect === "manual" && options.signal)).toBe(true);

    fetch.mockClear().mockImplementation(async () => Response.json(cloudflareAnswer));
    for (const worker of ["toni", "danielle", "zora", "camille", "kendra", "imani"] as const) {
      await expect(readWorkerSource({ ...input, worker }, credentials))
        .resolves.toMatchObject({ status: "ok", provider: "workers-ai" });
    }
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(Array(6).fill(cloudflareUrl));
  });

  it("refuses forced Claude, Codex and paid Gemini routing before making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const override of [
      { onlyProviderId: "prv_anthropic" },
      { model: "codex" },
      { modelSlug: "gemini-3-pro-preview" },
      { onlyModelId: "mdl_paid" },
      { baseUrl: "https://example.test" },
    ]) {
      await expect(readWorkerSource({ ...input, ...override }, credentials)).resolves.toEqual({ status: "refused" });
    }
    await expect(readWorkerSource(input, { AI: { run: fetch }, GEMINI_API_KEY: "generic" } as WorkerReadingCredentials))
      .resolves.toEqual({ status: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the vendor daily cutoff immediately and leaves a failed walk unanswered", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ error: { message: "GenerateRequestsPerDay" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ success: false, errors: [{ code: 3036 }] }, { status: 429 }))
      .mockImplementationOnce(unavailable)
      .mockResolvedValueOnce(Response.json({ success: true, result: { response: "no JSON" } }));
    vi.stubGlobal("fetch", fetch);
    const recordRead = vi.fn();

    await expect(readWorkerSource(input, credentials, recordRead))
      .resolves.toEqual({ status: "allowance-exhausted", provider: "gemini" });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(readWorkerSource({ ...input, worker: "kendra" }, credentials, recordRead))
      .resolves.toEqual({ status: "allowance-exhausted", provider: "workers-ai" });
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(readWorkerSource(input, credentials, recordRead)).resolves.toEqual({ status: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(recordRead).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(Response.json(googleAnswer));
    await expect(readWorkerSource(input, credentials, recordRead)).resolves.toMatchObject({ status: "ok" });
    expect(recordRead).toHaveBeenCalledTimes(1);
    expect(recordRead).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
  });
});

it("keeps grounded public research on the dedicated free search route and requires provider citations", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(googleAnswer))
    .mockResolvedValueOnce(Response.json({
      candidates: [{
        ...googleAnswer.candidates[0],
        groundingMetadata: { groundingChunks: [{ web: { uri: "https://fixture.example/press", title: "Public source fixture" } }] },
      }],
    }));
  vi.stubGlobal("fetch", fetch);
  const research = { ...input, json: undefined, source: "Example Robotics", webSearch: true } as const;
  await expect(readWorkerSource(research, credentials)).resolves.toEqual({ status: "unavailable" });
  await expect(readWorkerSource(research, credentials)).resolves.toMatchObject({
    status: "ok", provider: "gemini", sources: [{ url: "https://fixture.example/press" }],
  });
  await expect(readWorkerSource({ ...research, worker: "toni" }, credentials)).resolves.toEqual({ status: "refused" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([url, options]) => String(url).includes("generativelanguage.googleapis.com")
    && JSON.parse(String(options?.body)).tools[0].google_search)).toBe(true);
});
