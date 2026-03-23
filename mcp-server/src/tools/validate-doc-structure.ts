/**
 * MCP tool: validate-doc-structure
 *
 * Validates that documentation files with `category` frontmatter are
 * placed in the correct subdirectory matching their category. Reports
 * errors for mismatches and warnings for docs missing category fields.
 *
 * Optionally generates a docs/README.md index with subdirectory table.
 *
 * Supports cross-project validation via project-discovery.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../registry/frontmatter.js";
import { discoverProjects } from "../registry/project-discovery.js";
import { getToolkitRoot, getDocsDir } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import type { PatternMetadata, RegistryEntry } from "../registry/types.js";

/** Directories to skip during validation. */
const SKIP_DIRS = new Set(["archive", "images", ".git", "node_modules"]);

/**
 * Approved category vocabulary (9 unified categories).
 * Any category not in this set will be reported as a warning.
 */
export const APPROVED_CATEGORIES = new Set([
  "agents",
  "architecture",
  "compose",
  "data",
  "di",
  "error-handling",
  "gradle",
  "guides",
  "domain",
  "navigation",
  "offline-first",
  "product",
  "resources",
  "security",
  "storage",
  "testing",
  "build",
  "ui",
]);

/**
 * Mapping from subdirectory names to accepted category values.
 *
 * After category consolidation (Phase 14.3), some docs live in
 * subdirectories named after the old category but have frontmatter
 * with the new consolidated category. This map allows both the
 * legacy subdirectory name and the unified category.
 */
export const SUBDIR_TO_CATEGORIES: Record<string, string[]> = {
  architecture: ["architecture", "data", "ui"],
  compose: ["architecture"],
  di: ["architecture"],
  navigation: ["architecture"],
  testing: ["testing"],
  "offline-first": ["data"],
  storage: ["data"],
  resources: ["data"],
  io: ["data"],
  security: ["security"],
  oauth: ["security"],
  "error-handling": ["domain", "ui"],
  gradle: ["build"],
  tech: ["build", "security"],
  guides: ["guides", "testing", "ui"],
  domain: ["domain"],
  firebase: ["domain"],
  foundation: ["architecture"],
  product: ["product"],
  business: ["product"],
  legal: ["product"],
  references: ["product"],
  ui: ["ui"],
};

/** Result of naming validation on a single file. */
export interface NamingResult {
  warnings: string[];
}

/** Result of validating a single docs directory. */
export interface ValidationResult {
  totalFiles: number;
  errors: string[];
  warnings: string[];
}

/** Result of size limit checks on a single document. */
export interface SizeLimitResult {
  errors: string[];
  warnings: string[];
}

/** Result of l0_refs cross-reference validation. */
export interface L0RefResult {
  errors: string[];
}

/** Result of sub-document cross-reference validation. */
export interface SubDocResult {
  errors: string[];
  warnings: string[];
}

/** Result of module README validation. */
export interface ModuleReadmeResult {
  errors: string[];
  warnings: string[];
}

