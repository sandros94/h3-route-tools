/**
 * Parse a `Content-Type` header value down to its lowercase media type (no parameters).
 * `application/json; charset=utf-8` → `application/json`.
 */
export function parseMediaType(contentType: string | null | undefined): string | undefined {
  if (!contentType) return undefined;
  const semi = contentType.indexOf(";");
  const type = (semi === -1 ? contentType : contentType.slice(0, semi)).trim().toLowerCase();
  return type || undefined;
}

/**
 * Match an incoming `Content-Type` against a list of declared media types.
 * Returns the matched declared key (preserving its original casing) or `undefined`.
 * Supports exact match and `type/*` wildcards on the declared side.
 */
export function matchMediaType(
  declared: readonly string[],
  options: { against: string | null | undefined }
): string | undefined {
  const parsed = parseMediaType(options.against);
  if (!parsed) return undefined;

  for (const key of declared) {
    const normalized = key.trim().toLowerCase();
    if (normalized === parsed) return key;
    if (normalized.endsWith("/*")) {
      const prefix = normalized.slice(0, -1); // keep trailing slash
      if (parsed.startsWith(prefix)) return key;
    }
  }
  return undefined;
}

/** Names of the standard `Request` body-parser methods we dispatch on. */
export type ParserName = "json" | "formData" | "text" | "arrayBuffer";

/**
 * Sentinel keys for parser dispatch in content-type-aware body validation.
 * Recognized at runtime; anything else falls back to `arrayBuffer`/raw body.
 */
export const PARSER_BY_MEDIA_TYPE: Record<string, ParserName> = {
  "application/json": "json",
  "multipart/form-data": "formData",
  "application/x-www-form-urlencoded": "formData",
  "text/plain": "text",
};
