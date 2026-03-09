/**
 * Doc-structure integration tests.
 *
 * End-to-end verification of the docs subdirectory reorganization.
 *
 * Verifies:
 * - Scanner discovers all docs from subdirectory structure
 * - Every discovered doc has a category field in metadata
 * - No docs with scope/sources/targets exist at docs/ root
 * - find-pattern with category filter returns correct results
 * - L1 and L2 docs are discoverable via scanDirectory (if projects present)
 * - validate-doc-structure reports zero errors
 *
 * L1/L2 tests are skipped automatically when sibling project directories
 * are not found on disk. Configure via L1_PATH / L2_PATH env vars or
 * place sibling projects in the parent directory of AndroidCommonDoc.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { scanDirectory } from "../../src/registry/scanner.js";
import {
  validateDocsDirectory,
  checkSizeLimits,
  validateL0Refs,
  frontmatterCompleteness,
} from "../../src/tools/validate-doc-structure.js";
import { getDocsDir, getToolkitRoot } from "../../src/utils/paths.js";
import path from "node:path";
import { stat, readFile } from "node:fs/promises";

interface FindPatternResult {
  query: string;
  matches: Array<{
    slug: string;
    description?: string;
    scope: string[];
    sources: string[];
    targets: string[];
    layer: string;
    category?: string;
    uri: string;
    content?: string;
  }>;
  total: number;
  project_filter: string | null;
}

interface ValidateResult {
  projects: Array<{
    name: string;
    docsDir: string;
    totalFiles: number;
    errors: string[];
    warnings: string[];
  }>;
  summary: {
    totalErrors: number;
    totalWarnings: number;
  };
}

/**
 * Resolve sibling project docs directory from toolkit root.
/**
 * Resolve the docs directory for a sibling project.
 * Checks L1_PATH / L2_PATH env vars first, then falls back to sibling directory convention.
 * Returns null if the directory does not exist.
 */
async function resolveSiblingDocsDir(
  projectName: string,
): Promise<string | null> {
  // Check env var overrides
  const envKey = projectName === "shared-libs" ? "L1_PATH" : "L2_PATH";
  const envPath = process.env[envKey];
  if (envPath) {
    const envDocsDir = path.join(envPath, "docs");
    try {
      const s = await stat(envDocsDir);
      if (s.isDirectory()) return envDocsDir;
    } catch {
      // Env path not valid
    }
  }
  const toolkitRoot = getToolkitRoot();
  const parentDir = path.dirname(toolkitRoot);
  const docsDir = path.join(parentDir, projectName, "docs");
  try {
    const s = await stat(docsDir);
    if (s.isDirectory()) return docsDir;
  } catch {
    // Directory does not exist
  }
  return null;
}