/** Required frontmatter fields for completeness scoring (10 total). */
const COMPLETENESS_FIELDS: Array<keyof PatternMetadata> = [
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
 * Check size limits for a documentation file.
 *
 * Rules:
 * - Absolute max: 500 lines per doc (error)
 * - Hub doc max: 100 lines for docs containing "## Sub-documents" (error)
 * - Section max: 150 lines per ## section (warning)
 * - Archive docs: all size checks skipped
 *
 * @param filepath - Relative filepath (for reporting)
 * @param content - Raw file content
 * @param isArchived - Whether this file is in an archive/ directory
 * @returns Size limit check results with errors and warnings
 */
export function checkSizeLimits(
  filepath: string,
  content: string,
  isArchived: boolean,
): SizeLimitResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (isArchived) {
    return { errors, warnings };
  }

  const lines = content.split("\n");
  const lineCount = lines.length;

  // Absolute max: 500 lines
  if (lineCount > 500) {
    errors.push(
      `${filepath}: ${lineCount} lines exceeds 500-line maximum`,
    );
  }

  // Hub doc max: 100 lines (identified by "## Sub-documents" section)
  const isHub = lines.some((line) => line.trim() === "## Sub-documents");
  if (isHub && lineCount > 100) {
    errors.push(
      `${filepath}: hub doc with ${lineCount} lines exceeds 100-line hub maximum`,
    );
  }

  // Section max: 150 lines per ## section (warning)
  let currentSection: string | null = null;
  let sectionLineCount = 0;

  for (const line of lines) {
    const sectionMatch = line.match(/^## (.+)/);
    if (sectionMatch) {
      // Check previous section
      if (currentSection !== null && sectionLineCount > 150) {
        warnings.push(
          `${filepath}: section "${currentSection}" has ${sectionLineCount} lines, exceeds 150-line recommendation`,
        );
      }
      currentSection = sectionMatch[1].trim();
      sectionLineCount = 0;
    } else if (currentSection !== null) {
      sectionLineCount++;
    }
  }

  // Check the last section
  if (currentSection !== null && sectionLineCount > 150) {
    warnings.push(
      `${filepath}: section "${currentSection}" has ${sectionLineCount} lines, exceeds 150-line recommendation`,
    );
  }

  return { errors, warnings };
}

/**
 * Validate l0_refs cross-references against the L0 slug registry.
 *
 * For each registry entry with l0_refs, verify every referenced slug
 * exists in the provided L0 slug set.
 *
 * @param entries - Registry entries to validate
 * @param l0Slugs - Set of valid L0 slugs
 * @returns Validation errors for unresolvable references
 */
export function validateL0Refs(
  entries: Array<{
    slug: string;
    filepath: string;
    metadata: { l0_refs?: string[] };
  }>,
  l0Slugs: Set<string>,
): L0RefResult {
  const errors: string[] = [];

  for (const entry of entries) {
    const refs = entry.metadata.l0_refs;
    if (!refs || refs.length === 0) continue;

    for (const ref of refs) {
      if (!l0Slugs.has(ref)) {
        errors.push(
          `${entry.slug}: l0_refs contains "${ref}" which is not a valid L0 slug`,
        );
      }
    }
  }

  return { errors };
}

/**
 * Calculate frontmatter completeness score (0-10).
 *
 * Counts how many of the 10 standard frontmatter fields are present
 * and non-empty: scope, sources, targets, slug, status, layer,
 * category, description, version, last_updated.
 *
 * @param metadata - Pattern metadata to score
 * @returns Score from 0 to 10
 */
export function frontmatterCompleteness(
  metadata: Partial<PatternMetadata>,
): number {
  let score = 0;

  for (const field of COMPLETENESS_FIELDS) {
    const value = metadata[field];
    if (value === undefined || value === null) continue;

    // Arrays must be non-empty to count
    if (Array.isArray(value)) {
      if (value.length > 0) score++;
    } else if (typeof value === "string") {
      if (value.length > 0) score++;
    } else {
      // number, other truthy types
      score++;
    }
  }

  return score;
}

/**
 * Required frontmatter fields for module READMEs.
 *
 * - Required (error if missing): category, slug, layer, status
 * - Optional (warning if missing): description, version, last_updated, scope, sources, targets
 */
const MODULE_REQUIRED_FIELDS: Array<keyof PatternMetadata> = [
  "category",
  "slug",
  "layer",
  "status",
];

const MODULE_OPTIONAL_FIELDS: Array<keyof PatternMetadata> = [
  "description",
  "version",
  "last_updated",
];

/**
 * Validate a module README file (e.g., core-foo/README.md).
 *
 * Rules:
 * - 10-field frontmatter completeness: error for missing required (category, slug, layer, status),
 *   warning for missing optional (description, version, last_updated)
 * - l0_refs presence: warn if missing for L1 module READMEs
 * - 300-line limit (sub-doc limit from QUAL-02)
 * - Layer field must equal expected project layer for L1 projects
 *
 * @param filepath - Relative filepath (for reporting)
 * @param content - Raw file content
 * @param projectLayer - Expected project layer ("L0", "L1", "L2")
 * @returns Module README validation results
 */
export function validateModuleReadme(
  filepath: string,
  content: string,
  projectLayer: string,
): ModuleReadmeResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Parse frontmatter
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    errors.push(`${filepath}: no valid frontmatter found`);
    return { errors, warnings };
  }

  const metadata = parsed.data as Partial<PatternMetadata>;

  // Check required fields (error if missing)
  for (const field of MODULE_REQUIRED_FIELDS) {
    const value = metadata[field];
    if (value === undefined || value === null || value === "") {
      errors.push(`${filepath}: missing required field "${field}"`);
    } else if (Array.isArray(value) && value.length === 0) {
      errors.push(`${filepath}: missing required field "${field}"`);
    }
  }

  // Check optional fields (warning if missing)
  for (const field of MODULE_OPTIONAL_FIELDS) {
    const value = metadata[field];
    if (value === undefined || value === null || value === "") {
      warnings.push(`${filepath}: missing optional field "${field}"`);
    } else if (Array.isArray(value) && value.length === 0) {
      warnings.push(`${filepath}: missing optional field "${field}"`);
    }
  }

  // Check l0_refs presence for L1 module READMEs
  if (projectLayer === "L1") {
    const l0Refs = metadata.l0_refs;
    if (!l0Refs || (Array.isArray(l0Refs) && l0Refs.length === 0)) {
      warnings.push(
        `${filepath}: missing l0_refs (L1 module READMEs should reference L0 patterns)`,
      );
    }
  }

  // Check layer field matches expected project layer for L1 projects
  if (projectLayer === "L1" && metadata.layer && metadata.layer !== "L1") {
    errors.push(
      `${filepath}: layer is "${metadata.layer}" but expected "L1" for this L1 module README`,
    );
  }

  // Enforce 300-line limit (sub-doc limit)
  const lineCount = content.split("\n").length;
  if (lineCount > 300) {
    errors.push(
      `${filepath}: ${lineCount} lines exceeds 300-line module README limit`,
    );
  }

  return { errors, warnings };
}

