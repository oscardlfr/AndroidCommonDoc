import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { discoverProjects } from "../../../src/registry/project-discovery.js";
import type { ProjectInfo } from "../../../src/registry/project-discovery.js";

describe("discoverProjects", () => {
  let tmpRoot: string;
  let toolkitDir: string;
  const originalEnv = process.env.ANDROID_COMMON_DOC;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "project-discovery-test-"),
    );
    toolkitDir = path.join(tmpRoot, "AndroidCommonDoc");
    await fs.mkdir(toolkitDir, { recursive: true });

    process.env.ANDROID_COMMON_DOC = toolkitDir;
    process.env.HOME = path.join(tmpRoot, "userhome");
    process.env.USERPROFILE = path.join(tmpRoot, "userhome");
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.ANDROID_COMMON_DOC = originalEnv;
    } else {
      delete process.env.ANDROID_COMMON_DOC;
    }
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("discovers sibling projects with includeBuild referencing toolkit", async () => {
    // Create a sibling project with settings.gradle.kts referencing AndroidCommonDoc
    const appDir = path.join(tmpRoot, "MyApp");
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(
      path.join(appDir, "settings.gradle.kts"),
      `pluginManagement { }\nincludeBuild("../AndroidCommonDoc")\n`,
    );

    const projects = await discoverProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("MyApp");
    expect(projects[0].path).toBe(appDir);
  });

  it("discovers multiple sibling projects", async () => {
    const appDir = path.join(tmpRoot, "MyApp");
    const otherAppDir = path.join(tmpRoot, "MyOtherApp");
    await fs.mkdir(appDir, { recursive: true });
    await fs.mkdir(otherAppDir, { recursive: true });
    await fs.writeFile(
      path.join(appDir, "settings.gradle.kts"),
      `includeBuild("../AndroidCommonDoc")`,
    );
    await fs.writeFile(
      path.join(otherAppDir, "settings.gradle.kts"),
      `includeBuild("../AndroidCommonDoc")`,
    );

    const projects = await discoverProjects();
    expect(projects).toHaveLength(2);
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["MyApp", "MyOtherApp"]);
  });

  it("excludes the toolkit root directory itself", async () => {
    // Toolkit root has its own settings.gradle.kts (should not self-discover)
    await fs.writeFile(
      path.join(toolkitDir, "settings.gradle.kts"),
      `includeBuild("../AndroidCommonDoc")`,
    );

    const projects = await discoverProjects();
    expect(projects).toHaveLength(0);
  });

  it("reports hasL1Docs=true when .androidcommondoc/docs/ exists", async () => {
    const appDir = path.join(tmpRoot, "MyApp");
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(
      path.join(appDir, "settings.gradle.kts"),
      `includeBuild("../AndroidCommonDoc")`,
    );
    await fs.mkdir(
      path.join(appDir, ".androidcommondoc", "docs"),
      { recursive: true },
    );

    const projects = await discoverProjects();
    expect(projects[0].hasL1Docs).toBe(true);
  });

  it("reports hasL1Docs=false when .androidcommondoc/docs/ does not exist", async () => {
    const appDir = path.join(tmpRoot, "MyApp");
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(
      path.join(appDir, "settings.gradle.kts"),
      `includeBuild("../AndroidCommonDoc")`,
    );

    const projects = await discoverProjects();
    expect(projects[0].hasL1Docs).toBe(false);
  });

  it("ignores sibling dirs without settings.gradle.kts", async () => {
    const randomDir = path.join(tmpRoot, "SomeOtherProject");
    await fs.mkdir(randomDir, { recursive: true });

    const projects = await discoverProjects();
    expect(projects).toHaveLength(0);
  });

  it("ignores sibling dirs whose settings.gradle.kts does not reference toolkit", async () => {
    const unrelatedDir = path.join(tmpRoot, "UnrelatedProject");
    await fs.mkdir(unrelatedDir, { recursive: true });
    await fs.writeFile(
      path.join(unrelatedDir, "settings.gradle.kts"),
      `pluginManagement { }\ninclude(":app")\n`,
    );

    const projects = await discoverProjects();
    expect(projects).toHaveLength(0);
  });

  it("falls back to projects.yaml when no sibling settings.gradle.kts found", async () => {
    // No sibling projects, but yaml config exists
    const homeDir = path.join(tmpRoot, "userhome");
    const configDir = path.join(homeDir, ".androidcommondoc");
    await fs.mkdir(configDir, { recursive: true });

    const appPath = path.join(tmpRoot, "SomeMyApp");
    await fs.mkdir(appPath, { recursive: true });

    await fs.writeFile(
      path.join(configDir, "projects.yaml"),
      `projects:\n  - name: MyApp\n    path: "${appPath.replace(/\\/g, "/")}"\n`,
    );

    const projects = await discoverProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("MyApp");
  });

  it("returns empty array on errors (not throw)", async () => {
    // Point to a non-existent toolkit root
    process.env.ANDROID_COMMON_DOC = "/non/existent/path/toolkit";

    const projects = await discoverProjects();
    expect(projects).toEqual([]);
  });

  it("handles includeBuild with single quotes", async () => {
    const appDir = path.join(tmpRoot, "MyApp");
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(
      path.join(appDir, "settings.gradle.kts"),
      `includeBuild('../AndroidCommonDoc')`,
    );

    const projects = await discoverProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("MyApp");
  });
});
