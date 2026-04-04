import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";

describe("getToolkitRoot", () => {
  const originalEnv = process.env.ANDROID_COMMON_DOC;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANDROID_COMMON_DOC = originalEnv;
    } else {
      delete process.env.ANDROID_COMMON_DOC;
    }
  });

  it("returns ANDROID_COMMON_DOC env var when set", async () => {
    process.env.ANDROID_COMMON_DOC = "/custom/toolkit/path";
    const { getToolkitRoot } = await import("../../../src/utils/paths.js");
    expect(getToolkitRoot()).toBe("/custom/toolkit/path");
  });

  it("falls back to a resolved path when env var is unset", async () => {
    delete process.env.ANDROID_COMMON_DOC;
    const { getToolkitRoot } = await import("../../../src/utils/paths.js");
    const result = getToolkitRoot();
    // Should return an absolute path (the fallback from import.meta.url)
    expect(path.isAbsolute(result)).toBe(true);
  });
});

describe("getDocsDir", () => {
  it("returns a path ending with 'docs'", async () => {
    process.env.ANDROID_COMMON_DOC = "/toolkit/root";
    const { getDocsDir } = await import("../../../src/utils/paths.js");
    const result = getDocsDir();
    expect(result).toBe(path.join("/toolkit/root", "docs"));
  });
});

describe("getSkillsDir", () => {
  it("returns a path ending with 'skills'", async () => {
    process.env.ANDROID_COMMON_DOC = "/toolkit/root";
    const { getSkillsDir } = await import("../../../src/utils/paths.js");
    const result = getSkillsDir();
    expect(result).toBe(path.join("/toolkit/root", "skills"));
  });
});

describe("getScriptsDir", () => {
  it("returns a path ending with 'scripts/sh'", async () => {
    process.env.ANDROID_COMMON_DOC = "/toolkit/root";
    const { getScriptsDir } = await import("../../../src/utils/paths.js");
    const result = getScriptsDir();
    expect(result).toBe(path.join("/toolkit/root", "scripts", "sh"));
  });
});

describe("getL2Dir", () => {
  it("returns path to ~/.androidcommondoc", async () => {
    const os = await import("node:os");
    const { getL2Dir } = await import("../../../src/utils/paths.js");
    const result = getL2Dir();
    expect(result).toBe(path.join(os.homedir(), ".androidcommondoc"));
  });
});

describe("getL2DocsDir", () => {
  it("returns path to ~/.androidcommondoc/docs", async () => {
    const os = await import("node:os");
    const { getL2DocsDir } = await import("../../../src/utils/paths.js");
    const result = getL2DocsDir();
    expect(result).toBe(path.join(os.homedir(), ".androidcommondoc", "docs"));
  });
});

describe("getL1DocsDir", () => {
  it("returns path to projectPath/.androidcommondoc/docs", async () => {
    const { getL1DocsDir } = await import("../../../src/utils/paths.js");
    const result = getL1DocsDir("/projects/MyApp");
    expect(result).toBe(
      path.join("/projects/MyApp", ".androidcommondoc", "docs"),
    );
  });
});

describe("getAgentsDir", () => {
  it("returns a path ending with .claude/agents", async () => {
    process.env.ANDROID_COMMON_DOC = "/toolkit/root";
    const { getAgentsDir } = await import("../../../src/utils/paths.js");
    const result = getAgentsDir();
    expect(result).toBe(path.join("/toolkit/root", ".claude", "agents"));
  });
});
