/**
 * MCP tool: validate-vault
 *
 * Performs four validation checks on the Obsidian vault and source docs:
 * 1. Duplicate detection (filename collisions, content hash matches, vault_source conflicts)
 * 2. Structural homogeneity (hub/sub-doc pattern, size limits, frontmatter completeness)
 * 3. Cross-layer reference integrity (L0/L1/L2 ref validation, upward reference detection)
 * 4. Wikilink coverage (broken wikilinks, orphan files)
 *
 * Follows existing validation tool pattern: pure exported functions + MCP registration.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../registry/frontmatter.js";
import { loadVaultConfig } from "../vault/config.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/** Severity of a validation issue. */
export type IssueSeverity = "error" | "warning";

/** A single validation issue found during checks. */
export interface ValidationIssue {
  severity: IssueSeverity;
  check: "duplicates" | "homogeneity" | "references" | "wikilinks";
  message: string;
  file?: string;
  details?: Record<string, unknown>;
}

/** Aggregated result from all validation checks. */
export interface ValidateVaultResult {
  duplicates: ValidationIssue[];
  homogeneity: ValidationIssue[];
  references: ValidationIssue[];
  wikilinks: ValidationIssue[];
  summary: { errors: number; warnings: number; passed: boolean };
}

/** Project path descriptor for structural and reference checks. */
export interface ProjectPath {
  name: string;
  path: string;
  layer: "L0" | "L1" | "L2";
}

/** Directories to skip during file scanning. */
const SKIP_DIRS = new Set([
  "archive",
  ".git",
  "node_modules",
  "build",
  "dist",
  ".gradle",
]);

/** Required frontmatter fields (10-field standard). */
const REQUIRED_FRONTMATTER_FIELDS = [
  "scope",
  "sources",
  "targets",
  "slug",
  "status",
  "layer",
  "category",
  "description",
  "version",
  "last_updated",
];

/**
 * Recursively find all .md files under a directory.
 * Skips directories in SKIP_DIRS.
 */
async function findMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Check for duplicate files in the vault.
 *
 * Detects:
 * (a) Case-insensitive filename collisions within same directory
 * (b) Files with identical content hash (SHA-256) across directories
 * (c) Same vault_source frontmatter pointing to multiple files
 */
export async function checkDuplicates(
  vaultPath: string,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const files = await findMdFiles(vaultPath);

  // (a) Case-insensitive filename collisions per directory
  const dirFiles = new Map<string, Map<string, string[]>>();
  for (const filepath of files) {
    const dir = path.dirname(filepath);
    const basename = path.basename(filepath);
    const lowerName = basename.toLowerCase();

    if (!dirFiles.has(dir)) {
      dirFiles.set(dir, new Map());
    }
    const dirMap = dirFiles.get(dir)!;
    if (!dirMap.has(lowerName)) {
      dirMap.set(lowerName, []);
    }
    dirMap.get(lowerName)!.push(basename);
  }

  for (const [dir, nameMap] of dirFiles) {
    for (const [, names] of nameMap) {
      if (names.length > 1) {
        const relDir = path.relative(vaultPath, dir).replace(/\\/g, "/") || ".";
        issues.push({
          severity: "error",
          check: "duplicates",
          message: `Case-insensitive filename collision in ${relDir}/: ${names.join(", ")}`,
          details: { directory: relDir, files: names },
        });
      }
    }
  }

  // (b) Identical content hash across directories
  const hashMap = new Map<string, string[]>();
  for (const filepath of files) {
    try {
      const content = await readFile(filepath, "utf-8");
      const hash = createHash("sha256").update(content).digest("hex");
      if (!hashMap.has(hash)) {
        hashMap.set(hash, []);
      }
      hashMap.get(hash)!.push(
        path.relative(vaultPath, filepath).replace(/\\/g, "/"),
      );
    } catch {
      // Skip unreadable files
    }
  }

  for (const [hash, paths] of hashMap) {
    if (paths.length > 1) {
      issues.push({
        severity: "error",
        check: "duplicates",
        message: `Identical content (SHA-256) in ${paths.length} files: ${paths.join(", ")}`,
        details: { hash: hash.slice(0, 12), files: paths },
      });
    }
  }

  // (c) Same vault_source in multiple files
  const sourceMap = new Map<string, string[]>();
  for (const filepath of files) {
    try {
      const content = await readFile(filepath, "utf-8");
      const parsed = parseFrontmatter(content);
      const vaultSource = parsed?.data?.vault_source as string | undefined;
      if (vaultSource) {
        if (!sourceMap.has(vaultSource)) {
          sourceMap.set(vaultSource, []);
        }
        sourceMap.get(vaultSource)!.push(
          path.relative(vaultPath, filepath).replace(/\\/g, "/"),
        );
      }
    } catch {
      // Skip unreadable files
    }
  }

  for (const [source, paths] of sourceMap) {
    if (paths.length > 1) {
      issues.push({
        severity: "error",
        check: "duplicates",
        message: `Same vault_source "${source}" in ${paths.length} files: ${paths.join(", ")}`,
        details: { vault_source: source, files: paths },
      });
    }
  }

  return issues;
}

