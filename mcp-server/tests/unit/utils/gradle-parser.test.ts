/**
 * Tests for gradle-parser utility.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseSettingsModules,
  parseModuleDependencies,
  parsePlugins,
  findHardcodedVersions,
} from "../../../src/utils/gradle-parser.js";

const TEST_ROOT = path.join(os.tmpdir(), "gradle-parser-test-" + process.pid);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(TEST_ROOT, { recursive: true });
}

beforeEach(() => {
  ensureClean();
});

afterEach(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(TEST_ROOT, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("parseSettingsModules", () => {
  it("parses single module include", async () => {
    const p = writeFile(
      "settings.gradle.kts",
      `include(":app")\n`,
    );
    const modules = await parseSettingsModules(p);
    expect(modules).toEqual([":app"]);
  });

  it("parses multiple modules on separate lines", async () => {
    const p = writeFile(
      "settings.gradle.kts",
      `include(":app")\ninclude(":core:network")\ninclude(":feature:home")\n`,
    );
    const modules = await parseSettingsModules(p);
    expect(modules).toEqual([":app", ":core:network", ":feature:home"]);
  });

  it("parses multi-include on one line", async () => {
    const p = writeFile(
      "settings.gradle.kts",
      `include(":app", ":core", ":feature")\n`,
    );
    const modules = await parseSettingsModules(p);
    expect(modules).toEqual([":app", ":core", ":feature"]);
  });

  it("returns empty for no includes", async () => {
    const p = writeFile("settings.gradle.kts", `rootProject.name = "test"\n`);
    const modules = await parseSettingsModules(p);
    expect(modules).toEqual([]);
  });

  it("parses nested KMP modules", async () => {
    const p = writeFile(
      "settings.gradle.kts",
      `include(":core:network:api")\ninclude(":core:network:impl")\n`,
    );
    const modules = await parseSettingsModules(p);
    expect(modules).toEqual([":core:network:api", ":core:network:impl"]);
  });
});

describe("parseModuleDependencies", () => {
  it("parses api and implementation deps", async () => {
    const p = writeFile(
      "build.gradle.kts",
      `
dependencies {
    api(project(":core:model"))
    implementation(project(":core:network"))
    implementation(project(":feature:auth"))
}
`,
    );
    const deps = await parseModuleDependencies(p);
    expect(deps.api).toEqual([":core:model"]);
    expect(deps.implementation).toEqual([":core:network", ":feature:auth"]);
  });

  it("returns empty for no project deps", async () => {
    const p = writeFile(
      "build.gradle.kts",
      `
dependencies {
    implementation(libs.kotlinx.coroutines)
}
`,
    );
    const deps = await parseModuleDependencies(p);
    expect(deps.api).toEqual([]);
    expect(deps.implementation).toEqual([]);
  });
});

describe("parsePlugins", () => {
  it("parses id plugins", async () => {
    const p = writeFile(
      "build.gradle.kts",
      `
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
`,
    );
    const result = await parsePlugins(p);
    expect(result.ids).toContain("com.android.application");
    expect(result.ids).toContain("org.jetbrains.kotlin.android");
    expect(result.hasConvention).toBe(false);
  });

  it("parses alias plugins and detects convention", async () => {
    const p = writeFile(
      "build.gradle.kts",
      `
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}
`,
    );
    const result = await parsePlugins(p);
    expect(result.ids).toHaveLength(2);
    expect(result.hasConvention).toBe(true);
  });

  it("parses kotlin shorthand", async () => {
    const p = writeFile(
      "build.gradle.kts",
      `
plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
}
`,
    );
    const result = await parsePlugins(p);
    expect(result.ids).toContain("org.jetbrains.kotlin.jvm");
    expect(result.ids).toContain(
      "org.jetbrains.kotlin.plugin.serialization",
    );
  });

  it("returns empty for no plugins block", async () => {
    const p = writeFile("build.gradle.kts", `// no plugins\n`);
    const result = await parsePlugins(p);
    expect(result.ids).toEqual([]);
    expect(result.hasConvention).toBe(false);
  });
});

describe("findHardcodedVersions", () => {
  it("detects hardcoded dependency versions", async () => {
    const p = writeFile(
      "build.gradle.kts",
      `
dependencies {
    implementation("com.google.code.gson:gson:2.10.1")
    implementation(libs.kotlinx.coroutines)
}
`,
    );
    const hardcoded = await findHardcodedVersions(p);
    expect(hardcoded).toHaveLength(1);
    expect(hardcoded[0]).toContain("gson:2.10.1");
  });

  it("ignores version catalog references", async () => {
    const p = writeFile(
      "build.gradle.kts",
      `
dependencies {
    implementation(libs.ktor.client.core)
    api(libs.kotlinx.serialization.json)
}
`,
    );
    const hardcoded = await findHardcodedVersions(p);
    expect(hardcoded).toHaveLength(0);
  });

  it("detects version assignment", async () => {
    const p = writeFile(
      "build.gradle.kts",
      `
android {
    compileSdk = 34
    defaultConfig {
        minSdk = 26
        targetSdk = 34
        versionName = "1.0.0"
    }
}
`,
    );
    // compileSdk/minSdk/targetSdk are int assignments, not string versions
    // versionName = "1.0.0" is not a dependency version
    const hardcoded = await findHardcodedVersions(p);
    // Should not flag integer assignments
    expect(hardcoded.every((h) => !h.includes("compileSdk"))).toBe(true);
  });
});
