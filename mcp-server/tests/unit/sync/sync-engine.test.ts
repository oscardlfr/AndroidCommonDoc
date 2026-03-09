import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SkillRegistry, SkillRegistryEntry } from "../../../src/registry/skill-registry.js";
import type { Manifest } from "../../../src/sync/manifest-schema.js";

// We'll import the sync engine module once it exists
import {
  resolveSyncPlan,
  computeSyncActions,
  materializeFile,
  syncL0,
  destPath,
  type SyncPlanEntry,
  type SyncReport,
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

  it("marks entries with no checksum as 'add'", () => {
    const manifest = makeManifest({ checksums: {} });
    const actions = computeSyncActions([skillA], manifest);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("add");
  });

  it("marks entries with matching checksum as 'unchanged' (checksums keyed by dest path)", () => {
    // Checksums use dest path (.claude/skills/) not source path (skills/)
    const manifest = makeManifest({
      checksums: { ".claude/skills/test/SKILL.md": "sha256:testhash" },
    });
    const actions = computeSyncActions([skillA], manifest);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("unchanged");
  });

  it("marks entries with different checksum as 'update' (checksums keyed by dest path)", () => {
    const manifest = makeManifest({
      checksums: { ".claude/skills/test/SKILL.md": "sha256:oldhash" },
    });
    const actions = computeSyncActions([skillA], manifest);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("update");
    expect(actions[0].currentHash).toBe("sha256:oldhash");
  });

  it("marks checksummed entries not in resolved as 'remove' (orphaned)", () => {
    const manifest = makeManifest({
      checksums: {
        ".claude/skills/test/SKILL.md": "sha256:testhash",
        ".claude/commands/old-tool.md": "sha256:oldhash",
      },
    });
    const actions = computeSyncActions([skillA], manifest);
    // skillA = unchanged, old-tool = remove
    const removeActions = actions.filter((a) => a.action === "remove");
    expect(removeActions).toHaveLength(1);
    expect(removeActions[0].registryEntry.path).toBe(".claude/commands/old-tool.md");
  });

  it("regression: skills with source-path checksums (skills/) are treated as 'add', not 'unchanged'", () => {
    // Before the fix: checksums were written with source paths (skills/test/SKILL.md)
    // computeSyncActions would look up by dest path (.claude/skills/test/SKILL.md) → miss
    // → mark as "add" even though file was already synced
    // This is the lesser evil vs the original bug (marking as orphan → delete)
    // After a single re-sync the checksums are rewritten with correct dest paths
    const manifest = makeManifest({
      checksums: { "skills/test/SKILL.md": "sha256:testhash" },
    });
    const actions = computeSyncActions([skillA], manifest);
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

  it("regression: skills with dest-path checksums are NOT marked as orphans (the MyApp bug)", () => {
    // The MyApp incident: manifest had .claude/skills/ keys, engine built resolvedPaths
    // from source paths (skills/), orphan detector saw .claude/skills/ keys as unknown → delete
    // Fix: resolvedDestPaths uses destPath(entry.path), matching .claude/skills/ keys correctly
    const manifest = makeManifest({
      checksums: {
        ".claude/skills/test/SKILL.md": "sha256:testhash",
        ".claude/skills/coverage/SKILL.md": "sha256:coveragehash",
      },
    });
    const actions = computeSyncActions([skillA, skillB], manifest);
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
    const manifest = makeManifest({ l0_source: l0Root });
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
    const manifest = makeManifest({ l0_source: l0Root });
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
    const manifest = makeManifest({ l0_source: l0Root });
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
      l0_source: l0Root,
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
      l0_source: l0Root,
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
    const manifest = makeManifest({ l0_source: l0Root });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const report = await syncL0(projectRoot, l0Root);

    expect(report.added).toBeGreaterThan(0);
    expect(typeof report.updated).toBe("number");
    expect(typeof report.removed).toBe("number");
    expect(typeof report.unchanged).toBe("number");
    expect(report.errors).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.actions).toBeInstanceOf(Array);
    expect(report.added + report.updated + report.removed + report.unchanged).toBe(
      report.actions.length,
    );
  });

  it("post-sync verification: missing array is empty when all files written successfully", async () => {
    const manifest = makeManifest({ l0_source: l0Root });
    await writeFile(
      join(projectRoot, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const report = await syncL0(projectRoot, l0Root);

    expect(report.missing).toEqual([]);
    expect(report.errors.filter(e => e.includes("Post-sync"))).toHaveLength(0);
  });
});
