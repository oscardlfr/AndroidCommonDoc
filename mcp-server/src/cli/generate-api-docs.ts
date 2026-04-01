/* eslint-disable no-console */
/**
 * CLI entrypoint for generate-api-docs.
 *
 * Transforms Dokka HTML/Markdown output into docs/api/ with YAML frontmatter.
 * Delegates to the dokka-to-docs.sh script if available, otherwise performs
 * a minimal transformation directly.
 *
 * Usage:
 *   node build/cli/generate-api-docs.js <project_root>
 *   node build/cli/generate-api-docs.js <project_root> --module core-result
 *   node build/cli/generate-api-docs.js <project_root> --dry-run
 *   node build/cli/generate-api-docs.js <project_root> --validate-only
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { readKDocState, writeKDocState, createEmptyState, updateDocsApi } from "../utils/kdoc-state.js";
import { decodeDokkaName, toDocSlug } from "../utils/dokka-slugs.js";

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error("Usage: node build/cli/generate-api-docs.js <project_root> [options]");
  console.error("");
  console.error("Options:");
  console.error("  --module MODULE     Single module (default: all)");
  console.error("  --input DIR         Dokka output dir (default: build/dokka)");
  console.error("  --output DIR        Output dir (default: docs/api)");
  console.error("  --dry-run           Show what would be generated");
  console.error("  --validate-only     Check if docs/api/ is stale");
  process.exit(args.length === 0 ? 1 : 0);
}

const projectRoot = path.resolve(args[0]);
let moduleName: string | undefined;
// Default: build/dokka/html (Dokka HTML output for KMP)
// Falls back to build/dokka if html/ subdir doesn't exist
let inputDir = path.join(projectRoot, "build", "dokka");
let outputDir = path.join(projectRoot, "docs", "api");
let dryRun = false;
let validateOnly = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--module" && args[i + 1]) { moduleName = args[i + 1]; i++; }
  else if (args[i] === "--input" && args[i + 1]) { inputDir = path.resolve(args[i + 1]); i++; }
  else if (args[i] === "--output" && args[i + 1]) { outputDir = path.resolve(args[i + 1]); i++; }
  else if (args[i] === "--dry-run") { dryRun = true; }
  else if (args[i] === "--validate-only") { validateOnly = true; }
}

// ── Validate-only mode ──────────────────────────────────────────────────────

if (validateOnly) {
  if (!existsSync(outputDir)) {
    console.log(JSON.stringify({ status: "NO_DOCS", message: "docs/api/ does not exist. Run generate-api-docs to create." }));
    process.exit(0);
  }

  // Check generated_at freshness
  const hubFiles = readdirSync(outputDir).filter((f) => f.endsWith("-hub.md"));
  const stale: string[] = [];

  for (const hub of hubFiles) {
    const content = readFileSync(path.join(outputDir, hub), "utf-8");
    const match = content.match(/generated_at:\s*"([^"]+)"/);
    if (match) {
      const generatedAt = new Date(match[1]);
      const ageHours = (Date.now() - generatedAt.getTime()) / 3600000;
      if (ageHours > 24) {
        stale.push(`${hub}: generated ${Math.round(ageHours)}h ago`);
      }
    }
  }

  console.log(JSON.stringify({
    status: stale.length > 0 ? "STALE" : "FRESH",
    hubs: hubFiles.length,
    stale,
  }));
  process.exit(0);
}

// ── Check Dokka output exists ───────────────────────────────────────────────

// Auto-detect: build/dokka/html/ (Dokka HTML) or build/dokka/ (Dokka GFM/Markdown)
if (existsSync(path.join(inputDir, "html"))) {
  inputDir = path.join(inputDir, "html");
}

if (!existsSync(inputDir)) {
  console.log(JSON.stringify({
    status: "NO_DOKKA",
    message: `Dokka output not found at ${inputDir}. Run './gradlew dokkaGenerate' first. This is optional.`,
  }));
  process.exit(0);
}

// ── Transform ───────────────────────────────────────────────────────────────

const generatedAt = new Date().toISOString();
let modulesProcessed = 0;
let docsGenerated = 0;

// For module dirs: convert CamelCase to kebab (core-common stays core-common)
function toKebab(name: string): string {
  return name.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "").replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/-$/, "");
}

function generateFrontmatter(slug: string, mod: string, description: string, isHub: boolean): string {
  const lastUpdated = new Date().toISOString().slice(0, 7);
  return [
    "---",
    `scope: [api, ${mod}]`,
    `sources: [${mod}]`,
    `targets: [all]`,
    `slug: ${slug}`,
    `status: active`,
    `layer: L1`,
    `category: api`,
    `description: "${description}"`,
    `version: 1`,
    `last_updated: "${lastUpdated}"`,
    `generated: true`,
    `generated_from: dokka`,
    `generated_at: "${generatedAt}"`,
    `parent: ${isHub ? "api-hub" : mod + "-api-hub"}`,
    "---",
    "",
  ].join("\n");
}

// Process each module directory in Dokka output
let moduleDirs: string[];
try {
  moduleDirs = readdirSync(inputDir).filter((d) => {
    try { return statSync(path.join(inputDir, d)).isDirectory(); } catch { return false; }
  });
} catch {
  console.log(JSON.stringify({ status: "ERROR", message: `Cannot read ${inputDir}` }));
  process.exit(1);
}

if (moduleName) {
  moduleDirs = moduleDirs.filter((d) => d === moduleName || toKebab(d) === moduleName);
}

for (const mod of moduleDirs) {
  const modDir = path.join(inputDir, mod);
  const modSlug = toKebab(mod);
  const modOutput = path.join(outputDir, modSlug);

  // Collect doc files (.md or .html — Dokka produces HTML for KMP, Markdown for JVM-only)
  const docFiles: string[] = [];
  function walkDocs(dir: string): void {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip scripts/, styles/, images/ (Dokka support files)
          if (!["scripts", "styles", "images"].includes(entry.name)) walkDocs(full);
        } else if (entry.name.endsWith(".html") && entry.name !== "navigation.html" && entry.name !== "index.html") {
          docFiles.push(full);
        } else if (entry.name.endsWith(".md")) {
          docFiles.push(full);
        }
      }
    } catch { /* skip */ }
  }
  walkDocs(modDir);

  // Also include module index.html as the hub source
  const moduleIndex = path.join(modDir, "index.html");
  if (existsSync(moduleIndex) && docFiles.length === 0) {
    // Module only has index — still process it
    docFiles.push(moduleIndex);
  }

  if (docFiles.length === 0) continue;

  if (dryRun) {
    console.log(`[dry-run] ${mod}: ${docFiles.length} docs would be generated`);
    modulesProcessed++;
    docsGenerated += docFiles.length + 1;
    continue;
  }

  mkdirSync(modOutput, { recursive: true });

  // Hub doc
  const hubContent = generateFrontmatter(`${modSlug}-api-hub`, mod, `API documentation hub for ${mod}`, true)
    + `# ${mod} API\n\nAuto-generated from KDoc via Dokka. Run \`/generate-api-docs\` to regenerate.\n\n`
    + `## Sub-documents\n\n| Class/Interface | Description |\n|----------------|-------------|\n`;

  const hubLines = [hubContent];

  // Sub-docs
  for (const docFile of docFiles) {
    const ext = path.extname(docFile);
    const filename = path.basename(docFile, ext);
    const slug = toDocSlug(filename);
    let rawContent = readFileSync(docFile, "utf-8");

    // Convert HTML to simplified Markdown if needed
    if (ext === ".html") {
      // Strip HTML tags but keep text content
      rawContent = rawContent
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
        .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
        .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
        .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n")
        .replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`")
        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, text: string) =>
          `[${text}](${decodeDokkaName(href)})`)
        .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, "\n\n");
    }

    // Strip existing frontmatter
    rawContent = rawContent.replace(/^---[\s\S]*?---\n?/, "");

    // First heading as description (decode filename fallback for Dokka URL-encoding)
    const heading = rawContent.match(/^#\s+(.+)$/m)?.[1] ?? decodeDokkaName(filename);

    // Truncate
    const lines = rawContent.split("\n");
    if (lines.length > 280) {
      rawContent = lines.slice(0, 280).join("\n") + "\n\n> Truncated at 280 lines.";
    }

    const subContent = generateFrontmatter(`${modSlug}-${slug}`, mod, heading, false) + rawContent;
    writeFileSync(path.join(modOutput, `${slug}.md`), subContent, "utf-8");

    hubLines.push(`| [${heading}](${modSlug}/${slug}.md) | ${heading} |`);
    docsGenerated++;
  }

  writeFileSync(path.join(outputDir, `${modSlug}-hub.md`), hubLines.join("\n"), "utf-8");
  modulesProcessed++;
  docsGenerated++; // hub
}

// Persist to kdoc-state.json
if (!dryRun && modulesProcessed > 0) {
  try {
    const state = readKDocState(projectRoot) ?? createEmptyState();
    updateDocsApi(state, moduleDirs);
    writeKDocState(projectRoot, state);
  } catch {
    // Non-fatal
  }
}

console.log(JSON.stringify({
  status: "OK",
  modules_processed: modulesProcessed,
  docs_generated: docsGenerated,
  output: outputDir,
  dry_run: dryRun,
}));