/**
 * Validate that a documentation filename follows lowercase-kebab-case convention.
 *
 * Rules:
 * - Active (non-archive) doc filenames must only contain: a-z, 0-9, -, . (for extension)
 * - Diagram section prefixes like A01- within diagrams/ directories are allowed
 * - UPPERCASE letters, underscores, and spaces are rejected
 * - README.md and LEGEND.md are exempted (conventional names)
 * - Reports as warnings (not errors) to avoid blocking on edge cases
 *
 * @param filename - The basename of the file
 * @param relDir - Relative directory path from docs root
 * @param isArchived - Whether this file is in an archive/ directory
 * @returns Naming validation result with warnings
 */
export function validateNaming(
  filename: string,
  relDir: string,
  isArchived: boolean,
): NamingResult {
  const warnings: string[] = [];

  // Skip archive files
  if (isArchived) {
    return { warnings };
  }

  // Exempt conventional filenames
  if (filename === "README.md" || filename === "LEGEND.md") {
    return { warnings };
  }

  // Allow diagram section prefixes (e.g., A01-system-overview.md) in diagrams/ dirs
  const isDiagramDir = relDir.includes("diagrams");
  if (isDiagramDir) {
    // Diagram files may use uppercase section prefix like A01-, B05- etc.
    const withoutPrefix = filename.replace(/^[A-H]\d{2}-/, "");
    const nameWithoutExt = withoutPrefix.replace(/\.md$/, "");
    if (/^[a-z0-9-]+$/.test(nameWithoutExt)) {
      return { warnings };
    }
  }

  // Check for non-lowercase-kebab-case characters
  const nameWithoutExt = filename.replace(/\.md$/, "");
  if (!/^[a-z0-9-]+$/.test(nameWithoutExt)) {
    const issues: string[] = [];
    if (/[A-Z]/.test(nameWithoutExt)) issues.push("uppercase letters");
    if (/_/.test(nameWithoutExt)) issues.push("underscores");
    if (/\s/.test(nameWithoutExt)) issues.push("spaces");
    warnings.push(
      `${relDir === "." ? "" : relDir + "/"}${filename}: non-lowercase-kebab-case naming (contains ${issues.join(", ")})`,
    );
  }

  return { warnings };
}