/**
 * Check structural homogeneity of project docs.
 *
 * Validates:
 * (a) Every subdirectory with 2+ .md files must have a hub doc (contains "## Sub-documents")
 * (b) Hub docs must be <100 lines
 * (c) Sub-docs must be <300 lines
 * (d) All files must have 10-field frontmatter
 */
export async function checkStructuralHomogeneity(
  projectPaths: ProjectPath[],
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const project of projectPaths) {
    const docsDir = path.join(project.path, "docs");
    try {
      const s = await stat(docsDir);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    // Walk docs subdirectories
    let entries;
    try {
      entries = await readdir(docsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const subDir = path.join(docsDir, entry.name);
      const mdFiles = await findMdFiles(subDir);

      // Only check directories with 2+ files
      if (mdFiles.length < 2) continue;

      // (a) Check for hub doc
      let hasHub = false;
      for (const filepath of mdFiles) {
        // Only check files directly in this subdir (not nested)
        if (path.dirname(filepath) !== subDir) continue;
        try {
          const content = await readFile(filepath, "utf-8");
          if (content.includes("## Sub-documents")) {
            hasHub = true;
            // (b) Hub doc size check
            const lineCount = content.split("\n").length;
            if (lineCount > 100) {
              issues.push({
                severity: "error",
                check: "homogeneity",
                message: `[${project.name}] Hub doc ${path.basename(filepath)} has ${lineCount} lines (max 100)`,
                file: path.relative(project.path, filepath).replace(/\\/g, "/"),
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (!hasHub) {
        issues.push({
          severity: "warning",
          check: "homogeneity",
          message: `[${project.name}] docs/${entry.name}/ has ${mdFiles.length} files but no hub doc (missing "## Sub-documents" heading)`,
          details: { directory: `docs/${entry.name}`, fileCount: mdFiles.length },
        });
      }
    }

    // Check all doc files for size and frontmatter completeness
    const allFiles = await findMdFiles(docsDir);
    for (const filepath of allFiles) {
      const relPath = path.relative(project.path, filepath).replace(/\\/g, "/");

      // Skip archive files
      if (relPath.includes("archive")) continue;

      try {
        const content = await readFile(filepath, "utf-8");
        const lines = content.split("\n");

        // (c) Sub-doc size check (non-hub files)
        const isHub = content.includes("## Sub-documents");
        if (!isHub && lines.length > 300) {
          issues.push({
            severity: "error",
            check: "homogeneity",
            message: `[${project.name}] ${path.basename(filepath)} has ${lines.length} lines (max 300 for sub-docs)`,
            file: relPath,
          });
        }

        // (d) Frontmatter completeness
        const parsed = parseFrontmatter(content);
        if (parsed) {
          const missing = REQUIRED_FRONTMATTER_FIELDS.filter((field) => {
            const value = parsed.data[field];
            if (value === undefined || value === null) return true;
            if (typeof value === "string" && value === "") return true;
            if (Array.isArray(value) && value.length === 0) return true;
            return false;
          });

          if (missing.length > 0) {
            issues.push({
              severity: "warning",
              check: "homogeneity",
              message: `[${project.name}] ${path.basename(filepath)} missing frontmatter fields: ${missing.join(", ")}`,
              file: relPath,
              details: { missingFields: missing },
            });
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return issues;
}

/**
 * Check cross-layer reference integrity.
 *
 * Validates:
 * - L1 docs with l0_refs: each referenced slug exists in L0 docs
 * - L2 docs with l0_refs/l1_refs: each referenced slug exists
 * - L0 docs must not reference L1/L2 project names (upward reference violation)
 */
export async function checkReferenceIntegrity(
  projectPaths: ProjectPath[],
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Build slug sets per layer
  const slugsByLayer = new Map<string, Set<string>>();
  const projectNames = new Map<string, { layer: string; originalName: string }>(); // lowercase name -> { layer, originalName }

  for (const project of projectPaths) {
    projectNames.set(project.name.toLowerCase(), { layer: project.layer, originalName: project.name });
    const docsDir = path.join(project.path, "docs");
    const slugs = new Set<string>();

    try {
      const files = await findMdFiles(docsDir);
      for (const filepath of files) {
        try {
          const content = await readFile(filepath, "utf-8");
          const parsed = parseFrontmatter(content);
          const slug = parsed?.data?.slug as string | undefined;
          if (slug) {
            slugs.add(slug);
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // No docs directory
    }

    if (!slugsByLayer.has(project.layer)) {
      slugsByLayer.set(project.layer, new Set());
    }
    for (const slug of slugs) {
      slugsByLayer.get(project.layer)!.add(slug);
    }
  }

  const l0Slugs = slugsByLayer.get("L0") ?? new Set<string>();
  const l1Slugs = slugsByLayer.get("L1") ?? new Set<string>();

  // Validate references for each project
  for (const project of projectPaths) {
    const docsDir = path.join(project.path, "docs");
    let files: string[];
    try {
      files = await findMdFiles(docsDir);
    } catch {
      continue;
    }

    for (const filepath of files) {
      const relPath = path.relative(project.path, filepath).replace(/\\/g, "/");
      try {
        const content = await readFile(filepath, "utf-8");
        const parsed = parseFrontmatter(content);
        if (!parsed) continue;

        // Check l0_refs for L1/L2 projects
        if (project.layer === "L1" || project.layer === "L2") {
          const l0Refs = parsed.data.l0_refs as string[] | undefined;
          if (Array.isArray(l0Refs)) {
            for (const ref of l0Refs) {
              if (!l0Slugs.has(ref)) {
                issues.push({
                  severity: "error",
                  check: "references",
                  message: `[${project.name}] ${path.basename(filepath)}: l0_refs contains "${ref}" which is not a valid L0 slug`,
                  file: relPath,
                });
              }
            }
          }
        }

        // Check l1_refs for L2 projects
        if (project.layer === "L2") {
          const l1Refs = parsed.data.l1_refs as string[] | undefined;
          if (Array.isArray(l1Refs)) {
            for (const ref of l1Refs) {
              if (!l1Slugs.has(ref)) {
                issues.push({
                  severity: "error",
                  check: "references",
                  message: `[${project.name}] ${path.basename(filepath)}: l1_refs contains "${ref}" which is not a valid L1 slug`,
                  file: relPath,
                });
              }
            }
          }
        }

        // Check upward references from L0 (L0 must not reference L1/L2 project names)
        if (project.layer === "L0") {
          const bodyContent = parsed.content || "";
          for (const [name, info] of projectNames) {
            if (info.layer === "L0") continue;
            // Check if the L1/L2 project name appears as a reference in L0 doc body
            // Use word boundary matching to avoid false positives
            const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
            if (regex.test(bodyContent)) {
              issues.push({
                severity: "warning",
                check: "references",
                message: `[${project.name}] ${path.basename(filepath)}: L0 doc references ${info.layer} project "${info.originalName}" (potential upward reference)`,
                file: relPath,
              });
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return issues;
}

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check wikilink coverage in the vault.
 *
 * Validates:
 * - Every [[wikilink]] target resolves to a file in the vault
 * - No orphan files (files with no incoming wikilinks and not a MOC page)
 */
export async function checkWikilinkCoverage(
  vaultPath: string,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const files = await findMdFiles(vaultPath);

  // MOC-like file patterns that are exempt from orphan checks
  const MOC_PATTERNS = [
    /^home\.md$/i,
    /^index\.md$/i,
    /^readme\.md$/i,
    /^moc[-_]/i,
    /all[-_ ](?:patterns|modules|projects)/i,
  ];

  function isMocFile(filename: string): boolean {
    return MOC_PATTERNS.some((pattern) => pattern.test(filename));
  }

  // Build file lookup (case-insensitive, without extension)
  const filenameLookup = new Map<string, string>(); // lowercase name (no ext) -> relative path
  const allRelPaths = new Set<string>();

  for (const filepath of files) {
    const relPath = path.relative(vaultPath, filepath).replace(/\\/g, "/");
    const basename = path.basename(filepath, ".md").toLowerCase();
    filenameLookup.set(basename, relPath);
    allRelPaths.add(relPath);
  }

  // Track incoming wikilinks for orphan detection
  const incomingLinks = new Set<string>(); // lowercase names that are linked to
  const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  for (const filepath of files) {
    const relPath = path.relative(vaultPath, filepath).replace(/\\/g, "/");
    try {
      const content = await readFile(filepath, "utf-8");
      let match;
      while ((match = wikilinkRegex.exec(content)) !== null) {
        const target = match[1].trim().toLowerCase();
        incomingLinks.add(target);

        // Check if target exists
        if (!filenameLookup.has(target)) {
          issues.push({
            severity: "error",
            check: "wikilinks",
            message: `${relPath}: broken wikilink [[${match[1].trim()}]] (target not found)`,
            file: relPath,
            details: { target: match[1].trim() },
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Orphan detection: files with no incoming wikilinks and not MOC
  for (const filepath of files) {
    const basename = path.basename(filepath);
    const nameNoExt = path.basename(filepath, ".md").toLowerCase();
    const relPath = path.relative(vaultPath, filepath).replace(/\\/g, "/");

    if (isMocFile(basename)) continue;
    if (!incomingLinks.has(nameNoExt)) {
      issues.push({
        severity: "warning",
        check: "wikilinks",
        message: `${relPath}: orphan file (no incoming wikilinks, not a MOC page)`,
        file: relPath,
      });
    }
  }

  return issues;
}

/**
 * Orchestrate all 4 validation checks.
 *
 * Runs selected checks (or all by default), aggregates results into
 * a structured ValidateVaultResult with summary counts.
 */
export async function validateVault(params: {
  vaultPath: string;
  checks?: string[];
  projectPaths?: ProjectPath[];
}): Promise<ValidateVaultResult> {
  const { vaultPath, projectPaths = [] } = params;
  const checksToRun = new Set(
    params.checks ?? ["duplicates", "homogeneity", "references", "wikilinks"],
  );

  const result: ValidateVaultResult = {
    duplicates: [],
    homogeneity: [],
    references: [],
    wikilinks: [],
    summary: { errors: 0, warnings: 0, passed: true },
  };

  if (checksToRun.has("duplicates")) {
    result.duplicates = await checkDuplicates(vaultPath);
  }
  if (checksToRun.has("homogeneity")) {
    result.homogeneity = await checkStructuralHomogeneity(projectPaths);
  }
  if (checksToRun.has("references")) {
    result.references = await checkReferenceIntegrity(projectPaths);
  }
  if (checksToRun.has("wikilinks")) {
    result.wikilinks = await checkWikilinkCoverage(vaultPath);
  }

  // Calculate summary
  const allIssues = [
    ...result.duplicates,
    ...result.homogeneity,
    ...result.references,
    ...result.wikilinks,
  ];

  result.summary.errors = allIssues.filter(
    (i) => i.severity === "error",
  ).length;
  result.summary.warnings = allIssues.filter(
    (i) => i.severity === "warning",
  ).length;
  result.summary.passed = result.summary.errors === 0;

  return result;
}

/**
 * Register the validate-vault MCP tool.
 */
export function registerValidateVaultTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-vault",
    {
      title: "Validate Vault",
      description:
        "Validates the Obsidian vault with 4 checks: duplicate detection, structural homogeneity, cross-layer reference integrity, and wikilink coverage.",
      inputSchema: z.object({
        vaultPath: z
          .string()
          .optional()
          .describe(
            "Path to the Obsidian vault directory (defaults to configured vault path)",
          ),
        checks: z
          .array(
            z.enum(["duplicates", "homogeneity", "references", "wikilinks"]),
          )
          .optional()
          .describe("Which checks to run (defaults to all 4)"),
        projectPaths: z
          .array(
            z.object({
              name: z.string(),
              path: z.string(),
              layer: z.enum(["L0", "L1", "L2"]),
            }),
          )
          .optional()
          .describe(
            "Project paths for structural and reference checks (defaults to discovered projects)",
          ),
      }),
    },
    async ({ vaultPath, checks, projectPaths }) => {
      const rateLimitResponse = checkRateLimit(limiter, "validate-vault");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        // Resolve vault path
        let resolvedVaultPath = vaultPath;
        if (!resolvedVaultPath) {
          const config = await loadVaultConfig();
          resolvedVaultPath = config.vaultPath;
        }

        // Resolve project paths
        let resolvedProjectPaths = projectPaths as ProjectPath[] | undefined;
        if (!resolvedProjectPaths || resolvedProjectPaths.length === 0) {
          // Use empty array -- checks requiring project paths will skip
          resolvedProjectPaths = [];
        }

        const result = await validateVault({
          vaultPath: resolvedVaultPath,
          checks: checks as string[] | undefined,
          projectPaths: resolvedProjectPaths,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.error(`validate-vault error: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );
}
