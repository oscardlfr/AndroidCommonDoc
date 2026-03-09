/**
 * MCP tool: dependency-graph
 *
 * Builds a dependency graph from Gradle project() declarations, outputs
 * as adjacency list JSON, Mermaid diagram, or both. Optionally detects
 * circular dependencies via DFS.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import {
  parseSettingsModules,
  parseModuleDependencies,
} from "../utils/gradle-parser.js";

// ── Cycle detection ─────────────────────────────────────────────────────────

export function detectCycles(adj: Record<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const pathArr: string[] = [];

  function dfs(node: string): void {
    if (stack.has(node)) {
      const cycleStart = pathArr.indexOf(node);
      cycles.push(pathArr.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    pathArr.push(node);
    for (const dep of adj[node] ?? []) {
      dfs(dep);
    }
    pathArr.pop();
    stack.delete(node);
  }

  for (const node of Object.keys(adj)) {
    dfs(node);
  }
  return cycles;
}

// ── Graph analytics ─────────────────────────────────────────────────────────

interface GraphStats {
  total_modules: number;
  total_edges: number;
  leaf_modules: string[];
  most_depended_on: Array<{ module: string; incoming: number }>;
  cycles: string[][];
}

function computeStats(
  adj: Record<string, string[]>,
  doCycleDetection: boolean,
): GraphStats {
  const allNodes = new Set(Object.keys(adj));
  // Also add nodes that only appear as targets
  for (const deps of Object.values(adj)) {
    for (const d of deps) {
      allNodes.add(d);
    }
  }

  let totalEdges = 0;
  for (const deps of Object.values(adj)) {
    totalEdges += deps.length;
  }

  // Leaf modules: no outgoing deps
  const leafModules = Array.from(allNodes).filter(
    (n) => !adj[n] || adj[n].length === 0,
  );

  // Incoming count
  const incoming: Record<string, number> = {};
  for (const node of allNodes) {
    incoming[node] = 0;
  }
  for (const deps of Object.values(adj)) {
    for (const d of deps) {
      incoming[d] = (incoming[d] ?? 0) + 1;
    }
  }

  // Sort by incoming count descending
  const mostDependedOn = Object.entries(incoming)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([module, count]) => ({ module, incoming: count }));

  const cycles = doCycleDetection ? detectCycles(adj) : [];

  return {
    total_modules: allNodes.size,
    total_edges: totalEdges,
    leaf_modules: leafModules.sort(),
    most_depended_on: mostDependedOn,
    cycles,
  };
}

// ── Mermaid rendering ───────────────────────────────────────────────────────

function renderMermaid(adj: Record<string, string[]>): string {
  const lines: string[] = ["graph TD"];
  const sortedNodes = Object.keys(adj).sort();

  for (const node of sortedNodes) {
    const deps = adj[node];
    if (!deps || deps.length === 0) continue;
    for (const dep of deps.sort()) {
      lines.push(`  ${node} --> ${dep}`);
    }
  }

  return lines.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerDependencyGraphTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "dependency-graph",
    "Build a dependency graph from Gradle project() declarations. Outputs adjacency list, Mermaid diagram, and detects circular dependencies.",
    {
      project_root: z
        .string()
        .describe("Absolute path to the Gradle project root"),
      output: z
        .enum(["adjacency", "mermaid", "both"])
        .default("both")
        .describe("Output format"),
      detect_cycles: z
        .boolean()
        .default(true)
        .describe("Run DFS cycle detection"),
    },
    async ({
      project_root,
      output = "both",
      detect_cycles = true,
    }) => {
      const rateLimitResponse = checkRateLimit(
        rateLimiter,
        "dependency-graph",
      );
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const settingsPath = path.join(project_root, "settings.gradle.kts");
        let allModules: string[];
        try {
          allModules = await parseSettingsModules(settingsPath);
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  summary: `Could not read settings.gradle.kts: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Build adjacency list
        const adj: Record<string, string[]> = {};
        for (const mod of allModules) {
          const moduleDir = mod.replace(/^:/, "").replace(/:/g, "/");
          const buildFile = path.join(
            project_root,
            moduleDir,
            "build.gradle.kts",
          );
          try {
            const deps = await parseModuleDependencies(buildFile);
            const allDeps = [...deps.api, ...deps.implementation];
            if (allDeps.length > 0) {
              adj[mod] = allDeps;
            } else {
              adj[mod] = [];
            }
          } catch {
            // No build file or unreadable — still include module with no deps
            adj[mod] = [];
          }
        }

        const stats = computeStats(adj, detect_cycles);

        const parts: string[] = [];

        if (output === "adjacency" || output === "both") {
          parts.push(
            JSON.stringify(
              {
                adjacency: adj,
                stats,
              },
              null,
              2,
            ),
          );
        }

        if (output === "mermaid" || output === "both") {
          const mermaid = renderMermaid(adj);
          const lines: string[] = [
            "## Dependency Graph (Mermaid)",
            "",
            "```mermaid",
            mermaid,
            "```",
          ];

          if (stats.cycles.length > 0) {
            lines.push("");
            lines.push("### Cycles Detected");
            for (const cycle of stats.cycles) {
              lines.push(`- ${cycle.join(" -> ")}`);
            }
          }

          if (stats.leaf_modules.length > 0) {
            lines.push("");
            lines.push("### Leaf Modules (no outgoing deps)");
            for (const leaf of stats.leaf_modules) {
              lines.push(`- ${leaf}`);
            }
          }

          if (stats.most_depended_on.length > 0) {
            lines.push("");
            lines.push("### Most Depended On");
            for (const entry of stats.most_depended_on) {
              lines.push(`- ${entry.module}: ${entry.incoming} incoming`);
            }
          }

          parts.push(lines.join("\n"));
        }

        return {
          content: [
            { type: "text" as const, text: parts.join("\n\n---\n\n") },
          ],
        };
      } catch (error) {
        logger.error(`dependency-graph error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `dependency-graph failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
