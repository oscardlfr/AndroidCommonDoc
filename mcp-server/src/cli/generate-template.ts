/* eslint-disable no-console */
/**
 * CLI entrypoint for generate-template.
 *
 * Phase 3 round 1: produces agent template `.md` files from
 * `.claude/registry/agents.manifest.yaml`. Body is preserved verbatim;
 * only the YAML frontmatter is authored from manifest data.
 *
 * Usage:
 *   node build/cli/generate-template.js <agent-name> [PROJECT_ROOT] [options]
 *   node build/cli/generate-template.js --all [PROJECT_ROOT] [options]
 *
 * Options:
 *   --check                 Read-only; exit 1 if generated output ≠ current file
 *   --all                   Batch over every manifest entry
 *   --update-manifest-hash  Compute SHA-256 + write back to manifest in same pass
 *   --format summary|json   Output format (default: summary)
 *   --help, -h              Show usage
 *
 * Exit codes:
 *   0 = success / no-op when target is already aligned
 *   1 = drift detected with --check (or any agent failed in --all batch)
 *   2 = error (manifest unreadable, agent unknown, IO failure, bad CLI args)
 *
 * stdout is reserved for command output (summary text / JSON). All
 * progress + warnings go to stderr via the logger utility.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  generateTemplate,
  splitFrontmatterAndBody,
  computeFrontmatterSha256,
  renderFrontmatter,
  type ManifestAgentEntry,
} from "../registry/template-generator.js";
import { logger } from "../utils/logger.js";

// ── CLI option parsing ───────────────────────────────────────────────────────

interface CliOptions {
  projectRoot: string;
  agentName: string | null; // null when --all
  all: boolean;
  check: boolean;
  updateManifestHash: boolean;
  format: "summary" | "json";
}

function printUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    "Usage: node build/cli/generate-template.js <agent-name> [PROJECT_ROOT] [options]\n" +
      "       node build/cli/generate-template.js --all [PROJECT_ROOT] [options]\n\n" +
      "Generates agent templates from .claude/registry/agents.manifest.yaml.\n" +
      "Frontmatter is authored from manifest; body is preserved verbatim.\n\n" +
      "Options:\n" +
      "  --check                 Read-only; exit 1 if generated output != current file\n" +
      "  --all                   Batch over every manifest entry\n" +
      "  --update-manifest-hash  Compute SHA-256 + write to manifest in same pass\n" +
      "  --format summary|json   Output format (default: summary)\n" +
      "  --help, -h              Show this message\n\n" +
      "Exit codes:\n" +
      "  0 = success / no-op when aligned\n" +
      "  1 = drift detected with --check (or any agent failed in --all)\n" +
      "  2 = error (manifest unreadable, agent unknown, IO failure)\n",
  );
}

function parseArgs(argv: string[]): CliOptions | null {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return null;
  }

  let projectRoot = process.cwd();
  let agentName: string | null = null;
  let all = false;
  let check = false;
  let updateManifestHash = false;
  let format: "summary" | "json" = "summary";
  let positionalSeen = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--check") {
      check = true;
    } else if (arg === "--update-manifest-hash") {
      updateManifestHash = true;
    } else if (arg === "--format") {
      const next = args[i + 1];
      if (next !== "summary" && next !== "json") {
        process.stderr.write(
          `ERROR: --format must be 'summary' or 'json' (got '${next ?? "<missing>"}')\n`,
        );
        process.exit(2);
      }
      format = next;
      i++;
    } else if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value !== "summary" && value !== "json") {
        process.stderr.write(
          `ERROR: --format must be 'summary' or 'json' (got '${value}')\n`,
        );
        process.exit(2);
      }
      format = value;
    } else if (arg.startsWith("--")) {
      process.stderr.write(`ERROR: unknown option '${arg}'\n`);
      process.exit(2);
    } else {
      // Positional: first is agent-name (unless --all), second is PROJECT_ROOT.
      if (positionalSeen === 0 && !all) {
        agentName = arg;
      } else if (positionalSeen === 0 && all) {
        projectRoot = path.resolve(arg);
      } else if (positionalSeen === 1 && !all) {
        projectRoot = path.resolve(arg);
      } else {
        process.stderr.write(`ERROR: unexpected positional '${arg}'\n`);
        process.exit(2);
      }
      positionalSeen++;
    }
  }

  if (!all && agentName === null) {
    process.stderr.write(
      "ERROR: must pass either <agent-name> or --all\n",
    );
    process.exit(2);
  }

  return { projectRoot, agentName, all, check, updateManifestHash, format };
}

// ── Manifest I/O ─────────────────────────────────────────────────────────────

interface RawManifest {
  agents?: Record<string, ManifestAgentEntry>;
}

function readManifest(manifestPath: string): RawManifest {
  const raw = readFileSync(manifestPath, "utf-8");
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`manifest at ${manifestPath} is not a YAML object`);
  }
  return parsed as RawManifest;
}

/**
 * Update an agent's `template_frontmatter_sha256` field in the manifest YAML
 * file via a surgical line-based replacement.
 *
 * The yaml library's Document API rewrites the entire file (folds long
 * scalars, normalizes whitespace, alters quoting), which would produce a
 * 900+ line diff for a single hash update. This function instead locates
 * the agent block by indent-aware scanning and rewrites ONLY the single
 * `template_frontmatter_sha256: ...` line. Comments, formatting, quoting,
 * and surrounding fields are byte-preserved.
 */