/**
 * Validate that a category value is from the approved vocabulary.
 *
 * Approved categories: architecture, testing, data, security, build,
 * guides, domain, product, ui.
 *
 * @param category - The category value from frontmatter
 * @param filename - The filename (for reporting)
 * @returns Warning message if category is not approved, or null
 */
export function validateCategoryVocabulary(
  category: string,
  filename: string,
): string | null {
  if (!APPROVED_CATEGORIES.has(category)) {
    return `${filename}: category "${category}" is not in approved vocabulary (${[...APPROVED_CATEGORIES].join(", ")})`;
  }
  return null;
}

/**
 * Recursively discover all .md files in a docs directory.
 * Skips directories in SKIP_DIRS.
 * Returns objects with absolute filepath and relative subdir path.
 */
async function findDocsFiles(
  docsDir: string,
): Promise<Array<{ filepath: string; relDir: string }>> {
  const results: Array<{ filepath: string; relDir: string }> = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        // Compute relative directory from docsDir
        const relDir = path.relative(docsDir, dir).replace(/\\/g, "/");
        results.push({ filepath: fullPath, relDir: relDir || "." });
      }
    }
  }

  await walk(docsDir);
  return results;
}

/**
 * Validate sub-document cross-references within a docs directory.
 *
 * Checks:
 * 1. Sub-docs with `parent` frontmatter field: parent file must exist and
 *    must list this sub-doc in its "## Sub-documents" section.
 * 2. Hub docs with "## Sub-documents" section: every listed file must exist
 *    on disk with a `parent` field pointing back to this hub.
 * 3. Empty parent fields produce warnings.
 *
 * @param docsDir - Absolute path to the docs/ directory
 * @returns Sub-doc validation results with errors and warnings
 */
