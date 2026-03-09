/**
 * Rule definition parser for pattern doc frontmatter.
 *
 * Extracts RuleDefinition arrays from the `rules:` field in YAML
 * frontmatter data. Validates required fields and supported rule types.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../registry/frontmatter.js";
import type { RuleDefinition, RuleType } from "../registry/types.js";
import { logger } from "../utils/logger.js";

/** All valid RuleType values for validation. */
const VALID_RULE_TYPES: ReadonlySet<string> = new Set<string>([
  "banned-import",
  "prefer-construct",
  "banned-usage",
  "required-call-arg",
  "banned-supertype",
  "naming-convention",
  "banned-annotation",
  "required-rethrow",
]);

/**
 * Parse rule definitions from frontmatter data.
 *
 * Extracts the `rules` array from parsed YAML frontmatter and validates
 * each entry has the required fields: id, type, message, detect.
 * Invalid entries are skipped with a warning.
 *
 * @param frontmatterData - The parsed YAML frontmatter object
 * @returns Validated array of RuleDefinition objects
 */
export function parseRuleDefinitions(
  frontmatterData: Record<string, unknown>,
): RuleDefinition[] {
  const rawRules = frontmatterData.rules;

  if (!Array.isArray(rawRules)) {
    return [];
  }

  const definitions: RuleDefinition[] = [];

  for (const entry of rawRules) {
    if (typeof entry !== "object" || entry === null) {
      logger.warn("Rule parser: skipping non-object rule entry");
      continue;
    }

    const obj = entry as Record<string, unknown>;

    // Validate required fields
    if (typeof obj.id !== "string") {
      logger.warn("Rule parser: skipping rule entry missing 'id' field");
      continue;
    }
    if (typeof obj.type !== "string" || !VALID_RULE_TYPES.has(obj.type)) {
      logger.warn(
        `Rule parser: skipping rule '${obj.id ?? "unknown"}' with invalid type '${String(obj.type)}'`,
      );
      continue;
    }
    if (typeof obj.message !== "string") {
      logger.warn(
        `Rule parser: skipping rule '${obj.id}' missing 'message' field`,
      );
      continue;
    }
    if (typeof obj.detect !== "object" || obj.detect === null) {
      logger.warn(
        `Rule parser: skipping rule '${obj.id}' missing 'detect' field`,
      );
      continue;
    }

    const definition: RuleDefinition = {
      id: obj.id,
      type: obj.type as RuleType,
      message: obj.message,
      detect: obj.detect as Record<string, unknown>,
    };

    // Optional fields
    if (obj.hand_written === true) {
      definition.hand_written = true;
    }
    if (typeof obj.source_rule === "string") {
      definition.source_rule = obj.source_rule;
    }

    definitions.push(definition);
  }

  return definitions;
}

/**
 * Scan a docs directory and collect all rule definitions with their source doc slug.
 *
 * Reads all .md files in the given directory, parses their YAML frontmatter,
 * and extracts any rule definitions found in the `rules:` field.
 *
 * @param docsDir - Absolute path to the docs directory to scan
 * @returns Array of { slug, rule } objects for all discovered rules
 */
export async function collectAllRules(
  docsDir: string,
): Promise<Array<{ slug: string; rule: RuleDefinition }>> {
  let files: string[];
  try {
    files = await readdir(docsDir);
  } catch {
    logger.warn(`Rule collector: directory not found: ${docsDir}`);
    return [];
  }

  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const results: Array<{ slug: string; rule: RuleDefinition }> = [];

  for (const filename of mdFiles) {
    const filepath = path.join(docsDir, filename);
    let raw: string;
    try {
      raw = await readFile(filepath, "utf-8");
    } catch {
      logger.warn(`Rule collector: could not read file: ${filepath}`);
      continue;
    }

    const parsed = parseFrontmatter(raw);
    if (!parsed) {
      continue;
    }

    const slug = filename.replace(/\.md$/, "");
    const rules = parseRuleDefinitions(parsed.data);

    for (const rule of rules) {
      results.push({ slug, rule });
    }
  }

  return results;
}
