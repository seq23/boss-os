import { readWorkerSource } from "../../../src/worker/boss/router/freeModel.ts";
import { readJsonObject } from "../../../src/worker/boss/router/types.ts";

export const readMonique = (input) => readWorkerSource({ ...input, worker: "monique" }, process.env);

export function stopReading(status) {
  throw new Error(status === "allowance-exhausted"
    ? "NAMED STOP [FREE_ALLOWANCE_EXHAUSTED] Unfinished research will be retried."
    : "NAMED STOP [CAPITAL_READING_UNAVAILABLE] Unfinished research will be retried.");
}

export async function readDealObject({ name, instruction, source, schema, validate, read = readMonique }) {
  const accept = (text) => {
    const answer = readJsonObject(text);
    return answer !== null && validate(answer);
  };
  const result = await read({
    worker: "monique", instruction, source: JSON.stringify(source), maxOutputTokens: 4096,
    json: { name, schema }, accept,
  });
  if (result.status !== "ok" || !accept(result.text)) stopReading(result.status);
  return readJsonObject(result.text);
}

export const issuerKey = (asset) => String(asset ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Resolve issuer identity in pages, preserving each input's display name and original row ID. */
export async function resolveIssuers(assets, { read } = {}) {
  const names = [...new Set(assets.map((name) => String(name ?? "").trim()).filter(Boolean))];
  const resolved = new Map();
  for (let offset = 0; offset < names.length; offset += 40) {
    const page = names.slice(offset, offset + 40);
    const result = await readDealObject({
      name: "issuer_identity",
      instruction: `Identify the underlying issuer for each name in inputs, including tickers,
former names and clearly identified holding vehicles. Use the same established issuer name for
aliases. Use the previous mapping when it identifies the same issuer. Keep the input name if
there is insufficient evidence, and keep similar but distinct firms separate. Return exactly
one nonempty string per input in input order under issuers.`,
      source: { inputs: page, previouslyResolved: Object.fromEntries(resolved) },
      schema: {
        type: "object", required: ["issuers"],
        properties: { issuers: { type: "array", items: { type: "string" } } },
      },
      validate: ({ issuers }) => Array.isArray(issuers) && issuers.length === page.length
        && issuers.every((issuer) => typeof issuer === "string" && issuerKey(issuer) && issuer.length <= 160),
      read,
    });
    page.forEach((name, index) => resolved.set(name, result.issuers[index].trim()));
  }
  return (asset) => resolved.get(String(asset ?? "").trim()) ?? asset;
}