export async function validateSubDocRefs(
  docsDir: string,
): Promise<SubDocResult> {
  const files = await findDocsFiles(docsDir);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Phase 1: Build maps of all files, their parent fields, and hub sub-doc listings
  // Map: filename (basename without dir) -> { dir, content, parentField, subDocListings }
  interface DocInfo {
    filepath: string;
    dir: string;
    filename: string;
    parentField: string | undefined;
    subDocListings: string[]; // filenames listed in ## Sub-documents
  }

  const docsByFilename = new Map<string, DocInfo>();

  for (const { filepath } of files) {
    const filename = path.basename(filepath);
    const dir = path.dirname(filepath);

    let raw: string;
    try {
      raw = await readFile(filepath, "utf-8");
    } catch {
      continue;
    }

    const parsed = parseFrontmatter(raw);
    const parentField = parsed?.data.parent as string | undefined;

    // Parse ## Sub-documents section for hub docs
    const subDocListings: string[] = [];
    const lines = raw.split(/\r?\n/);
    let inSubDocSection = false;

    for (const line of lines) {
      if (line.trim() === "## Sub-documents") {
        inSubDocSection = true;
        continue;
      }
      if (inSubDocSection && line.match(/^## /)) {
        // Next section -- stop parsing sub-docs
        break;
      }
      if (inSubDocSection) {
        // Match markdown link patterns like:
        // - **[name](filename.md)**: description
        // - [name](filename.md)
        const linkMatch = line.match(/\[.*?\]\(([^)]+\.md)\)/);
        if (linkMatch) {
          // Extract just the filename (strip relative path like ./ or ../)
          const linkedFile = path.basename(linkMatch[1]);
          subDocListings.push(linkedFile);
        }
      }
    }

    docsByFilename.set(filepath, {
      filepath,
      dir,
      filename,
      parentField,
      subDocListings,
    });
  }

  // Build lookup: filename -> DocInfo[] (there could be same-named files in different dirs,
  // but typically filenames are unique in a docs/ tree; we look up by directory-relative)
  const allDocs = Array.from(docsByFilename.values());

  // Build a set of all filenames for existence checks
  // Map: dir + filename -> DocInfo for quick lookup
  const docByDirAndFilename = new Map<string, DocInfo>();
  for (const doc of allDocs) {
    docByDirAndFilename.set(doc.filepath, doc);
  }

  // Helper: find a doc by filename in the same directory as referrer
  function findDocInDir(dir: string, filename: string): DocInfo | undefined {
    const fullPath = path.join(dir, filename);
    return docByDirAndFilename.get(fullPath);
  }

  // Phase 2: Check sub-docs (files with parent field)
  for (const doc of allDocs) {
    if (doc.parentField === undefined || doc.parentField === null) {
      continue; // No parent field -- standalone doc
    }

    if (doc.parentField === "") {
      warnings.push(
        `${doc.filename}: has empty parent field in frontmatter`,
      );
      continue;
    }

    // Find the parent hub file
    // Parent field is a slug (filename without .md extension)
    const parentFilename = doc.parentField.endsWith(".md")
      ? doc.parentField
      : `${doc.parentField}.md`;

    const parentDoc = findDocInDir(doc.dir, parentFilename);

    if (!parentDoc) {
      errors.push(
        `${doc.filename}: parent "${doc.parentField}" not found (file ${parentFilename} does not exist in ${path.relative(docsDir, doc.dir) || "."})`,
      );
      continue;
    }

    // Check if parent hub lists this sub-doc in its Sub-documents section
    const isListedInParent = parentDoc.subDocListings.includes(doc.filename);
    if (!isListedInParent) {
      errors.push(
        `${doc.filename}: has parent "${doc.parentField}" but is not listed in ${parentDoc.filename}'s Sub-documents section`,
      );
    }
  }

  // Phase 3: Check hub docs (files with ## Sub-documents section)
  for (const doc of allDocs) {
    if (doc.subDocListings.length === 0) {
      continue; // Not a hub doc
    }

    for (const listedFilename of doc.subDocListings) {
      const subDoc = findDocInDir(doc.dir, listedFilename);

      if (!subDoc) {
        errors.push(
          `${doc.filename}: Sub-documents lists "${listedFilename}" but file not found in ${path.relative(docsDir, doc.dir) || "."}`,
        );
        continue;
      }

      // Check if sub-doc's parent field points back to this hub
      const expectedParent = doc.filename.replace(/\.md$/, "");
      if (
        subDoc.parentField !== expectedParent &&
        subDoc.parentField !== doc.filename
      ) {
        if (!subDoc.parentField) {
          errors.push(
            `${listedFilename}: listed in ${doc.filename}'s Sub-documents but has no parent field`,
          );
        } else {
          errors.push(
            `${listedFilename}: parent is "${subDoc.parentField}" but is listed in ${doc.filename}'s Sub-documents (expected parent: "${expectedParent}")`,
          );
        }
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validate all docs in a directory for category-subdirectory alignment.
 *
 * Rules:
 * - Doc with `category` field MUST be in a subdirectory matching category name
 * - Doc with `category` at root level (not in subdir) is an error
 * - Doc without `category` field gets a warning (opt-in validation)
 * - Archive/ directories are skipped entirely
 *
 * @param docsDir - Absolute path to the docs/ directory
 * @returns Validation result with file count, errors, and warnings
 */
export async function validateDocsDirectory(
  docsDir: string,
): Promise<ValidationResult> {
  const files = await findDocsFiles(docsDir);
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { filepath, relDir } of files) {
    const filename = path.basename(filepath);
    const isArchived = relDir.includes("archive");

    // Naming validation (warning for non-lowercase-kebab-case)
    const namingResult = validateNaming(filename, relDir, isArchived);
    warnings.push(...namingResult.warnings);

    let raw: string;
    try {
      raw = await readFile(filepath, "utf-8");
    } catch {
      warnings.push(`Could not read: ${filename}`);
      continue;
    }

    const parsed = parseFrontmatter(raw);
    if (!parsed) {
      // No valid frontmatter -- skip (not a pattern doc)
      continue;
    }

    const category = parsed.data.category as string | undefined;

    if (!category) {
      warnings.push(`${filename}: no category field in frontmatter`);
      continue;
    }

    // Category vocabulary validation (warning for non-approved categories)
    const vocabWarning = validateCategoryVocabulary(category, filename);
    if (vocabWarning) {
      warnings.push(vocabWarning);
    }

    // Check if file is at root level (relDir === ".")
    // README.md at docs root is the index file -- exempt from category-directory rule
    if (relDir === "." && filename !== "README.md") {
      errors.push(
        `${filename}: has category "${category}" but is at docs root (should be in docs/${category}/)`,
      );
      continue;
    }
    if (relDir === "." && filename === "README.md") {
      continue;
    }

    // Check if the subdirectory matches the category
    // relDir could be nested (e.g., "testing/sub") -- use the first segment
    const topDir = relDir.split("/")[0];
    // Accept both exact match and consolidated category mapping
    const acceptedCategories = SUBDIR_TO_CATEGORIES[topDir] ?? [topDir];
    if (topDir !== category && !acceptedCategories.includes(category)) {
      errors.push(
        `${filename}: category "${category}" but found in "${topDir}/" (expected one of: ${acceptedCategories.join(", ")})`,
      );
    }
  }

  return {
    totalFiles: files.length,
    errors,
    warnings,
  };
}

/**
 * Generate a README.md index for a docs directory.
 *
 * Scans subdirectories, counts files per directory, and produces
 * a markdown README optimized for AI agent consumption.
 *
 * @param docsDir - Absolute path to the docs/ directory
 * @param projectName - Name of the project
 * @param description - Brief project description
 * @returns README.md content as a string
 */
export async function generateReadmeIndex(
  docsDir: string,
  projectName: string,
  description: string,
): Promise<string> {
  // Discover subdirectories and their file counts
  const subdirs: Array<{ name: string; count: number; files: string[] }> = [];

  let entries;
  try {
    entries = await readdir(docsDir, { withFileTypes: true });
  } catch {
    return `# ${projectName}\n\n${description}\n\nNo docs directory found.\n`;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const subPath = path.join(docsDir, entry.name);
    const files = await findDocsFiles(subPath);
    const fileNames = files.map((f) => path.basename(f.filepath));

    subdirs.push({
      name: entry.name,
      count: files.length,
      files: fileNames,
    });
  }

  // Build README content
  const lines: string[] = [];
  lines.push(`# ${projectName}`);
  lines.push("");
  lines.push(description);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Documentation Index");
  lines.push("");
  lines.push("| Directory | Files | Contents |");
  lines.push("|-----------|------:|----------|");

  for (const sub of subdirs) {
    const fileList = sub.files.map((f) => f.replace(/\.md$/, "")).join(", ");
    lines.push(`| ${sub.name}/ | ${sub.count} | ${fileList} |`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Classification System");
  lines.push("");
  lines.push(
    "Each documentation file includes a `category` field in its YAML frontmatter that determines its subdirectory placement. The category vocabulary is not hardcoded -- any category value is valid as long as the file resides in a matching subdirectory.",
  );
  lines.push("");
  lines.push("### Frontmatter Example");
  lines.push("");
  lines.push("```yaml");
  lines.push("---");
  lines.push("scope: [testing, coroutines]");
  lines.push("category: testing");
  lines.push("---");
  lines.push("```");
  lines.push("");
  lines.push("### Validation");
  lines.push("");
  lines.push(
    "Run `validate-doc-structure` via MCP to check category-subdirectory alignment across all projects.",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("*Auto-generated by validate-doc-structure*");
  lines.push("");

  return lines.join("\n");
}

/**
 * Probe a list of monitor_urls entries for reachability using Node fetch.
 * Samples up to maxSample URLs, preferring lower tier values.
 * Returns results sorted by tier.
 */
export interface UrlCheckResult {
  url: string;
  source_doc: string;
  tier: number;
  reachable: boolean;
  status_code?: number;
  error?: string;
}

export async function checkMonitorUrls(
  docsDir: string,
  maxSample = 5,
  fetchFn: typeof fetch = fetch,
): Promise<UrlCheckResult[]> {
  // Collect all monitor_url entries across docs
  const entries: Array<{ url: string; source_doc: string; tier: number }> = [];
  const seenDomains = new Set<string>();

  async function collectUrls(dir: string): Promise<void> {
    let items: string[];
    try {
      items = await readdir(dir);
    } catch {
      return;
    }
    for (const item of items) {
      const full = path.join(dir, item);
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (!SKIP_DIRS.has(item)) await collectUrls(full);
        continue;
      }
      if (!item.endsWith(".md")) continue;
      let content: string;
      try {
        content = await readFile(full, "utf-8");
      } catch {
        continue;
      }
      const meta = parseFrontmatter(content);
      if (!meta) continue;
      const monitorUrls = (meta.data as { monitor_urls?: Array<{ url: string; tier?: number }> }).monitor_urls;
      if (!Array.isArray(monitorUrls)) continue;
      const relPath = path.relative(docsDir, full);
      for (const entry of monitorUrls) {
        if (typeof entry.url !== "string") continue;
        const tier = typeof entry.tier === "number" ? entry.tier : 3;
        entries.push({ url: entry.url, source_doc: relPath, tier });
      }
    }
  }

  await collectUrls(docsDir);

  // Sort by tier ascending (tier 1 = highest priority)
  entries.sort((a, b) => a.tier - b.tier);

  // Sample: one URL per domain, up to maxSample
  const sampled: typeof entries = [];
  for (const entry of entries) {
    if (sampled.length >= maxSample) break;
    let domain: string;
    try {
      domain = new URL(entry.url).hostname;
    } catch {
      continue;
    }
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    sampled.push(entry);
  }

  // Probe each URL
  const results: UrlCheckResult[] = [];
  for (const entry of sampled) {
    let reachable = false;
    let status_code: number | undefined;
    let error: string | undefined;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetchFn(entry.url, {
        method: "HEAD",
        signal: controller.signal,
        headers: { "User-Agent": "AndroidCommonDoc-monitor/1.0" },
        redirect: "follow",
      });
      clearTimeout(timeout);
      status_code = resp.status;
      reachable = resp.status < 400;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    results.push({ ...entry, reachable, status_code, error });
  }

  return results;
}

/**
 * Register the validate-doc-structure MCP tool.
 */
export function registerValidateDocStructureTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-doc-structure",
    {
      title: "Validate Doc Structure",
      description:
        "Validates that docs with `category` frontmatter are in the correct subdirectory. Reports mismatches as errors and missing category fields as warnings. Optionally generates docs/README.md index.",
      inputSchema: z.object({
        project: z
          .string()
          .optional()
          .describe(
            "Specific project name, or omit for all discovered projects",
          ),
        generate_index: z
          .boolean()
          .optional()
          .default(false)
          .describe("Generate/update docs/README.md index file"),
        live_url_check: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Probe a sample of monitor_urls for reachability using HTTP HEAD requests. Adds url_check results to the response. Use when you want to verify links are not stale.",
          ),
      }),
    },
    async ({ project, generate_index, live_url_check }) => {
      const rateLimitResponse = checkRateLimit(
        limiter,
        "validate-doc-structure",
      );
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const toolkitRoot = getToolkitRoot();
        const projectResults: Array<{
          name: string;
          docsDir: string;
          totalFiles: number;
          errors: string[];
          warnings: string[];
        }> = [];

        // Always include AndroidCommonDoc (L0)
        const toolkitDocsDir = getDocsDir();
        const toolkitName = path.basename(toolkitRoot);

        const shouldInclude = (name: string): boolean =>
          !project || name.toLowerCase() === project.toLowerCase();

        if (shouldInclude(toolkitName) || shouldInclude("AndroidCommonDoc")) {
          const result = await validateDocsDirectory(toolkitDocsDir);
          projectResults.push({
            name: toolkitName,
            docsDir: toolkitDocsDir,
            ...result,
          });

          if (generate_index) {
            const readme = await generateReadmeIndex(
              toolkitDocsDir,
              "AndroidCommonDoc L0",
              "Generic KMP patterns and guides for AI agent consumption.",
            );
            await writeFile(path.join(toolkitDocsDir, "README.md"), readme);
            logger.info("Generated docs/README.md for AndroidCommonDoc");
          }
        }

        // Discover consumer projects
        const discovered = await discoverProjects();
        for (const proj of discovered) {
          if (!shouldInclude(proj.name)) continue;

          const projDocsDir = path.join(proj.path, "docs");
          try {
            const s = await stat(projDocsDir);
            if (!s.isDirectory()) continue;
          } catch {
            continue;
          }

          const result = await validateDocsDirectory(projDocsDir);
          projectResults.push({
            name: proj.name,
            docsDir: projDocsDir,
            ...result,
          });

          if (generate_index) {
            const readme = await generateReadmeIndex(
              projDocsDir,
              proj.name,
              `Documentation for ${proj.name}.`,
            );
            await writeFile(path.join(projDocsDir, "README.md"), readme);
            logger.info(`Generated docs/README.md for ${proj.name}`);
          }
        }

        const totalErrors = projectResults.reduce(
          (sum, r) => sum + r.errors.length,
          0,
        );
        const totalWarnings = projectResults.reduce(
          (sum, r) => sum + r.warnings.length,
          0,
        );

        // Optional: live URL reachability check
        let urlCheckResults: UrlCheckResult[] | undefined;
        if (live_url_check) {
          logger.info("Running live URL reachability check on monitor_urls…");
          try {
            const targetDocsDir = project
              ? projectResults.find(r => r.name.toLowerCase() === project.toLowerCase())?.docsDir ?? getDocsDir()
              : getDocsDir();
            urlCheckResults = await checkMonitorUrls(targetDocsDir, 5);
            const unreachable = urlCheckResults.filter(r => !r.reachable);
            if (unreachable.length > 0) {
              logger.info(`URL check: ${unreachable.length} unreachable URL(s) found`);
            }
          } catch (err) {
            logger.error(`URL check failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const response: Record<string, unknown> = {
          projects: projectResults,
          summary: {
            totalErrors,
            totalWarnings,
          },
        };

        if (urlCheckResults !== undefined) {
          const unreachable = urlCheckResults.filter(r => !r.reachable);
          response.url_checks = {
            sampled: urlCheckResults.length,
            unreachable: unreachable.length,
            results: urlCheckResults,
          };
          if (unreachable.length > 0) {
            (response.summary as Record<string, unknown>).urlWarnings = unreachable.length;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.error(`validate-doc-structure error: ${message}`);
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
