import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { detectSubProjects } from "../../../src/vault/sub-project-detector.js";

describe("sub-project-detector", () => {
  let tmpDir: string;

  async function makeTmpDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "subproject-test-"),
    );
    return tmpDir;
  }

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper: create a directory and optionally write files inside it.
   */
  async function createDir(relativePath: string, files: string[] = []) {
    const dirPath = path.join(tmpDir, ...relativePath.split("/"));
    await fs.mkdir(dirPath, { recursive: true });
    for (const file of files) {
      await fs.writeFile(path.join(dirPath, file), "", "utf-8");
    }
    return dirPath;
  }

  describe("detectSubProjects", () => {
    it("CMakeLists.txt in Gradle parent detected as sub-project", async () => {
      await makeTmpDir();
      // Create parent with Gradle build file (signals gradle build system)
      await fs.writeFile(
        path.join(tmpDir, "build.gradle.kts"),
        "",
        "utf-8",
      );
      // Create child with CMakeLists.txt (cross-tech signal)
      await createDir("NativeWidget", ["CMakeLists.txt"]);

      const results = await detectSubProjects(tmpDir);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("NativeWidget");
      expect(results[0].path).toBe("NativeWidget");
    });

    it("package.json in Gradle parent detected as sub-project", async () => {
      await makeTmpDir();
      await fs.writeFile(
        path.join(tmpDir, "settings.gradle.kts"),
        "",
        "utf-8",
      );
      await createDir("WebFrontend", ["package.json"]);

      const results = await detectSubProjects(tmpDir);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("WebFrontend");
    });

    it(".git directory detected as independent sub-project", async () => {
      await makeTmpDir();
      await fs.writeFile(
        path.join(tmpDir, "build.gradle.kts"),
        "",
        "utf-8",
      );
      // Create a child with its own .git (independent repo)
      await createDir("ExternalLib/.git");

      const results = await detectSubProjects(tmpDir);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("ExternalLib");
    });

    it("build.gradle.kts in Gradle parent NOT detected (Gradle sub-module)", async () => {
      await makeTmpDir();
      await fs.writeFile(
        path.join(tmpDir, "settings.gradle.kts"),
        "",
        "utf-8",
      );
      // Child also uses gradle -- same build system = sub-module, NOT sub-project
      await createDir("core", ["build.gradle.kts"]);
      await createDir("feature-auth", ["build.gradle.kts"]);

      const results = await detectSubProjects(tmpDir);

      expect(results).toHaveLength(0);
    });

    it("maxDepth=1 only scans immediate children", async () => {
      await makeTmpDir();
      await fs.writeFile(
        path.join(tmpDir, "build.gradle.kts"),
        "",
        "utf-8",
      );
      // Depth 1: immediate child with CMakeLists.txt
      await createDir("Level1", []);
      // Depth 2: nested child with CMakeLists.txt
      await createDir("Level1/Nested", ["CMakeLists.txt"]);

      const results = await detectSubProjects(tmpDir, 1);

      // maxDepth=1 should not find Nested because it's at depth 2
      expect(results).toHaveLength(0);
    });

    it("skips known non-project directories (build, node_modules, .gradle)", async () => {
      await makeTmpDir();
      await fs.writeFile(
        path.join(tmpDir, "build.gradle.kts"),
        "",
        "utf-8",
      );
      // These directories should always be skipped
      await createDir("build", ["CMakeLists.txt"]);
      await createDir("node_modules", ["package.json"]);
      await createDir(".gradle", ["CMakeLists.txt"]);

      const results = await detectSubProjects(tmpDir);

      expect(results).toHaveLength(0);
    });

    it("empty directory returns empty array", async () => {
      await makeTmpDir();

      const results = await detectSubProjects(tmpDir);

      expect(results).toEqual([]);
    });
  });
});
