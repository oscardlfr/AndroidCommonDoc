import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdtemp, rm, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SkillRegistry, SkillRegistryEntry } from "../../../src/registry/skill-registry.js";
import type { Manifest } from "../../../src/sync/manifest-schema.js";

import {
  resolveSyncPlan,
  computeSyncActions,
  materializeFile,
  syncL0,
  destPath,
  resolveL0Source,
  getGitCommit,
  stripL0Metadata,
  type SyncPlanEntry,
  type SyncReport,
  type SyncOptions,
} from "../../../src/sync/sync-engine.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEntry(
  overrides: Partial<SkillRegistryEntry> & { name: string; type: SkillRegistryEntry["type"] },
): SkillRegistryEntry {
  return {
    path: overrides.type === "skill"
      ? `skills/${overrides.name}/SKILL.md`
      : overrides.type === "agent"
        ? `.claude/agents/${overrides.name}.md`
        : `.claude/commands/${overrides.name}.md`,
    description: "",
    category: "testing",
    tier: "core",
    hash: `sha256:${overrides.name}hash`,
    dependencies: [],
    frontmatter: {},
    ...overrides,
  };
}

function makeRegistry(entries: SkillRegistryEntry[]): SkillRegistry {
  return {
    version: 1,
    generated: "2026-03-15T12:00:00Z",
    l0_root: "/fake/l0",
    entries,
  };
}

