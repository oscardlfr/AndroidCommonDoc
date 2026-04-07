/**
 * Model profiles integration tests.
 *
 * Validates the model-profiles.json configuration:
 * - Schema structure and required fields
 * - All override agents exist as .claude/agents/*.md files
 * - All agent frontmatter has valid model: field
 * - Profile model values are valid (haiku/sonnet/opus)
 * - Current profile references an existing profile
 * - Every profile produces a complete assignment for all agents
 * - No orphan overrides (agents that don't exist)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const VALID_MODELS = ["haiku", "sonnet", "opus"] as const;
type ValidModel = (typeof VALID_MODELS)[number];

interface Profile {
  description: string;
  default_model: ValidModel;
  overrides: Record<string, ValidModel>;
}

interface ModelProfiles {
  current: string;
  profiles: Record<string, Profile>;
}

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const PROFILES_PATH = path.join(ROOT, ".claude", "model-profiles.json");
const AGENTS_DIR = path.join(ROOT, ".claude", "agents");

describe("model-profiles.json", () => {
  let config: ModelProfiles;
  let agentNames: string[];
  let agentModels: Map<string, string>;

  beforeAll(async () => {
    // Load model-profiles.json
    const raw = await readFile(PROFILES_PATH, "utf-8");
    config = JSON.parse(raw);

    // Discover all agent .md files and extract their name + model from frontmatter
    const files = await readdir(AGENTS_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    agentNames = [];
    agentModels = new Map();

    for (const file of mdFiles) {
      const content = await readFile(path.join(AGENTS_DIR, file), "utf-8");
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const modelMatch = content.match(/^model:\s*(.+)$/m);

      if (nameMatch) {
        const name = nameMatch[1].trim();
        agentNames.push(name);
        if (modelMatch) {
          agentModels.set(name, modelMatch[1].trim());
        }
      }
    }
  });

  // ---------------------------------------------------------------
  // 1. Schema validation
  // ---------------------------------------------------------------
  describe("schema", () => {
    it("has required top-level fields", () => {
      expect(config).toHaveProperty("current");
      expect(config).toHaveProperty("profiles");
      expect(typeof config.current).toBe("string");
      expect(typeof config.profiles).toBe("object");
    });

    it("has at least budget, balanced, and quality profiles", () => {
      expect(Object.keys(config.profiles)).toContain("budget");
      expect(Object.keys(config.profiles)).toContain("balanced");
      expect(Object.keys(config.profiles)).toContain("quality");
    });

    it("has advanced profile for opus+sonnet mix", () => {
      expect(Object.keys(config.profiles)).toContain("advanced");
    });

    it("each profile has required fields", () => {
      for (const [name, profile] of Object.entries(config.profiles)) {
        expect(profile.description, `${name}.description`).toBeTruthy();
        expect(typeof profile.description).toBe("string");
        expect(profile.default_model, `${name}.default_model`).toBeTruthy();
        expect(typeof profile.overrides, `${name}.overrides`).toBe("object");
      }
    });
  });

  // ---------------------------------------------------------------
  // 2. Model value validation
  // ---------------------------------------------------------------
  describe("model values", () => {
    it("all default_model values are valid", () => {
      for (const [name, profile] of Object.entries(config.profiles)) {
        expect(
          VALID_MODELS,
          `${name}.default_model = "${profile.default_model}"`,
        ).toContain(profile.default_model);
      }
    });

    it("all override model values are valid", () => {
      for (const [profileName, profile] of Object.entries(config.profiles)) {
        for (const [agent, model] of Object.entries(profile.overrides)) {
          expect(
            VALID_MODELS,
            `${profileName}.overrides.${agent} = "${model}"`,
          ).toContain(model);
        }
      }
    });

    it("all agent frontmatter model values are valid", () => {
      for (const [name, model] of agentModels) {
        expect(
          VALID_MODELS as readonly string[],
          `agent "${name}" has model "${model}"`,
        ).toContain(model);
      }
    });
  });

  // ---------------------------------------------------------------
  // 3. Cross-reference validation
  // ---------------------------------------------------------------
  describe("cross-references", () => {
    it("current profile references an existing profile", () => {
      expect(
        Object.keys(config.profiles),
        `current = "${config.current}" not found in profiles`,
      ).toContain(config.current);
    });

    it("all override agents exist as .claude/agents/*.md", () => {
      for (const [profileName, profile] of Object.entries(config.profiles)) {
        for (const agent of Object.keys(profile.overrides)) {
          expect(
            agentNames,
            `${profileName} references non-existent agent "${agent}"`,
          ).toContain(agent);
        }
      }
    });

    it("every agent has a model: field in frontmatter", () => {
      for (const name of agentNames) {
        expect(
          agentModels.has(name),
          `agent "${name}" missing model: in frontmatter`,
        ).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------
  // 4. Profile tier correctness
  // ---------------------------------------------------------------
  describe("profile tiers", () => {
    it("budget profile uses haiku as default with no overrides", () => {
      const budget = config.profiles.budget;
      expect(budget.default_model).toBe("haiku");
      expect(Object.keys(budget.overrides)).toHaveLength(0);
    });

    it("quality profile uses opus as default with no overrides", () => {
      const quality = config.profiles.quality;
      expect(quality.default_model).toBe("opus");
      expect(Object.keys(quality.overrides)).toHaveLength(0);
    });

    it("balanced profile default is sonnet", () => {
      expect(config.profiles.balanced.default_model).toBe("sonnet");
    });

    it("balanced profile overrides only downgrade to haiku (except PM which is always opus)", () => {
      for (const [agent, model] of Object.entries(
        config.profiles.balanced.overrides,
      )) {
        if (agent === "project-manager") {
          expect(model, `balanced.${agent} must be opus`).toBe("opus");
        } else {
          expect(model, `balanced.${agent} should be haiku`).toBe("haiku");
        }
      }
    });

    it("advanced profile default is sonnet with opus overrides", () => {
      const advanced = config.profiles.advanced;
      expect(advanced.default_model).toBe("sonnet");
      for (const [agent, model] of Object.entries(advanced.overrides)) {
        expect(model, `advanced.${agent} should be opus`).toBe("opus");
      }
    });

    it("advanced profile has at least 4 opus agents", () => {
      const opusCount = Object.values(
        config.profiles.advanced.overrides,
      ).filter((m) => m === "opus").length;
      expect(opusCount).toBeGreaterThanOrEqual(4);
    });
  });

  // ---------------------------------------------------------------
  // 5. Coverage -- every profile covers every agent
  // ---------------------------------------------------------------
  describe("profile coverage", () => {
    it("every profile resolves a model for every agent", () => {
      for (const [profileName, profile] of Object.entries(config.profiles)) {
        for (const agent of agentNames) {
          const resolved =
            profile.overrides[agent] ?? profile.default_model;
          expect(
            VALID_MODELS as readonly string[],
            `${profileName} resolves "${resolved}" for "${agent}"`,
          ).toContain(resolved);
        }
      }
    });

    it("no override references a non-existent agent", () => {
      const allOverrideAgents = new Set<string>();
      for (const profile of Object.values(config.profiles)) {
        for (const agent of Object.keys(profile.overrides)) {
          allOverrideAgents.add(agent);
        }
      }
      for (const agent of allOverrideAgents) {
        expect(
          agentNames,
          `override agent "${agent}" does not exist`,
        ).toContain(agent);
      }
    });
  });

  // ---------------------------------------------------------------
  // 6. Current profile matches actual agent frontmatter
  // ---------------------------------------------------------------
  describe("current profile alignment", () => {
    it("agent frontmatter matches the current profile assignments", () => {
      const currentProfile = config.profiles[config.current];
      if (!currentProfile) return; // already tested in cross-references

      const mismatches: string[] = [];
      for (const [name, actualModel] of agentModels) {
        const expected =
          currentProfile.overrides[name] ?? currentProfile.default_model;
        if (actualModel !== expected) {
          mismatches.push(
            `${name}: frontmatter="${actualModel}" expected="${expected}"`,
          );
        }
      }

      expect(
        mismatches,
        `Agents out of sync with "${config.current}" profile:\n  ${mismatches.join("\n  ")}`,
      ).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // 7. Profile ordering (budget < balanced < advanced < quality)
  // ---------------------------------------------------------------
  describe("profile tier ordering", () => {
    const modelRank: Record<string, number> = {
      haiku: 1,
      sonnet: 2,
      opus: 3,
    };

    function avgModelRank(profile: Profile): number {
      const models = agentNames.map(
        (a) => profile.overrides[a] ?? profile.default_model,
      );
      return (
        models.reduce((sum, m) => sum + (modelRank[m] ?? 0), 0) /
        models.length
      );
    }

    it("budget has lowest average model rank", () => {
      const ranks = Object.entries(config.profiles).map(([name, p]) => ({
        name,
        rank: avgModelRank(p),
      }));
      const budgetRank = ranks.find((r) => r.name === "budget")!.rank;
      for (const r of ranks) {
        if (r.name !== "budget") {
          expect(
            budgetRank,
            `budget (${budgetRank}) should be <= ${r.name} (${r.rank})`,
          ).toBeLessThanOrEqual(r.rank);
        }
      }
    });

    it("quality has highest average model rank", () => {
      const ranks = Object.entries(config.profiles).map(([name, p]) => ({
        name,
        rank: avgModelRank(p),
      }));
      const qualityRank = ranks.find((r) => r.name === "quality")!.rank;
      for (const r of ranks) {
        if (r.name !== "quality") {
          expect(
            qualityRank,
            `quality (${qualityRank}) should be >= ${r.name} (${r.rank})`,
          ).toBeGreaterThanOrEqual(r.rank);
        }
      }
    });

    it("advanced rank is between balanced and quality", () => {
      const balancedRank = avgModelRank(config.profiles.balanced);
      const advancedRank = avgModelRank(config.profiles.advanced);
      const qualityRank = avgModelRank(config.profiles.quality);

      expect(advancedRank).toBeGreaterThanOrEqual(balancedRank);
      expect(advancedRank).toBeLessThanOrEqual(qualityRank);
    });
  });

  // ---------------------------------------------------------------
  // 8. PM is opus in ALL non-budget profiles
  // ---------------------------------------------------------------
  describe("PM model tier — opus in all non-budget profiles", () => {
    it("PM is opus in balanced profile (explicit override)", () => {
      const resolved = config.profiles.balanced.overrides["project-manager"] ?? config.profiles.balanced.default_model;
      expect(resolved).toBe("opus");
    });

    it("PM is opus in advanced profile (explicit override)", () => {
      const resolved = config.profiles.advanced.overrides["project-manager"] ?? config.profiles.advanced.default_model;
      expect(resolved).toBe("opus");
    });

    it("PM is opus in quality profile (default_model is opus, no override needed)", () => {
      const resolved = config.profiles.quality.overrides["project-manager"] ?? config.profiles.quality.default_model;
      expect(resolved).toBe("opus");
    });
  });
});

// ---------------------------------------------------------------------------
// Bootstrap and L0 sync contract tests (Fix #6)
// ---------------------------------------------------------------------------

describe("model-profiles.json L0 sync contract", () => {
  let l0Config: ModelProfiles;

  beforeAll(async () => {
    const raw = await readFile(PROFILES_PATH, "utf-8");
    l0Config = JSON.parse(raw);
  });

  it("L0 profiles.json is the canonical source (file exists at L0 root)", async () => {
    const content = await readFile(PROFILES_PATH, "utf-8");
    expect(content).toBeTruthy();
    const data = JSON.parse(content);
    expect(data.profiles).toBeDefined();
    expect(Object.keys(data.profiles).length).toBeGreaterThanOrEqual(4);
  });

  it("L0 profiles contain all four canonical tiers", () => {
    const tiers = Object.keys(l0Config.profiles);
    expect(tiers).toContain("budget");
    expect(tiers).toContain("balanced");
    expect(tiers).toContain("advanced");
    expect(tiers).toContain("quality");
  });

  it("each L0 profile override agent maps to an existing .claude/agents file", async () => {
    const agentFiles = await readdir(AGENTS_DIR);
    const agentNames = agentFiles
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""));

    for (const [profileName, profile] of Object.entries(l0Config.profiles)) {
      for (const overrideAgent of Object.keys(profile.overrides)) {
        expect(
          agentNames,
          `${profileName}.overrides references "${overrideAgent}" which doesn't exist in .claude/agents/`,
        ).toContain(overrideAgent);
      }
    }
  });

  it("balanced profile overrides are a subset of all agents (not all agents)", async () => {
    const agentFiles = await readdir(AGENTS_DIR);
    const allAgentNames = agentFiles
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""));
    const overrideCount = Object.keys(l0Config.profiles.balanced.overrides).length;
    const agentCount = allAgentNames.length;
    // Balanced should have SOME overrides but not ALL agents
    expect(overrideCount).toBeGreaterThan(0);
    expect(overrideCount).toBeLessThan(agentCount);
  });

  it("sync-l0 does NOT include model-profiles.json in registry (managed by skill)", async () => {
    const registryRaw = await readFile(
      path.join(ROOT, "skills", "registry.json"),
      "utf-8",
    );
    const registry = JSON.parse(registryRaw);
    const entries = registry.skills ?? registry.entries ?? [];
    const profileEntry = entries.find(
      (e: { path?: string; name?: string }) =>
        (e.path && e.path.includes("model-profiles")) ||
        (e.name && e.name === "model-profiles"),
    );
    expect(
      profileEntry,
      "model-profiles.json should NOT be in the sync registry — it's managed by /set-model-profile",
    ).toBeUndefined();
  });

  it("set-model-profile skill documents bootstrap behavior", async () => {
    const skillContent = await readFile(
      path.join(ROOT, "skills", "set-model-profile", "SKILL.md"),
      "utf-8",
    );
    expect(skillContent).toContain("Bootstrap");
    expect(skillContent).toContain("l0-manifest.json");
    expect(skillContent).toContain("ANDROID_COMMON_DOC");
    expect(skillContent).toContain("--update");
  });

  it("set-model-profile skill documents --update for refreshing L0 definitions", async () => {
    const skillContent = await readFile(
      path.join(ROOT, "skills", "set-model-profile", "SKILL.md"),
      "utf-8",
    );
    expect(skillContent).toContain("--update");
    expect(skillContent).toContain("Re-import profile definitions from L0");
    expect(skillContent).toContain("current");
  });
});

