import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  mergeRegistries,
  syncMultiSource,
  generateKnowledgeCascade,
  resolveAgentTemplate,
  resolveKnowledgeCascade,
  type LayeredRegistryEntry,
  type MultiSourceSyncReport,
} from "../../../src/sync/sync-engine.js";
import type { SkillRegistry, SkillRegistryEntry } from "../../../src/registry/skill-registry.js";
import { writeManifest, createChainManifest, createDefaultManifest } from "../../../src/sync/manifest-schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(
  name: string,
  type: "skill" | "agent" | "command",
  hash: string,
  category = "testing",
): SkillRegistryEntry {
  const pathPrefix = type === "skill" ? `skills/${name}/SKILL.md`
    : type === "agent" ? `.claude/agents/${name}.md`
    : `.claude/commands/${name}.md`;
  return {
    name,
    type,
    path: pathPrefix,
    description: `${name} description`,
    category,
    tier: "core",
    hash,
    dependencies: [],
    frontmatter: {},
  };
}

function makeRegistry(entries: SkillRegistryEntry[], l0Root = "/l0"): SkillRegistry {
  return {
    version: 1,
    generated: new Date().toISOString(),
    l0_root: l0Root,
    entries,
  };
}

// ---------------------------------------------------------------------------
// mergeRegistries
// ---------------------------------------------------------------------------

