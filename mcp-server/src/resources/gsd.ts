/**
 * GSD project state resources.
 *
 * Registers project management artifacts (STATE, REQUIREMENTS, DECISIONS,
 * and individual milestones) as MCP resources using a gsd:// URI scheme.
 * Agents can read live project state without knowing the filesystem layout.
 *
 * URI scheme:
 *   gsd://state                   → .gsd/STATE.md
 *   gsd://requirements             → .gsd/REQUIREMENTS.md
 *   gsd://decisions                → .gsd/DECISIONS.md
 *   gsd://milestone/{id}           → .gsd/milestones/{id}/{id}-ROADMAP.md
 *   gsd://milestone/{id}/summary   → .gsd/milestones/{id}/{id}-SUMMARY.md
 *   gsd://milestone/{id}/context   → .gsd/milestones/{id}/{id}-CONTEXT.md
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getToolkitRoot } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

function gsdDir(): string {
  return path.join(getToolkitRoot(), ".gsd");
}

async function readGsdFile(filePath: string, label: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `GSD artifact not found: ${label}`,
    );
  }
}

/**
 * Discover milestone IDs by scanning .gsd/milestones/.
 * Returns IDs like ["M001", "M002", "M005"].
 */
async function discoverMilestoneIds(): Promise<string[]> {
  const milestonesDir = path.join(gsdDir(), "milestones");
  try {
    const entries = await readdir(milestonesDir);
    const ids: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(milestonesDir, entry);
      const stats = await stat(entryPath);
      // Match Mxxx or Mxxx-xxxxxx (unique_milestone_ids format)
      if (stats.isDirectory() && /^M\d{3}/.test(entry)) {
        // Use the directory name as-is for the milestone ID key
        ids.push(entry);
      }
    }
    return ids.sort();
  } catch {
    return [];
  }
}

/**
 * Find a milestone directory by ID prefix (e.g. "M005" matches "M005" or "M005-eh88as").
 */
async function findMilestoneDir(milestoneId: string): Promise<string | null> {
  const milestonesDir = path.join(gsdDir(), "milestones");
  try {
    const entries = await readdir(milestonesDir);
    const match = entries.find((e) => e === milestoneId || e.startsWith(`${milestoneId}-`));
    if (!match) return null;
    return path.join(milestonesDir, match);
  } catch {
    return null;
  }
}

/**
 * Register all GSD project state resources.
 */
export async function registerGsdResources(server: McpServer): Promise<void> {
  const gsd = gsdDir();

  // ── Static resources ──────────────────────────────────────────────────────

  server.registerResource(
    "gsd-state",
    "gsd://state",
    {
      title: "Project State",
      description: "Current GSD milestone and slice progress (STATE.md)",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const content = await readGsdFile(path.join(gsd, "STATE.md"), "state");
      return { contents: [{ uri: uri.href, text: content }] };
    },
  );

  server.registerResource(
    "gsd-requirements",
    "gsd://requirements",
    {
      title: "Project Requirements",
      description: "Active, validated, and deferred requirements (REQUIREMENTS.md)",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const content = await readGsdFile(
        path.join(gsd, "REQUIREMENTS.md"),
        "requirements",
      );
      return { contents: [{ uri: uri.href, text: content }] };
    },
  );

  server.registerResource(
    "gsd-decisions",
    "gsd://decisions",
    {
      title: "Architectural Decisions",
      description: "Append-only architectural decision register (DECISIONS.md)",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const content = await readGsdFile(
        path.join(gsd, "DECISIONS.md"),
        "decisions",
      );
      return { contents: [{ uri: uri.href, text: content }] };
    },
  );

  // ── Dynamic milestone resources ───────────────────────────────────────────

  const milestoneIds = await discoverMilestoneIds();

  for (const milestoneId of milestoneIds) {
    // Capture stable reference for async closures
    const id = milestoneId;

    // ROADMAP (primary milestone resource)
    server.registerResource(
      `gsd-milestone-${id}`,
      `gsd://milestone/${id}`,
      {
        title: `Milestone ${id} Roadmap`,
        description: `Slices, tasks, and success criteria for milestone ${id}`,
        mimeType: "text/markdown",
      },
      async (uri) => {
        const dir = await findMilestoneDir(id);
        if (!dir) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Milestone not found: ${id}`,
          );
        }
        const filePath = path.join(dir, `${id}-ROADMAP.md`);
        const content = await readGsdFile(filePath, `milestone/${id}`);
        return { contents: [{ uri: uri.href, text: content }] };
      },
    );

    // SUMMARY (if exists — registered speculatively, errors on read if absent)
    server.registerResource(
      `gsd-milestone-${id}-summary`,
      `gsd://milestone/${id}/summary`,
      {
        title: `Milestone ${id} Summary`,
        description: `Completion summary and outcomes for milestone ${id}`,
        mimeType: "text/markdown",
      },
      async (uri) => {
        const dir = await findMilestoneDir(id);
        if (!dir) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Milestone not found: ${id}`,
          );
        }
        const filePath = path.join(dir, `${id}-SUMMARY.md`);
        const content = await readGsdFile(filePath, `milestone/${id}/summary`);
        return { contents: [{ uri: uri.href, text: content }] };
      },
    );
  }

  const staticCount = 3;
  const milestoneCount = milestoneIds.length * 2; // roadmap + summary per milestone
  logger.info(
    `Registered ${staticCount} static + ${milestoneCount} milestone gsd:// resources (milestones: ${milestoneIds.join(", ")})`,
  );
}
