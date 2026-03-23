/**
 * Unified documentation audit orchestrator.
 *
 * Three waves:
 * - Wave 1 (Structure): sizes, frontmatter, naming, archive exclusion
 * - Wave 2 (Coherence): internal links, l0_refs, README counts, hub tables
 * - Wave 3 (Upstream): assertions against fetched upstream content (opt-in)
 *
 * Waves 1+2 are local ($0). Wave 3 requires network (opt-in via --with-upstream).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../utils/logger.js";
import type { MonitoringFinding, FindingSeverity } from "../registry/types.js";
import {
  validateDocsDirectory,
  validateL0Refs,
  validateSubDocRefs,
  checkMonitorUrls,
} from "../tools/validate-doc-structure.js";
import { scanDirectory } from "../registry/scanner.js";
import type { UpstreamValidation } from "./assertion-engine.js";
import { runAssertions } from "./assertion-engine.js";
import { fetchContent } from "./content-fetcher.js";
import { ContentCache } from "./content-cache.js";

/** Options for audit-docs execution. */
export interface AuditDocsOptions {
  /** Project root directory. */
  projectRoot: string;
  /** Project layer (L0, L1, L2). */
  layer: "L0" | "L1" | "L2";
  /** Which waves to run (default: [1, 2]). */
  waves?: number[];
  /** Include upstream validation — Wave 3 (default: false). */
  withUpstream?: boolean;
  /** Cache TTL override for upstream content in hours. */
  cacheTtlHours?: number;
  /** Max docs to analyze with LLM in deep profile (default: unlimited). */
  maxLlmDocs?: number;
  /** Quality profile: "standard" (Layer 1 only) or "deep" (Layer 1 + LLM). */
  profile?: "standard" | "deep";
}

/** Result of a single audit check. */
export interface AuditFinding {
  wave: number;
  severity: FindingSeverity;
  category: string;
  file?: string;
  message: string;
}

/** Full audit result. */
export interface AuditResult {
  projectRoot: string;
  layer: string;
  wavesRun: number[];
  findings: AuditFinding[];
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  timestamp: string;
}

/**
 * Run the documentation audit.
 */
export async function auditDocs(
  options: AuditDocsOptions,
): Promise<AuditResult> {
  const waves = options.withUpstream
    ? (options.waves ?? [1, 2, 3])
    : (options.waves ?? [1, 2]);
  const findings: AuditFinding[] = [];

  logger.info(`audit-docs: ${options.layer} at ${options.projectRoot}`);
  logger.info(`audit-docs: waves ${waves.join(", ")}`);

  const docsDir = path.join(options.projectRoot, "docs");
  if (!existsSync(docsDir)) {
    return makeResult(options, waves, [
      { wave: 0, severity: "HIGH", category: "missing-docs", message: "docs/ directory not found" },
    ]);
  }

  // Wave 1: Structure
  if (waves.includes(1)) {
    logger.info("audit-docs: Wave 1 — Structure");
    const wave1 = await runWave1Structure(docsDir);
    findings.push(...wave1);
  }

  // Wave 2: Coherence
  if (waves.includes(2)) {
    logger.info("audit-docs: Wave 2 — Coherence");
    const wave2 = await runWave2Coherence(options.projectRoot, docsDir, options.layer);
    findings.push(...wave2);
  }

  // Wave 3: Upstream (opt-in)
  if (waves.includes(3)) {
    logger.info("audit-docs: Wave 3 — Upstream");
    const wave3 = await runWave3Upstream(options);
    findings.push(...wave3);
  }

  return makeResult(options, waves, findings);
}

// ---------------------------------------------------------------------------
// Wave 1: Structure
// ---------------------------------------------------------------------------

