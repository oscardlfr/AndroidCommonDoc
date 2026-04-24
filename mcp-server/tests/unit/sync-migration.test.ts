import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectMigrations,
  applyMigrations,
  type MigrationRegistry,
  type MigrationEntry,
} from "../../src/sync/sync-engine.js";
import {
  ManifestSchemaV2,
  createDefaultManifest,
  writeManifest,
  readManifest,
  type Manifest,
} from "../../src/sync/manifest-schema.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides?: Partial<Manifest>): Manifest {
  return {
    version: 2,
    sources: [{ layer: "L0", path: "../AndroidCommonDoc", role: "tooling" as const }],
    topology: "flat",
    last_synced: "2026-04-24T00:00:00Z",
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
    },
    checksums: {},
    l2_specific: { commands: [], agents: [], skills: [] },
    migrations_applied: [],
    ...overrides,
  };
}

const M001: MigrationEntry = {
  id: "M001",
  description: "dev-lead renamed to project-manager",
  type: "agent_rename",
  from: "dev-lead",
  to: "project-manager",
  applies_when: { l0_version_before: "5.0.0" },
};

const M002: MigrationEntry = {
  id: "M002",
  description: "l0-manifest.json gains migrations_applied array field",
  type: "manifest_schema_bump",
  field_to_add: "migrations_applied",
  default_value: [],
  applies_when: { field_missing: "migrations_applied" },
};

const REGISTRY: MigrationRegistry = {
  format_version: "1.0",
  migrations: [M001, M002],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sync-migration — detectMigrations + applyMigrations", () => {
  let tmpDir: string;
  let agentsDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tmpDir = await (await import("node:fs/promises")).mkdtemp(join(tmpdir(), "sync-migration-"));
    agentsDir = join(tmpDir, ".claude", "agents");
    await mkdir(agentsDir, { recursive: true });
    manifestPath = join(tmpDir, "l0-manifest.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // Test 1
  it("detectMigrations() returns empty array when no migrations pending", async () => {
    const manifest = makeManifest({ migrations_applied: ["M001", "M002"] });
    const pending = await detectMigrations(tmpDir, REGISTRY, manifest);
    expect(pending).toHaveLength(0);
  });

  // Test 2
  it("detectMigrations() returns M001 when target has dev-lead agent (case-insensitive — A5)", async () => {
    await writeFile(join(agentsDir, "dev-lead.md"), "# dev-lead", "utf8");
    const manifest = makeManifest();
    const pending = await detectMigrations(tmpDir, REGISTRY, manifest);
    expect(pending.map(m => m.id)).toContain("M001");
  });

  // Test 3
  it("detectMigrations() returns M002 when manifest missing migrations_applied", async () => {
    // Simulate a manifest loaded before the schema update (field is null/absent)
    const manifest = makeManifest({ migrations_applied: null as unknown as string[] });
    const pending = await detectMigrations(tmpDir, REGISTRY, manifest);
    expect(pending.map(m => m.id)).toContain("M002");
  });

  // Test 4
  it("applyMigrations() M001 renames dev-lead.md to project-manager.md", async () => {
    await writeFile(join(agentsDir, "dev-lead.md"), "# dev-lead", "utf8");
    const manifest = makeManifest();
    await writeManifest(manifestPath, manifest);
    const pending = [M001];
    await applyMigrations(tmpDir, pending, manifest, manifestPath);
    const { access } = await import("node:fs/promises");
    await expect(access(join(agentsDir, "project-manager.md"))).resolves.toBeUndefined();
  });

  // Test 5
  it("applyMigrations() M002 adds migrations_applied field to manifest", async () => {
    const manifest = makeManifest();
    await writeManifest(manifestPath, manifest);
    await applyMigrations(tmpDir, [M002], manifest, manifestPath);
    const updated = await readManifest(manifestPath);
    expect(updated.migrations_applied).toContain("M002");
  });

  // Test 6
  it("applyMigrations() is idempotent — double-apply is a no-op", async () => {
    await writeFile(join(agentsDir, "dev-lead.md"), "# dev-lead", "utf8");
    const manifest = makeManifest();
    await writeManifest(manifestPath, manifest);
    await applyMigrations(tmpDir, [M001], manifest, manifestPath);
    // Second apply — should not throw, should not duplicate entry
    const updated = await readManifest(manifestPath);
    await applyMigrations(tmpDir, [M001], updated, manifestPath);
    const final = await readManifest(manifestPath);
    const m001Count = final.migrations_applied.filter(id => id === "M001").length;
    expect(m001Count).toBe(1);
  });

  // Test 7 (A5)
  it("detectMigrations() normalizes to lowercase — Dev-Lead.md matches M001", async () => {
    await writeFile(join(agentsDir, "Dev-Lead.md"), "# dev-lead", "utf8");
    const manifest = makeManifest();
    const pending = await detectMigrations(tmpDir, REGISTRY, manifest);
    expect(pending.map(m => m.id)).toContain("M001");
  });

  // Test 8 (A9)
  it("ManifestSchemaV2 accepts migrations_applied array without throwing", () => {
    const result = ManifestSchemaV2.safeParse({
      version: 2,
      sources: [{ layer: "L0", path: "../AndroidCommonDoc", role: "tooling" }],
      topology: "flat",
      last_synced: "2026-04-24T00:00:00Z",
      selection: { mode: "include-all", exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [] },
      checksums: {},
      l2_specific: { commands: [], agents: [], skills: [] },
      migrations_applied: ["M001", "M002"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.migrations_applied).toEqual(["M001", "M002"]);
    }
  });

  // Test 9 (A9)
  it("ManifestSchemaV2 defaults migrations_applied to [] when absent", () => {
    const result = ManifestSchemaV2.safeParse({
      version: 2,
      sources: [{ layer: "L0", path: "../AndroidCommonDoc", role: "tooling" }],
      topology: "flat",
      last_synced: "2026-04-24T00:00:00Z",
      selection: { mode: "include-all", exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [] },
      checksums: {},
      l2_specific: { commands: [], agents: [], skills: [] },
      // migrations_applied intentionally absent
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.migrations_applied).toEqual([]);
    }
  });
});
