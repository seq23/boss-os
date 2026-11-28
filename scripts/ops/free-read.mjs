#!/usr/bin/env node
/**
 * THE SHARED FREE READER, FROM ANOTHER REPO (27 Nov 2026, follow-up to #584). Jobs that live outside boss-os
 * (seq-bin's post-land check, how-we-know's comment classifier) reach `readWorkerSource` the way they already
 * reach Boss OS: run a script in this checkout through the vault. Nothing is copied into those repos.
 *
 *   npm run --silent vault:run -- node scripts/ops/free-read.mjs --worker <name> --instruction-file <path> \
 *     [--max-output <n>] [--require <literal>] < source.txt
 *
 *   --worker            a worker name freeModel.ts knows (its lane order follows the name)
 *   --instruction-file  the job's own instruction (the system role); the source on stdin is the user role and
 *                       is treated as evidence only
 *   --max-output        the most tokens the answer may use (default 2048)
 *   --require           a literal the answer must contain (structure only, never meaning): an answer without
 *                       it is not usable, so the next lane is tried and, with none left, the read is uncertain
 *
 * stdout carries the answer and nothing else. Exit 0 ok · 2 bad arguments or empty source · 3 the read ended
 * without a usable answer, with one NAMED STOP on stderr: FREE_READER_UNAVAILABLE (no lane answered),
 * FREE_ALLOWANCE_EXHAUSTED (both free days spent), FREE_READER_UNCERTAIN (a lane answered, nothing usable) or
 * FREE_READER_REFUSED (the request was malformed). A caller treats every exit but 0 as "unknown", never as a
 * verdict, a pass or "nothing found".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkerSource } from "../../src/worker/boss/router/freeModel.ts";

const STOPS = Object.freeze({
  unavailable: "FREE_READER_UNAVAILABLE",
  "allowance-exhausted": "FREE_ALLOWANCE_EXHAUSTED",
  uncertain: "FREE_READER_UNCERTAIN",
  refused: "FREE_READER_REFUSED",
});

/** Parse the flags: { worker, instructionFile, maxOutputTokens, require } or { error }. Pure. */
export function freeReadArgs(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1] ?? null; };
  const worker = at("--worker");
  const instructionFile = at("--instruction-file");
  const max = at("--max-output");
  const maxOutputTokens = max === null ? 2048 : Number(max);
  if (!worker || !/^[a-z]+$/.test(worker)) return { error: "--worker <name> is required" };
  if (!instructionFile) return { error: "--instruction-file <path> is required" };
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 16_384) return { error: "--max-output is 1 to 16384" };
  return { worker, instructionFile, maxOutputTokens, require: at("--require") };
}

/** One read: { code, out, err }. `read` is injectable for tests; the real one is the shared client. */
export async function freeRead({ worker, instruction, source, maxOutputTokens, require = null }, { env = process.env, read = readWorkerSource } = {}) {
  if (!instruction.trim() || !source.trim()) return { code: 2, out: "", err: "NAMED STOP [FREE_READ_EMPTY] the instruction and the source must both have text" };
  const result = await read({
    worker, instruction, source, maxOutputTokens,
    ...(require ? { accept: (text) => text.includes(require) } : {}),
  }, env);
  if (result.status === "ok") return { code: 0, out: result.text, err: `free reader: ${result.provider}` };
  return { code: 3, out: "", err: `NAMED STOP [${STOPS[result.status] ?? "FREE_READER_UNAVAILABLE"}] the free reader gave no usable answer (${result.status}); the item stays unread` };
}

async function main() {
  const args = freeReadArgs(process.argv.slice(2));
  if (args.error) { console.error(`NAMED STOP [FREE_READ_ARGS] ${args.error}`); process.exit(2); }
  let instruction;
  try { instruction = readFileSync(args.instructionFile, "utf8"); } catch { console.error("NAMED STOP [FREE_READ_ARGS] the instruction file cannot be read"); process.exit(2); }
  const source = readFileSync(0, "utf8");
  const { code, out, err } = await freeRead({ ...args, instruction, source });
  if (out) process.stdout.write(out.endsWith("\n") ? out : `${out}\n`);
  console.error(err);
  process.exit(code);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(`NAMED STOP [FREE_READER_UNAVAILABLE] ${String(error?.message ?? error).slice(0, 200)}`); process.exit(3); });
}
