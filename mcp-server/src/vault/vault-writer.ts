/**
 * Vault file writer with manifest tracking and orphan detection.
 *
 * Handles writing VaultEntry files to the Obsidian vault directory,
 * creating .obsidian/ configuration, managing the sync manifest for
 * incremental sync via content hashing, and detecting orphaned files.
 *
 * Uses node:crypto for SHA-256 hashing (built-in, no dependency).
 */

import { readFile, writeFile, mkdir, unlink, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { VaultEntry, SyncResult, SyncManifest } from "./types.js";

/**
 * Compute a compact SHA-256 hash of content (first 16 hex characters).
 */
export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Detect and migrate old flat vault structure to layer-first.
 *
 * Old structure had patterns/, skills/, projects/ at vault root.
 * New structure uses L0-generic/, L1-ecosystem/, L2-apps/.
 *
 * Per CONTEXT.md: clean slate migration -- remove old content, clear manifest.
 *
 * @param vaultPath - Absolute path to the vault root
 * @returns true if migration was performed, false if no old structure detected
 */
export async function migrateToLayerFirst(vaultPath: string): Promise<boolean> {
  const oldDirs = ["patterns", "skills", "projects"];
  const newSignal = path.join(vaultPath, "L0-generic");

  // Check if new structure already exists (no migration needed)
  try {
    await stat(newSignal);
    return false;
  } catch {
    // L0-generic doesn't exist -- check for old structure
  }

  // Check for old structure signals
  let hasOldStructure = false;
  for (const dir of oldDirs) {
    try {
      await stat(path.join(vaultPath, dir));
      hasOldStructure = true;
      break;
    } catch {
      // Directory doesn't exist
    }
  }

  if (!hasOldStructure) {
    return false;
  }

  // Remove old structure directories (preserve .obsidian/ and _vault-meta/)
  for (const dir of oldDirs) {
    try {
      await rm(path.join(vaultPath, dir), { recursive: true, force: true });
    } catch {
      // Directory may not exist -- ignore
    }
  }

  // Also remove old MOC directory (will be recreated)
  try {
    await rm(path.join(vaultPath, "00-MOC"), { recursive: true, force: true });
  } catch {
    // May not exist
  }

  // Clear manifest (will be rebuilt on sync)
  const emptyManifest: SyncManifest = { lastSync: "", files: {} };
  await saveManifest(vaultPath, emptyManifest);

  return true;
}

/**
 * Generate Obsidian .obsidian/ config files.
 *
 * Returns a map of filename -> JSON string for:
 * - app.json: Core Obsidian settings (wikilink mode enabled)
 * - community-plugins.json: Recommended community plugins
 * - core-plugins.json: Enabled core plugins
 * - graph.json: Graph view color configuration
 */
export function generateObsidianConfig(): Record<string, string> {
  const app = {
    useMarkdownLinks: false,
    showFrontmatter: true,
    readableLineLength: true,
    strictLineBreaks: false,
  };

  const communityPlugins = ["dataview"];

  const corePlugins = [
    "file-explorer",
    "search",
    "graph",
    "backlink",
    "outgoing-link",
    "tag-pane",
    "page-preview",
    "templates",
    "command-palette",
  ];

  // Obsidian uses { a: 1, rgb: <integer> } format where rgb = (r << 16) | (g << 8) | b
  const rgb = (r: number, g: number, b: number) => ({ a: 1, rgb: (r << 16) | (g << 8) | b });

  const graph = {
    colorGroups: [
      // Content type
      { query: 'tag:#moc', color: rgb(255, 215, 0) },
      { query: 'tag:#skill', color: rgb(33, 150, 243) },
      // Category-based (domain coloring)
      { query: 'tag:#category/architecture', color: rgb(156, 39, 176) },
      { query: 'tag:#category/testing', color: rgb(0, 150, 136) },
      { query: 'tag:#category/ui', color: rgb(233, 30, 99) },
      { query: 'tag:#category/error-handling', color: rgb(244, 67, 54) },
      { query: 'tag:#category/compose', color: rgb(103, 58, 183) },
      { query: 'tag:#category/gradle', color: rgb(121, 85, 72) },
      { query: 'tag:#category/navigation', color: rgb(0, 188, 212) },
      { query: 'tag:#category/storage', color: rgb(255, 152, 0) },
      { query: 'tag:#category/security', color: rgb(255, 87, 34) },
      { query: 'tag:#category/oauth', color: rgb(63, 81, 181) },
      { query: 'tag:#category/offline-first', color: rgb(76, 175, 80) },
      { query: 'tag:#category/di', color: rgb(205, 220, 57) },
      { query: 'tag:#category/resources', color: rgb(255, 193, 7) },
      { query: 'tag:#category/guides', color: rgb(158, 158, 158) },
      { query: 'tag:#category/domain', color: rgb(96, 125, 139) },
      { query: 'tag:#category/business', color: rgb(255, 111, 0) },
      { query: 'tag:#category/product', color: rgb(46, 125, 50) },
      { query: 'tag:#category/tech', color: rgb(21, 101, 192) },
      { query: 'tag:#category/legal', color: rgb(78, 52, 46) },
      // Layer fallback
      { query: 'tag:#l0', color: rgb(76, 175, 80) },
      { query: 'tag:#l1 OR tag:#ecosystem', color: rgb(0, 150, 136) },
      { query: 'tag:#l2 OR tag:#app', color: rgb(255, 87, 34) },
    ],
  };

  return {
    "app.json": JSON.stringify(app, null, 2),
    "community-plugins.json": JSON.stringify(communityPlugins, null, 2),
    "core-plugins.json": JSON.stringify(corePlugins, null, 2),
    "graph.json": JSON.stringify(graph, null, 2),
  };
}

/**
 * Load the sync manifest from the vault's _vault-meta/ directory.
 *
 * Returns an empty manifest if the file doesn't exist.
 */
export async function loadManifest(vaultPath: string): Promise<SyncManifest> {
  const manifestPath = path.join(vaultPath, "_vault-meta", "sync-manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SyncManifest>;
    // Defensive: ensure files is always a valid object even if manifest is corrupted
    return {
      lastSync: parsed.lastSync ?? "",
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
    };
  } catch {
    return { lastSync: "", files: {} };
  }
}

/**
 * Save the sync manifest to the vault's _vault-meta/ directory.
 */
export async function saveManifest(
  vaultPath: string,
  manifest: SyncManifest,
): Promise<void> {
  const metaDir = path.join(vaultPath, "_vault-meta");
  await mkdir(metaDir, { recursive: true });
  const manifestPath = path.join(metaDir, "sync-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

/**
 * Detect orphaned files: vault paths in the manifest that are not in
 * the current set of entry paths.
 */
export function detectOrphans(
  manifest: SyncManifest,
  currentPaths: Set<string>,
): string[] {
  return Object.keys(manifest.files).filter((p) => !currentPaths.has(p));
}

/**
 * Write vault entries to disk with manifest-based change detection.
 *
 * 1. Load existing manifest
 * 2. If init: create .obsidian/ config, _vault-meta/README.md
 * 3. For each entry: compute hash, compare manifest, write if changed
 * 4. Build new manifest from all written + unchanged files
 * 5. If clean: detect orphans, delete them
 * 6. Save updated manifest
 * 7. Return SyncResult
 */
export async function writeVault(
  vaultPath: string,
  entries: VaultEntry[],
  options: { init?: boolean; clean?: boolean } = {},
): Promise<SyncResult> {
  const startTime = Date.now();
  let written = 0;
  let unchanged = 0;
  let removed = 0;
  const errors: string[] = [];

  // 0. Check for and run migration from flat to layer-first structure
  await migrateToLayerFirst(vaultPath);

  // 1. Load existing manifest
  const manifest = await loadManifest(vaultPath);

  // 2. Init mode: create .obsidian/ and _vault-meta/README.md
  //    .obsidian/ config only written during init (respects user customizations on sync)
  if (options.init) {
    await writeObsidianConfig(vaultPath);
    await writeVaultMetaReadme(vaultPath);
  }

  // 3. New manifest for this sync run
  const newFiles: SyncManifest["files"] = {};

  // 4. Write each entry
  for (const entry of entries) {
    const entryPath = entry.vaultPath.replace(/\\/g, "/");
    const hash = computeHash(entry.content);

    // Check if content is unchanged
    const existingFile = manifest.files[entryPath];
    if (existingFile && existingFile.hash === hash) {
      unchanged++;
      newFiles[entryPath] = existingFile;
      continue;
    }

    // Write the file
    try {
      const fullPath = path.join(vaultPath, entryPath);
      const dir = path.dirname(fullPath);
      await mkdir(dir, { recursive: true });
      await writeFile(fullPath, entry.content, "utf-8");
      written++;

      newFiles[entryPath] = {
        hash,
        sourceType: entry.sourceType,
        sourcePath: entryPath,
        layer: entry.layer,
      };
    } catch (err) {
      errors.push(
        `Failed to write ${entryPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 5. Clean orphans if requested
  if (options.clean) {
    const currentPaths = new Set(Object.keys(newFiles));
    const orphans = detectOrphans(manifest, currentPaths);
    for (const orphanPath of orphans) {
      try {
        const fullPath = path.join(vaultPath, orphanPath);
        await unlink(fullPath);
        removed++;
      } catch {
        // File may already be deleted -- ignore
      }
    }
  }

  // 6. Save updated manifest
  const newManifest: SyncManifest = {
    lastSync: new Date().toISOString(),
    files: newFiles,
  };
  await saveManifest(vaultPath, newManifest);

  // 7. Return result
  return {
    written,
    unchanged,
    removed,
    errors,
    duration: Date.now() - startTime,
  };
}

/**
 * Write .obsidian/ configuration files to the vault.
 *
 * For graph.json: merges colorGroups into existing Obsidian settings
 * (Obsidian manages graph.json with its own runtime state like zoom,
 * filters, forces — we only inject colorGroups without losing those).
 */
async function writeObsidianConfig(vaultPath: string): Promise<void> {
  const obsidianDir = path.join(vaultPath, ".obsidian");
  await mkdir(obsidianDir, { recursive: true });

  const config = generateObsidianConfig();
  for (const [filename, content] of Object.entries(config)) {
    const filePath = path.join(obsidianDir, filename);

    if (filename === "graph.json") {
      // Merge colorGroups into existing graph.json (preserve Obsidian settings)
      let existing: Record<string, unknown> = {};
      try {
        const raw = await readFile(filePath, "utf-8");
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // File doesn't exist yet — use generated content as-is
      }
      const generated = JSON.parse(content) as Record<string, unknown>;
      existing.colorGroups = generated.colorGroups;
      await writeFile(filePath, JSON.stringify(existing, null, 2), "utf-8");
    } else {
      await writeFile(filePath, content, "utf-8");
    }
  }
}

/**
 * Write _vault-meta/README.md explaining the vault's purpose.
 */
async function writeVaultMetaReadme(vaultPath: string): Promise<void> {
  const metaDir = path.join(vaultPath, "_vault-meta");
  await mkdir(metaDir, { recursive: true });

  const readme = `# KMP Knowledge Vault

This vault is **auto-generated** by AndroidCommonDoc's \`sync-vault\` tool.

## Important

- **Source repos are the source of truth.** Do not edit files in this vault directly -- changes will be overwritten on the next sync.
- **Pattern docs, skills, and project knowledge** are collected from the KMP ecosystem and enriched with Obsidian-flavored frontmatter, wikilinks, and tags.
- **MOC (Map of Content) pages** in \`00-MOC/\` provide navigable index views.
- **Sync manifest** (\`sync-manifest.json\`) tracks file hashes for incremental sync.

## Sync

Run the \`sync-vault\` MCP tool or use the CLI to update this vault:

\`\`\`
# Via MCP tool
sync-vault --mode sync

# Initialize a fresh vault
sync-vault --mode init

# Clean orphaned files
sync-vault --mode clean
\`\`\`

## Learn More

See the [sync-vault skill documentation](https://github.com/user/AndroidCommonDoc/skills/sync-vault/SKILL.md) for full details.
`;

  await writeFile(path.join(metaDir, "README.md"), readme, "utf-8");
}
