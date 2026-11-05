/** Narrow RR header-reader contract, used by the existing Gmail validator and mutation fixtures. */
export function rainmakerHeaderOnly(src) {
  return src.includes('threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Message-ID&metadataHeaders=In-Reply-To&metadataHeaders=References`')
    && /import \{ contentToken \} from "\.\/lp-positive\.mjs"/.test(src)
    && !/format=full|format=raw|"format", "(?:full|raw)"|\.snippet|\.payload\.body|gmail\.modify|gmail\.send|gmail\.compose|\/send\b|api\.openai\.com|api\.anthropic\.com|openrouter\.ai|generativelanguage\.googleapis\.com/.test(src);
}
