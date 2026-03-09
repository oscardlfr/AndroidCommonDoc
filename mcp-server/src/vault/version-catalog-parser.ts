/**
 * Version catalog parser for Gradle libs.versions.toml files.
 *
 * Parses TOML version catalog files and generates readable markdown
 * reference pages for the vault. Implements the features.versionCatalog
 * opt-in flag from ProjectConfig.
 *
 * Uses a focused TOML parser that handles the subset of TOML syntax
 * used by Gradle version catalogs (not the full TOML spec). No external
 * TOML library dependency required.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * A parsed version entry from the [versions] section.
 */
interface VersionEntry {
  key: string;
  version: string;
}

/**
 * A parsed library entry from the [libraries] section.
 */
interface LibraryEntry {
  alias: string;
  module: string;
  version: string;
}

/**
 * A parsed plugin entry from the [plugins] section.
 */
interface PluginEntry {
  alias: string;
  id: string;
  version: string;
}

/**
 * A parsed bundle entry from the [bundles] section.
 */
interface BundleEntry {
  name: string;
  libraries: string[];
}

/**
 * Parsed TOML section data from a version catalog.
 */
interface CatalogData {
  versions: VersionEntry[];
  libraries: LibraryEntry[];
  plugins: PluginEntry[];
  bundles: BundleEntry[];
  warnings: string[];
}

/**
 * Remove inline comments from a TOML line.
 * Handles quoted strings by not stripping # inside quotes.
 */
function stripInlineComment(line: string): string {
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === "#") {
        return line.slice(0, i).trimEnd();
      }
    }
  }

  return line;
}

/**
 * Extract a quoted string value from a TOML value expression.
 * Handles both single and double quotes.
 */
function extractQuotedString(value: string): string | null {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return null;
}

/**
 * Parse an inline table: { key = "value", key2.ref = "value2" }
 * Returns a map of dotted keys to their string values.
 */
function parseInlineTable(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const trimmed = value.trim();

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return result;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return result;

  // Split by commas, handling quoted values
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];

    if (inQuote) {
      current += char;
      if (char === quoteChar) {
        inQuote = false;
      }
    } else {
      if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
        current += char;
      } else if (char === ",") {
        parts.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;

    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    const strVal = extractQuotedString(val);
    if (strVal !== null) {
      result[key] = strVal;
    }
  }

  return result;
}

/**
 * Parse a multi-line array value from TOML.
 * Collects lines until the closing bracket is found.
 *
 * @param lines - All lines of the file
 * @param startIdx - Index of the line containing the opening bracket
 * @param startContent - Content after the `=` on the opening line
 * @returns Tuple of [parsed string array, next line index to process]
 */
function parseMultiLineArray(
  lines: string[],
  startIdx: number,
  startContent: string,
): [string[], number] {
  const items: string[] = [];
  let content = startContent.trim();

  // Remove opening bracket
  if (content.startsWith("[")) {
    content = content.slice(1);
  }

  // Check if the array closes on the same line
  const closeBracketIdx = content.indexOf("]");
  if (closeBracketIdx !== -1) {
    content = content.slice(0, closeBracketIdx);
    // Extract items from single-line array
    extractArrayItems(content, items);
    return [items, startIdx + 1];
  }

  // Extract items from first line remainder
  extractArrayItems(content, items);

  // Continue reading lines until we find ]
  let idx = startIdx + 1;
  while (idx < lines.length) {
    const line = stripInlineComment(lines[idx]).trim();

    const closeIdx = line.indexOf("]");
    if (closeIdx !== -1) {
      const before = line.slice(0, closeIdx);
      extractArrayItems(before, items);
      return [items, idx + 1];
    }

    extractArrayItems(line, items);
    idx++;
  }

  return [items, idx];
}

/**
 * Extract quoted string items from a comma-separated line.
 */
function extractArrayItems(content: string, items: string[]): void {
  const parts = content.split(",");
  for (const part of parts) {
    const str = extractQuotedString(part.trim());
    if (str !== null && str.length > 0) {
      items.push(str);
    }
  }
}

/**
 * Parse a TOML version catalog file into structured data.
 */
