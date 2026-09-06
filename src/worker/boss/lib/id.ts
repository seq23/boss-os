const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Sortable, prefixed id: apr_01j9x8k2m4... */
export function newId(prefix: string): string {
  const t = Date.now();
  let time = "";
  let n = t;
  for (let i = 0; i < 8; i++) {
    time = ALPHABET[n % 32] + time;
    n = Math.floor(n / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(8));
  let tail = "";
  for (const b of rand) tail += ALPHABET[b % 32];
  return `${prefix}_${time}${tail}`;
}

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
