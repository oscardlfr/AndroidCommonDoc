import { describe, it, expect, afterEach } from "vitest";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ManifestSchema,
  type Manifest,
  validateManifest,
  createDefaultManifest,
  readManifest,
  writeManifest,
  generateExampleManifests,
} from "../../../src/sync/manifest-schema.js";

describe("ManifestSchema", () => {
  const validIncludeAllManifest: Manifest = {
    version: 1,
    l0_source: "../AndroidCommonDoc",
    last_synced: "2026-03-15T12:00:00Z",
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
    },
    checksums: {},
    l2_specific: {
      commands: [],
      agents: [],
      skills: [],
    },
  };

  const validExplicitManifest: Manifest = {
    version: 1,
    l0_source: "../AndroidCommonDoc",
    last_synced: "2026-03-15T12:00:00Z",
    selection: {
      mode: "explicit",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
    },
    checksums: {
      "skills/test/SKILL.md": "sha256:abc123def456",
    },
    l2_specific: {
      commands: ["deploy-web"],
      agents: ["daw-guardian"],
      skills: [],
    },
  };

  describe("validation", () => {
    it("validates manifest with include-all mode", () => {
      const result = ManifestSchema.safeParse(validIncludeAllManifest);
      expect(result.success).toBe(true);
    });

    it("validates manifest with explicit mode", () => {
      const result = ManifestSchema.safeParse(validExplicitManifest);
      expect(result.success).toBe(true);
    });

    it("rejects missing version field", () => {
      const invalid = { ...validIncludeAllManifest };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (invalid as any).version;
      const result = ManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects invalid l0_source (empty string)", () => {
      const invalid = { ...validIncludeAllManifest, l0_source: "" };
      const result = ManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("accepts empty checksums object (fresh manifest)", () => {
      const result = ManifestSchema.safeParse(validIncludeAllManifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.checksums).toEqual({});
      }
    });

    it("validates l2_specific section correctly lists project-specific files", () => {
      const manifest = {
        ...validIncludeAllManifest,
        l2_specific: {
          commands: ["deploy-web", "lint-web", "test-m4l"],
          agents: ["daw-guardian", "data-layer-specialist"],
          skills: ["custom-skill"],
        },
      };
      const result = ManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.l2_specific.commands).toEqual([
          "deploy-web",
          "lint-web",
          "test-m4l",
        ]);
        expect(result.data.l2_specific.agents).toEqual([
          "daw-guardian",
          "data-layer-specialist",
        ]);
        expect(result.data.l2_specific.skills).toEqual(["custom-skill"]);
      }
    });

    it("defaults exclude_skills, exclude_agents, exclude_commands, exclude_categories to empty arrays", () => {
      const minimal = {
        version: 1,
        l0_source: "../AndroidCommonDoc",
        last_synced: "2026-03-15T12:00:00Z",
        selection: {
          mode: "include-all" as const,
        },
        checksums: {},
        l2_specific: {},
      };
      const result = ManifestSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.selection.exclude_skills).toEqual([]);
        expect(result.data.selection.exclude_agents).toEqual([]);
        expect(result.data.selection.exclude_commands).toEqual([]);
        expect(result.data.selection.exclude_categories).toEqual([]);
      }
    });

    it("defaults l2_specific.commands/agents/skills to empty arrays", () => {
      const minimal = {
        version: 1,
        l0_source: "../AndroidCommonDoc",
        last_synced: "2026-03-15T12:00:00Z",
        selection: { mode: "include-all" as const },
        checksums: {},
        l2_specific: {},
      };
      const result = ManifestSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.l2_specific.commands).toEqual([]);
        expect(result.data.l2_specific.agents).toEqual([]);
        expect(result.data.l2_specific.skills).toEqual([]);
      }
    });

    it("accepts checksums with relative paths as keys and sha256:hex as values", () => {
      const manifest = {
        ...validIncludeAllManifest,
        checksums: {
          "skills/test/SKILL.md": "sha256:abc123def456",
          ".claude/agents/test-specialist.md": "sha256:789012ghi345",
          ".claude/commands/test.md": "sha256:jkl678mno901",
        },
      };
      const result = ManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.checksums["skills/test/SKILL.md"]).toBe(
          "sha256:abc123def456",
        );
        expect(
          result.data.checksums[".claude/agents/test-specialist.md"],
        ).toBe("sha256:789012ghi345");
      }
    });

    it("validates last_synced is a valid ISO datetime string", () => {
      // Valid ISO datetime
      const validResult = ManifestSchema.safeParse(validIncludeAllManifest);
      expect(validResult.success).toBe(true);

      // Invalid datetime string
      const invalid = {
        ...validIncludeAllManifest,
        last_synced: "not-a-date",
      };
      const invalidResult = ManifestSchema.safeParse(invalid);
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("validateManifest", () => {
    it("returns validated manifest for valid data", () => {
      const result = validateManifest(validIncludeAllManifest);
      expect(result.version).toBe(1);
      expect(result.l0_source).toBe("../AndroidCommonDoc");
      expect(result.selection.mode).toBe("include-all");
    });

    it("throws ZodError for invalid data", () => {
      expect(() => validateManifest({ version: 2 })).toThrow();
    });
  });

  describe("createDefaultManifest", () => {
    it("generates valid include-all manifest with given l0_source path", () => {
      const manifest = createDefaultManifest("../AndroidCommonDoc");
      expect(manifest.version).toBe(1);
      expect(manifest.l0_source).toBe("../AndroidCommonDoc");
      expect(manifest.selection.mode).toBe("include-all");
      expect(manifest.checksums).toEqual({});

      // Verify it passes schema validation
      const result = ManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });

    it("sets last_synced to a valid ISO datetime", () => {
      const manifest = createDefaultManifest("../AndroidCommonDoc");
      // Should be parseable as a date
      const date = new Date(manifest.last_synced);
      expect(date.getTime()).not.toBeNaN();
    });

    it("defaults all exclude arrays to empty", () => {
      const manifest = createDefaultManifest("../AndroidCommonDoc");
      expect(manifest.selection.exclude_skills).toEqual([]);
      expect(manifest.selection.exclude_agents).toEqual([]);
      expect(manifest.selection.exclude_commands).toEqual([]);
      expect(manifest.selection.exclude_categories).toEqual([]);
    });

    it("defaults l2_specific to empty arrays", () => {
      const manifest = createDefaultManifest("../AndroidCommonDoc");
      expect(manifest.l2_specific.commands).toEqual([]);
      expect(manifest.l2_specific.agents).toEqual([]);
      expect(manifest.l2_specific.skills).toEqual([]);
    });
  });

  describe("readManifest", () => {
    let tmpDir: string;

    afterEach(async () => {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("reads and validates a JSON file", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
      const filePath = join(tmpDir, "l0-manifest.json");
      await writeFile(
        filePath,
        JSON.stringify(validIncludeAllManifest),
        "utf-8",
      );

      const result = await readManifest(filePath);
      expect(result.version).toBe(1);
      expect(result.l0_source).toBe("../AndroidCommonDoc");
    });

    it("throws on invalid JSON file content", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
      const filePath = join(tmpDir, "bad-manifest.json");
      await writeFile(filePath, "{ invalid json }", "utf-8");

      await expect(readManifest(filePath)).rejects.toThrow();
    });
  });

  describe("writeManifest", () => {
    let tmpDir: string;

    afterEach(async () => {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("writes manifest as JSON with 2-space indent", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
      const filePath = join(tmpDir, "l0-manifest.json");

      await writeManifest(filePath, validIncludeAllManifest);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe(
        JSON.stringify(validIncludeAllManifest, null, 2) + "\n",
      );
    });
  });

  describe("generateExampleManifests", () => {
    it("generates both example manifests that pass schema validation", () => {
      const examples = generateExampleManifests();

      const kmpResult = ManifestSchema.safeParse(examples.sharedLibs);
      expect(kmpResult.success).toBe(true);

      const appResult = ManifestSchema.safeParse(examples.myApp);
      expect(appResult.success).toBe(true);
    });

    it("L1 (shared library) manifest uses include-all mode", () => {
      const { sharedLibs } = generateExampleManifests();
      expect(sharedLibs.selection.mode).toBe("include-all");
      expect(sharedLibs.l0_source).toBe("../AndroidCommonDoc");
    });

    it("L1 manifest excludes GSD-specific commands", () => {
      const { sharedLibs } = generateExampleManifests();
      expect(sharedLibs.selection.exclude_commands).toContain("start-track");
      expect(sharedLibs.selection.exclude_commands).toContain(
        "sync-roadmap",
      );
      expect(sharedLibs.selection.exclude_commands).toContain("merge-track");
    });

    it("L1 manifest excludes product category", () => {
      const { sharedLibs } = generateExampleManifests();
      expect(sharedLibs.selection.exclude_categories).toContain("product");
    });

    it("L1 manifest has no L2-specific items", () => {
      const { sharedLibs } = generateExampleManifests();
      expect(sharedLibs.l2_specific.commands).toEqual([]);
      expect(sharedLibs.l2_specific.agents).toEqual([]);
      expect(sharedLibs.l2_specific.skills).toEqual([]);
    });

    it("L2 (app) manifest uses include-all mode with no exclusions", () => {
      const { myApp } = generateExampleManifests();
      expect(myApp.selection.mode).toBe("include-all");
      expect(myApp.l0_source).toBe("../AndroidCommonDoc");
      expect(myApp.selection.exclude_skills).toEqual([]);
      expect(myApp.selection.exclude_commands).toEqual([]);
    });

    it("L2 manifest L2-specific items are empty arrays (template defaults)", () => {
      const { myApp } = generateExampleManifests();
      // The example manifest ships with empty arrays -- each project fills its own
      expect(Array.isArray(myApp.l2_specific.commands)).toBe(true);
      expect(Array.isArray(myApp.l2_specific.agents)).toBe(true);
      expect(myApp.l2_specific.skills).toEqual([]);
    });

    it("both manifests have empty checksums (pre-sync)", () => {
      const examples = generateExampleManifests();
      expect(examples.sharedLibs.checksums).toEqual({});
      expect(examples.myApp.checksums).toEqual({});
    });
  });
});
