import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "../env";
import type { Env as WorkerEnv } from "../../env";
import { toBossEnv } from "../../bossMount";
import { oneBrain } from "./store";

/**
 * THE BRAIN, READ BY ANOTHER WORKER ON THIS ACCOUNT (15 Nov 2026). West Peek OS reads the `west-peek` brain's
 * partner and business sections for its first read. A named RPC entrypoint is reachable only through a service
 * binding on this Cloudflare account, never from the internet, so it needs no key and no passcode.
 * Only the slugs below are served, and every `<!-- confidential -->…<!-- /confidential -->` span is removed.
 */
export const READABLE_BRAINS = ["west-peek"] as const;

export function withoutConfidential(md: string): string {
  return md.replace(/<!--\s*confidential\s*-->[\s\S]*?<!--\s*\/confidential\s*-->/gi, "[private]");
}

export async function readBrainForPeer(env: Env, slug: string): Promise<{ slug: string; body_md: string; updated_at: string | number | null } | null> {
  if (!(READABLE_BRAINS as readonly string[]).includes(slug)) return null;
  const row = await oneBrain(env, slug).catch(() => null);
  if (!row?.body_md) return null;
  return { slug: row.slug, body_md: withoutConfidential(row.body_md), updated_at: row.updated_at ?? null };
}

export class BrainReader extends WorkerEntrypoint<WorkerEnv> {
  async brain(slug: string) {
    return readBrainForPeer(toBossEnv(this.env), String(slug ?? ""));
  }
}
