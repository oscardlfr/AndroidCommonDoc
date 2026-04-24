import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectMigrations,
  applyMigrations,
  type MigrationRegistry,
} from "../../src/sync/sync-engine.js";
import {
  createDefaultManifest,
  writeManifest,
  readManifest,
} from "../../src/sync/manifest-schema.js";

// ---------------------------------------------------------------------------
// Shared registry matching migrations.json seeds
// ---------------------------------------------------------------------------

const REGISTRY: MigrationRegistry = {
  format_version: "1.0",
  migrations: [
    {
      id: "M001",
      description: "dev-lead renamed to project-manager",
      type: "agent_rename",
      from: "dev-lead",
      to: "project-manager",
      applies_when: { l0_version_before: "5.0.0" },
    },
    {
      id: "M002",
      description: "l0-manifest.json gains migrations_applied array field",
      type: "manifest_schema_bump",
      field_to_add: "migrations_applied",
      default_value: [],
      applies_when: { field_missing: "migrations_applied" },
    },
  ],
};

// ---------------------------------------------------------------------------
// Integration scenarios
// ---------------------------------------------------------------------------

describe("sync-migration integration", () => {
  let tmpDir: string;
  let agentsDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tmpDir = await (await import("node:fs/promises")).mkdtemp(join(tmpdir(), "sync-migration-int-"));
    agentsDir = join(tmpDir, ".claude", "agents");
    await mkdir(agentsDir, { recursive: true });
    manifestPath = join(tmpDir, "l0-manifest.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // Scenario A: M001 — dev-lead.md renamed to project-manager.md
  it("Scenario A: M001 with --auto-migrate renames dev-lead.md to project-manager.md", async () => {
    // Setup: project has dev-lead.md agent
    await writeFile(join(agentsDir, "dev-lead.md"), "# dev-lead agent", "utf8");
    const manifest = createDefaultManifest("../AndroidCommonDoc");
    await writeManifest(manifestPath, manifest);

    // Act: detect + apply (simulates --auto-migrate)
    const pending = await detectMigrations(tmpDir, REGISTRY, manifest);
    expect(pending.map(m => m.id)).toContain("M001");

    await applyMigrations(tmpDir, pending.filter(m => m.id === "M001"), manifest, manifestPath);

    // Assert: project-manager.md exists, dev-lead.md gone
    await expect(access(join(agentsDir, "project-manager.md"))).resolves.toBeUndefined();
    await expect(access(join(agentsDir, "dev-lead.md"))).rejects.toThrow();

    // Assert: M001 recorded in manifest
    const updated = await readManifest(manifestPath);
    expect(updated.migrations_applied).toContain("M001");
  });

  // Scenario B: M002 — manifest gains migrations_applied field
  it("Scenario B: M002 with --auto-migrate adds migrations_applied to manifest", async () => {
    // Setup: manifest without migrations_applied (simulates pre-W31 manifest on disk)
    const manifest = createDefaultManifest("../AndroidCommonDoc");
    // Simulate absence — null triggers the field_missing detection in detectMigrations
    const manifestWithout = { ...manifest, migrations_applied: null as unknown as string[] };
    await writeManifest(manifestPath, manifest);

    // Act: detect + apply
    const pending = await detectMigrations(tmpDir, REGISTRY, manifestWithout);
    expect(pending.map(m => m.id)).toContain("M002");

    await applyMigrations(tmpDir, pending.filter(m => m.id === "M002"), manifestWithout, manifestPath);

    // Assert: manifest now has migrations_applied with M002
    const updated = await readManifest(manifestPath);
    expect(updated.migrations_applied).toContain("M002");
  });
});