function parseCatalogContent(content: string): CatalogData {
  const data: CatalogData = {
    versions: [],
    libraries: [],
    plugins: [],
    bundles: [],
    warnings: [],
  };

  // Normalize line endings
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let currentSection = "";

  // Build versions map for resolving version.ref references
  const versionsMap = new Map<string, string>();

  // First pass: collect versions
  let firstPassSection = "";
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();

    if (line.length === 0) continue;

    // Detect section headers
    const sectionMatch = line.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      firstPassSection = sectionMatch[1];
      continue;
    }

    if (firstPassSection === "versions") {
      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) continue;

      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();

      const strVal = extractQuotedString(value);
      if (strVal !== null) {
        versionsMap.set(key, strVal);
      }
    }
  }

  // Second pass: parse all sections with version resolution
  let lineIdx = 0;
  while (lineIdx < lines.length) {
    const rawLine = lines[lineIdx];
    const line = stripInlineComment(rawLine).trim();

    if (line.length === 0) {
      lineIdx++;
      continue;
    }

    // Detect section headers
    const sectionMatch = line.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      lineIdx++;
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      lineIdx++;
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();

    try {
      switch (currentSection) {
        case "versions": {
          const strVal = extractQuotedString(value);
          if (strVal !== null) {
            data.versions.push({ key, version: strVal });
          }
          lineIdx++;
          break;
        }

        case "libraries": {
          if (value.startsWith("{")) {
            // Inline table: { module = "group:artifact", version.ref = "key" }
            // or { group = "...", name = "...", version.ref = "..." }
            const table = parseInlineTable(value);

            const module =
              table["module"] ??
              (table["group"] && table["name"]
                ? `${table["group"]}:${table["name"]}`
                : "unknown");

            let version = table["version"] ?? "";
            if (!version && table["version.ref"]) {
              version =
                versionsMap.get(table["version.ref"]) ??
                `ref:${table["version.ref"]}`;
            }

            data.libraries.push({ alias: key, module, version });
          } else {
            // Simple string value (module with version embedded)
            const strVal = extractQuotedString(value);
            if (strVal !== null) {
              // Format: "group:artifact:version"
              const parts = strVal.split(":");
              if (parts.length >= 3) {
                data.libraries.push({
                  alias: key,
                  module: `${parts[0]}:${parts[1]}`,
                  version: parts[2],
                });
              } else {
                data.libraries.push({
                  alias: key,
                  module: strVal,
                  version: "",
                });
              }
            }
          }
          lineIdx++;
          break;
        }

        case "plugins": {
          if (value.startsWith("{")) {
            const table = parseInlineTable(value);
            const id = table["id"] ?? "unknown";
            let version = table["version"] ?? "";
            if (!version && table["version.ref"]) {
              version =
                versionsMap.get(table["version.ref"]) ??
                `ref:${table["version.ref"]}`;
            }
            data.plugins.push({ alias: key, id, version });
          } else {
            const strVal = extractQuotedString(value);
            if (strVal !== null) {
              data.plugins.push({ alias: key, id: strVal, version: "" });
            }
          }
          lineIdx++;
          break;
        }

        case "bundles": {
          if (value.trimStart().startsWith("[")) {
            // Array value (potentially multi-line)
            const [items, nextIdx] = parseMultiLineArray(
              lines,
              lineIdx,
              value,
            );
            data.bundles.push({ name: key, libraries: items });
            lineIdx = nextIdx;
          } else {
            lineIdx++;
          }
          break;
        }

        default:
          lineIdx++;
          break;
      }
    } catch (err) {
      data.warnings.push(
        `Failed to parse ${currentSection} entry "${key}": ${err instanceof Error ? err.message : String(err)}`,
      );
      lineIdx++;
    }
  }

  return data;
}

/**
 * Generate a markdown reference page from parsed catalog data.
 */
function generateMarkdown(
  data: CatalogData,
  projectName: string,
): string {
  const syncDate = new Date().toISOString().split("T")[0];

  const lines: string[] = [
    "---",
    "vault_type: reference",
    `vault_synced: ${syncDate}`,
    "---",
    "",
    `# Version Catalog: ${projectName}`,
    "",
    "> Auto-generated from \\`gradle/libs.versions.toml\\`. Source of truth is the TOML file.",
    "",
  ];

  // Versions section
  if (data.versions.length > 0) {
    lines.push("## Versions", "");
    lines.push("| Key | Version |");
    lines.push("|-----|---------|");
    for (const entry of data.versions) {
      lines.push(`| ${entry.key} | ${entry.version} |`);
    }
    lines.push("");
  }

  // Libraries section
  if (data.libraries.length > 0) {
    lines.push("## Libraries", "");
    lines.push("| Alias | Module | Version |");
    lines.push("|-------|--------|---------|");
    for (const entry of data.libraries) {
      lines.push(
        `| ${entry.alias} | ${entry.module} | ${entry.version} |`,
      );
    }
    lines.push("");
  }

  // Plugins section
  if (data.plugins.length > 0) {
    lines.push("## Plugins", "");
    lines.push("| Alias | ID | Version |");
    lines.push("|-------|----|---------|");
    for (const entry of data.plugins) {
      lines.push(`| ${entry.alias} | ${entry.id} | ${entry.version} |`);
    }
    lines.push("");
  }

  // Bundles section
  if (data.bundles.length > 0) {
    lines.push("## Bundles", "");
    lines.push("| Name | Libraries |");
    lines.push("|------|-----------|");
    for (const entry of data.bundles) {
      lines.push(`| ${entry.name} | ${entry.libraries.join(", ")} |`);
    }
    lines.push("");
  }

  // Warnings section (only if there were parsing issues)
  if (data.warnings.length > 0) {
    lines.push("## Parse Warnings", "");
    for (const warning of data.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Parse a Gradle version catalog (libs.versions.toml) and generate
 * a readable markdown reference page for the vault.
 *
 * Handles the subset of TOML syntax used by Gradle version catalogs:
 * - [versions]: Simple string values
 * - [libraries]: String values and inline tables with module/version.ref
 * - [plugins]: String values and inline tables with id/version.ref
 * - [bundles]: Single-line and multi-line string arrays
 *
 * @param tomlPath - Absolute path to libs.versions.toml
 * @returns Markdown content string, or null if file doesn't exist
 */
export async function parseVersionCatalog(
  tomlPath: string,
): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(tomlPath, "utf-8");
  } catch {
    // File doesn't exist
    return null;
  }

  // Derive project name from path
  // Expected path: .../project-name/gradle/libs.versions.toml
  const projectDir = path.dirname(path.dirname(tomlPath));
  const projectName = path.basename(projectDir);

  const data = parseCatalogContent(content);

  // If all sections are empty, return null (nothing useful to generate)
  if (
    data.versions.length === 0 &&
    data.libraries.length === 0 &&
    data.plugins.length === 0 &&
    data.bundles.length === 0
  ) {
    return null;
  }

  return generateMarkdown(data, projectName);
}
