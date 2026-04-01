/**
 * Slug utilities for Dokka output filenames.
 *
 * Dokka URL-encodes special characters in filenames:
 *   Result<T>       → Result%3CT%3E.html
 *   suspend fun     → suspend%20fun.html
 *   Map<String,Any> → Map%3CString%2C%20Any%3E.html
 *
 * These must be decoded before generating doc slugs and cross-references,
 * otherwise the slugs contain meaningless fragments like "3CT-3E".
 */

/**
 * Decode URL-encoded characters from Dokka filenames.
 * Falls back gracefully on malformed percent-encoding.
 */
export function decodeDokkaName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    // Malformed percent-encoding — strip orphan % sequences manually
    return name.replace(/%(?![0-9A-Fa-f]{2})/g, "");
  }
}

/**
 * Convert a Dokka filename (without extension) to a filesystem-safe doc slug.
 * Decodes URL-encoding first, then replaces non-alphanumeric chars with hyphens.
 *
 * Examples:
 *   "Result%3CT%3E"          → "Result-T"
 *   "suspend%20fun"          → "suspend-fun"
 *   "Map%3CString%2C%20Any%3E" → "Map-String-Any"
 *   "simple-name"            → "simple-name"
 */
export function toDocSlug(name: string): string {
  const decoded = decodeDokkaName(name);
  return decoded
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
}