describe("mergeRegistries", () => {
  it("returns all entries from a single registry", () => {
    const r0 = makeRegistry([
      makeEntry("test", "skill", "aaa"),
      makeEntry("lint", "skill", "bbb"),
    ]);

    const merged = mergeRegistries([["L0", r0]]);
    expect(merged).toHaveLength(2);
    expect(merged[0].sourceLayer).toBe("L0");
    expect(merged[1].sourceLayer).toBe("L0");
  });

  it("merges two registries with no collisions", () => {
    const r0 = makeRegistry([makeEntry("test", "skill", "aaa")]);
    const r1 = makeRegistry([makeEntry("deploy", "skill", "bbb")]);

    const merged = mergeRegistries([["L0", r0], ["L1", r1]]);
    expect(merged).toHaveLength(2);
    const names = merged.map((e) => e.name).sort();
    expect(names).toEqual(["deploy", "test"]);
  });

  it("last source wins on name+type collision", () => {
    const r0 = makeRegistry([makeEntry("test", "skill", "l0-hash")]);
    const r1 = makeRegistry([makeEntry("test", "skill", "l1-hash")]);

    const merged = mergeRegistries([["L0", r0], ["L1", r1]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].hash).toBe("l1-hash");
    expect(merged[0].sourceLayer).toBe("L1");
  });

  it("same name but different type are NOT collisions", () => {
    const r0 = makeRegistry([makeEntry("test", "skill", "aaa")]);
    const r1 = makeRegistry([makeEntry("test", "agent", "bbb")]);

    const merged = mergeRegistries([["L0", r0], ["L1", r1]]);
    expect(merged).toHaveLength(2);
  });

  it("three-layer merge: L2 overrides L1 which overrides L0", () => {
    const r0 = makeRegistry([
      makeEntry("test", "skill", "v0"),
      makeEntry("lint", "skill", "v0"),
    ]);
    const r1 = makeRegistry([
      makeEntry("test", "skill", "v1"),
      makeEntry("deploy", "skill", "v1"),
    ]);
    const r2 = makeRegistry([
      makeEntry("test", "skill", "v2"),
    ]);

    const merged = mergeRegistries([["L0", r0], ["L1", r1], ["L2", r2]]);
    expect(merged).toHaveLength(3); // test(v2), lint(v0), deploy(v1)

    const testEntry = merged.find((e) => e.name === "test")!;
    expect(testEntry.hash).toBe("v2");
    expect(testEntry.sourceLayer).toBe("L2");

    const lintEntry = merged.find((e) => e.name === "lint")!;
    expect(lintEntry.hash).toBe("v0");
    expect(lintEntry.sourceLayer).toBe("L0");

    const deployEntry = merged.find((e) => e.name === "deploy")!;
    expect(deployEntry.hash).toBe("v1");
    expect(deployEntry.sourceLayer).toBe("L1");
  });

  it("preserves all fields from the winning entry", () => {
    const entry = makeEntry("test", "skill", "hash-1");
    entry.description = "Custom description";
    entry.category = "architecture";
    entry.tier = "extended";
    const r0 = makeRegistry([entry]);

    const merged = mergeRegistries([["L0", r0]]);
    expect(merged[0].description).toBe("Custom description");
    expect(merged[0].category).toBe("architecture");
    expect(merged[0].tier).toBe("extended");
  });

  it("returns empty array for empty registries", () => {
    const merged = mergeRegistries([["L0", makeRegistry([])]]);
    expect(merged).toEqual([]);
  });

  it("returns empty array for no registries", () => {
    const merged = mergeRegistries([]);
    expect(merged).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateKnowledgeCascade
// ---------------------------------------------------------------------------

describe("generateKnowledgeCascade", () => {
  it("generates tagged sections for each layer", () => {
    const result = generateKnowledgeCascade([
      ["L0", "# Knowledge\n\n## Rule A\nDon't use rg on Windows"],
      ["L1", "# Knowledge\n\n## Rule B\nUse testDispatcher"],
    ]);

    expect(result).toContain("## [L0]");
    expect(result).toContain("## [L1]");
    expect(result).toContain("Rule A");
    expect(result).toContain("Rule B");
  });

  it("strips top-level heading to avoid duplicates", () => {
    const result = generateKnowledgeCascade([
      ["L0", "# AndroidCommonDoc — Knowledge Base\n\nContent here"],
    ]);

    expect(result).not.toContain("# AndroidCommonDoc");
    expect(result).toContain("Content here");
  });

  it("strips frontmatter comments", () => {
    const result = generateKnowledgeCascade([
      ["L0", "<!-- some comment -->\n# Title\n\nContent"],
    ]);

    expect(result).not.toContain("some comment");
    expect(result).toContain("Content");
  });

  it("skips empty layers", () => {
    const result = generateKnowledgeCascade([
      ["L0", "## Rule\nContent"],
      ["L1", ""],
      ["L2", "   "],
    ]);

    expect(result).toContain("## [L0]");
    expect(result).not.toContain("## [L1]");
    expect(result).not.toContain("## [L2]");
  });

  it("includes auto-generated header", () => {
    const result = generateKnowledgeCascade([["L0", "Content"]]);
    expect(result).toContain("# Knowledge — Resolved (auto-generated)");
    expect(result).toContain("Do not edit manually");
  });

  it("handles single layer", () => {
    const result = generateKnowledgeCascade([
      ["L0", "## Only rule\nDo this thing"],
    ]);
    expect(result).toContain("## [L0]");
    expect(result).toContain("Only rule");
  });

  it("returns header only for empty input", () => {
    const result = generateKnowledgeCascade([]);
    expect(result).toContain("# Knowledge — Resolved");
    expect(result).not.toContain("## [");
  });
});

// ---------------------------------------------------------------------------
// resolveAgentTemplate
// ---------------------------------------------------------------------------

describe("resolveAgentTemplate", () => {
  it("replaces {{LAYER_KNOWLEDGE}} with cascade content", () => {
    const template = "You are a specialist.\n\n{{LAYER_KNOWLEDGE}}\n\nDo your job.";
    const knowledge = "## [L0]\nRule A\n## [L1]\nRule B";

    const resolved = resolveAgentTemplate(template, knowledge);
    expect(resolved).toContain("Rule A");
    expect(resolved).toContain("Rule B");
    expect(resolved).not.toContain("{{LAYER_KNOWLEDGE}}");
  });

  it("replaces multiple {{LAYER_KNOWLEDGE}} occurrences", () => {
    const template = "A: {{LAYER_KNOWLEDGE}}\nB: {{LAYER_KNOWLEDGE}}";
    const resolved = resolveAgentTemplate(template, "content");
    expect(resolved).toBe("A: content\nB: content");
  });

  it("replaces {{LAYER_CONVENTIONS}} with extracted conventions section", () => {
    const template = "Conventions:\n{{LAYER_CONVENTIONS}}";
    const knowledge = "## [L0]\n\n## Key Conventions\n- Use sealed interfaces\n- No Channel\n\n## Other\nStuff";

    const resolved = resolveAgentTemplate(template, knowledge);
    expect(resolved).toContain("Use sealed interfaces");
    expect(resolved).not.toContain("{{LAYER_CONVENTIONS}}");
  });

  it("replaces {{LAYER_CONVENTIONS}} with empty when no conventions section", () => {
    const template = "Conventions: [{{LAYER_CONVENTIONS}}]";
    const knowledge = "## [L0]\nJust rules";

    const resolved = resolveAgentTemplate(template, knowledge);
    expect(resolved).toBe("Conventions: []");
  });

  it("leaves template unchanged when no placeholders", () => {
    const template = "Plain agent with no placeholders.";
    const resolved = resolveAgentTemplate(template, "knowledge");
    expect(resolved).toBe("Plain agent with no placeholders.");
  });
});

// ---------------------------------------------------------------------------
// resolveKnowledgeCascade (filesystem)
// ---------------------------------------------------------------------------

describe("resolveKnowledgeCascade", () => {
  let tmpDir: string;
  let l0Root: string;
  let l1Root: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-cascade-"));
    l0Root = path.join(tmpDir, "l0");
    l1Root = path.join(tmpDir, "l1");
    projectRoot = path.join(tmpDir, "project");

    await fs.mkdir(path.join(l0Root, ".gsd"), { recursive: true });
    await fs.mkdir(path.join(l1Root, ".gsd"), { recursive: true });
    await fs.mkdir(path.join(projectRoot, ".gsd"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("concatenates knowledge from L0 + L1 + local", async () => {
    await fs.writeFile(path.join(l0Root, ".gsd", "KNOWLEDGE.md"), "# K\n\n## L0 Rule\nContent A");
    await fs.writeFile(path.join(l1Root, ".gsd", "KNOWLEDGE.md"), "# K\n\n## L1 Rule\nContent B");
    await fs.writeFile(path.join(projectRoot, ".gsd", "KNOWLEDGE.md"), "# K\n\n## Local Rule\nContent C");

    const result = await resolveKnowledgeCascade(projectRoot, { L0: l0Root, L1: l1Root });

    expect(result.layerCount).toBe(3);
    expect(result.resolvedKnowledge).toContain("## [L0]");
    expect(result.resolvedKnowledge).toContain("Content A");
    expect(result.resolvedKnowledge).toContain("## [L1]");
    expect(result.resolvedKnowledge).toContain("Content B");
    expect(result.resolvedKnowledge).toContain("Content C");
  });

  it("handles missing KNOWLEDGE.md in a layer", async () => {
    await fs.writeFile(path.join(l0Root, ".gsd", "KNOWLEDGE.md"), "## Rule\nOnly L0");
    // l1Root has no KNOWLEDGE.md

    const result = await resolveKnowledgeCascade(projectRoot, { L0: l0Root, L1: l1Root });

    expect(result.layerCount).toBe(1); // only L0
    expect(result.resolvedKnowledge).toContain("Only L0");
    expect(result.resolvedKnowledge).not.toContain("[L1]");
  });

  it("handles empty source paths", async () => {
    const result = await resolveKnowledgeCascade(projectRoot, {});
    expect(result.layerCount).toBe(0);
    expect(result.resolvedKnowledge).toContain("# Knowledge — Resolved");
  });
});

// ---------------------------------------------------------------------------
// syncMultiSource (integration)
// ---------------------------------------------------------------------------

describe("syncMultiSource", () => {
  let tmpDir: string;
  let l0Root: string;
  let l1Root: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-source-sync-"));
    l0Root = path.join(tmpDir, "l0");
    l1Root = path.join(tmpDir, "l1");
    projectRoot = path.join(tmpDir, "project");

    // Create L0 with a valid registry
    await fs.mkdir(path.join(l0Root, "skills", "test"), { recursive: true });
    await fs.mkdir(path.join(l0Root, "skills", "lint"), { recursive: true });
    await fs.mkdir(path.join(l0Root, ".claude", "agents"), { recursive: true });
    await fs.writeFile(
      path.join(l0Root, "skills", "test", "SKILL.md"),
      "---\ndescription: L0 test skill\n---\n# Test Skill",
    );
    await fs.writeFile(
      path.join(l0Root, "skills", "lint", "SKILL.md"),
      "---\ndescription: L0 lint skill\n---\n# Lint Skill",
    );

    // Create L1 with its own registry (overrides test, adds deploy)
    await fs.mkdir(path.join(l1Root, "skills", "test"), { recursive: true });
    await fs.mkdir(path.join(l1Root, "skills", "deploy"), { recursive: true });
    await fs.writeFile(
      path.join(l1Root, "skills", "test", "SKILL.md"),
      "---\ndescription: L1 test skill (override)\n---\n# Test Skill v2",
    );
    await fs.writeFile(
      path.join(l1Root, "skills", "deploy", "SKILL.md"),
      "---\ndescription: L1 deploy skill\n---\n# Deploy Skill",
    );

    // Generate registry.json for both
    for (const root of [l0Root, l1Root]) {
      const { generateRegistry } = await import("../../../src/registry/skill-registry.js");
      const registry = await generateRegistry(root);
      await fs.mkdir(path.join(root, "skills"), { recursive: true });
      await fs.writeFile(
        path.join(root, "skills", "registry.json"),
        JSON.stringify(registry, null, 2),
      );
    }

    // Create project with chain manifest
    await fs.mkdir(projectRoot, { recursive: true });
    const manifest = createChainManifest([
      { layer: "L0", path: l0Root, role: "tooling" },
      { layer: "L1", path: l1Root, role: "ecosystem" },
    ]);
    await writeManifest(path.join(projectRoot, "l0-manifest.json"), manifest);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("syncs from multiple sources in dry-run mode", async () => {
    const report = await syncMultiSource(projectRoot, { dryRun: true });

    expect(report.sourceCount).toBe(2);
    expect(report.sourceCounts["L0"]).toBeGreaterThan(0);
    expect(report.sourceCounts["L1"]).toBeGreaterThan(0);
    // Should have adds for all merged entries
    expect(report.added).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);
  });

  it("reports overrides when L1 replaces L0 entry", async () => {
    const report = await syncMultiSource(projectRoot, { dryRun: true });

    const testOverride = report.overrides.find((o) => o.name === "test");
    expect(testOverride).toBeDefined();
    expect(testOverride!.overriddenBy).toBe("L1");
    expect(testOverride!.overrides).toBe("L0");
  });

  it("materializes files from correct source layer", async () => {
    const report = await syncMultiSource(projectRoot);

    expect(report.errors).toEqual([]);
    expect(report.added).toBeGreaterThan(0);

    // test skill should come from L1 (override)
    const testContent = await fs.readFile(
      path.join(projectRoot, ".claude", "skills", "test", "SKILL.md"),
      "utf-8",
    );
    expect(testContent).toContain("L1 test skill");

    // lint skill should come from L0 (no override)
    const lintContent = await fs.readFile(
      path.join(projectRoot, ".claude", "skills", "lint", "SKILL.md"),
      "utf-8",
    );
    expect(lintContent).toContain("L0 lint skill");

    // deploy skill should come from L1 (L1-only)
    const deployContent = await fs.readFile(
      path.join(projectRoot, ".claude", "skills", "deploy", "SKILL.md"),
      "utf-8",
    );
    expect(deployContent).toContain("L1 deploy skill");
  });

  it("updates manifest checksums after sync", async () => {
    await syncMultiSource(projectRoot);

    const manifestContent = await fs.readFile(
      path.join(projectRoot, "l0-manifest.json"),
      "utf-8",
    );
    const manifest = JSON.parse(manifestContent);
    expect(Object.keys(manifest.checksums).length).toBeGreaterThan(0);
    expect(manifest.last_synced).toBeDefined();
  });

  it("throws on empty registry from any source", async () => {
    // Create an empty L1
    const emptyL1 = path.join(tmpDir, "empty-l1");
    await fs.mkdir(path.join(emptyL1, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(emptyL1, "skills", "registry.json"),
      JSON.stringify({ version: 1, generated: "", l0_root: "", entries: [] }),
    );

    const manifest = createChainManifest([
      { layer: "L0", path: l0Root, role: "tooling" },
      { layer: "L1", path: emptyL1, role: "ecosystem" },
    ]);
    await writeManifest(path.join(projectRoot, "l0-manifest.json"), manifest);

    await expect(syncMultiSource(projectRoot)).rejects.toThrow("0 registry entries");
  });
});
