/**
 * MCP tool: check-outdated
 *
 * Reads a project's gradle/libs.versions.toml, compares each library
 * version against Maven Central Search API, and caches results in
 * kdoc-state.json. Returns a structured report of outdated dependencies.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import {
  readKDocState,
  createEmptyState,
  writeKDocState,
  updateDependencies,
  type DependencyState,
} from "../utils/kdoc-state.js";

// ── TOML parsing ───────────────────────────────────────────────────────────

export interface ParsedLibrary {
  alias: string;
  group: string;
  artifact: string;
  version: string;
}

/**
 * Parse [versions] section from libs.versions.toml content.
 * Handles: key = "value" and key = { strictly = "value" }
 */
export function parseVersions(content: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const lines = content.split("\n");
  let inVersions = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "[versions]") {
      inVersions = true;
      continue;
    }
    if (/^\[(?!versions\])/.test(trimmed)) {
      inVersions = false;
      continue;
    }
    if (!inVersions || trimmed.startsWith("#") || trimmed === "") continue;

    // key = "value"
    const simpleMatch = trimmed.match(/^([\w-]+)\s*=\s*"([^"]+)"/);
    if (simpleMatch) {
      versions[simpleMatch[1]] = simpleMatch[2];
      continue;
    }

    // key = { strictly = "value" }
    const strictlyMatch = trimmed.match(
      /^([\w-]+)\s*=\s*\{[^}]*strictly\s*=\s*"([^"]+)"/,
    );
    if (strictlyMatch) {
      versions[strictlyMatch[1]] = strictlyMatch[2];
    }
  }

  return versions;
}

/**
 * Parse [libraries] section from libs.versions.toml content.
 * Handles:
 * - alias = { module = "group:artifact", version.ref = "key" }
 * - alias = { group = "group", name = "artifact", version.ref = "key" }
 * - alias = { module = "group:artifact", version = "1.0.0" }
 */
export function parseLibraries(
  content: string,
  versions: Record<string, string>,
): ParsedLibrary[] {
  const libraries: ParsedLibrary[] = [];
  const lines = content.split("\n");
  let inLibraries = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "[libraries]") {
      inLibraries = true;
      continue;
    }
    if (/^\[(?!libraries\])/.test(trimmed)) {
      inLibraries = false;
      continue;
    }
    if (!inLibraries || trimmed.startsWith("#") || trimmed === "") continue;

    const aliasMatch = trimmed.match(/^([\w-]+)\s*=\s*\{(.+)\}/);
    if (!aliasMatch) continue;

    const alias = aliasMatch[1];
    const body = aliasMatch[2];

    let group: string | undefined;
    let artifact: string | undefined;
    let version: string | undefined;

    // module = "group:artifact"
    const moduleMatch = body.match(/module\s*=\s*"([^"]+):([^"]+)"/);
    if (moduleMatch) {
      group = moduleMatch[1];
      artifact = moduleMatch[2];
    }

    // group = "group", name = "artifact"
    if (!group) {
      const groupMatch = body.match(/group\s*=\s*"([^"]+)"/);
      const nameMatch = body.match(/name\s*=\s*"([^"]+)"/);
      if (groupMatch && nameMatch) {
        group = groupMatch[1];
        artifact = nameMatch[1];
      }
    }

    if (!group || !artifact) continue;

    // version.ref = "key"
    const refMatch = body.match(/version\.ref\s*=\s*"([^"]+)"/);
    if (refMatch) {
      version = versions[refMatch[1]];
    }

    // version = "1.0.0" (inline)
    if (!version) {
      const inlineMatch = body.match(
        /(?<!version\.ref\s*=\s*)version\s*=\s*"([^"]+)"/,
      );
      // More reliable: look for version = "..." that is NOT version.ref
      const versionParts = body.match(/version\s*=\s*"([^"]+)"/);
      if (versionParts && !refMatch) {
        version = versionParts[1];
      } else if (inlineMatch && !refMatch) {
        version = inlineMatch[1];
      }
    }

    if (!version) continue;

    libraries.push({ alias, group, artifact, version });
  }

  return libraries;
}

