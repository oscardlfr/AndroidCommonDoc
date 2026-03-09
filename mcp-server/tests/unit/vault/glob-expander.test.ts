import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expandGlobs } from "../../../src/vault/glob-expander.js";

describe("glob-expander", () => {
  let tmpDir: string;

  async function makeTmpDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "glob-test-"));
    return tmpDir;
  }

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper: create a file (and its parent dirs) inside the temp tree.
   */
  async function createFile(relativePath: string, content = "# doc\n") {
    const fullPath = path.join(tmpDir, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  describe("expandGlobs", () => {
    it("literal pattern 'CLAUDE.md' matches only root CLAUDE.md", async () => {
      await makeTmpDir();
      await createFile("CLAUDE.md");
      await createFile("docs/CLAUDE.md");

      const results = await expandGlobs(tmpDir, ["CLAUDE.md"], []);

      expect(results).toHaveLength(1);
      expect(results[0].relativePath).toBe("CLAUDE.md");
    });

    it("wildcard 'docs/*.md' matches docs/foo.md but not docs/sub/bar.md", async () => {
      await makeTmpDir();
      await createFile("docs/foo.md");
      await createFile("docs/sub/bar.md");

      const results = await expandGlobs(tmpDir, ["docs/*.md"], []);

      const relativePaths = results.map((r) => r.relativePath);
      expect(relativePaths).toContain("docs/foo.md");
      expect(relativePaths).not.toContain("docs/sub/bar.md");
    });

    it("double-star 'docs/**/*.md' matches nested files at any depth", async () => {
      await makeTmpDir();
      await createFile("docs/foo.md");
      await createFile("docs/sub/bar.md");
      await createFile("docs/sub/deep/baz.md");

      const results = await expandGlobs(tmpDir, ["docs/**/*.md"], []);

      const relativePaths = results.map((r) => r.relativePath);
      expect(relativePaths).toContain("docs/foo.md");
      expect(relativePaths).toContain("docs/sub/bar.md");
      expect(relativePaths).toContain("docs/sub/deep/baz.md");
    });

    it("exclude patterns filter out matching files", async () => {
      await makeTmpDir();
      await createFile("docs/good.md");
      await createFile("build/generated.md");
      await createFile("docs/build/deep.md");

      // Include everything, exclude build dirs
      const results = await expandGlobs(
        tmpDir,
        ["**/*.md"],
        ["**/build/**"],
      );

      const relativePaths = results.map((r) => r.relativePath);
      expect(relativePaths).toContain("docs/good.md");
      expect(relativePaths).not.toContain("docs/build/deep.md");
    });

    it("multiple include globs combine results with deduplication", async () => {
      await makeTmpDir();
      await createFile("CLAUDE.md");
      await createFile("docs/foo.md");

      const results = await expandGlobs(
        tmpDir,
        ["CLAUDE.md", "docs/*.md", "CLAUDE.md"],
        [],
      );

      const relativePaths = results.map((r) => r.relativePath);
      expect(relativePaths).toContain("CLAUDE.md");
      expect(relativePaths).toContain("docs/foo.md");
      // CLAUDE.md only appears once (deduplicated)
      expect(relativePaths.filter((p) => p === "CLAUDE.md")).toHaveLength(1);
    });

    it("empty include globs returns empty array", async () => {
      await makeTmpDir();
      await createFile("docs/foo.md");

      const results = await expandGlobs(tmpDir, [], []);

      expect(results).toEqual([]);
    });

    it("non-existent directory returns empty array", async () => {
      const results = await expandGlobs(
        path.join(os.tmpdir(), "does-not-exist-" + Date.now()),
        ["**/*.md"],
        [],
      );

      expect(results).toEqual([]);
    });

    it("paths normalized to forward slashes", async () => {
      await makeTmpDir();
      await createFile("docs/sub/file.md");

      const results = await expandGlobs(tmpDir, ["docs/**/*.md"], []);

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.relativePath).not.toContain("\\");
      }
    });
  });
});