function writeManifestHash(
  manifestPath: string,
  agentName: string,
  sha256: string,
): void {
  const raw = readFileSync(manifestPath, "utf-8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);

  // Locate the top-level `agents:` section. Anything before that is header
  // metadata (manifest:, paths_template:, categories:, lifecycles:, invariants:).
  const agentsStartIdx = lines.findIndex((l) => l === "agents:");
  if (agentsStartIdx === -1) {
    throw new Error("manifest has no top-level 'agents:' section");
  }

  let inAgentBlock = false;
  let updated = false;
  for (let i = agentsStartIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Exit agents: section on the next top-level key (column-0 identifier).
    if (/^[a-z]/.test(line)) break;
    // Agent block header: indent 2, lower-kebab name, colon, nothing else.
    const match = line.match(/^  ([a-z][a-z0-9_-]*):$/);
    if (match) {
      inAgentBlock = match[1] === agentName;
      continue;
    }
    if (inAgentBlock && /^    template_frontmatter_sha256:/.test(line)) {
      lines[i] = `    template_frontmatter_sha256: ${sha256}`;
      updated = true;
      break;
    }
  }

  if (!updated) {
    throw new Error(
      `agents.${agentName}.template_frontmatter_sha256 not found in manifest`,
    );
  }
  writeFileSync(manifestPath, lines.join(eol), "utf-8");
}

// ── Per-agent generation ─────────────────────────────────────────────────────

interface AgentResult {
  agent: string;
  /** "wrote" = file mutated; "noop" = already aligned; "drift" = check-mode mismatch; "error" = failure */
  status: "wrote" | "noop" | "drift" | "error";
  message?: string;
  templatePath: string;
  mirrorPath: string;
  sha256?: string;
}

interface ProcessOptions {
  projectRoot: string;
  templatesDir: string;
  mirrorDir: string;
  manifestPath: string;
  check: boolean;
  updateManifestHash: boolean;
}

function processAgent(
  agentName: string,
  entry: ManifestAgentEntry,
  opts: ProcessOptions,
): AgentResult {
  const templatePath = path.join(opts.templatesDir, `${agentName}.md`);
  const mirrorPath = path.join(opts.mirrorDir, `${agentName}.md`);

  const result: AgentResult = {
    agent: agentName,
    status: "noop",
    templatePath,
    mirrorPath,
  };

  // Existing template required — body is preserved from it.
  if (!existsSync(templatePath)) {
    result.status = "error";
    result.message = `template missing: ${path.relative(opts.projectRoot, templatePath)}`;
    return result;
  }

  const existingRaw = readFileSync(templatePath, "utf-8");
  const split = splitFrontmatterAndBody(existingRaw);
  if (!split) {
    result.status = "error";
    result.message = `cannot parse frontmatter from ${path.relative(opts.projectRoot, templatePath)}`;
    return result;
  }

  // Render new template content (frontmatter from manifest, body unchanged).
  const newContent = generateTemplate(entry, split.body);
  const newFrontmatter = renderFrontmatter(entry);
  const newSha256 = computeFrontmatterSha256(newFrontmatter);
  result.sha256 = newSha256;

  // Compare against current file content (LF-normalized) — drift check.
  const existingNormalized = existingRaw.replace(/\r\n/g, "\n");
  const isAligned = existingNormalized === newContent;

  // Mirror content: byte-identical to template.
  const mirrorRaw = existsSync(mirrorPath)
    ? readFileSync(mirrorPath, "utf-8").replace(/\r\n/g, "\n")
    : null;
  const mirrorAligned = mirrorRaw === newContent;

  if (opts.check) {
    if (isAligned && mirrorAligned) {
      result.status = "noop";
    } else {
      result.status = "drift";
      result.message = `drift detected (template aligned: ${isAligned}, mirror aligned: ${mirrorAligned})`;
    }
    // Even in --check mode, optionally update manifest hash if asked.
    if (opts.updateManifestHash) {
      const currentHash = entry.template_frontmatter_sha256;
      if (currentHash !== newSha256) {
        try {
          writeManifestHash(opts.manifestPath, agentName, newSha256);
        } catch (err) {
          result.status = "error";
          result.message = `manifest hash update failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
    return result;
  }

  // Write mode: write template + mirror unconditionally (idempotent — same bytes if aligned).
  try {
    writeFileSync(templatePath, newContent, "utf-8");
    writeFileSync(mirrorPath, newContent, "utf-8");
    result.status = isAligned && mirrorAligned ? "noop" : "wrote";
  } catch (err) {
    result.status = "error";
    result.message = `write failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  if (opts.updateManifestHash) {
    const currentHash = entry.template_frontmatter_sha256;
    if (currentHash !== newSha256) {
      try {
        writeManifestHash(opts.manifestPath, agentName, newSha256);
      } catch (err) {
        result.status = "error";
        result.message = `manifest hash update failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  return result;
}

// ── Output formatting ────────────────────────────────────────────────────────

function formatResults(
  results: AgentResult[],
  projectRoot: string,
  format: "summary" | "json",
): string {
  if (format === "json") {
    return JSON.stringify({ projectRoot, results }, null, 2);
  }
  const lines: string[] = [];
  lines.push(`Template generator — ${projectRoot}`);
  const counts = {
    wrote: results.filter((r) => r.status === "wrote").length,
    noop: results.filter((r) => r.status === "noop").length,
    drift: results.filter((r) => r.status === "drift").length,
    error: results.filter((r) => r.status === "error").length,
  };
  lines.push(
    `  agents: ${results.length}  wrote: ${counts.wrote}  noop: ${counts.noop}  drift: ${counts.drift}  error: ${counts.error}`,
  );
  for (const r of results) {
    const tag = r.status.toUpperCase().padEnd(6);
    const extra = r.message ? ` — ${r.message}` : "";
    lines.push(`  ${tag} ${r.agent}${extra}`);
  }
  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (opts === null) {
    printUsage(process.stdout);
    process.exit(0);
  }

  const projectRoot = path.resolve(opts.projectRoot);
  const manifestPath = path.join(
    projectRoot,
    ".claude",
    "registry",
    "agents.manifest.yaml",
  );
  const templatesDir = path.join(projectRoot, "setup", "agent-templates");
  const mirrorDir = path.join(projectRoot, ".claude", "agents");

  let manifest: RawManifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (err) {
    logger.error(
      `failed to read manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }

  if (!manifest.agents || typeof manifest.agents !== "object") {
    logger.error("manifest 'agents' field is missing or not an object");
    process.exit(2);
  }

  const procOpts: ProcessOptions = {
    projectRoot,
    templatesDir,
    mirrorDir,
    manifestPath,
    check: opts.check,
    updateManifestHash: opts.updateManifestHash,
  };

  const results: AgentResult[] = [];
  if (opts.all) {
    for (const [name, entry] of Object.entries(manifest.agents)) {
      results.push(processAgent(name, entry, procOpts));
    }
  } else {
    const name = opts.agentName!;
    const entry = manifest.agents[name];
    if (!entry) {
      logger.error(`agent '${name}' not found in manifest`);
      process.exit(2);
    }
    results.push(processAgent(name, entry, procOpts));
  }

  process.stdout.write(formatResults(results, projectRoot, opts.format) + "\n");

  const hasError = results.some((r) => r.status === "error");
  if (hasError) {
    process.exit(2);
  }
  const hasDrift = results.some((r) => r.status === "drift");
  if (opts.check && hasDrift) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error(`generate-template CLI error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
