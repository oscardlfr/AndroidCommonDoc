import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  validateRunArgs,
  validateCreateArgs,
  type RunArgs,
  type CreateArgs,
} from "../../../src/tools/android-cli-bridge.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "android-cli-bridge-test-"));
}

function writeFakeApk(dir: string, name: string): string {
  const apkPath = path.join(dir, name);
  writeFileSync(apkPath, "PK\u0003\u0004fake apk content");
  return apkPath;
}

// ── validateRunArgs ─────────────────────────────────────────────────────────

describe("validateRunArgs", () => {
  it("rejects when apks is empty", () => {
    const result = validateRunArgs({ apks: [], device_serial: "DEV123" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one apk/i);
  });

  it("rejects when an APK path does not exist", () => {
    const result = validateRunArgs({
      apks: ["/path/that/does/not/exist.apk"],
      device_serial: "DEV123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/does not exist/i);
      expect(result.hint).toBeDefined();
    }
  });

  it("rejects when device_serial is missing (multi-device safety)", () => {
    const dir = makeTempDir();
    try {
      const apk = writeFakeApk(dir, "app-debug.apk");
      const result = validateRunArgs({ apks: [apk], device_serial: "" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/device_serial is required/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("rejects release/prod-tagged APKs without confirm_production", () => {
    const dir = makeTempDir();
    try {
      const apk = writeFakeApk(dir, "app-release.apk");
      const result = validateRunArgs({ apks: [apk], device_serial: "DEV" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/production build/i);
        expect(result.hint).toMatch(/confirm_production/);
      }
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("allows release APKs when confirm_production=true", () => {
    const dir = makeTempDir();
    try {
      const apk = writeFakeApk(dir, "app-release.apk");
      const result = validateRunArgs({
        apks: [apk],
        device_serial: "DEV",
        confirm_production: true,
      });
      expect(result.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("assembles CLI args with comma-separated APKs and optional flags", () => {
    const dir = makeTempDir();
    try {
      const a = writeFakeApk(dir, "base.apk");
      const b = writeFakeApk(dir, "density-hdpi.apk");
      const result = validateRunArgs({
        apks: [a, b],
        device_serial: "R3CT30KAMEH",
        activity: ".MainActivity",
        component_type: "ACTIVITY",
        debug: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]).toBe("run");
        expect(result.value).toContain(`--apks=${a},${b}`);
        expect(result.value).toContain("--device=R3CT30KAMEH");
        expect(result.value).toContain("--activity=.MainActivity");
        expect(result.value).toContain("--type=ACTIVITY");
        expect(result.value).toContain("--debug");
      }
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("does not flag debug APKs as production", () => {
    const dir = makeTempDir();
    try {
      const apk = writeFakeApk(dir, "app-debug.apk");
      const result = validateRunArgs({ apks: [apk], device_serial: "DEV" });
      expect(result.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ── validateCreateArgs ──────────────────────────────────────────────────────

describe("validateCreateArgs", () => {
  it("rejects empty template or name", () => {
    const dir = makeTempDir();
    try {
      expect(validateCreateArgs({ template: "", name: "x", output_dir: ".", project_root: dir }).ok)
        .toBe(false);
      expect(validateCreateArgs({ template: "x", name: "", output_dir: ".", project_root: dir }).ok)
        .toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("rejects names containing colons (AGP 9 flat invariant)", () => {
    const dir = makeTempDir();
    try {
      const result = validateCreateArgs({
        template: "empty-activity-agp-9",
        name: "core:json:api",
        output_dir: ".",
        project_root: dir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/flat/i);
        expect(result.hint).toMatch(/gradle-patterns-agp9/i);
      }
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("rejects output_dir that escapes project_root (path traversal)", () => {
    const dir = makeTempDir();
    try {
      const result = validateCreateArgs({
        template: "empty-activity-agp-9",
        name: "evil",
        output_dir: "../../../escape",
        project_root: dir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/escapes project_root/i);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("rejects absolute output_dir that escapes project_root", () => {
    const dir = makeTempDir();
    const other = makeTempDir();
    try {
      const result = validateCreateArgs({
        template: "empty-activity-agp-9",
        name: "evil",
        output_dir: other, // absolute, outside project_root
        project_root: dir,
      });
      expect(result.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
      rmSync(other, { recursive: true });
    }
  });

  it("rejects non-existent project_root", () => {
    const result = validateCreateArgs({
      template: "empty-activity-agp-9",
      name: "ok",
      output_dir: ".",
      project_root: "/does/not/exist/for/real/12345",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid create invocation and assembles CLI args", () => {
    const dir = makeTempDir();
    try {
      const result = validateCreateArgs({
        template: "empty-activity-agp-9",
        name: "feature-foo",
        output_dir: "modules/feature-foo",
        project_root: dir,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0]).toBe("create");
        expect(result.value).toContain("empty-activity-agp-9");
        expect(result.value).toContain("--name=feature-foo");
        const outputArg = result.value.find((a) => a.startsWith("--output="));
        expect(outputArg).toBeDefined();
        // Output is resolved to an absolute path inside project_root.
        expect(outputArg).toContain(path.resolve(dir, "modules/feature-foo"));
      }
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("includes --dry-run and --verbose flags when requested", () => {
    const dir = makeTempDir();
    try {
      const result = validateCreateArgs({
        template: "empty-activity-agp-9",
        name: "ok",
        output_dir: ".",
        project_root: dir,
        dry_run: true,
        verbose: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("--dry-run");
        expect(result.value).toContain("--verbose");
        // Flags come BEFORE the template argument per CLI semantics.
        const dryIdx = result.value.indexOf("--dry-run");
        const tmplIdx = result.value.indexOf("empty-activity-agp-9");
        expect(dryIdx).toBeLessThan(tmplIdx);
      }
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
