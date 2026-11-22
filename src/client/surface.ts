/**
 * Which surface a navigation gets. Boss OS is the only app this bundle still carries.
 *
 * boss.sequoiataylor.com (her one production host) and any /boss path mount Boss OS. Anywhere
 * else used to mount the copied West Peek fund screens (the "chassis"); they were retired on
 * 22 Nov 2026 (her yes, personal brain) because West Peek OS runs them itself. Those addresses now
 * get a plain "moved" page that names where to go, never a blank screen.
 *
 * BOSS_HOSTS is an allowlist rather than a pattern, because "does this look like a Boss host" is a
 * question with a wrong answer.
 */
export const BOSS_HOSTS: ReadonlySet<string> = new Set(["boss.sequoiataylor.com"]);

/** West Peek OS, where the fund screens live now (its Worker's custom domain, read 22 Nov 2026). */
export const WEST_PEEK_OS_ORIGIN = "https://os.joinwestpeek.com";

export type Surface = "boss" | "moved";

export function surfaceFor(hostname: string, pathname: string): Surface {
  // `boss.sequoiataylor.com.` (the fully-qualified form, trailing dot) is her host too: it serves
  // with a valid certificate and the browser reports the dot. Host names are case-blind.
  if (BOSS_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ""))) return "boss";
  if (pathname === "/boss" || pathname.startsWith("/boss/")) return "boss";
  return "moved";
}

/**
 * The West Peek OS page an old fund-screen address belongs to. The chassis addressed its pages by
 * hash (`#/dealflow`), and West Peek OS kept the same keys, so a well-formed key carries over.
 * Anything else lands on West Peek OS's front door: the target origin is fixed, never built from
 * the address.
 */
export function westPeekOsUrlFor(hash: string): string {
  const key = /^#\/([a-z0-9][a-z0-9.-]{0,63})$/.exec(hash)?.[1];
  return key ? `${WEST_PEEK_OS_ORIGIN}/#/${key}` : `${WEST_PEEK_OS_ORIGIN}/`;
}