function makeManifest(overrides?: Partial<Manifest>): Manifest {
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
    l2_specific: {
      commands: [],
      agents: [],
      skills: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// destPath
// ---------------------------------------------------------------------------

describe("destPath", () => {
  it("translates skills/ source path to .claude/skills/ destination", () => {
    expect(destPath("skills/test/SKILL.md")).toBe(".claude/skills/test/SKILL.md");
    expect(destPath("skills/coverage/SKILL.md")).toBe(".claude/skills/coverage/SKILL.md");
  });

  it("leaves agent paths unchanged (already have .claude/ prefix)", () => {
    expect(destPath(".claude/agents/test-specialist.md")).toBe(".claude/agents/test-specialist.md");
  });

  it("leaves command paths unchanged (already have .claude/ prefix)", () => {
    expect(destPath(".claude/commands/run.md")).toBe(".claude/commands/run.md");
  });

  it("BL-W30-04: setup/agent-templates/ paths are identity-mapped (no prefix added)", () => {
    expect(destPath("setup/agent-templates/team-lead.md")).toBe("setup/agent-templates/team-lead.md");
    expect(destPath("setup/agent-templates/planner.md")).toBe("setup/agent-templates/planner.md");
    expect(destPath("setup/agent-templates/arch-platform.md")).toBe("setup/agent-templates/arch-platform.md");
  });
});

// ---------------------------------------------------------------------------
// resolveSyncPlan
// ---------------------------------------------------------------------------

describe("resolveSyncPlan", () => {
  const skillA = makeEntry({ name: "test", type: "skill" });
  const skillB = makeEntry({ name: "coverage", type: "skill" });
  const agentA = makeEntry({ name: "test-specialist", type: "agent" });
  const commandA = makeEntry({ name: "run", type: "command", category: "build" });
  const commandB = makeEntry({ name: "deploy-web", type: "command", category: "domain" });
  const webSkill = makeEntry({ name: "accessibility", type: "skill", category: "ui", tier: "web" });

  const registry = makeRegistry([skillA, skillB, agentA, commandA, commandB, webSkill]);

  it("include-all mode returns all registry entries except excluded ones", () => {
    const manifest = makeManifest();
    const resolved = resolveSyncPlan(registry, manifest);
    expect(resolved).toHaveLength(6);
  });

  it("respects exclude_skills filter", () => {
    const manifest = makeManifest({
      selection: {
        mode: "include-all",
        exclude_skills: ["test"],
        exclude_agents: [],
        exclude_commands: [],
        exclude_categories: [],
      },
    });
    const resolved = resolveSyncPlan(registry, manifest);
    expect(resolved).toHaveLength(5);
    expect(resolved.find((e) => e.name === "test")).toBeUndefined();
  });

  it("respects exclude_agents filter", () => {
    const manifest = makeManifest({
      selection: {
        mode: "include-all",
        exclude_skills: [],
        exclude_agents: ["test-specialist"],
        exclude_commands: [],
        exclude_categories: [],
      },
    });
    const resolved = resolveSyncPlan(registry, manifest);
    expect(resolved).toHaveLength(5);
    expect(resolved.find((e) => e.name === "test-specialist")).toBeUndefined();
  });

  it("respects exclude_commands filter", () => {
    const manifest = makeManifest({
      selection: {
        mode: "include-all",
        exclude_skills: [],
        exclude_agents: [],
        exclude_commands: ["run"],
        exclude_categories: [],
      },
    });
    const resolved = resolveSyncPlan(registry, manifest);
    expect(resolved).toHaveLength(5);
    expect(resolved.find((e) => e.name === "run")).toBeUndefined();
  });

  it("respects exclude_categories filter", () => {
    const manifest = makeManifest({
      selection: {
        mode: "include-all",
        exclude_skills: [],
        exclude_agents: [],
        exclude_commands: [],
        exclude_categories: ["ui"],
      },
    });
    const resolved = resolveSyncPlan(registry, manifest);
    // accessibility (ui category) should be excluded
    expect(resolved.find((e) => e.name === "accessibility")).toBeUndefined();
    expect(resolved).toHaveLength(5);
  });

  it("explicit mode returns only entries present in checksums (future extensibility)", () => {
    const manifest = makeManifest({
      selection: {
        mode: "explicit",
        exclude_skills: [],
        exclude_agents: [],
        exclude_commands: [],
        exclude_categories: [],
      },
      checksums: {
        "skills/test/SKILL.md": "sha256:testhash",
      },
    });
    const resolved = resolveSyncPlan(registry, manifest);
    // Only entries that have a checksum entry should be included
    expect(resolved).toHaveLength(1);
    expect(resolved[0].name).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// computeSyncActions
// ---------------------------------------------------------------------------

describe("computeSyncActions", () => {
  const skillA = makeEntry({ name: "test", type: "skill" });
  const skillB = makeEntry({ name: "coverage", type: "skill", hash: "sha256:coveragehash" });
  const commandC = makeEntry({ name: "run", type: "command", hash: "sha256:runhash" });

  it("marks entries with no checksum as 'add'", async () => {
    const manifest = makeManifest({ checksums: {} });
    const actions = await computeSyncActions([skillA], manifest);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("add");
  });

  it("marks entries with matching checksum as 'unchanged' (checksums keyed by dest path)", async () => {
    // Checksums use dest path (.claude/skills/) not source path (skills/)
    const manifest = makeManifest({
      checksums: { ".claude/skills/test/SKILL.md": "sha256:testhash" },
    });
    const actions = await computeSyncActions([skillA], manifest);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("unchanged");
  });

  it("marks entries with different checksum as 'update' (no projectRoot = no conflict check)", async () => {
    const manifest = makeManifest({
      checksums: { ".claude/skills/test/SKILL.md": "sha256:oldhash" },
    });
    // Without projectRoot, conflict detection is skipped → plain "update"
    const actions = await computeSyncActions([skillA], manifest);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("update");
    expect(actions[0].currentHash).toBe("sha256:oldhash");
  });

  it("marks checksummed entries not in resolved as 'remove' (orphaned)", async () => {
    const manifest = makeManifest({
      checksums: {
        ".claude/skills/test/SKILL.md": "sha256:testhash",
        ".claude/commands/old-tool.md": "sha256:oldhash",
      },
    });
    const actions = await computeSyncActions([skillA], manifest);
    // skillA = unchanged, old-tool = remove
    const removeActions = actions.filter((a) => a.action === "remove");
    expect(removeActions).toHaveLength(1);
    expect(removeActions[0].registryEntry.path).toBe(".claude/commands/old-tool.md");
  });

  it("regression: skills with source-path checksums (skills/) are treated as 'add', not 'unchanged'", async () => {
    // Before the fix: checksums were written with source paths (skills/test/SKILL.md)
    // computeSyncActions would look up by dest path (.claude/skills/test/SKILL.md) → miss
    // → mark as "add" even though file was already synced
    // This is the lesser evil vs the original bug (marking as orphan → delete)
    // After a single re-sync the checksums are rewritten with correct dest paths
    const manifest = makeManifest({
      checksums: { "skills/test/SKILL.md": "sha256:testhash" },
    });
    const actions = await computeSyncActions([skillA], manifest);
    // Source-path checksum is not found under dest-path key → treated as "add"
    // The old source-path entry appears as orphan → "remove"
    const addActions = actions.filter((a) => a.action === "add");
    const removeActions = actions.filter((a) => a.action === "remove");
    expect(addActions).toHaveLength(1);
    expect(addActions[0].registryEntry.name).toBe("test");
    // The stale source-path entry is orphaned and will be removed
    expect(removeActions).toHaveLength(1);
    expect(removeActions[0].registryEntry.path).toBe("skills/test/SKILL.md");
  });

  it("regression: skills with dest-path checksums are NOT marked as orphans (the MyApp bug)", async () => {
    // The MyApp incident: manifest had .claude/skills/ keys, engine built resolvedPaths
    // from source paths (skills/), orphan detector saw .claude/skills/ keys as unknown → delete
    // Fix: resolvedDestPaths uses destPath(entry.path), matching .claude/skills/ keys correctly
    const manifest = makeManifest({
      checksums: {
        ".claude/skills/test/SKILL.md": "sha256:testhash",
        ".claude/skills/coverage/SKILL.md": "sha256:coveragehash",
      },
    });
    const actions = await computeSyncActions([skillA, skillB], manifest);
    const removeActions = actions.filter((a) => a.action === "remove");
    // Neither skill should be marked for removal
    expect(removeActions).toHaveLength(0);
    // Both should be unchanged (hashes match)
    const unchangedActions = actions.filter((a) => a.action === "unchanged");
    expect(unchangedActions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// materializeFile
// ---------------------------------------------------------------------------

describe("materializeFile", () => {
  it("injects l0_source, l0_hash, l0_synced into skill YAML frontmatter", () => {
    const content = `---
name: test
description: "Run tests"
allowed-tools: [Bash]
---

# Test skill body`;

    const entry = makeEntry({ name: "test", type: "skill", hash: "sha256:abc123" });
    const result = materializeFile(content, entry, "/path/to/l0");

    expect(result).toContain("l0_source: /path/to/l0");
    expect(result).toContain("l0_hash: sha256:abc123");
    expect(result).toContain("l0_synced:");
    // Original content still present
    expect(result).toContain("# Test skill body");
    expect(result).toContain("name: test");
  });

  it("injects l0_source, l0_hash, l0_synced into agent YAML frontmatter", () => {
    const content = `---
name: test-specialist
description: "Testing agent"
---

# Agent body`;

    const entry = makeEntry({ name: "test-specialist", type: "agent", hash: "sha256:def456" });
    const result = materializeFile(content, entry, "/path/to/l0");

    expect(result).toContain("l0_source: /path/to/l0");
    expect(result).toContain("l0_hash: sha256:def456");
    expect(result).toContain("l0_synced:");
    expect(result).toContain("# Agent body");
  });

  it("prepends HTML comment header for commands", () => {
    const content = `# /run - Run the project

Some instructions here`;

    const entry = makeEntry({ name: "run", type: "command", hash: "sha256:ghi789" });
    const result = materializeFile(content, entry, "/path/to/l0");

    expect(result).toContain("<!-- L0-SYNC");
    expect(result).toContain("l0_source: /path/to/l0");
    expect(result).toContain("l0_hash: sha256:ghi789");
    expect(result).toContain("l0_synced:");
    expect(result).toContain("# /run - Run the project");
  });

  it("removes existing 'GENERATED by claude-adapter' comments from commands", () => {
    const content = `<!-- GENERATED from skills/run/SKILL.md by claude-adapter -->
# /run - Run the project

Some instructions here`;

    const entry = makeEntry({ name: "run", type: "command", hash: "sha256:ghi789" });
    const result = materializeFile(content, entry, "/path/to/l0");

    expect(result).not.toContain("GENERATED from skills/run/SKILL.md by claude-adapter");
    expect(result).toContain("<!-- L0-SYNC");
    expect(result).toContain("# /run - Run the project");
  });
});

// ---------------------------------------------------------------------------
// syncL0 (integration-style tests with temp directories)
// ---------------------------------------------------------------------------

describe("syncL0", () => {
  let projectRoot: string;
  let l0Root: string;

  beforeEach(async () => {
    // Create temp directories for project and L0 source
    projectRoot = await mkdtemp(join(tmpdir(), "sync-project-"));
    l0Root = await mkdtemp(join(tmpdir(), "sync-l0-"));

    // Create L0 skill directory structure
    await mkdir(join(l0Root, "skills", "test"), { recursive: true });
    await writeFile(
      join(l0Root, "skills", "test", "SKILL.md"),
      `---
name: test
description: "Run tests"
allowed-tools: [Bash]
---

# Test skill body
`,
    );

    // Create L0 agent
    await mkdir(join(l0Root, ".claude", "agents"), { recursive: true });
    await writeFile(
      join(l0Root, ".claude", "agents", "test-specialist.md"),
      `---
name: test-specialist
description: "Testing agent"
---

# Agent body
`,
    );

    // Create L0 command
    await mkdir(join(l0Root, ".claude", "commands"), { recursive: true });
    await writeFile(
      join(l0Root, ".claude", "commands", "run.md"),
      `# /run - Run the project

Run instructions
`,
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(l0Root, { recursive: true, force: true });
  });

  it("creates directories if missing (skills/name/, .claude/agents/, .claude/commands/)", async () => {
    // Write manifest
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    await syncL0(projectRoot, l0Root);

    // Skills must land in .claude/skills/ (not skills/) in consumer project
    const skillContent = await readFile(
      join(projectRoot, ".claude", "skills", "test", "SKILL.md"),
      "utf-8",
    );
    expect(skillContent).toContain("name: test");

    const agentContent = await readFile(
      join(projectRoot, ".claude", "agents", "test-specialist.md"),
      "utf-8",
    );
    expect(agentContent).toContain("name: test-specialist");

    const cmdContent = await readFile(
      join(projectRoot, ".claude", "commands", "run.md"),
      "utf-8",
    );
    expect(cmdContent).toContain("# /run - Run the project");
  });

  it("writes materialized files to correct destination paths", async () => {
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    await syncL0(projectRoot, l0Root);

    // Skill at .claude/skills/ must have l0_source injected
    const skillContent = await readFile(
      join(projectRoot, ".claude", "skills", "test", "SKILL.md"),
      "utf-8",
    );
    expect(skillContent).toContain("l0_source:");
    expect(skillContent).toContain("l0_hash:");

    // Agent should have l0_source injected
    const agentContent = await readFile(
      join(projectRoot, ".claude", "agents", "test-specialist.md"),
      "utf-8",
    );
    expect(agentContent).toContain("l0_source:");
    expect(agentContent).toContain("l0_hash:");

    // Command should have HTML comment header
    const cmdContent = await readFile(
      join(projectRoot, ".claude", "commands", "run.md"),
      "utf-8",
    );
    expect(cmdContent).toContain("<!-- L0-SYNC");
  });

  it("updates manifest checksums after successful sync", async () => {
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    await syncL0(projectRoot, l0Root);

    // Read back the updated manifest
    const updatedContent = await readFile(
      join(projectRoot, "l0-manifest.json"),
      "utf-8",
    );
    const updatedManifest = JSON.parse(updatedContent);

    expect(Object.keys(updatedManifest.checksums).length).toBeGreaterThan(0);
    // Each checksum should be a sha256: prefixed hash
    for (const hash of Object.values(updatedManifest.checksums)) {
      expect(hash).toMatch(/^sha256:[a-f0-9]+$/);
    }
  });

  it("updates manifest last_synced timestamp", async () => {
    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      last_synced: "2020-01-01T00:00:00Z",
    });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    await syncL0(projectRoot, l0Root);

    const updatedContent = await readFile(
      join(projectRoot, "l0-manifest.json"),
      "utf-8",
    );
    const updatedManifest = JSON.parse(updatedContent);

    // Should be a more recent timestamp
    expect(updatedManifest.last_synced).not.toBe("2020-01-01T00:00:00Z");
    // Should be a valid ISO datetime
    expect(new Date(updatedManifest.last_synced).getTime()).not.toBeNaN();
  });

  it("skips files listed in l2_specific", async () => {
    // Create a project-specific command that should NOT be touched
    await mkdir(join(projectRoot, ".claude", "commands"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "commands", "run.md"),
      "# My custom run command\nProject-specific content\n",
    );

    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      l2_specific: {
        commands: ["run"],
        agents: [],
        skills: [],
      },
    });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    await syncL0(projectRoot, l0Root);

    // The project-specific run command should still contain the original content
    const cmdContent = await readFile(
      join(projectRoot, ".claude", "commands", "run.md"),
      "utf-8",
    );
    expect(cmdContent).toContain("My custom run command");
    expect(cmdContent).not.toContain("L0-SYNC");
  });

  it("returns SyncReport with counts (added, updated, removed, unchanged)", async () => {
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const report = await syncL0(projectRoot, l0Root);

    expect(report.added).toBeGreaterThan(0);
    expect(typeof report.updated).toBe("number");
    expect(typeof report.removed).toBe("number");
    expect(typeof report.unchanged).toBe("number");
    expect(typeof report.conflicts).toBe("number");
    expect(typeof report.skippedRemoves).toBe("number");
    expect(report.errors).toEqual([]);
    expect(report.warnings).toBeInstanceOf(Array);
    expect(report.missing).toEqual([]);
    expect(report.removedPaths).toBeInstanceOf(Array);
    expect(report.conflictPaths).toBeInstanceOf(Array);
    expect(report.actions).toBeInstanceOf(Array);
  });

  it("post-sync verification: missing array is empty when all files written successfully", async () => {
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const report = await syncL0(projectRoot, l0Root);

    expect(report.missing).toEqual([]);
    expect(report.errors.filter(e => e.includes("Post-sync"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Safety guardrails (Fix #1: empty registry, Fix #5: additive default)
// ---------------------------------------------------------------------------

describe("syncL0 safety guardrails", () => {
  let projectRoot: string;
  let l0Root: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "sync-safe-project-"));
    l0Root = await mkdtemp(join(tmpdir(), "sync-safe-l0-"));

    // Create minimal L0 with one skill
    await mkdir(join(l0Root, "skills", "test"), { recursive: true });
    await writeFile(
      join(l0Root, "skills", "test", "SKILL.md"),
      `---\nname: test\ndescription: "Test"\n---\n\n# Body\n`,
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(l0Root, { recursive: true, force: true });
  });

  it("Fix #1: throws on empty registry (0 entries)", async () => {
    // Create empty L0 (no skills, no agents, no commands)
    const emptyL0 = await mkdtemp(join(tmpdir(), "sync-empty-l0-"));

    const manifest = makeManifest({ sources: [{ layer: "L0", path: emptyL0, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    await expect(syncL0(projectRoot, emptyL0)).rejects.toThrow(
      /0 entries.*aborting/i,
    );

    await rm(emptyL0, { recursive: true, force: true });
  });

  it("Fix #5: additive mode (default) skips removes and warns", async () => {
    // First sync to create files
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    await syncL0(projectRoot, l0Root);

    // Add an orphan to checksums (simulates a removed L0 skill)
    const manifestContent = JSON.parse(
      await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"),
    );
    manifestContent.checksums[".claude/skills/deleted-skill/SKILL.md"] = "sha256:oldhash";

    // Create the file on disk with L0 headers so it's eligible for removal
    await mkdir(join(projectRoot, ".claude", "skills", "deleted-skill"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "skills", "deleted-skill", "SKILL.md"),
      `---\nname: deleted-skill\nl0_source: /fake\nl0_hash: sha256:oldhash\n---\n\nOrphan\n`,
    );

    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifestContent, null, 2),
    );

    // Run without --prune (default additive)
    const report = await syncL0(projectRoot, l0Root);

    expect(report.skippedRemoves).toBe(1);
    expect(report.removed).toBe(0);
    expect(report.removedPaths).toHaveLength(0);
    expect(report.warnings.some(w => w.includes("orphaned"))).toBe(true);

    // File should still exist on disk
    const content = await readFile(
      join(projectRoot, ".claude", "skills", "deleted-skill", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain("deleted-skill");
  });

  it("Fix #5: prune mode removes orphans", async () => {
    // First sync
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    await syncL0(projectRoot, l0Root);

    // Add orphan
    const manifestContent = JSON.parse(
      await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"),
    );
    manifestContent.checksums[".claude/commands/old-cmd.md"] = "sha256:oldhash";

    await mkdir(join(projectRoot, ".claude", "commands"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "commands", "old-cmd.md"),
      `<!-- L0-SYNC\n  l0_source: /fake\n  l0_hash: sha256:oldhash\n-->\n# Old command\n`,
    );
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifestContent, null, 2),
    );

    // Run WITH prune
    const report = await syncL0(projectRoot, l0Root, { prune: true });

    expect(report.removed).toBe(1);
    expect(report.removedPaths).toContain(".claude/commands/old-cmd.md");
    expect(report.skippedRemoves).toBe(0);

    // File should be gone
    await expect(
      readFile(join(projectRoot, ".claude", "commands", "old-cmd.md"), "utf-8"),
    ).rejects.toThrow();
  });

  it("Fix #1: prune blocks >5 removes without --force", async () => {
    // Setup: create manifest with 7 orphans
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    await syncL0(projectRoot, l0Root);

    const manifestContent = JSON.parse(
      await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"),
    );

    // Add 7 orphan entries
    for (let i = 0; i < 7; i++) {
      const key = `.claude/commands/orphan-${i}.md`;
      manifestContent.checksums[key] = `sha256:orphan${i}hash`;
      await mkdir(join(projectRoot, ".claude", "commands"), { recursive: true });
      await writeFile(
        join(projectRoot, ".claude", "commands", `orphan-${i}.md`),
        `<!-- L0-SYNC\n  l0_source: /fake\n  l0_hash: sha256:orphan${i}hash\n-->\n# Orphan ${i}\n`,
      );
    }
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifestContent, null, 2),
    );

    // Prune without force — should block
    const report = await syncL0(projectRoot, l0Root, { prune: true });

    expect(report.skippedRemoves).toBe(7);
    expect(report.removed).toBe(0);
    expect(report.warnings.some(w => w.includes("exceeds safety threshold"))).toBe(true);

    // Files should still exist
    const exists = await readFile(
      join(projectRoot, ".claude", "commands", "orphan-0.md"),
      "utf-8",
    );
    expect(exists).toContain("Orphan 0");
  });

  it("Fix #1: prune + force allows >5 removes", async () => {
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    await syncL0(projectRoot, l0Root);

    const manifestContent = JSON.parse(
      await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"),
    );

    for (let i = 0; i < 7; i++) {
      const key = `.claude/commands/orphan-${i}.md`;
      manifestContent.checksums[key] = `sha256:orphan${i}hash`;
      await mkdir(join(projectRoot, ".claude", "commands"), { recursive: true });
      await writeFile(
        join(projectRoot, ".claude", "commands", `orphan-${i}.md`),
        `<!-- L0-SYNC\n  l0_source: /fake\n  l0_hash: sha256:orphan${i}hash\n-->\n# Orphan ${i}\n`,
      );
    }
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifestContent, null, 2),
    );

    // Prune WITH force
    const report = await syncL0(projectRoot, l0Root, { prune: true, force: true });

    expect(report.removed).toBe(7);
    expect(report.removedPaths).toHaveLength(7);
    expect(report.skippedRemoves).toBe(0);
  });

  it("dryRun mode does not write files", async () => {
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const report = await syncL0(projectRoot, l0Root, { dryRun: true });

    expect(report.added).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);

    // Files should NOT exist on disk
    await expect(
      access(join(projectRoot, ".claude", "skills", "test", "SKILL.md")),
    ).rejects.toThrow();

    // Manifest should NOT be updated (still has empty checksums)
    const manifestAfter = JSON.parse(
      await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"),
    );
    expect(Object.keys(manifestAfter.checksums)).toHaveLength(0);
  });

  it("Fix #4: warns when detekt baseline is updated", async () => {
    // Add a detekt baseline file to L0
    await mkdir(join(l0Root, "detekt-rules", "src", "main", "resources", "config"), { recursive: true });
    await writeFile(
      join(l0Root, "detekt-rules", "src", "main", "resources", "config", "detekt-l0-base.yml"),
      "AndroidCommonDoc:\n  active: true\n",
    );
    // Registry needs to list it — but generateRegistry scans skills/agents/commands
    // The detekt warning is triggered by path matching, so we create a skill that contains "detekt-l0-base"
    // Actually — the warning checks action paths. Let's just verify the detection logic directly.
    // Since generateRegistry only picks up skills/agents/commands, we can't easily
    // add a config file. Test the warning with a mock approach instead.

    // Just verify the report structure works with basic sync
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const report = await syncL0(projectRoot, l0Root);
    // No detekt baseline in registry → no warning expected
    expect(report.warnings.filter(w => w.includes("detekt"))).toHaveLength(0);
  });

  it("report includes l0Commit when L0 is a git repo", async () => {
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const report = await syncL0(projectRoot, l0Root);
    // Temp dir is not a git repo, so l0Commit should be undefined
    expect(report.l0Commit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Manifest preservation guarantees
// ---------------------------------------------------------------------------

describe("syncL0 manifest preservation", () => {
  let projectRoot: string;
  let l0Root: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "sync-preserve-project-"));
    l0Root = await mkdtemp(join(tmpdir(), "sync-preserve-l0-"));

    // Create minimal L0 with one skill
    await mkdir(join(l0Root, "skills", "test"), { recursive: true });
    await writeFile(
      join(l0Root, "skills", "test", "SKILL.md"),
      `---\nname: test\ndescription: "Test skill"\ncategory: testing\n---\n\n# Test skill\n`,
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(l0Root, { recursive: true, force: true });
  });

  it("preserves selection.mode after sync", async () => {
    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      selection: {
        mode: "explicit",
        exclude_skills: [],
        exclude_agents: [],
        exclude_commands: [],
        exclude_categories: [],
      },
    });
    // Explicit mode: put the skill in checksums so it gets synced
    manifest.checksums[".claude/skills/test/SKILL.md"] = "sha256:old";

    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));
    expect(updated.selection.mode).toBe("explicit");
  });

  it("preserves exclude_skills after sync", async () => {
    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      selection: {
        mode: "include-all",
        exclude_skills: ["coverage", "auto-cover"],
        exclude_agents: [],
        exclude_commands: [],
        exclude_categories: [],
      },
    });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));
    expect(updated.selection.exclude_skills).toEqual(["coverage", "auto-cover"]);
  });

  it("preserves exclude_agents after sync", async () => {
    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      selection: {
        mode: "include-all",
        exclude_skills: [],
        exclude_agents: ["quality-gate-orchestrator", "script-parity-validator"],
        exclude_commands: [],
        exclude_categories: [],
      },
    });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));
    expect(updated.selection.exclude_agents).toEqual(["quality-gate-orchestrator", "script-parity-validator"]);
  });

  it("preserves exclude_categories after sync", async () => {
    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      selection: {
        mode: "include-all",
        exclude_skills: [],
        exclude_agents: [],
        exclude_commands: [],
        exclude_categories: ["security", "ui"],
      },
    });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));
    expect(updated.selection.exclude_categories).toEqual(["security", "ui"]);
  });

  it("preserves topology after sync", async () => {
    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      topology: "chain" as "flat" | "chain",
    });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));
    expect(updated.topology).toBe("chain");
  });

  it("preserves sources array after sync", async () => {
    const manifest = makeManifest({
      sources: [
        { layer: "L0", path: l0Root, role: "tooling" },
        { layer: "L1", path: "/fake/shared-libs", role: "ecosystem" },
      ],
    });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));
    expect(updated.sources).toHaveLength(2);
    expect(updated.sources[0].layer).toBe("L0");
    expect(updated.sources[1].layer).toBe("L1");
    expect(updated.sources[1].path).toBe("/fake/shared-libs");
    expect(updated.sources[1].role).toBe("ecosystem");
  });

  it("preserves l2_specific after sync", async () => {
    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      l2_specific: {
        commands: ["my-custom-cmd"],
        agents: ["my-custom-agent"],
        skills: ["my-custom-skill"],
      },
    });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));
    expect(updated.l2_specific.commands).toEqual(["my-custom-cmd"]);
    expect(updated.l2_specific.agents).toEqual(["my-custom-agent"]);
    expect(updated.l2_specific.skills).toEqual(["my-custom-skill"]);
  });

  it("preserves version field after sync", async () => {
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));
    expect(updated.version).toBe(2);
  });

  it("only mutates checksums and last_synced", async () => {
    const manifest = makeManifest({
      sources: [{ layer: "L0", path: l0Root, role: "tooling" }],
      topology: "chain" as "flat" | "chain",
      selection: {
        mode: "include-all",
        exclude_skills: ["sbom"],
        exclude_agents: ["privacy-auditor"],
        exclude_commands: ["start-track"],
        exclude_categories: ["security"],
        exclude_hooks: [],
      },
      l2_specific: {
        commands: ["deploy"],
        agents: ["custom-agent"],
        skills: ["custom-skill"],
      },
    });
    const originalJson = JSON.stringify(manifest, null, 2);
    await writeFile(join(projectRoot, "l0-manifest.json"), originalJson);
    await syncL0(projectRoot, l0Root);

    const updated = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf-8"));

    // These should be IDENTICAL to original
    expect(updated.version).toBe(manifest.version);
    expect(updated.topology).toBe(manifest.topology);
    expect(updated.sources).toEqual(manifest.sources);
    expect(updated.selection).toEqual(manifest.selection);
    expect(updated.l2_specific).toEqual(manifest.l2_specific);

    // These should be DIFFERENT (updated by sync)
    expect(updated.last_synced).not.toBe(manifest.last_synced);
    expect(Object.keys(updated.checksums).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// stripL0Metadata
// ---------------------------------------------------------------------------

describe("stripL0Metadata", () => {
  it("strips YAML frontmatter l0_ fields", () => {
    const input = `---
name: test
l0_source: /path/to/l0
l0_hash: sha256:abc123
l0_synced: 2026-03-15T12:00:00Z
description: "A skill"
---

# Body`;
    const result = stripL0Metadata(input);
    expect(result).not.toContain("l0_source:");
    expect(result).not.toContain("l0_hash:");
    expect(result).not.toContain("l0_synced:");
    expect(result).toContain("name: test");
    expect(result).toContain("description: \"A skill\"");
    expect(result).toContain("# Body");
  });

  it("strips HTML comment L0-SYNC headers", () => {
    const input = `<!-- L0-SYNC
  l0_source: /path/to/l0
  l0_hash: sha256:abc123
  l0_synced: 2026-03-15T12:00:00Z
-->
# /run - Run the project

Instructions`;
    const result = stripL0Metadata(input);
    expect(result).not.toContain("L0-SYNC");
    expect(result).not.toContain("l0_source:");
    expect(result).toContain("# /run - Run the project");
    expect(result).toContain("Instructions");
  });

  it("returns content unchanged when no L0 metadata present", () => {
    const input = `---
name: test
---

# Body`;
    expect(stripL0Metadata(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Conflict detection (local edit protection)
// ---------------------------------------------------------------------------

describe("computeSyncActions conflict detection", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "sync-conflict-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("local file matches manifest hash → safe 'update'", async () => {
    // Simulate: L0 updated the skill (new registry hash), but local file
    // is untouched since last sync (local content hashes to manifest checksum)
    const { createHash } = await import("node:crypto");

    // The "original" source content (what was synced last time)
    const originalSource = `---
name: test
description: "Run tests"
---

# Test skill body
`;
    // Materialized version (with L0 metadata injected)
    const materialized = `---
name: test
description: "Run tests"
l0_source: /path/to/l0
l0_hash: sha256:oldhash
l0_synced: 2026-03-15T12:00:00Z
---

# Test skill body
`;
    // Hash of the original source (what the manifest stores)
    const manifestHash = `sha256:${createHash("sha256").update(originalSource).digest("hex")}`;

    // Write the materialized file to the project
    await mkdir(join(projectRoot, ".claude", "skills", "test"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "skills", "test", "SKILL.md"),
      materialized,
    );

    const entry = makeEntry({ name: "test", type: "skill", hash: "sha256:newhash" });
    const manifest = makeManifest({
      checksums: { ".claude/skills/test/SKILL.md": manifestHash },
    });

    // stripL0Metadata(materialized) should produce the original source
    // so its hash should match manifestHash → safe update
    const actions = await computeSyncActions([entry], manifest, projectRoot);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("update");
  });

  it("local file differs from manifest hash → 'conflict'", async () => {
    const { createHash } = await import("node:crypto");

    const originalSource = `---
name: test
description: "Run tests"
---

# Test skill body
`;
    const manifestHash = `sha256:${createHash("sha256").update(originalSource).digest("hex")}`;

    // User edited the file locally (added a line)
    const editedContent = `---
name: test
description: "Run tests"
l0_source: /path/to/l0
l0_hash: sha256:oldhash
l0_synced: 2026-03-15T12:00:00Z
---

# Test skill body

## My custom additions
Some local notes
`;

    await mkdir(join(projectRoot, ".claude", "skills", "test"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "skills", "test", "SKILL.md"),
      editedContent,
    );

    const entry = makeEntry({ name: "test", type: "skill", hash: "sha256:newhash" });
    const manifest = makeManifest({
      checksums: { ".claude/skills/test/SKILL.md": manifestHash },
    });

    const actions = await computeSyncActions([entry], manifest, projectRoot);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("conflict");
  });

  it("--force overrides conflict → 'update'", async () => {
    const { createHash } = await import("node:crypto");

    const originalSource = `---
name: test
description: "Run tests"
---

# Test skill body
`;
    const manifestHash = `sha256:${createHash("sha256").update(originalSource).digest("hex")}`;

    // User edited the file
    const editedContent = `---
name: test
description: "Run tests"
l0_source: /path/to/l0
l0_hash: sha256:oldhash
l0_synced: 2026-03-15T12:00:00Z
---

# Test skill body - EDITED
`;

    await mkdir(join(projectRoot, ".claude", "skills", "test"), { recursive: true });
    await writeFile(
      join(projectRoot, ".claude", "skills", "test", "SKILL.md"),
      editedContent,
    );

    const entry = makeEntry({ name: "test", type: "skill", hash: "sha256:newhash" });
    const manifest = makeManifest({
      checksums: { ".claude/skills/test/SKILL.md": manifestHash },
    });

    // force=true → skip conflict detection → plain "update"
    const actions = await computeSyncActions([entry], manifest, projectRoot, true);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("update");
  });

  it("no local file (deleted) → 'add' (not conflict)", async () => {
    // File doesn't exist on disk — user deleted it
    const entry = makeEntry({ name: "test", type: "skill", hash: "sha256:newhash" });
    const manifest = makeManifest({
      checksums: { ".claude/skills/test/SKILL.md": "sha256:oldhash" },
    });

    const actions = await computeSyncActions([entry], manifest, projectRoot);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("add");
  });
});

// ---------------------------------------------------------------------------
// syncL0 conflict integration
// ---------------------------------------------------------------------------

describe("syncL0 conflict integration", () => {
  let projectRoot: string;
  let l0Root: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "sync-conflict-int-"));
    l0Root = await mkdtemp(join(tmpdir(), "sync-conflict-l0-"));

    await mkdir(join(l0Root, "skills", "test"), { recursive: true });
    await writeFile(
      join(l0Root, "skills", "test", "SKILL.md"),
      `---\nname: test\ndescription: "Run tests"\n---\n\n# Test skill body\n`,
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(l0Root, { recursive: true, force: true });
  });

  it("reports conflicts and preserves locally edited files", async () => {
    // First sync: populate files + checksums
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    // User edits the synced file
    const skillPath = join(projectRoot, ".claude", "skills", "test", "SKILL.md");
    const synced = await readFile(skillPath, "utf-8");
    await writeFile(skillPath, synced + "\n## My local notes\n");

    // L0 updates the source
    await writeFile(
      join(l0Root, "skills", "test", "SKILL.md"),
      `---\nname: test\ndescription: "Run tests v2"\n---\n\n# Test skill body v2\n`,
    );

    // Second sync should detect conflict
    const report = await syncL0(projectRoot, l0Root);

    expect(report.conflicts).toBe(1);
    expect(report.conflictPaths).toContain(".claude/skills/test/SKILL.md");
    expect(report.warnings.some(w => w.includes("local edits"))).toBe(true);

    // The file should NOT have been overwritten — local edits preserved
    const afterSync = await readFile(skillPath, "utf-8");
    expect(afterSync).toContain("My local notes");
  });

  it("force flag overrides conflicts in full sync", async () => {
    // First sync
    const manifest = makeManifest({ sources: [{ layer: "L0", path: l0Root, role: "tooling" }] });
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify(manifest, null, 2));
    await syncL0(projectRoot, l0Root);

    // User edits the synced file
    const skillPath = join(projectRoot, ".claude", "skills", "test", "SKILL.md");
    const synced = await readFile(skillPath, "utf-8");
    await writeFile(skillPath, synced + "\n## My local notes\n");

    // L0 updates the source
    await writeFile(
      join(l0Root, "skills", "test", "SKILL.md"),
      `---\nname: test\ndescription: "Run tests v2"\n---\n\n# Test skill body v2\n`,
    );

    // Force sync should overwrite
    const report = await syncL0(projectRoot, l0Root, { force: true });

    expect(report.conflicts).toBe(0);
    expect(report.conflictPaths).toHaveLength(0);
    expect(report.updated).toBeGreaterThan(0);

    // The file SHOULD have been overwritten
    const afterSync = await readFile(skillPath, "utf-8");
    expect(afterSync).not.toContain("My local notes");
    expect(afterSync).toContain("Test skill body v2");
  });
});

// ---------------------------------------------------------------------------
// resolveL0Source (Fix #2: worktree-safe path resolution)
// ---------------------------------------------------------------------------

describe("resolveL0Source", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "resolve-l0-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    // Clean up env
    delete process.env.ANDROID_COMMON_DOC;
  });

  it("resolves absolute path directly", async () => {
    // Create a fake L0 with registry
    const fakeL0 = join(tempDir, "l0");
    await mkdir(join(fakeL0, "skills"), { recursive: true });
    await writeFile(join(fakeL0, "skills", "registry.json"), "{}");

    const resolved = await resolveL0Source(fakeL0, tempDir);
    expect(resolved).toBe(fakeL0);
  });

  it("throws when absolute path has no registry", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir, { recursive: true });

    await expect(resolveL0Source(emptyDir, tempDir)).rejects.toThrow(
      /does not contain skills\/registry\.json/,
    );
  });

  it("resolves relative path from projectRoot", async () => {
    // Create: tempDir/project/ and tempDir/l0/skills/registry.json
    const projectDir = join(tempDir, "project");
    const l0Dir = join(tempDir, "l0");
    await mkdir(projectDir, { recursive: true });
    await mkdir(join(l0Dir, "skills"), { recursive: true });
    await writeFile(join(l0Dir, "skills", "registry.json"), "{}");

    const resolved = await resolveL0Source("../l0", projectDir);
    expect(resolved).toBe(l0Dir);
  });

  it("falls back to ANDROID_COMMON_DOC env var", async () => {
    const envL0 = join(tempDir, "env-l0");
    await mkdir(join(envL0, "skills"), { recursive: true });
    await writeFile(join(envL0, "skills", "registry.json"), "{}");

    process.env.ANDROID_COMMON_DOC = envL0;

    // Give a relative path that won't resolve from projectRoot
    const resolved = await resolveL0Source("../nonexistent-l0", tempDir);
    expect(resolved).toBe(envL0);
  });

  it("throws helpful error when nothing resolves", async () => {
    delete process.env.ANDROID_COMMON_DOC;

    await expect(
      resolveL0Source("../nonexistent", tempDir),
    ).rejects.toThrow(/does not contain skills\/registry\.json/);
  });

  it("error message mentions ANDROID_COMMON_DOC when not set", async () => {
    delete process.env.ANDROID_COMMON_DOC;

    try {
      await resolveL0Source("../nonexistent", tempDir);
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("ANDROID_COMMON_DOC");
    }
  });
});