describe("doc-structure integration", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({
      name: "doc-structure-test-client",
      version: "1.0.0",
    });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  // -------------------------------------------------------------------
  // 1. L0 Scanner discovers all docs from subdirectories
  // -------------------------------------------------------------------
  describe("L0 scanner discovery", () => {
    it("scanDirectory on AndroidCommonDoc docs/ discovers 40+ docs from subdirectories", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");
      // 42 docs total, archive excluded, README.md has no frontmatter
      expect(entries.length).toBeGreaterThanOrEqual(40);
    });

    it("every discovered L0 doc has a category field in metadata", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");

      const missingCategory = entries.filter(
        (e) => !e.metadata.category,
      );

      expect(missingCategory).toHaveLength(0);
    });

    it("no docs with scope/sources/targets exist at docs/ root (all in subdirectories)", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");

      for (const entry of entries) {
        const relPath = path.relative(docsDir, entry.filepath);
        const parts = relPath.split(path.sep);
        // Every doc should be in at least one subdirectory (parts.length > 1)
        expect(parts.length).toBeGreaterThan(1);
      }
    });
  });

  // -------------------------------------------------------------------
  // 2. find-pattern with category filter
  // -------------------------------------------------------------------
  describe("find-pattern category filter", () => {
    it("find-pattern with category='testing' returns only testing-related docs", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "testing", category: "testing" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      expect(parsed.matches.length).toBeGreaterThan(0);

      // Every match must have category === "testing"
      for (const match of parsed.matches) {
        expect(match.category?.toLowerCase()).toBe("testing");
      }
    });

    it("find-pattern with category='architecture' returns architecture docs", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "architecture", category: "architecture" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      expect(parsed.matches.length).toBeGreaterThan(0);

      for (const match of parsed.matches) {
        expect(match.category?.toLowerCase()).toBe("architecture");
      }
    });

    it("find-pattern category filter is case-insensitive", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "testing", category: "TESTING" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      expect(parsed.matches.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------
  // 3. L1 and L2 docs discoverable via scanDirectory
  // -------------------------------------------------------------------
  describe("cross-project discovery", () => {
    it("L1 shared-libs docs are discoverable via scanDirectory", async () => {
      const sharedDocsDir = await resolveSiblingDocsDir("shared-libs");
      if (!sharedDocsDir) { console.log("Skipping: L1 sibling directory not found"); return; }

      const entries = await scanDirectory(
        sharedDocsDir!,
        "L1",
        "shared-libs",
      );

      // shared-libs has ~17 docs with full pattern metadata (scope/sources/targets)
      // Not all 27 files have complete frontmatter, but discoverable ones do
      expect(entries.length).toBeGreaterThanOrEqual(15);

      // Every discovered doc should have a category field
      const withCategory = entries.filter((e) => e.metadata.category);
      expect(withCategory.length).toBe(entries.length);
    });

    it("L2 my-app docs directory exists and is scannable", async () => {
      const appDocsDir = await resolveSiblingDocsDir("my-app");
      if (!appDocsDir) { console.log("Skipping: L2 sibling directory not found"); return; }

      // my-app L2 docs use category-only frontmatter (no scope/sources/targets)
      // so scanDirectory (which requires scope/sources/targets) returns fewer entries.
      // validate-doc-structure handles category validation for these docs.
      const entries = await scanDirectory(
        appDocsDir!,
        "L2",
        "my-app",
      );

      // Scanner returns entries only for files with scope/sources/targets
      // my-app L2 docs may have minimal frontmatter (category only)
      expect(Array.isArray(entries)).toBe(true);
    });

    it("all discovered L1 shared-libs docs have category field", async () => {
      const sharedDocsDir = await resolveSiblingDocsDir("shared-libs");
      if (!sharedDocsDir) { console.log("Skipping: L1 sibling directory not found"); return; }

      const entries = await scanDirectory(
        sharedDocsDir!,
        "L1",
        "shared-libs",
      );

      for (const entry of entries) {
        expect(entry.metadata.category).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------
  // 4. validate-doc-structure cross-project validation
  // -------------------------------------------------------------------
  describe("validate-doc-structure", () => {
    it("L0 AndroidCommonDoc validates with zero errors", async () => {
      const docsDir = getDocsDir();
      const result = await validateDocsDirectory(docsDir);

      expect(result.errors).toHaveLength(0);
      expect(result.totalFiles).toBeGreaterThanOrEqual(40);
    });

    it("L1 shared-libs validates with zero errors", async () => {
      const sharedDocsDir = await resolveSiblingDocsDir("shared-libs");
      if (!sharedDocsDir) { console.log("Skipping: L1 sibling directory not found"); return; }

      const result = await validateDocsDirectory(sharedDocsDir!);

      expect(result.errors).toHaveLength(0);
    });

    it("L2 my-app validates with zero errors", async () => {
      const appDocsDir = await resolveSiblingDocsDir("my-app");
      if (!appDocsDir) { console.log("Skipping: L2 sibling directory not found"); return; }

      const result = await validateDocsDirectory(appDocsDir!);

      expect(result.errors).toHaveLength(0);
    });

    it("validate-doc-structure MCP tool returns zero errors for L0", async () => {
      const result = await client.callTool({
        name: "validate-doc-structure",
        arguments: { project: "AndroidCommonDoc" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as ValidateResult;

      expect(parsed.summary.totalErrors).toBe(0);
      expect(parsed.projects.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------
  // 5. Scanner backward compatibility (flat structures without subdirs)
  // -------------------------------------------------------------------
  describe("scanner backward compatibility", () => {
    it("scanner works on projects that may have flat docs/ with no subdirectories", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    });

    it("scanner handles non-existent directory gracefully", async () => {
      const entries = await scanDirectory(
        "/non/existent/path/docs",
        "L0",
      );
      expect(entries).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // 6. Quality checks on actual L0 docs (Phase 14.2)
  // -------------------------------------------------------------------
  describe("L0 docs quality checks", () => {
    it("no L0 doc exceeds the 500-line absolute maximum", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");

      for (const entry of entries) {
        const content = await readFile(entry.filepath, "utf-8");
        const result = checkSizeLimits(
          path.relative(docsDir, entry.filepath),
          content,
          false,
        );

        expect(
          result.errors.filter((e) => e.includes("500")),
        ).toHaveLength(0);
      }
    });

    it("all L0 hub docs are under 100 lines", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");

      const hubErrors: string[] = [];
      for (const entry of entries) {
        const content = await readFile(entry.filepath, "utf-8");
        const result = checkSizeLimits(
          path.relative(docsDir, entry.filepath),
          content,
          false,
        );

        hubErrors.push(
          ...result.errors.filter((e) => e.includes("hub")),
        );
      }

      // After Phase 14.2, all hub docs should be under 100 lines
      expect(hubErrors).toHaveLength(0);
    });

    it("all L0 sub-docs are under 300 lines", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");

      for (const entry of entries) {
        const content = await readFile(entry.filepath, "utf-8");
        const lineCount = content.split("\n").length;
        // Sub-docs have parent field; check they stay under 300
        if (entry.metadata.parent) {
          expect(lineCount).toBeLessThanOrEqual(300);
        }
      }
    });

    it("every L0 doc has a frontmatter completeness score of at least 3", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");

      for (const entry of entries) {
        const score = frontmatterCompleteness(entry.metadata);
        // Minimum: scope, sources, targets (3/10)
        expect(score).toBeGreaterThanOrEqual(3);
      }
    });

    it("l0_refs on L0 entries (if any) resolve to valid L0 slugs", async () => {
      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");
      const l0Slugs = new Set(entries.map((e) => e.slug));

      const result = validateL0Refs(entries, l0Slugs);

      expect(result.errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------
  // 7. Phase 14.2 cross-layer quality: L1 docs
  // -------------------------------------------------------------------
  describe("L1 docs quality checks (Phase 14.2)", () => {
    it("all active L1 docs pass size checks (no doc over 500 lines)", async () => {
      const sharedDocsDir = await resolveSiblingDocsDir("shared-libs");
      if (!sharedDocsDir) { console.log("Skipping: L1 sibling directory not found"); return; }

      const entries = await scanDirectory(sharedDocsDir!, "L1", "shared-libs");

      for (const entry of entries) {
        const content = await readFile(entry.filepath, "utf-8");
        const result = checkSizeLimits(
          path.relative(sharedDocsDir!, entry.filepath),
          content,
          false,
        );

        expect(
          result.errors.filter((e) => e.includes("500")),
          `L1 doc exceeds 500 lines: ${entry.slug}`,
        ).toHaveLength(0);
      }
    });

    it("all L1 hub docs are under 100 lines", async () => {
      const sharedDocsDir = await resolveSiblingDocsDir("shared-libs");
      if (!sharedDocsDir) { console.log("Skipping: L1 sibling directory not found"); return; }

      const entries = await scanDirectory(sharedDocsDir!, "L1", "shared-libs");

      const hubErrors: string[] = [];
      for (const entry of entries) {
        const content = await readFile(entry.filepath, "utf-8");
        const result = checkSizeLimits(
          path.relative(sharedDocsDir!, entry.filepath),
          content,
          false,
        );
        hubErrors.push(
          ...result.errors.filter((e) => e.includes("hub")),
        );
      }

      expect(hubErrors).toHaveLength(0);
    });

    it("l0_refs in L1 docs resolve to valid L0 slugs", async () => {
      const docsDir = getDocsDir();
      const l0Entries = await scanDirectory(docsDir, "L0");
      const l0Slugs = new Set(l0Entries.map((e) => e.slug));

      const sharedDocsDir = await resolveSiblingDocsDir("shared-libs");
      if (!sharedDocsDir) { console.log("Skipping: L1 sibling directory not found"); return; }

      const l1Entries = await scanDirectory(sharedDocsDir!, "L1", "shared-libs");

      const result = validateL0Refs(l1Entries, l0Slugs);

      expect(result.errors).toHaveLength(0);
    });

    it("all L1 docs have frontmatter completeness score of 10/10", async () => {
      const sharedDocsDir = await resolveSiblingDocsDir("shared-libs");
      if (!sharedDocsDir) { console.log("Skipping: L1 sibling directory not found"); return; }

      const entries = await scanDirectory(sharedDocsDir!, "L1", "shared-libs");

      for (const entry of entries) {
        const score = frontmatterCompleteness(entry.metadata);
        expect(score).toBe(10);
      }
    });
  });

  // -------------------------------------------------------------------
  // 8. Phase 14.2 cross-layer quality: L2 my-app docs
  // -------------------------------------------------------------------
  describe("L2 my-app docs quality checks (Phase 14.2)", () => {
    it("all active L2 non-diagram docs pass size checks (no doc over 500 lines)", async () => {
      const appDocsDir = await resolveSiblingDocsDir("my-app");
      if (!appDocsDir) { console.log("Skipping: L2 sibling directory not found"); return; }

      const entries = await scanDirectory(appDocsDir!, "L2", "my-app");

      // Exclude diagrams (files under architecture/diagrams/) from size checks
      const nonDiagramEntries = entries.filter(
        (e) => !e.filepath.replace(/\\/g, "/").includes("/diagrams/"),
      );

      for (const entry of nonDiagramEntries) {
        const content = await readFile(entry.filepath, "utf-8");
        const result = checkSizeLimits(
          path.relative(appDocsDir!, entry.filepath),
          content,
          false,
        );

        expect(
          result.errors.filter((e) => e.includes("500")),
          `L2 doc exceeds 500 lines: ${entry.slug}`,
        ).toHaveLength(0);
      }
    });

    it("l0_refs in L2 docs resolve to valid L0 slugs", async () => {
      const docsDir = getDocsDir();
      const l0Entries = await scanDirectory(docsDir, "L0");
      const l0Slugs = new Set(l0Entries.map((e) => e.slug));

      const appDocsDir = await resolveSiblingDocsDir("my-app");
      if (!appDocsDir) { console.log("Skipping: L2 sibling directory not found"); return; }

      const l2Entries = await scanDirectory(appDocsDir!, "L2", "my-app");

      const result = validateL0Refs(l2Entries, l0Slugs);

      expect(result.errors).toHaveLength(0);
    });

    it("L2 non-diagram docs with scope have frontmatter completeness score of 10/10", async () => {
      const appDocsDir = await resolveSiblingDocsDir("my-app");
      if (!appDocsDir) { console.log("Skipping: L2 sibling directory not found"); return; }

      const entries = await scanDirectory(appDocsDir!, "L2", "my-app");

      // Exclude diagrams from completeness check
      const nonDiagramEntries = entries.filter(
        (e) => !e.filepath.replace(/\\/g, "/").includes("/diagrams/"),
      );

      for (const entry of nonDiagramEntries) {
        const score = frontmatterCompleteness(entry.metadata);
        expect(score).toBe(10);
      }
    });

    it("no active doc across any project exceeds 500 lines", async () => {
      // L0
      const docsDir = getDocsDir();
      const l0Entries = await scanDirectory(docsDir, "L0");
      for (const entry of l0Entries) {
        const content = await readFile(entry.filepath, "utf-8");
        expect(content.split("\n").length).toBeLessThanOrEqual(500);
      }

      // L1
      const sharedDocsDir = await resolveSiblingDocsDir("shared-libs");
      if (sharedDocsDir) {
        const l1Entries = await scanDirectory(sharedDocsDir, "L1", "shared-libs");
        for (const entry of l1Entries) {
          const content = await readFile(entry.filepath, "utf-8");
          expect(content.split("\n").length).toBeLessThanOrEqual(500);
        }
      }

      // L2 (non-diagram)
      const appDocsDir = await resolveSiblingDocsDir("my-app");
      if (appDocsDir) {
        const l2Entries = await scanDirectory(appDocsDir, "L2", "my-app");
        const nonDiagram = l2Entries.filter(
          (e) => !e.filepath.replace(/\\/g, "/").includes("/diagrams/"),
        );
        for (const entry of nonDiagram) {
          const content = await readFile(entry.filepath, "utf-8");
          expect(content.split("\n").length).toBeLessThanOrEqual(500);
        }
      }
    });
  });
});
