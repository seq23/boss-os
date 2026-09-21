#!/usr/bin/env node
/**
 * GIVE AN EMPLOYEE AN ADDRESS THAT DELIVERS — the routing rule for `<name>@sequoiataylor.com`.
 *
 * The new-hire path (21 Sep 2026). An employee sends mail from her own address and asks for a
 * one-word reply, so the address has to deliver, and a catch-all cannot target a Worker: it is one
 * literal rule per name → worker `boss-os`, whose `email()` handler routes it by tag or by the To:
 * local part. Idempotent — an existing enabled rule is reported, not duplicated.
 *
 *   npm run vault:run -- node scripts/ops/employee-address.mjs danielle
 *
 * Then add the name to ROSTER in scripts/ops/notify.mjs; `validate:employee-addresses-receive`
 * fails the build until both halves exist. Without the vault (no CLOUDFLARE_API_TOKEN) this is a
 * NAMED STOP that prints the exact wrangler line for her to run.
 */
const DOMAIN = "sequoiataylor.com";
const WORKER = "boss-os";
const name = String(process.argv[2] ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
if (!name) { console.error("usage: employee-address.mjs <firstname>"); process.exit(2); }
const addr = `${name}@${DOMAIN}`;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error(`NAMED STOP [NO_CLOUDFLARE_TOKEN] cannot make the rule for ${addr} from here. Run through the vault, or by hand:`);
  console.error(`  npx wrangler email routing rule create --zone ${DOMAIN} --name "${name} → boss-os" --matcher to=${addr} --action worker=${WORKER}`);
  console.error(`  (or Cloudflare dash → ${DOMAIN} → Email → Routing rules → Create: ${addr} → Send to a Worker → ${WORKER})`);
  process.exit(3);
}
const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const z = await (await fetch(`https://api.cloudflare.com/client/v4/zones?name=${DOMAIN}`, { headers: h })).json();
const zone = z.result?.[0]?.id;
if (!zone) { console.error(`NAMED STOP [ZONE_UNREADABLE] ${JSON.stringify(z.errors ?? [])}`); process.exit(4); }
const list = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/email/routing/rules?per_page=50`, { headers: h })).json();
const existing = (list.result ?? []).find((r) => (r.matchers ?? []).some((m) => m.type === "literal" && String(m.value).toLowerCase() === addr));
if (existing && existing.enabled && existing.actions?.[0]?.type === "worker" && (existing.actions[0].value ?? []).includes(WORKER)) {
  console.log(`${addr} already delivers: rule ${existing.id} (enabled) → worker ${WORKER}. Nothing changed.`);
  process.exit(0);
}
const body = { name: `${name} → ${WORKER}`, enabled: true, matchers: [{ type: "literal", field: "to", value: addr }], actions: [{ type: "worker", value: [WORKER] }] };
const res = existing
  ? await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/email/routing/rules/${existing.id}`, { method: "PUT", headers: h, body: JSON.stringify(body) })
  : await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/email/routing/rules`, { method: "POST", headers: h, body: JSON.stringify(body) });
const out = await res.json();
if (!out.success) { console.error(`NAMED STOP [RULE_NOT_MADE] ${JSON.stringify(out.errors ?? [])}`); process.exit(5); }
console.log(`${addr} now delivers: rule ${out.result.id} (${existing ? "repaired" : "created"}) → worker ${WORKER}. Add "${name}" to ROSTER in scripts/ops/notify.mjs if it is not there.`);