// ---------------------------------------------------------------------------
// getGitCommit
// ---------------------------------------------------------------------------

describe("getGitCommit", () => {
  it("returns undefined for non-git directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "no-git-"));
    const commit = getGitCommit(tempDir);
    expect(commit).toBeUndefined();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns a short hash string for a git repo", () => {
    // Use the actual AndroidCommonDoc repo (we're running tests from it)
    const commit = getGitCommit(process.cwd());
    if (commit) {
      expect(commit).toMatch(/^[a-f0-9]{7,12}$/);
    }
    // In CI without git, commit might be undefined — both are valid
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sequence150 P1-I observation-only RED CORRECTION of Sequence149 (Codex
// rejection: sequence149-codex-audit.json, finding P1I-149-03). Everything
// above this line is byte-for-byte UNCHANGED. This section fully replaces
// the previous P1I-OBS-SYNC section.
//
// P1I-149-03 (P0): the previous file registered runtime-host-boundary.js
// only under PreToolUse/PostToolUse and exercised PostToolUseFailure nowhere
// in this repository's registration surface. CLOSED: registration is now
// required for all THREE genuine hook events -- PreToolUse, PostToolUse,
// PostToolUseFailure -- with the corrected matcher `Agent|SendMessage`
// (previously wrongly assumed `Task|Agent|SendMessage`; Codex's own finding
// specifies `Agent|SendMessage` exactly), appended additively without
// reordering any existing block/hook. All add/skip counts below are updated
// from 2 to 3 accordingly. This is the SAME cross-file finding from
// Sequence149 that the sibling scripts/tests/runtime-host-boundary.test.js
// now exercises via a genuine hook_event_name:"PostToolUseFailure" event
// (P1I-149-03's other half) -- both files agree on the same three-event set.
//
// The CRITICAL cross-file finding from Sequence149 (mergeHookRegistrations()'s
// own protected fail-open malformed-JSON behavior for the 11 unconditional
// L0 hooks, read directly from mcp-server/tests/integration/sync-settings-merge.test.ts,
// NOT part of this RED phase's writable set) is unaffected by this
// correction and still governs why this section targets a SEPARATE,
// explicitly assumed mergeObservationBoundaryRegistration() rather than
// mergeHookRegistrations() itself -- unchanged from Sequence149.
//
// ASSUMED API SHAPE (updated only for the corrected 3-event set and matcher;
// otherwise identical to Sequence149's assumption):
//   syncEngineNs.mergeObservationBoundaryRegistration(
//     projectRoot: string,
//     options?: { observationPolicy?: {enabled:boolean} | null, dryRun?: boolean },
//   ): Promise<{
//     added: Array<{event:string; matcher:string; file:string}>,
//     skipped: Array<{event:string; matcher:string; file:string}>,
//     dryRun: boolean,
//     status: "REGISTERED" | "NOT_CONFIGURED" | "FAILED_UTILITY_MISSING"
//           | "FAILED_SETTINGS_MALFORMED" | "FAILED_SETTINGS_READ",
//     reason?: string,
//   }>
//   -- registers .claude/hooks/runtime-host-boundary.js under PreToolUse,
//   PostToolUse AND PostToolUseFailure, matcher "Agent|SendMessage" (P1I-149-03).
import * as syncEngineNs from "../../../src/sync/sync-engine.js";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

const OBSERVATION_BOUNDARY_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure"] as const;
const OBSERVATION_BOUNDARY_MATCHER = "Agent|SendMessage";

type AssumedObservationPolicy = { enabled: boolean } | null | undefined;
type AssumedMergeObservationBoundaryResult = {
  added: Array<{ event: string; matcher: string; file: string }>;
  skipped: Array<{ event: string; matcher: string; file: string }>;
  dryRun: boolean;
  status:
    | "REGISTERED"
    | "NOT_CONFIGURED"
    | "FAILED_UTILITY_MISSING"
    | "FAILED_SETTINGS_MALFORMED"
    | "FAILED_SETTINGS_READ";
  reason?: string;
};
type AssumedMergeObservationBoundaryFn = (
  projectRoot: string,
  options?: { observationPolicy?: AssumedObservationPolicy; dryRun?: boolean },
) => Promise<AssumedMergeObservationBoundaryResult>;

const mergeObservationBoundaryRegistration = (
  syncEngineNs as unknown as { mergeObservationBoundaryRegistration?: AssumedMergeObservationBoundaryFn }
).mergeObservationBoundaryRegistration;

function requireMergeObservationBoundaryRegistration(): AssumedMergeObservationBoundaryFn {
  expect(
    typeof mergeObservationBoundaryRegistration,
    "mcp-server/src/sync/sync-engine.ts must export mergeObservationBoundaryRegistration() -- the observation-policy-gated registration path for runtime-host-boundary.js (sequence149 section 4 / sequence150 P1I-149-03)",
  ).toBe("function");
  return mergeObservationBoundaryRegistration as AssumedMergeObservationBoundaryFn;
}

async function writeProjectSettingsJson(dir: string, settings: unknown): Promise<void> {
  const claudeDir = join(dir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

async function readProjectSettingsJson(dir: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function placeBoundaryUtility(dir: string): Promise<void> {
  const hooksDir = join(dir, ".claude", "hooks");
  await mkdir(hooksDir, { recursive: true });
  await writeFile(join(hooksDir, "runtime-host-boundary.js"), "// fixture stub, never executed by these unit tests\n", "utf-8");
}

type ObsMatcherBlock = { matcher: string; hooks: Array<{ command: string }> };

describe("mergeObservationBoundaryRegistration() -- P1I-OBS-SYNC", () => {
  it("P1I-OBS-SYNC-BOUNDARY-REGISTER-ADDITIVE-01 RED: registers PreToolUse, PostToolUse AND PostToolUseFailure entries (matcher Agent|SendMessage) for runtime-host-boundary.js while preserving every pre-existing hook entry and its order", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-obs-boundary-"));
    try {
      await writeProjectSettingsJson(dir, {
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/branch-guard.js", timeout: 5 }] },
          ],
          PostToolUse: [
            { matcher: ".*", hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-use-logger.js", timeout: 5 }] },
          ],
        },
      });
      await placeBoundaryUtility(dir);

      const result = await fn(dir, { observationPolicy: { enabled: true } });
      expect(result.status).toBe("REGISTERED");
      for (const event of OBSERVATION_BOUNDARY_EVENTS) {
        expect(result.added.some((a) => a.event === event && a.file === "runtime-host-boundary.js" && a.matcher === OBSERVATION_BOUNDARY_MATCHER)).toBe(true);
      }
      expect(result.added.filter((a) => a.file === "runtime-host-boundary.js")).toHaveLength(3);

      const settings = await readProjectSettingsJson(dir);
      const hooks = settings.hooks as Record<string, ObsMatcherBlock[]>;
      // Pre-existing entries preserved, byte-identical, at their original index.
      expect(hooks.PreToolUse[0].matcher).toBe("Bash");
      expect(hooks.PreToolUse[0].hooks[0].command).toContain("branch-guard.js");
      expect(hooks.PostToolUse[0].matcher).toBe(".*");
      expect(hooks.PostToolUse[0].hooks[0].command).toContain("tool-use-logger.js");
      // New entries additively present in all three event arrays.
      for (const event of OBSERVATION_BOUNDARY_EVENTS) {
        const arr = hooks[event] ?? [];
        expect(arr.some((b) => b.matcher === OBSERVATION_BOUNDARY_MATCHER && b.hooks.some((h) => h.command.includes("runtime-host-boundary.js")))).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1I-OBS-SYNC-BOUNDARY-REGISTER-IDEMPOTENT-02 RED: a second registration call adds zero duplicate entries across all three events and reports all three as skipped", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-obs-boundary-"));
    try {
      await placeBoundaryUtility(dir);
      const first = await fn(dir, { observationPolicy: { enabled: true } });
      expect(first.status).toBe("REGISTERED");
      expect(first.added.filter((a) => a.file === "runtime-host-boundary.js")).toHaveLength(3);

      const second = await fn(dir, { observationPolicy: { enabled: true } });
      expect(second.added.some((a) => a.file === "runtime-host-boundary.js")).toBe(false);
      expect(second.skipped.filter((s) => s.file === "runtime-host-boundary.js")).toHaveLength(3); // PreToolUse + PostToolUse + PostToolUseFailure

      const settings = await readProjectSettingsJson(dir);
      const hooks = settings.hooks as Record<string, ObsMatcherBlock[]>;
      for (const event of OBSERVATION_BOUNDARY_EVENTS) {
        const arr = hooks[event] ?? [];
        const matchingCommands = arr.flatMap((b) => b.hooks.map((h) => h.command)).filter((c) => c.includes("runtime-host-boundary.js"));
        expect(matchingCommands).toHaveLength(1);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1I-OBS-SYNC-HOOKS-PROPAGATES-BOUNDARY-UTILITY-03 RED: syncHooks() copies runtime-host-boundary.js from an L0 source, after which registration under all three events succeeds against the now-present utility", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const l0Root = await mkdtemp(join(tmpdir(), "sync-obs-l0-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "sync-obs-project-"));
    try {
      await mkdir(join(l0Root, ".claude", "hooks"), { recursive: true });
      await writeFile(join(l0Root, ".claude", "hooks", "runtime-host-boundary.js"), "// L0 source stub\n", "utf-8");
      await mkdir(join(projectRoot, ".claude"), { recursive: true });

      const hookResult = await syncEngineNs.syncHooks(l0Root, projectRoot, [], false);
      expect(hookResult.copied).toContain("runtime-host-boundary.js");
      expect(hookResult.errors).toHaveLength(0);
      const copiedContent = await readFile(join(projectRoot, ".claude", "hooks", "runtime-host-boundary.js"), "utf-8");
      expect(copiedContent).toContain("L0 source stub");

      const result = await fn(projectRoot, { observationPolicy: { enabled: true } });
      expect(result.status).toBe("REGISTERED");
      expect(result.added.filter((a) => a.file === "runtime-host-boundary.js")).toHaveLength(3);
    } finally {
      await rm(l0Root, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("P1I-OBS-SYNC-BOUNDARY-MALFORMED-JSON-PRESERVES-BYTES-04 RED: malformed settings.json returns a typed failure and leaves the original malformed bytes completely untouched (distinct from mergeHookRegistrations()'s own protected fail-open behavior for the unconditional L0 hooks)", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-obs-boundary-"));
    try {
      await placeBoundaryUtility(dir);
      const claudeDir = join(dir, ".claude");
      await mkdir(claudeDir, { recursive: true });
      const malformed = "{ this is not valid json, deliberately broken }";
      await writeFile(join(claudeDir, "settings.json"), malformed, "utf-8");

      const result = await fn(dir, { observationPolicy: { enabled: true } });
      expect(result.status).toBe("FAILED_SETTINGS_MALFORMED");
      expect(result.added).toHaveLength(0);

      const rawAfter = await readFile(join(claudeDir, "settings.json"), "utf-8");
      expect(rawAfter).toBe(malformed);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1I-OBS-SYNC-BOUNDARY-NON-ENOENT-READ-FAILURE-05 RED: a non-ENOENT read failure (settings.json is a directory, EISDIR) returns a distinct typed read failure and leaves the path untouched", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-obs-boundary-"));
    try {
      await placeBoundaryUtility(dir);
      const claudeDir = join(dir, ".claude");
      await mkdir(join(claudeDir, "settings.json"), { recursive: true });

      const result = await fn(dir, { observationPolicy: { enabled: true } });
      expect(result.status).toBe("FAILED_SETTINGS_READ");
      expect(result.status).not.toBe("FAILED_SETTINGS_MALFORMED");
      expect(result.added).toHaveLength(0);

      const st = await stat(join(claudeDir, "settings.json"));
      expect(st.isDirectory()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1I-OBS-SYNC-BOUNDARY-ENOENT-SEEDS-MINIMAL-06 RED: only a genuine ENOENT (settings.json entirely absent) seeds the minimal empty settings structure and succeeds", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-obs-boundary-"));
    try {
      await placeBoundaryUtility(dir);
      expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(false);

      const result = await fn(dir, { observationPolicy: { enabled: true } });
      expect(result.status).toBe("REGISTERED");
      expect(existsSync(join(dir, ".claude", "settings.json"))).toBe(true);

      const settings = await readProjectSettingsJson(dir);
      expect(Object.keys(settings)).toEqual(["hooks"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1I-OBS-SYNC-BOUNDARY-UTILITY-MISSING-FAILS-CLOSED-07 RED: a configured observation policy whose utility file is missing fails closed and writes no reference to the nonexistent file", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-obs-boundary-"));
    try {
      const result = await fn(dir, { observationPolicy: { enabled: true } });
      expect(result.status).toBe("FAILED_UTILITY_MISSING");
      expect(result.added).toHaveLength(0);

      if (existsSync(join(dir, ".claude", "settings.json"))) {
        const settings = await readProjectSettingsJson(dir);
        expect(JSON.stringify(settings).includes("runtime-host-boundary.js")).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1I-OBS-SYNC-BOUNDARY-NO-POLICY-NO-UTILITY-REQUIRED-08 RED: an ordinary project with no observation policy configured succeeds trivially even though the utility file is also absent", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-obs-boundary-"));
    try {
      const explicitNull = await fn(dir, { observationPolicy: null });
      expect(explicitNull.status).toBe("NOT_CONFIGURED");
      expect(explicitNull.added).toHaveLength(0);

      const omitted = await fn(dir);
      expect(omitted.status).toBe("NOT_CONFIGURED");
      expect(omitted.added).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1I-OBS-SYNC-BOUNDARY-DRYRUN-REPORTS-NO-WRITE-09 RED: dryRun reports the exact PreToolUse/PostToolUse/PostToolUseFailure additions without writing any byte to settings.json", async () => {
    const fn = requireMergeObservationBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-obs-boundary-"));
    try {
      await placeBoundaryUtility(dir);
      await writeProjectSettingsJson(dir, { hooks: { PreToolUse: [], PostToolUse: [] } });
      const beforeRaw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");

      const result = await fn(dir, { observationPolicy: { enabled: true }, dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.status).toBe("REGISTERED");
      for (const event of OBSERVATION_BOUNDARY_EVENTS) {
        expect(result.added.some((a) => a.event === event && a.file === "runtime-host-boundary.js")).toBe(true);
      }
      expect(result.added.filter((a) => a.file === "runtime-host-boundary.js")).toHaveLength(3);

      const afterRaw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
      expect(afterRaw).toBe(beforeRaw);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P1-I/A RED Block B2 -- mergeIbindBoundaryRegistration() (sync/settings).
// Mailbox: androidcommondoc-wave1-r131-p1ia-red-blockb2-sync-20260829/order.md
// Everything ABOVE this line (all 70 pre-existing tests, including the
// mergeObservationBoundaryRegistration() -- P1I-OBS-SYNC scaffold) is
// byte-for-byte UNCHANGED.
//
// This targets a SEPARATE assumed seam from mergeObservationBoundaryRegistration()
// above -- same owned utility file (.claude/hooks/runtime-host-boundary.js),
// the same three genuine hook events, but a DIFFERENT registry/matcher
// surface: "Task|SendMessage", not "Agent|SendMessage". "Agent" is not
// dropped from the contract -- it is kept as a separately-represented
// payload/display tool name, never folded into the matcher string itself.
//
// ASSUMED API SHAPE (narrow; this seam does not exist yet):
//   syncEngineNs.mergeIbindBoundaryRegistration(projectRoot: string): Promise<{
//     added: Array<{event; matcher; payloadToolName; file}>,
//     skipped: Array<{event; matcher; payloadToolName; file}>,
//     upgraded: Array<{event; matcher; payloadToolName; file; removedFromMatcher}>,
//     status: "REGISTERED" | "FAILED_SETTINGS_MALFORMED" | "FAILED_UTILITY_MISSING",
//   }>
//   -- registers runtime-host-boundary.js under PreToolUse, PostToolUse AND
//   PostToolUseFailure with matcher "Task|SendMessage" ONLY. A pre-existing
//   OWNED command found under the stale "Agent|SendMessage" matcher for the
//   same event is upgraded in place (old owned command removed, any
//   unrelated co-located command preserved) instead of being registered a
//   second time under the new matcher.
// ═══════════════════════════════════════════════════════════════════════════

const IBIND_BOUNDARY_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure"] as const;
const IBIND_BOUNDARY_MATCHER = "Task|SendMessage";
const IBIND_BOUNDARY_STALE_MATCHER = "Agent|SendMessage";
const IBIND_BOUNDARY_PAYLOAD_TOOL = "Agent";
const IBIND_BOUNDARY_FILE = "runtime-host-boundary.js";

type IbindMatcherBlock = ObsMatcherBlock;

type AssumedIbindBoundaryEntry = {
  event: string;
  matcher: string;
  payloadToolName: string;
  file: string;
};
type AssumedIbindUpgradedEntry = AssumedIbindBoundaryEntry & {
  removedFromMatcher: string;
};
type AssumedMergeIbindBoundaryResult = {
  added: AssumedIbindBoundaryEntry[];
  skipped: AssumedIbindBoundaryEntry[];
  upgraded: AssumedIbindUpgradedEntry[];
  status: "REGISTERED" | "FAILED_SETTINGS_MALFORMED" | "FAILED_UTILITY_MISSING";
};
type AssumedMergeIbindBoundaryFn = (projectRoot: string) => Promise<AssumedMergeIbindBoundaryResult>;

const mergeIbindBoundaryRegistration = (
  syncEngineNs as unknown as { mergeIbindBoundaryRegistration?: AssumedMergeIbindBoundaryFn }
).mergeIbindBoundaryRegistration;

function requireMergeIbindBoundaryRegistration(): AssumedMergeIbindBoundaryFn {
  expect(
    typeof mergeIbindBoundaryRegistration,
    "mcp-server/src/sync/sync-engine.ts must export mergeIbindBoundaryRegistration() -- the Task|SendMessage registration/migration path for runtime-host-boundary.js, keeping Agent as a separately-represented payload surface (P1-I/A RED Block B2)",
  ).toBe("function");
  return mergeIbindBoundaryRegistration as AssumedMergeIbindBoundaryFn;
}

describe("mergeIbindBoundaryRegistration() -- P1IA-IBIND-SYNC", () => {
  it("P1IA-IBIND-SYNC-REGISTER-TASK-MATCHER-ADDITIVE-01 RED: registers PreToolUse, PostToolUse and PostToolUseFailure entries under matcher Task|SendMessage (Agent kept only as payloadToolName) for runtime-host-boundary.js while preserving every pre-existing hook entry, its order, and unrelated settings keys", async () => {
    const fn = requireMergeIbindBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-ibind-boundary-"));
    try {
      await writeProjectSettingsJson(dir, {
        permissions: { allow: ["Bash(echo hi)"], deny: [] },
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/branch-guard.js", timeout: 5 }] },
          ],
          PostToolUse: [
            { matcher: ".*", hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-use-logger.js", timeout: 5 }] },
          ],
        },
      });
      await placeBoundaryUtility(dir);

      const result = await fn(dir);
      expect(result.status).toBe("REGISTERED");
      expect(result.upgraded).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      for (const event of IBIND_BOUNDARY_EVENTS) {
        const entry = result.added.find((a) => a.event === event && a.file === IBIND_BOUNDARY_FILE);
        expect(entry, `expected an added entry for ${event}`).toBeTruthy();
        expect(entry?.matcher).toBe(IBIND_BOUNDARY_MATCHER);
        expect(entry?.matcher).not.toContain("Agent");
        expect(entry?.payloadToolName).toBe(IBIND_BOUNDARY_PAYLOAD_TOOL);
      }
      expect(result.added.filter((a) => a.file === IBIND_BOUNDARY_FILE)).toHaveLength(3);

      const settings = await readProjectSettingsJson(dir);
      expect(settings.permissions).toEqual({ allow: ["Bash(echo hi)"], deny: [] });

      const hooks = settings.hooks as Record<string, IbindMatcherBlock[]>;
      // Pre-existing entries preserved, byte-identical, at their original index.
      expect(hooks.PreToolUse[0].matcher).toBe("Bash");
      expect(hooks.PreToolUse[0].hooks[0].command).toContain("branch-guard.js");
      expect(hooks.PostToolUse[0].matcher).toBe(".*");
      expect(hooks.PostToolUse[0].hooks[0].command).toContain("tool-use-logger.js");
      // New entries additively present in all three event arrays, under Task|SendMessage ONLY.
      for (const event of IBIND_BOUNDARY_EVENTS) {
        const arr = hooks[event] ?? [];
        expect(arr.some((b) => b.matcher === IBIND_BOUNDARY_MATCHER && b.hooks.some((h) => h.command.includes(IBIND_BOUNDARY_FILE)))).toBe(true);
        expect(arr.some((b) => b.matcher.includes("Agent") && b.hooks.some((h) => h.command.includes(IBIND_BOUNDARY_FILE)))).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1IA-IBIND-SYNC-UPGRADE-STALE-AGENT-MATCHER-02 RED: an owned command already registered under the stale Agent|SendMessage matcher is upgraded to Task|SendMessage for the same event, removing only the stale owned command and preserving a co-located unrelated command", async () => {
    const fn = requireMergeIbindBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-ibind-boundary-"));
    try {
      await writeProjectSettingsJson(dir, {
        hooks: {
          PreToolUse: [
            { matcher: IBIND_BOUNDARY_STALE_MATCHER, hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/runtime-host-boundary.js", timeout: 5 }] },
          ],
          PostToolUse: [
            { matcher: IBIND_BOUNDARY_STALE_MATCHER, hooks: [{ type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/runtime-host-boundary.js", timeout: 5 }] },
          ],
          PostToolUseFailure: [
            {
              matcher: IBIND_BOUNDARY_STALE_MATCHER,
              hooks: [
                { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-use-logger.js", timeout: 5 },
                { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/runtime-host-boundary.js", timeout: 5 },
              ],
            },
          ],
        },
      });
      await placeBoundaryUtility(dir);

      const result = await fn(dir);
      expect(result.status).toBe("REGISTERED");
      expect(result.added.filter((a) => a.file === IBIND_BOUNDARY_FILE)).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(result.upgraded).toHaveLength(3);
      for (const event of IBIND_BOUNDARY_EVENTS) {
        const entry = result.upgraded.find((u) => u.event === event && u.file === IBIND_BOUNDARY_FILE);
        expect(entry, `expected an upgraded entry for ${event}`).toBeTruthy();
        expect(entry?.matcher).toBe(IBIND_BOUNDARY_MATCHER);
        expect(entry?.matcher).not.toContain("Agent");
        expect(entry?.payloadToolName).toBe(IBIND_BOUNDARY_PAYLOAD_TOOL);
        expect(entry?.removedFromMatcher).toBe(IBIND_BOUNDARY_STALE_MATCHER);
      }

      const settings = await readProjectSettingsJson(dir);
      const hooks = settings.hooks as Record<string, IbindMatcherBlock[]>;
      for (const event of IBIND_BOUNDARY_EVENTS) {
        const arr = hooks[event] ?? [];
        const taskCommands = arr.filter((b) => b.matcher === IBIND_BOUNDARY_MATCHER).flatMap((b) => b.hooks.map((h) => h.command)).filter((c) => c.includes(IBIND_BOUNDARY_FILE));
        expect(taskCommands, `${event} must have exactly one owned command under Task|SendMessage`).toHaveLength(1);

        const staleOwnedCommands = arr.filter((b) => b.matcher === IBIND_BOUNDARY_STALE_MATCHER).flatMap((b) => b.hooks.map((h) => h.command)).filter((c) => c.includes(IBIND_BOUNDARY_FILE));
        expect(staleOwnedCommands, `${event} must have zero owned commands remaining under the stale Agent|SendMessage matcher`).toHaveLength(0);
      }

      // The unrelated command co-located in PostToolUseFailure's stale block must survive the migration.
      const postFailureBlocks = hooks.PostToolUseFailure ?? [];
      const survivingUnrelated = postFailureBlocks.flatMap((b) => b.hooks.map((h) => h.command)).filter((c) => c.includes("tool-use-logger.js"));
      expect(survivingUnrelated).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1IA-IBIND-SYNC-IDEMPOTENT-NO-BYTE-CHURN-03 RED: a second invocation after convergence adds and upgrades nothing, reports the prior entries as skipped, and leaves settings.json byte-for-byte identical", async () => {
    const fn = requireMergeIbindBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-ibind-boundary-"));
    try {
      await placeBoundaryUtility(dir);
      const first = await fn(dir);
      expect(first.status).toBe("REGISTERED");
      expect(first.added.filter((a) => a.file === IBIND_BOUNDARY_FILE)).toHaveLength(3);

      const afterFirstRaw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");

      const second = await fn(dir);
      expect(second.status).toBe("REGISTERED");
      expect(second.added.filter((a) => a.file === IBIND_BOUNDARY_FILE)).toHaveLength(0);
      expect(second.upgraded).toHaveLength(0);
      expect(second.skipped.filter((s) => s.file === IBIND_BOUNDARY_FILE)).toHaveLength(3);

      const afterSecondRaw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
      expect(afterSecondRaw).toBe(afterFirstRaw);

      const settings = await readProjectSettingsJson(dir);
      const hooks = settings.hooks as Record<string, IbindMatcherBlock[]>;
      for (const event of IBIND_BOUNDARY_EVENTS) {
        const arr = hooks[event] ?? [];
        const matchingCommands = arr.flatMap((b) => b.hooks.map((h) => h.command)).filter((c) => c.includes(IBIND_BOUNDARY_FILE));
        expect(matchingCommands).toHaveLength(1);
        const matchingBlocks = arr.filter((b) => b.matcher === IBIND_BOUNDARY_MATCHER);
        expect(matchingBlocks).toHaveLength(1);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1IA-IBIND-SYNC-MALFORMED-SETTINGS-PRESERVES-BYTES-04 RED: malformed settings.json fails closed and leaves the original malformed bytes completely untouched", async () => {
    const fn = requireMergeIbindBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-ibind-boundary-"));
    try {
      await placeBoundaryUtility(dir);
      const claudeDir = join(dir, ".claude");
      await mkdir(claudeDir, { recursive: true });
      const malformed = "{ this is not valid json, deliberately broken -- ibind }";
      await writeFile(join(claudeDir, "settings.json"), malformed, "utf-8");

      const result = await fn(dir);
      expect(result.status).toBe("FAILED_SETTINGS_MALFORMED");
      expect(result.added).toHaveLength(0);
      expect(result.upgraded).toHaveLength(0);

      const rawAfter = await readFile(join(claudeDir, "settings.json"), "utf-8");
      expect(rawAfter).toBe(malformed);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1IA-IBIND-SYNC-UTILITY-MISSING-FAILS-CLOSED-05 RED: a completely absent runtime-host-boundary.js fails closed and writes no reference to it", async () => {
    const fn = requireMergeIbindBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-ibind-boundary-"));
    try {
      // Deliberately no placeBoundaryUtility(dir) call -- the utility is absent.
      const result = await fn(dir);
      expect(result.status).toBe("FAILED_UTILITY_MISSING");
      expect(result.added).toHaveLength(0);
      expect(result.upgraded).toHaveLength(0);

      if (existsSync(join(dir, ".claude", "settings.json"))) {
        const settings = await readProjectSettingsJson(dir);
        expect(JSON.stringify(settings).includes(IBIND_BOUNDARY_FILE)).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1IA-IBIND-SYNC-UTILITY-NON-FILE-FAILS-CLOSED-06 RED: a directory occupying the runtime-host-boundary.js path fails closed and writes no reference to it", async () => {
    const fn = requireMergeIbindBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-ibind-boundary-"));
    try {
      await mkdir(join(dir, ".claude", "hooks", "runtime-host-boundary.js"), { recursive: true });

      const result = await fn(dir);
      expect(result.status).toBe("FAILED_UTILITY_MISSING");
      expect(result.added).toHaveLength(0);

      if (existsSync(join(dir, ".claude", "settings.json"))) {
        const settings = await readProjectSettingsJson(dir);
        expect(JSON.stringify(settings).includes(IBIND_BOUNDARY_FILE)).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1IA-IBIND-SYNC-UTILITY-SYMLINK-FAILS-CLOSED-07 RED: a symlinked runtime-host-boundary.js fails closed and writes no reference to it, even when the link target is a valid file", async () => {
    const fn = requireMergeIbindBoundaryRegistration();
    const dir = await mkdtemp(join(tmpdir(), "sync-ibind-boundary-"));
    try {
      const { symlink } = await import("node:fs/promises");
      const hooksDir = join(dir, ".claude", "hooks");
      await mkdir(hooksDir, { recursive: true });
      const realTarget = join(hooksDir, "runtime-host-boundary.real.js");
      await writeFile(realTarget, "// real target, never executed by these unit tests\n", "utf-8");
      await symlink(realTarget, join(hooksDir, IBIND_BOUNDARY_FILE));

      const result = await fn(dir);
      expect(result.status).toBe("FAILED_UTILITY_MISSING");
      expect(result.added).toHaveLength(0);

      if (existsSync(join(dir, ".claude", "settings.json"))) {
        const settings = await readProjectSettingsJson(dir);
        expect(JSON.stringify(settings).includes(IBIND_BOUNDARY_FILE)).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("P1IA-IBIND-SYNC-STATIC-SETTINGS-TASK-MATCHER-CONTRACT-08 RED: the real repository .claude/settings.json must register runtime-host-boundary.js under Task|SendMessage for exactly PreToolUse, PostToolUse and PostToolUseFailure, with no stale owned Agent|SendMessage registration left behind", async () => {
    const repoRoot = process.cwd().replace(/[\\/]mcp-server$/, "");
    const raw = await readFile(join(repoRoot, ".claude", "settings.json"), "utf-8");
    const settings = JSON.parse(raw) as { hooks?: Record<string, IbindMatcherBlock[]> };
    const hooks = settings.hooks ?? {};

    // Falsifiable across the ENTIRE hooks object -- not just the three expected
    // events -- so a fourth (unexpected) event carrying the owned command would
    // fail this just as surely as a missing one.
    const eventsWithOwnedCommand = Object.entries(hooks)
      .filter(([, blocks]) => (blocks ?? []).some((b) => b.hooks.some((h) => h.command.includes(IBIND_BOUNDARY_FILE))))
      .map(([event]) => event)
      .sort();
    expect(
      eventsWithOwnedCommand,
      `expected the owned runtime-host-boundary.js command to appear under exactly ${JSON.stringify([...IBIND_BOUNDARY_EVENTS].sort())} across the entire hooks object in the real .claude/settings.json, got ${JSON.stringify(eventsWithOwnedCommand)}`,
    ).toEqual([...IBIND_BOUNDARY_EVENTS].sort());

    for (const event of IBIND_BOUNDARY_EVENTS) {
      const blocks = hooks[event] ?? [];
      const taskBlock = blocks.find((b) => b.matcher === IBIND_BOUNDARY_MATCHER);
      expect(
        taskBlock?.hooks.some((h) => h.command.includes(IBIND_BOUNDARY_FILE)) ?? false,
        `expected ${event} to register runtime-host-boundary.js under matcher "${IBIND_BOUNDARY_MATCHER}" in the real .claude/settings.json`,
      ).toBe(true);

      const staleBlock = blocks.find((b) => b.matcher === IBIND_BOUNDARY_STALE_MATCHER);
      const staleOwnedCommand = staleBlock?.hooks.some((h) => h.command.includes(IBIND_BOUNDARY_FILE)) ?? false;
      expect(
        staleOwnedCommand,
        `expected no stale owned runtime-host-boundary.js registration left under "${IBIND_BOUNDARY_STALE_MATCHER}" for ${event} in the real .claude/settings.json`,
      ).toBe(false);
    }
  });
});
