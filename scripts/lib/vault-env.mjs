/**
 * THE VAULT, LOOKED UP BY NAME — NAMES ONLY, NEVER A VALUE (R5, R28; 6 Oct 2026).
 *
 * COPIED from West Peek OS's `scripts/lib/vault-env.mjs`, never imported. The owner, 6 Oct 2026:
 * "we have many api keys in the vault and any job should always check the vault first." Every Boss
 * OS lane that would name a missing key asks `vaultLookup` first — the repo lane (`repo-change.mjs`)
 * before it plans, and the notice drain (`task-notices.mjs`) before it emails her a `Missing key:`.
 *
 * The vault is `scripts/vault/vault.mjs`'s, whose manifest lists key NAMES in plain text beside the
 * encrypted payload; this reads only that manifest.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const VAULT_MANIFEST = join(homedir(), ".west-peek-os", "vault", "manifest.json");
/**
 * NAMES SHE EMAILED (R3). `vault.mjs sync:cloudflare` refuses a vault key nobody classified; a key
 * she emailed for a repo's own runs is classified here — injected by name into that repo's runs,
 * never into the Worker — so her handing one over can never break the Worker's secret sync.
 */
export const HANDED_OFF_NAMES = join(homedir(), ".boss-os", "handed-off-names.json");

/** Every name the vault holds, from its manifest. Empty if there is no vault. */
export function vaultNames(manifestPath = VAULT_MANIFEST) {
  try {
    if (existsSync(manifestPath)) return new Set((JSON.parse(readFileSync(manifestPath, "utf8")).keyNames ?? []).map(String));
  } catch {
    /* an unreadable manifest holds nothing we can name */
  }
  return new Set();
}

/** The vendor a secret name belongs to: its first token ("RESEND_API_KEY" → "RESEND"). */
export function vendorPrefixOf(name) {
  const m = /^([A-Z][A-Z0-9]*)_/.exec(String(name ?? "").trim());
  return m ? m[1] : "";
}

/**
 * LOOK THE VAULT UP BY NAME, THEN BY VENDOR. Every exact name present is `found`; for each wanted
 * name that is absent, any entry sharing its vendor prefix is offered under `by_vendor` (a repo
 * wanting GIPHY_KEY gets the vault's GIPHY_API_KEY); what is left is `missing`. `searched` records
 * every name and prefix looked for, so a message naming a missing key can prove the vault was checked.
 */
export function vaultLookup(wanted, names = vaultNames()) {
  const have = new Set([...names]);
  const want = [...new Set((Array.isArray(wanted) ? wanted : []).map((n) => String(n).trim()).filter((n) => /^[A-Z][A-Z0-9_]{2,}$/.test(n)))];
  const found = want.filter((n) => have.has(n));
  const by_vendor = {};
  const missing = [];
  const searched = [...want];
  for (const n of want) {
    if (have.has(n)) continue;
    const vendor = vendorPrefixOf(n);
    if (vendor) {
      searched.push(`${vendor}_*`);
      const matches = [...have].filter((h) => h.startsWith(`${vendor}_`)).sort();
      if (matches.length) { by_vendor[n] = matches; continue; }
    }
    missing.push(n);
  }
  const allowed = [...new Set([...found, ...Object.values(by_vendor).flat()])].sort();
  return { searched: [...new Set(searched)], found, by_vendor, missing, allowed };
}

/**
 * THE ENVIRONMENT A REPO'S OWN SCRIPT RUNS IN (R26/R28): the parent's environment WITHOUT any vault
 * name or model-auth variable, plus exactly the `allowed` names copied from the parent (which runs
 * under `vault:run`). A name not in `allowed` is never passed; the model itself never sees a value.
 */
export function envForRepoRun(base, allowed, known = vaultNames()) {
  const out = {};
  for (const [k, v] of Object.entries(base ?? {})) {
    if (known.has(k) || /^ANTHROPIC_/i.test(k) || /^CLAUDE_(API|AUTH|CODE_OAUTH|OAUTH|TOKEN)/i.test(k) || k === "BOSS_PASSCODE") continue;
    out[k] = v;
  }
  for (const name of allowed ?? []) {
    if (typeof base?.[name] === "string" && !/^ANTHROPIC_/i.test(name) && name !== "BOSS_PASSCODE") out[name] = base[name];
  }
  return out;
}

/** Record names she emailed, so the Worker sync classifies them (names only). */
export function rememberHandedOff(names, path = HANDED_OFF_NAMES) {
  let have = [];
  try { if (existsSync(path)) have = JSON.parse(readFileSync(path, "utf8")).names ?? []; } catch { have = []; }
  const all = [...new Set([...have, ...names])].sort();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ names: all, note: "Key NAMES she emailed as SECRET lines (R3). Values live only in the vault." }, null, 2), { mode: 0o600 });
  return all;
}

/** The names she emailed, for `vault.mjs sync:cloudflare`'s classification. */
export function handedOffNames(path = HANDED_OFF_NAMES) {
  try { return new Set(existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).names ?? [] : []); } catch { return new Set(); }
}
