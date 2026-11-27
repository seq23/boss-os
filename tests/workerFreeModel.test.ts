import { afterEach, describe, expect, it, vi } from "vitest";
import { MAIN_CLOUDFLARE_ACCOUNT_ID, readWorkerSource, setRateWait } from "../src/worker/boss/router/freeModel";
import { toBossEnv } from "../src/worker/bossMount";
import type { WorkerReadingCredentials } from "../src/worker/boss/router/freeModel";
import mapping from "../scripts/vault/cloudflare-mapping.json";

const credentials: WorkerReadingCredentials = {
  GEMINI_API_KEY: "fixture-google",
  CF2_ACCOUNT_ID: "1".repeat(32),
  CF2_WORKERS_AI_TOKEN: "fixture-cloudflare",
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
    const cloudflareUrl = `https://api.cloudflare.com/client/v4/accounts/${credentials.CF2_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`;
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
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads exactly the ruled vault names and never the main Cloudflare account or its AI binding", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(cloudflareAnswer));
    vi.stubGlobal("fetch", fetch);
    const binding = { run: vi.fn(async () => ({ response: { ok: true } })) };
    // The Worker's billed binding and the main account's names, with nothing else, reach no model.
    const billedOnly = {
      AI: binding, CLOUDFLARE_ACCOUNT_ID: "2".repeat(32), CLOUDFLARE_API_TOKEN: "main-account",
      BOSS_WORKER_GEMINI_FREE_KEY: "retired", BOSS_WORKER_CF_FREE_ACCOUNT_ID: "3".repeat(32), BOSS_WORKER_CF_FREE_TOKEN: "retired",
    } as WorkerReadingCredentials;
    await expect(readWorkerSource({ ...input, worker: "toni" }, billedOnly)).resolves.toEqual({ status: "unavailable" });
    // A CF2 id that is really the main account turns the Workers AI lane off.
    await expect(readWorkerSource({ ...input, worker: "toni" }, {
      CF2_ACCOUNT_ID: "2".repeat(32), CF2_WORKERS_AI_TOKEN: "fixture", CLOUDFLARE_ACCOUNT_ID: "2".repeat(32).toUpperCase(),
    })).resolves.toEqual({ status: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
    expect(binding.run).not.toHaveBeenCalled();
    // The two ruled lanes, each alone, are reached on their own names and hosts.
    await expect(readWorkerSource({ ...input, worker: "toni" }, {
      CF2_ACCOUNT_ID: "1".repeat(32), CF2_WORKERS_AI_TOKEN: "fixture", CLOUDFLARE_ACCOUNT_ID: "2".repeat(32), AI: binding,
    } as WorkerReadingCredentials)).resolves.toMatchObject({ status: "ok", provider: "workers-ai" });
    expect(String(fetch.mock.calls[0]?.[0])).toContain(`/accounts/${"1".repeat(32)}/ai/run/`);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer fixture" });
    fetch.mockClear().mockImplementation(async () => Response.json(googleAnswer));
    await expect(readWorkerSource(input, { GEMINI_API_KEY: "fixture-google" })).resolves.toMatchObject({ status: "ok", provider: "gemini" });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-goog-api-key": "fixture-google" });
    expect(binding.run).not.toHaveBeenCalled();
    // The Worker receives the same names from the vault sync, and no retired name.
    expect(mapping.secret_names).toEqual(expect.arrayContaining(["GEMINI_API_KEY", "CF2_ACCOUNT_ID", "CF2_WORKERS_AI_TOKEN"]));
    expect(JSON.stringify(mapping)).not.toContain("BOSS_WORKER_");
  });

  it("refuses the main Cloudflare account on the Worker, where no CLOUDFLARE_ACCOUNT_ID is passed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(cloudflareAnswer));
    vi.stubGlobal("fetch", fetch);
    // The Worker's real seam: toBossEnv carries CF2_* and never CLOUDFLARE_ACCOUNT_ID.
    const onWorker = (id: string) => toBossEnv({
      WP_OS_DB: {}, WP_OS_DOCUMENTS: {}, WP_OS_KV: {}, CF2_ACCOUNT_ID: id, CF2_WORKERS_AI_TOKEN: "fixture",
    } as never) as unknown as WorkerReadingCredentials;
    expect(onWorker(MAIN_CLOUDFLARE_ACCOUNT_ID).CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    for (const id of [MAIN_CLOUDFLARE_ACCOUNT_ID, ` ${MAIN_CLOUDFLARE_ACCOUNT_ID.toUpperCase()} `]) {
      await expect(readWorkerSource({ ...input, worker: "toni" }, onWorker(id))).resolves.toEqual({ status: "unavailable" });
    }
    expect(fetch).not.toHaveBeenCalled();
    // The second account itself is still read on the Worker.
    await expect(readWorkerSource({ ...input, worker: "toni" }, onWorker("1".repeat(32))))
      .resolves.toMatchObject({ status: "ok", provider: "workers-ai" });
    expect(String(fetch.mock.calls[0]?.[0])).toContain(`/accounts/${"1".repeat(32)}/ai/run/`);
  });

  it("moves a spent lane to the other lane and reports exhausted only when no lane answered", async () => {
    const geminiDay = () => Response.json({ error: { message: "GenerateRequestsPerDay" } }, { status: 429 });
    const workersDay = () => Response.json({ success: false, errors: [{ code: 3036 }] }, { status: 429 });
    const fetch = vi.fn<typeof globalThis.fetch>()
      // Monique: Gemini's day is spent, CF2's Workers AI answers.
      .mockResolvedValueOnce(geminiDay()).mockResolvedValueOnce(Response.json(cloudflareAnswer))
      // Kendra: CF2's 10,000 neurons are spent (code 3036), free Gemini answers.
      .mockResolvedValueOnce(workersDay()).mockResolvedValueOnce(Response.json(googleAnswer))
      // Both spent: exhausted, item kept unread.
      .mockResolvedValueOnce(geminiDay()).mockResolvedValueOnce(workersDay())
      // One spent, one down: still exhausted (the run stops; the item is unread either way).
      .mockResolvedValueOnce(geminiDay()).mockImplementationOnce(unavailable)
      // One down and the other answering in the wrong shape: a model read it and could not decide.
      .mockImplementationOnce(unavailable)
      .mockResolvedValueOnce(Response.json({ success: true, result: { response: "no JSON" } }))
      // Both down: unavailable, which never counts toward holding an item for a person.
      .mockImplementationOnce(unavailable).mockImplementationOnce(unavailable);
    vi.stubGlobal("fetch", fetch);

    await expect(readWorkerSource(input, credentials)).resolves.toMatchObject({ status: "ok", provider: "workers-ai" });
    await expect(readWorkerSource({ ...input, worker: "kendra" }, credentials)).resolves.toMatchObject({ status: "ok", provider: "gemini" });
    await expect(readWorkerSource(input, credentials)).resolves.toEqual({ status: "allowance-exhausted", provider: "workers-ai" });
    await expect(readWorkerSource(input, credentials)).resolves.toEqual({ status: "allowance-exhausted", provider: "gemini" });
    await expect(readWorkerSource(input, credentials)).resolves.toEqual({ status: "uncertain" });
    await expect(readWorkerSource(input, credentials)).resolves.toEqual({ status: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it("waits out a named per-minute limit once, and never a long or unnamed one", async () => {
    const waits: number[] = [];
    setRateWait(async (ms) => { waits.push(ms); });
    const minute = (delay: string) => Response.json({ error: { details: [{ retryDelay: delay }] } }, { status: 429 });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(minute("33s")).mockResolvedValueOnce(Response.json(googleAnswer))
      .mockResolvedValueOnce(minute("33s")).mockResolvedValueOnce(minute("33s"))
      .mockResolvedValueOnce(minute("600s"));
    vi.stubGlobal("fetch", fetch);
    const geminiOnly = { GEMINI_API_KEY: "fixture-google" };
    await expect(readWorkerSource(input, geminiOnly)).resolves.toMatchObject({ status: "ok", provider: "gemini" });
    await expect(readWorkerSource(input, geminiOnly)).resolves.toEqual({ status: "unavailable" });
    await expect(readWorkerSource(input, geminiOnly)).resolves.toEqual({ status: "unavailable" });
    expect(waits).toEqual([33_000, 33_000]);
    expect(fetch).toHaveBeenCalledTimes(5);
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
  await expect(readWorkerSource(research, credentials)).resolves.toEqual({ status: "uncertain" });
  await expect(readWorkerSource(research, credentials)).resolves.toMatchObject({
    status: "ok", provider: "gemini", sources: [{ url: "https://fixture.example/press" }],
  });
  await expect(readWorkerSource({ ...research, worker: "toni" }, credentials)).resolves.toEqual({ status: "refused" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([url, options]) => String(url).includes("generativelanguage.googleapis.com")
    && JSON.parse(String(options?.body)).tools[0].google_search)).toBe(true);
});
