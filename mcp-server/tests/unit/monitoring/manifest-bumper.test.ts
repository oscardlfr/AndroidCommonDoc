import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bumpManifestVersion, resolveCoupledVersions } from "../../../src/monitoring/manifest-bumper.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("bumpManifestVersion", () => {
  let tmpDir: string;
  let manifestPath: string;

  const baseManifest = {
    updated: "2026-03-01",
    versions: {
      kotlin: "2.3.10",
      agp: "9.0.0",
      ksp: "2.3.10-2.0.1",
    },
    profiles: {
      kmp: { kotlin: "2.3.10", agp: "9.0.0" },
      "android-only": { kotlin: "2.3.10", agp: "8.9.1" },
    },
    coupled_versions: { ksp: ["kotlin"] },
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bumper-test-"));
    manifestPath = path.join(tmpDir, "versions-manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(baseManifest, null, 2));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("bumps versions[key] to new version", async () => {
    const { manifest } = await bumpManifestVersion("kotlin", "2.3.20", manifestPath);
    expect(manifest.versions.kotlin).toBe("2.3.20");
  });

  it("bumps matching profile entries", async () => {
    const { manifest } = await bumpManifestVersion("kotlin", "2.3.20", manifestPath);
    expect(manifest.profiles?.kmp?.kotlin).toBe("2.3.20");
    expect(manifest.profiles?.["android-only"]?.kotlin).toBe("2.3.20");
  });

  it("does NOT change profile entries for unrelated keys", async () => {
    const { manifest } = await bumpManifestVersion("kotlin", "2.3.20", manifestPath);
    // agp in profiles should be unchanged
    expect(manifest.profiles?.kmp?.agp).toBe("9.0.0");
    expect(manifest.profiles?.["android-only"]?.agp).toBe("8.9.1");
  });

  it("reports all updated paths", async () => {
    const { updated } = await bumpManifestVersion("kotlin", "2.3.20", manifestPath);
    expect(updated).toContain("versions.kotlin");
    expect(updated).toContain("profiles.kmp.kotlin");
    expect(updated).toContain("profiles.android-only.kotlin");
  });

  it("updates the updated timestamp to today", async () => {
    const { manifest } = await bumpManifestVersion("kotlin", "2.3.20", manifestPath);
    const today = new Date().toISOString().slice(0, 10);
    expect(manifest.updated).toBe(today);
  });

  it("persists changes to disk", async () => {
    await bumpManifestVersion("kotlin", "2.3.20", manifestPath);
    const raw = await fs.readFile(manifestPath, "utf-8");
    const reloaded = JSON.parse(raw);
    expect(reloaded.versions.kotlin).toBe("2.3.20");
  });

  it("adds key if not present in versions (with warning)", async () => {
    const { manifest, updated } = await bumpManifestVersion("new-lib", "1.0.0", manifestPath);
    expect(manifest.versions["new-lib"]).toBe("1.0.0");
    expect(updated[0]).toContain("added");
  });

  it("works when profiles section is absent", async () => {
    const minimal = { updated: "2026-01-01", versions: { kotlin: "2.3.10" } };
    await fs.writeFile(manifestPath, JSON.stringify(minimal));
    const { manifest } = await bumpManifestVersion("kotlin", "2.3.20", manifestPath);
    expect(manifest.versions.kotlin).toBe("2.3.20");
  });
});

describe("resolveCoupledVersions", () => {
  const manifest = {
    updated: "2026-03-01",
    versions: { kotlin: "2.3.20", ksp: "2.3.20-2.0.1" },
    coupled_versions: {
      ksp: ["kotlin"],
    },
  };

  it("returns ksp when kotlin is bumped", () => {
    const coupled = resolveCoupledVersions("kotlin", manifest);
    expect(coupled).toContain("ksp");
  });

  it("returns empty array when key has no coupled entries", () => {
    const coupled = resolveCoupledVersions("agp", manifest);
    expect(coupled).toHaveLength(0);
  });

  it("returns empty array when coupled_versions is absent", () => {
    const noCouple = { updated: "2026-01-01", versions: { kotlin: "2.3.20" } };
    const coupled = resolveCoupledVersions("kotlin", noCouple);
    expect(coupled).toHaveLength(0);
  });

  it("handles multiple dependencies for one key", () => {
    const multi = {
      updated: "2026-01-01",
      versions: {},
      coupled_versions: {
        "compose-compiler": ["kotlin"],
        "compose-gradle-plugin": ["kotlin"],
        ksp: ["kotlin"],
      },
    };
    const coupled = resolveCoupledVersions("kotlin", multi);
    expect(coupled).toContain("compose-compiler");
    expect(coupled).toContain("compose-gradle-plugin");
    expect(coupled).toContain("ksp");
    expect(coupled).toHaveLength(3);
  });
});
