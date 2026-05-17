import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncHooks } from "../../../src/sync/sync-engine.js";

// ---------------------------------------------------------------------------
// Helper: create a minimal L0 hooks directory with test files
// ---------------------------------------------------------------------------

async function createL0Root(dir: string, hooks: string[]): Promise<void> {
  const hooksDir = join(dir, ".claude", "hooks");
  await mkdir(hooksDir, { recursive: true });
  for (const name of hooks) {
    await writeFile(join(hooksDir, name), `// hook: ${name}\n`, "utf-8");
  }
}

async function createProjectRoot(dir: string): Promise<void> {
  await mkdir(join(dir, ".claude", "hooks"), { recursive: true });
}

describe("syncHooks", () => {
  let tmpDir: string;
  let l0Root: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sync-hooks-test-"));
    l0Root = join(tmpDir, "l0");
    projectRoot = join(tmpDir, "project");
    await mkdir(l0Root, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("copies all hook files from L0 when no excludes", async () => {
    await createL0Root(l0Root, ["gate-a.js", "gate-b.js"]);
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, []);

    expect(result.copied).toEqual(expect.arrayContaining(["gate-a.js", "gate-b.js"]));
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    const destA = await readFile(join(projectRoot, ".claude", "hooks", "gate-a.js"), "utf-8");
    expect(destA).toContain("gate-a.js");
  });

  it("skips hooks listed in exclude_hooks", async () => {
    await createL0Root(l0Root, ["gate-a.js", "project-local.js", "gate-b.js"]);
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, ["project-local.js"]);

    expect(result.copied).toEqual(expect.arrayContaining(["gate-a.js", "gate-b.js"]));
    expect(result.skipped).toContain("project-local.js");
    expect(result.errors).toHaveLength(0);
  });

  it("handles missing L0 hooks dir gracefully", async () => {
    // No .claude/hooks in l0Root
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, []);

    expect(result.copied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("dry run reports copies without writing files", async () => {
    await createL0Root(l0Root, ["gate-a.js"]);
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, [], true);

    expect(result.copied).toContain("gate-a.js");

    // File should NOT exist in dest — dry run
    await expect(
      readFile(join(projectRoot, ".claude", "hooks", "gate-a.js"), "utf-8"),
    ).rejects.toThrow();
  });
});