async function runWave1Structure(docsDir: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  try {
    const result = await validateDocsDirectory(docsDir);

    for (const error of result.errors) {
      findings.push({
        wave: 1,
        severity: "HIGH",
        category: "doc-structure",
        message: error,
      });
    }

    for (const warning of result.warnings) {
      findings.push({
        wave: 1,
        severity: "LOW",
        category: "doc-structure",
        message: warning,
      });
    }
  } catch (error) {
    logger.warn(`Wave 1 error: ${error}`);
    findings.push({
      wave: 1,
      severity: "MEDIUM",
      category: "wave-error",
      message: `Structure validation failed: ${error}`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Wave 2: Coherence
// ---------------------------------------------------------------------------

async function runWave2Coherence(
  projectRoot: string,
  docsDir: string,
  layer: string,
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Check 1: Internal link resolution
  const linkFindings = await checkInternalLinks(docsDir);
  findings.push(...linkFindings);

  // Check 2: L0 refs (only for L1/L2)
  if (layer !== "L0") {
    const l0RefFindings = await checkL0Refs(docsDir, projectRoot);
    findings.push(...l0RefFindings);
  }

  // Check 3: Hub table completeness
  const hubFindings = await checkHubCompleteness(docsDir);
  findings.push(...hubFindings);

  return findings;
}

/**
 * Check that all markdown internal links resolve to existing files.
 */
async function checkInternalLinks(docsDir: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const mdFiles = await findAllMdFiles(docsDir);

  for (const filepath of mdFiles) {
    try {
      const content = await readFile(filepath, "utf-8");
      const dir = path.dirname(filepath);

      // Match [text](relative-path.md) but not http URLs
      const linkRegex = /\[([^\]]*)\]\(([^)]+\.md)\)/g;
      let match: RegExpExecArray | null;

      while ((match = linkRegex.exec(content)) !== null) {
        const linkTarget = match[2];
        if (linkTarget.startsWith("http")) continue;

        const targetPath = path.resolve(dir, linkTarget);
        if (!existsSync(targetPath)) {
          const relFile = path.relative(docsDir, filepath);
          findings.push({
            wave: 2,
            severity: "MEDIUM",
            category: "broken-link",
            file: relFile,
            message: `Broken link: [${match[1]}](${linkTarget}) → file not found`,
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return findings;
}

/**
 * Check that l0_refs in L1/L2 docs resolve to valid L0 slugs.
 */
async function checkL0Refs(
  docsDir: string,
  projectRoot: string,
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Try to find L0 path from l0-manifest or sibling
  const manifestPath = path.join(projectRoot, "l0-manifest.json");
  if (!existsSync(manifestPath)) return findings;

  try {
    const entries = await scanDirectory(docsDir, "L1");
    for (const entry of entries) {
      const l0Refs = entry.metadata.l0_refs;
      if (!l0Refs || l0Refs.length === 0) continue;

      // We can't validate l0_refs without L0 registry — just check format
      for (const ref of l0Refs) {
        if (!ref || typeof ref !== "string" || ref.trim().length === 0) {
          findings.push({
            wave: 2,
            severity: "MEDIUM",
            category: "invalid-l0-ref",
            file: entry.slug,
            message: `Empty or invalid l0_ref in ${entry.slug}`,
          });
        }
      }
    }
  } catch (error) {
    logger.warn(`L0 ref check error: ${error}`);
  }

  return findings;
}

/**
 * Check that hub docs list all their sub-documents.
 */
async function checkHubCompleteness(docsDir: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  try {
    const subdirs = await readdir(docsDir, { withFileTypes: true });

    for (const subdir of subdirs) {
      if (!subdir.isDirectory()) continue;
      if (subdir.name === "archive" || subdir.name === "images") continue;

      const hubDir = path.join(docsDir, subdir.name);
      const hubFiles = (await readdir(hubDir)).filter(
        (f) => f.endsWith("-hub.md") || f === "hub.md",
      );

      if (hubFiles.length === 0) continue;

      const hubPath = path.join(hubDir, hubFiles[0]);
      const hubContent = await readFile(hubPath, "utf-8");

      // Count sub-docs in directory (excluding hub, archive)
      const allFiles = (await readdir(hubDir)).filter(
        (f) => f.endsWith(".md") && !f.includes("hub") && f !== "README.md",
      );

      // Check each sub-doc is mentioned in hub
      for (const subDoc of allFiles) {
        const baseName = subDoc.replace(".md", "");
        if (!hubContent.includes(baseName) && !hubContent.includes(subDoc)) {
          findings.push({
            wave: 2,
            severity: "LOW",
            category: "hub-incomplete",
            file: `${subdir.name}/${hubFiles[0]}`,
            message: `Sub-doc "${subDoc}" not referenced in hub`,
          });
        }
      }
    }
  } catch (error) {
    logger.warn(`Hub completeness error: ${error}`);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Wave 3: Upstream
// ---------------------------------------------------------------------------

async function runWave3Upstream(
  options: AuditDocsOptions,
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const docsDir = path.join(options.projectRoot, "docs");
  const cache = new ContentCache({
    projectRoot: options.projectRoot,
    defaultTtlHours: options.cacheTtlHours ?? 24,
  });

  // Scan docs for validate_upstream frontmatter
  const entries = await scanDirectory(docsDir, options.layer);
  let checkedCount = 0;

  for (const entry of entries) {
    const validateUpstream = entry.metadata.validate_upstream as
      | UpstreamValidation[]
      | undefined;
    if (!validateUpstream || validateUpstream.length === 0) continue;

    for (const validation of validateUpstream) {
      checkedCount++;

      // Fetch content (cached or fresh)
      let content: string;
      const cached = await cache.get(validation.url, validation.cache_ttl);

      if (cached) {
        content = cached.content;
      } else {
        const fetchResult = await fetchContent(validation.url);
        if (!fetchResult.ok) {
          findings.push({
            wave: 3,
            severity: "MEDIUM",
            category: "upstream-fetch-error",
            file: entry.slug,
            message: `Could not fetch ${validation.url}: ${fetchResult.error.error}`,
          });
          continue;
        }
        content = fetchResult.data.content;
        await cache.set(fetchResult.data, validation.cache_ttl);
      }

      // Run assertions
      const { findings: assertionFindings } = runAssertions(
        validation,
        content,
        entry.slug,
      );

      // Convert MonitoringFinding to AuditFinding
      for (const af of assertionFindings) {
        findings.push({
          wave: 3,
          severity: af.severity,
          category: af.category,
          file: entry.slug,
          message: af.summary,
        });
      }
    }
  }

  logger.info(`Wave 3: ${checkedCount} upstream validations checked`);
  return findings;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findAllMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

function makeResult(
  options: AuditDocsOptions,
  waves: number[],
  findings: AuditFinding[],
): AuditResult {
  return {
    projectRoot: options.projectRoot,
    layer: options.layer,
    wavesRun: waves,
    findings,
    summary: {
      total: findings.length,
      high: findings.filter((f) => f.severity === "HIGH").length,
      medium: findings.filter((f) => f.severity === "MEDIUM").length,
      low: findings.filter((f) => f.severity === "LOW").length,
    },
    timestamp: new Date().toISOString(),
  };
}
