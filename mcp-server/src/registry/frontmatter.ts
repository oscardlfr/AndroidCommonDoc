/**
 * YAML frontmatter parser for pattern documents.
 *
 * Extracts YAML frontmatter delimited by `---` markers from markdown
 * files. Handles BOM characters and CRLF line endings gracefully.
 */

import { parse as parseYaml } from "yaml";
import type { FrontmatterResult } from "./types.js";

/**
 * Parse YAML frontmatter from a raw markdown string.
 *
 * @param raw - The raw file content (may include BOM, CRLF)
 * @returns Parsed frontmatter data and remaining content, or null if invalid
 */
export function parseFrontmatter(raw: string): FrontmatterResult | null {
  if (!raw) {
    return null;
  }

  // Strip BOM if present
  let text = raw;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Normalize CRLF to LF for consistent parsing
  text = text.replace(/\r\n/g, "\n");

  // Must start with opening delimiter
  if (!text.startsWith("---\n")) {
    return null;
  }

  // Find closing delimiter (--- on its own line)
  const closingIndex = text.indexOf("\n---\n", 3);
  if (closingIndex === -1) {
    // Also check if the closing --- is at the very end of the string
    if (text.endsWith("\n---")) {
      const yamlBlock = text.slice(4, text.length - 4);
      try {
        const data = parseYaml(yamlBlock) ?? {};
        return { data, content: "" };
      } catch {
        return null;
      }
    }
    return null;
  }

  const yamlBlock = text.slice(4, closingIndex);
  const content = text.slice(closingIndex + 5); // skip \n---\n

  try {
    const data = parseYaml(yamlBlock) ?? {};
    return { data, content };
  } catch {
    return null;
  }
}
