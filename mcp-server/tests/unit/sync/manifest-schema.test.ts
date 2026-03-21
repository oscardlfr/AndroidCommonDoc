import { describe, it, expect, afterEach } from "vitest";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ManifestSchema,
  ManifestSchemaV1,
  ManifestSchemaV2,
  type Manifest,
  type ManifestV1,
  validateManifest,
  createDefaultManifest,
  createChainManifest,
  migrateV1toV2,
  readManifest,
  writeManifest,
  getL0Source,
  getOrderedSources,
  generateExampleManifests,
} from "../../../src/sync/manifest-schema.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeV1Manifest(overrides?: Partial<ManifestV1>): ManifestV1 {
  return {
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
    l2_specific: { commands: [], agents: [], skills: [] },
    ...overrides,
  };
}

function makeV2Manifest(overrides?: Partial<Manifest>): Manifest {
  return {
    version: 2,
    sources: [{ layer: "L0", path: "../AndroidCommonDoc", role: "tooling" as const }],
    topology: "flat",
    last_synced: "2026-03-15T12:00:00Z",
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
    },
    checksums: {},
    l2_specific: { commands: [], agents: [], skills: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// v2 schema validation
// ---------------------------------------------------------------------------

describe("ManifestSchemaV2", () => {
  it("validates flat topology manifest", () => {
    const result = ManifestSchemaV2.safeParse(makeV2Manifest());
    expect(result.success).toBe(true);
  });

  it("validates chain topology manifest", () => {
    const manifest = makeV2Manifest({
      topology: "chain",
      sources: [
        { layer: "L0", path: "../../AndroidCommonDoc", role: "tooling" },
        { layer: "L1", path: "../../shared-kmp-libs", role: "ecosystem" },
      ],
    });
    const result = ManifestSchemaV2.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("rejects empty sources array", () => {
    const manifest = makeV2Manifest({ sources: [] });
    const result = ManifestSchemaV2.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects source with empty layer", () => {
    const manifest = makeV2Manifest({
      sources: [{ layer: "", path: "../x", role: "tooling" }],
    });
    const result = ManifestSchemaV2.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("rejects source with empty path", () => {
    const manifest = makeV2Manifest({
      sources: [{ layer: "L0", path: "", role: "tooling" }],
    });
    const result = ManifestSchemaV2.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("defaults topology to flat when not specified", () => {
    const raw = { ...makeV2Manifest() };
    delete (raw as Record<string, unknown>).topology;
    const result = ManifestSchemaV2.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.topology).toBe("flat");
  });

  it("validates source with optional remote URL", () => {
    const manifest = makeV2Manifest({
      sources: [
        { layer: "L0", path: "../AndroidCommonDoc", role: "tooling", remote: "https://github.com/org/AndroidCommonDoc.git" },
      ],
    });
    const result = ManifestSchemaV2.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sources[0].remote).toBe("https://github.com/org/AndroidCommonDoc.git");
    }
  });

  it("validates source without remote (optional field)", () => {
    const manifest = makeV2Manifest({
      sources: [
        { layer: "L0", path: "../AndroidCommonDoc", role: "tooling" },
      ],
    });
    const result = ManifestSchemaV2.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sources[0].remote).toBeUndefined();
    }
  });

  it("rejects source with invalid remote URL", () => {
    const manifest = makeV2Manifest({
      sources: [
        { layer: "L0", path: "../x", role: "tooling", remote: "not-a-url" },
      ],
    });
    const result = ManifestSchemaV2.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("accepts all valid roles: tooling, ecosystem, application", () => {
    for (const role of ["tooling", "ecosystem", "application"] as const) {
      const manifest = makeV2Manifest({
        sources: [{ layer: "L0", path: "../x", role }],
      });
      expect(ManifestSchemaV2.safeParse(manifest).success).toBe(true);
    }
  });

  it("defaults source role to tooling", () => {
    const raw = {
      ...makeV2Manifest(),
      sources: [{ layer: "L0", path: "../x" }],
    };
    const result = ManifestSchemaV2.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sources[0].role).toBe("tooling");
  });
});

// ---------------------------------------------------------------------------
// v1 schema validation (backward compat)
// ---------------------------------------------------------------------------

describe("ManifestSchemaV1", () => {
  it("validates v1 manifest", () => {
    const result = ManifestSchemaV1.safeParse(makeV1Manifest());
    expect(result.success).toBe(true);
  });

  it("rejects empty l0_source", () => {
    const result = ManifestSchemaV1.safeParse(makeV1Manifest({ l0_source: "" }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// v1 → v2 migration
// ---------------------------------------------------------------------------

describe("migrateV1toV2", () => {
  it("converts v1 l0_source to v2 sources array", () => {
    const v1 = makeV1Manifest({ l0_source: "../MyL0" });
    const v2 = migrateV1toV2(v1);

    expect(v2.version).toBe(2);
    expect(v2.sources).toHaveLength(1);
    expect(v2.sources[0].layer).toBe("L0");
    expect(v2.sources[0].path).toBe("../MyL0");
    expect(v2.sources[0].role).toBe("tooling");
  });

  it("sets topology to flat", () => {
    const v2 = migrateV1toV2(makeV1Manifest());
    expect(v2.topology).toBe("flat");
  });

  it("preserves selection", () => {
    const v1 = makeV1Manifest({
      selection: {
        mode: "explicit",
        exclude_skills: ["test"],
        exclude_agents: [],
        exclude_commands: ["run"],
        exclude_categories: ["ui"],
      },
    });
    const v2 = migrateV1toV2(v1);
    expect(v2.selection.mode).toBe("explicit");
    expect(v2.selection.exclude_skills).toEqual(["test"]);
    expect(v2.selection.exclude_commands).toEqual(["run"]);
  });

  it("preserves checksums", () => {
    const v1 = makeV1Manifest({
      checksums: { "skills/test/SKILL.md": "sha256:abc" },
    });
    const v2 = migrateV1toV2(v1);
    expect(v2.checksums["skills/test/SKILL.md"]).toBe("sha256:abc");
  });

  it("preserves l2_specific", () => {
    const v1 = makeV1Manifest({
      l2_specific: { commands: ["deploy"], agents: ["guardian"], skills: [] },
    });
    const v2 = migrateV1toV2(v1);
    expect(v2.l2_specific.commands).toEqual(["deploy"]);
    expect(v2.l2_specific.agents).toEqual(["guardian"]);
  });

  it("migrated manifest passes v2 schema validation", () => {
    const v2 = migrateV1toV2(makeV1Manifest());
    const result = ManifestSchemaV2.safeParse(v2);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateManifest (union: v1 auto-migrated, v2 direct)
// ---------------------------------------------------------------------------

describe("validateManifest", () => {
  it("accepts v2 manifest directly", () => {
    const result = validateManifest(makeV2Manifest());
    expect(result.version).toBe(2);
    expect(result.sources).toHaveLength(1);
  });

  it("auto-migrates v1 manifest to v2", () => {
    const result = validateManifest(makeV1Manifest());
    expect(result.version).toBe(2);
    expect(result.sources[0].path).toBe("../AndroidCommonDoc");
    expect(result.topology).toBe("flat");
  });

  it("throws on invalid data (neither v1 nor v2)", () => {
    expect(() => validateManifest({ version: 99 })).toThrow();
    expect(() => validateManifest({})).toThrow();
    expect(() => validateManifest("string")).toThrow();
  });

  it("v1 with checksums migrates correctly", () => {
    const v1 = makeV1Manifest({
      checksums: { ".claude/skills/test/SKILL.md": "sha256:abc" },
    });
    const result = validateManifest(v1);
    expect(result.checksums[".claude/skills/test/SKILL.md"]).toBe("sha256:abc");
  });
});

// ---------------------------------------------------------------------------
// createDefaultManifest / createChainManifest
// ---------------------------------------------------------------------------

describe("createDefaultManifest", () => {
  it("creates flat v2 manifest", () => {
    const m = createDefaultManifest("../L0");
    expect(m.version).toBe(2);
    expect(m.topology).toBe("flat");
    expect(m.sources).toHaveLength(1);
    expect(m.sources[0]).toEqual({ layer: "L0", path: "../L0", role: "tooling" });
  });

  it("passes v2 schema validation", () => {
    const m = createDefaultManifest("../L0");
    expect(ManifestSchemaV2.safeParse(m).success).toBe(true);
  });

  it("has valid ISO datetime for last_synced", () => {
    const m = createDefaultManifest("../L0");
    expect(new Date(m.last_synced).getTime()).not.toBeNaN();
  });
});

describe("createChainManifest", () => {
  it("creates chain topology with multiple sources", () => {
    const m = createChainManifest([
      { layer: "L0", path: "../../L0", role: "tooling" },
      { layer: "L1", path: "../../L1", role: "ecosystem" },
    ]);
    expect(m.version).toBe(2);
    expect(m.topology).toBe("chain");
    expect(m.sources).toHaveLength(2);
  });

  it("passes v2 schema validation", () => {
    const m = createChainManifest([
      { layer: "L0", path: "../L0", role: "tooling" },
    ]);
    expect(ManifestSchemaV2.safeParse(m).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe("getL0Source", () => {
  it("returns L0 source path from flat manifest", () => {
    const m = makeV2Manifest();
    expect(getL0Source(m)).toBe("../AndroidCommonDoc");
  });

  it("returns L0 source from chain manifest with multiple sources", () => {
    const m = makeV2Manifest({
      topology: "chain",
      sources: [
        { layer: "L0", path: "../../L0", role: "tooling" },
        { layer: "L1", path: "../L1", role: "ecosystem" },
      ],
    });
    expect(getL0Source(m)).toBe("../../L0");
  });

  it("falls back to first source if no L0 layer", () => {
    const m = makeV2Manifest({
      sources: [{ layer: "L1", path: "../L1", role: "ecosystem" }],
    });
    expect(getL0Source(m)).toBe("../L1");
  });
});

describe("getOrderedSources", () => {
  it("returns sources sorted by layer name", () => {
    const m = makeV2Manifest({
      sources: [
        { layer: "L1", path: "../L1", role: "ecosystem" },
        { layer: "L0", path: "../L0", role: "tooling" },
      ],
    });
    const ordered = getOrderedSources(m);
    expect(ordered[0].layer).toBe("L0");
    expect(ordered[1].layer).toBe("L1");
  });

  it("does not mutate original sources array", () => {
    const m = makeV2Manifest({
      sources: [
        { layer: "L1", path: "../L1", role: "ecosystem" },
        { layer: "L0", path: "../L0", role: "tooling" },
      ],
    });
    getOrderedSources(m);
    expect(m.sources[0].layer).toBe("L1"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

describe("readManifest", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads and validates v2 JSON file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "manifest-"));
    const fp = join(tmpDir, "l0-manifest.json");
    await writeFile(fp, JSON.stringify(makeV2Manifest()), "utf-8");

    const result = await readManifest(fp);
    expect(result.version).toBe(2);
  });

  it("reads v1 JSON and auto-migrates to v2", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "manifest-"));
    const fp = join(tmpDir, "l0-manifest.json");
    await writeFile(fp, JSON.stringify(makeV1Manifest()), "utf-8");

    const result = await readManifest(fp);
    expect(result.version).toBe(2);
    expect(result.sources[0].path).toBe("../AndroidCommonDoc");
  });

  it("throws on invalid JSON", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "manifest-"));
    const fp = join(tmpDir, "bad.json");
    await writeFile(fp, "{ invalid }", "utf-8");
    await expect(readManifest(fp)).rejects.toThrow();
  });
});

describe("writeManifest", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes v2 manifest with 2-space indent + trailing newline", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "manifest-"));
    const fp = join(tmpDir, "out.json");
    const m = makeV2Manifest();
    await writeManifest(fp, m);

    const content = await readFile(fp, "utf-8");
    expect(content).toBe(JSON.stringify(m, null, 2) + "\n");
  });
});

// ---------------------------------------------------------------------------
// Example manifests
// ---------------------------------------------------------------------------

describe("generateExampleManifests", () => {
  it("generates sharedLibs (flat), myApp (flat), myAppChain (chain)", () => {
    const ex = generateExampleManifests();
    expect(ex.sharedLibs.topology).toBe("flat");
    expect(ex.myApp.topology).toBe("flat");
    expect(ex.myAppChain.topology).toBe("chain");
  });

  it("all examples pass v2 schema validation", () => {
    const ex = generateExampleManifests();
    expect(ManifestSchemaV2.safeParse(ex.sharedLibs).success).toBe(true);
    expect(ManifestSchemaV2.safeParse(ex.myApp).success).toBe(true);
    expect(ManifestSchemaV2.safeParse(ex.myAppChain).success).toBe(true);
  });

  it("chain example has L0 + L1 sources", () => {
    const { myAppChain } = generateExampleManifests();
    expect(myAppChain.sources).toHaveLength(2);
    expect(myAppChain.sources[0].layer).toBe("L0");
    expect(myAppChain.sources[1].layer).toBe("L1");
  });

  it("sharedLibs excludes product category", () => {
    const { sharedLibs } = generateExampleManifests();
    expect(sharedLibs.selection.exclude_categories).toContain("product");
  });
});