// ── Maven Central query ────────────────────────────────────────────────────

export interface MavenResult {
  alias: string;
  group: string;
  artifact: string;
  current: string;
  latest: string | null;
  error?: string;
}

const MAVEN_SEARCH_URL = "https://search.maven.org/solrsearch/select";

/**
 * Query Maven Central for the latest version of a single artifact.
 */
async function queryMavenCentral(lib: ParsedLibrary): Promise<MavenResult> {
  const url = `${MAVEN_SEARCH_URL}?q=g:"${encodeURIComponent(lib.group)}"+AND+a:"${encodeURIComponent(lib.artifact)}"&rows=1&wt=json`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        alias: lib.alias,
        group: lib.group,
        artifact: lib.artifact,
        current: lib.version,
        latest: null,
        error: `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      response?: { docs?: Array<{ latestVersion?: string }> };
    };
    const docs = data?.response?.docs;

    if (!docs || docs.length === 0 || !docs[0].latestVersion) {
      return {
        alias: lib.alias,
        group: lib.group,
        artifact: lib.artifact,
        current: lib.version,
        latest: null,
        error: "Not found on Maven Central",
      };
    }

    return {
      alias: lib.alias,
      group: lib.group,
      artifact: lib.artifact,
      current: lib.version,
      latest: docs[0].latestVersion,
    };
  } catch (err) {
    return {
      alias: lib.alias,
      group: lib.group,
      artifact: lib.artifact,
      current: lib.version,
      latest: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Query Maven Central for all libraries in batches of 5 with 100ms delays.
 */
export async function queryAllLibraries(
  libraries: ParsedLibrary[],
): Promise<MavenResult[]> {
  const results: MavenResult[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < libraries.length; i += BATCH_SIZE) {
    const batch = libraries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((lib) => queryMavenCentral(lib)),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        // Should not happen since queryMavenCentral catches errors
        const lib = batch[batchResults.indexOf(result)];
        results.push({
          alias: lib.alias,
          group: lib.group,
          artifact: lib.artifact,
          current: lib.version,
          latest: null,
          error: String(result.reason),
        });
      }
    }

    // 100ms delay between batches (skip after last batch)
    if (i + BATCH_SIZE < libraries.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

// ── Tool output ────────────────────────────────────────────────────────────

export interface CheckOutdatedResult {
  status: "OUTDATED" | "UP_TO_DATE";
  checked_at: string;
  total_libraries: number;
  outdated_count: number;
  outdated: Array<{
    alias: string;
    group: string;
    artifact: string;
    current: string;
    latest: string;
  }>;
  up_to_date_count: number;
  errors: Array<{ alias: string; reason: string }>;
  from_cache: boolean;
}

function buildResult(
  mavenResults: MavenResult[],
  fromCache: boolean,
): CheckOutdatedResult {
  const outdated: CheckOutdatedResult["outdated"] = [];
  const errors: CheckOutdatedResult["errors"] = [];
  let upToDate = 0;

  for (const r of mavenResults) {
    if (r.error) {
      errors.push({ alias: r.alias, reason: r.error });
      continue;
    }
    if (r.latest && r.latest !== r.current) {
      outdated.push({
        alias: r.alias,
        group: r.group,
        artifact: r.artifact,
        current: r.current,
        latest: r.latest,
      });
    } else {
      upToDate++;
    }
  }

  return {
    status: outdated.length > 0 ? "OUTDATED" : "UP_TO_DATE",
    checked_at: new Date().toISOString(),
    total_libraries: mavenResults.length,
    outdated_count: outdated.length,
    outdated,
    up_to_date_count: upToDate,
    errors,
    from_cache: fromCache,
  };
}

function formatSummary(result: CheckOutdatedResult): string {
  const lines: string[] = [];
  lines.push(
    `Dependency check: ${result.status} (${result.outdated_count} outdated / ${result.total_libraries} total)`,
  );
  lines.push(`Checked at: ${result.checked_at}`);
  if (result.from_cache) lines.push("(from cache)");
  lines.push("");

  if (result.outdated.length > 0) {
    lines.push("Outdated:");
    for (const dep of result.outdated) {
      lines.push(
        `  ${dep.alias}: ${dep.current} → ${dep.latest} (${dep.group}:${dep.artifact})`,
      );
    }
    lines.push("");
  }

  lines.push(`Up to date: ${result.up_to_date_count}`);

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const e of result.errors) {
      lines.push(`  ${e.alias}: ${e.reason}`);
    }
  }

  return lines.join("\n");
}

// ── Registration ───────────────────────────────────────────────────────────

export function registerCheckOutdatedTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "check-outdated",
    {
      title: "Check Outdated Dependencies",
      description:
        "Check libs.versions.toml against Maven Central for outdated dependencies. Caches results in kdoc-state.json.",
      inputSchema: z.object({
        project_root: z
          .string()
          .describe(
            "Path to project root containing gradle/libs.versions.toml",
          ),
        cache_ttl_hours: z
          .number()
          .optional()
          .default(24)
          .describe(
            "Hours before cache expires (default: 24). Set to 0 to force refresh.",
          ),
        format: z
          .enum(["summary", "json"])
          .optional()
          .default("summary")
          .describe("Output format: summary (human-readable) or json"),
      }),
    },
    async ({ project_root, cache_ttl_hours, format }) => {
      const rateLimitResponse = checkRateLimit(limiter, "check-outdated");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        // Check cache
        if (cache_ttl_hours > 0) {
          const state = readKDocState(project_root);
          if (state?.dependencies) {
            const cacheAge =
              (Date.now() - new Date(state.dependencies.last_checked).getTime()) /
              (1000 * 60 * 60);
            if (cacheAge < cache_ttl_hours) {
              logger.info(
                `check-outdated: using cached results (age: ${cacheAge.toFixed(1)}h, ttl: ${cache_ttl_hours}h)`,
              );
              const cached: CheckOutdatedResult = {
                status:
                  state.dependencies.outdated_count > 0
                    ? "OUTDATED"
                    : "UP_TO_DATE",
                checked_at: state.dependencies.last_checked,
                total_libraries: state.dependencies.total_libraries,
                outdated_count: state.dependencies.outdated_count,
                outdated: state.dependencies.outdated,
                up_to_date_count:
                  state.dependencies.total_libraries -
                  state.dependencies.outdated_count,
                errors: [],
                from_cache: true,
              };

              const text =
                format === "json"
                  ? JSON.stringify(cached, null, 2)
                  : formatSummary(cached);
              return { content: [{ type: "text" as const, text }] };
            }
          }
        }

        // Read TOML
        const tomlPath = path.join(
          project_root,
          "gradle",
          "libs.versions.toml",
        );
        let tomlContent: string;
        try {
          tomlContent = readFileSync(tomlPath, "utf-8");
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  summary: `Cannot read ${tomlPath}`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Parse
        const versions = parseVersions(tomlContent);
        const libraries = parseLibraries(tomlContent, versions);
        logger.info(
          `check-outdated: parsed ${Object.keys(versions).length} versions, ${libraries.length} libraries`,
        );

        // Query Maven Central
        const mavenResults = await queryAllLibraries(libraries);
        const result = buildResult(mavenResults, false);

        // Cache results in kdoc-state.json
        const state = readKDocState(project_root) ?? createEmptyState();
        updateDependencies(state, {
          last_checked: result.checked_at,
          cache_ttl_hours,
          total_libraries: result.total_libraries,
          outdated_count: result.outdated_count,
          outdated: result.outdated,
        });
        writeKDocState(project_root, state);

        const text =
          format === "json"
            ? JSON.stringify(result, null, 2)
            : formatSummary(result);
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        logger.error(`check-outdated failed: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
