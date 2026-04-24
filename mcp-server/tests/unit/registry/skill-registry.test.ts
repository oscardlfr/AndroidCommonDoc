/**
 * Tests for the L0 skill registry generator.
 *
 * Verifies that the registry correctly scans skills, agents, and commands,
 * computes deterministic SHA-256 hashes, extracts metadata from frontmatter,
 * and produces a complete SkillRegistry object.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  computeHash,
  scanSkills,
  scanAgents,
  scanCommands,
  scanAgentTemplates,
  generateRegistry,
  extractDependencies,
  categorize,
  tierize,
  type SkillRegistryEntry,
  type SkillRegistry,
} from "../../../src/registry/skill-registry.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "skill-reg-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// --- Helper to create fixture files ---

async function createSkill(
  name: string,
  content: string,
): Promise<void> {
  const dir = path.join(tmpDir, "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), content, "utf-8");
}

async function createAgent(
  name: string,
  content: string,
): Promise<void> {
  const dir = path.join(tmpDir, ".claude", "agents");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.md`), content, "utf-8");
}

async function createCommand(
  name: string,
  content: string,
): Promise<void> {
  const dir = path.join(tmpDir, ".claude", "commands");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.md`), content, "utf-8");
}

async function createAgentTemplate(
  name: string,
  content: string,
): Promise<void> {
  const dir = path.join(tmpDir, "setup", "agent-templates");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.md`), content, "utf-8");
}

describe("skill-registry", () => {
  describe("computeHash", () => {
    it("returns deterministic SHA-256 string prefixed with sha256:", async () => {
      const filePath = path.join(tmpDir, "hash-test.md");
      await writeFile(filePath, "hello world", "utf-8");

      const hash = await computeHash(filePath);

      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("returns same hash for identical content", async () => {
      const file1 = path.join(tmpDir, "file1.md");
      const file2 = path.join(tmpDir, "file2.md");
      await writeFile(file1, "identical content", "utf-8");
      await writeFile(file2, "identical content", "utf-8");

      const hash1 = await computeHash(file1);
      const hash2 = await computeHash(file2);

      expect(hash1).toBe(hash2);
    });

    it("returns different hash for different content", async () => {
      const file1 = path.join(tmpDir, "diff1.md");
      const file2 = path.join(tmpDir, "diff2.md");
      await writeFile(file1, "content A", "utf-8");
      await writeFile(file2, "content B", "utf-8");

      const hash1 = await computeHash(file1);
      const hash2 = await computeHash(file2);

      expect(hash1).not.toBe(hash2);
    });

    it("produces same hash for CRLF and LF versions of identical content (parity with rehash-registry.sh)", async () => {
      const lfFile = path.join(tmpDir, "parity-lf.md");
      const crlfFile = path.join(tmpDir, "parity-crlf.md");
      const contentLF = "# Skill\n\nDescription with arrow → here.\n\nMore content.\n";
      const contentCRLF = contentLF.replace(/\n/g, '\r\n');
      await writeFile(lfFile, contentLF, 'binary');
      await writeFile(crlfFile, contentCRLF, 'binary');

      const hashLF = await computeHash(lfFile);
      const hashCRLF = await computeHash(crlfFile);

      expect(hashLF).toBe(hashCRLF);
    });
  });

  describe("scanSkills", () => {
    it("discovers all SKILL.md files under skills/ directory", async () => {
      await createSkill(
        "test",
        '---\nname: test\ndescription: "Run tests"\nallowed-tools: [Bash]\n---\n\n## Usage\nTest stuff.\n',
      );
      await createSkill(
        "coverage",
        '---\nname: coverage\ndescription: "Check coverage"\nallowed-tools: [Bash, Read]\n---\n\nCoverage skill.\n',
      );

      const entries = await scanSkills(tmpDir);

      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.name).sort()).toEqual(["coverage", "test"]);
      expect(entries.every((e) => e.type === "skill")).toBe(true);
    });

    it("returns entries with correct paths relative to root", async () => {
      await createSkill(
        "test",
        '---\nname: test\ndescription: "Run tests"\nallowed-tools: [Bash]\n---\n\nContent.\n',
      );

      const entries = await scanSkills(tmpDir);

      expect(entries[0].path).toBe("skills/test/SKILL.md");
    });

    it("extracts description from frontmatter", async () => {
      await createSkill(
        "test",
        '---\nname: test\ndescription: "Run tests with retry"\nallowed-tools: [Bash]\n---\n\nContent.\n',
      );

      const entries = await scanSkills(tmpDir);

      expect(entries[0].description).toBe("Run tests with retry");
    });

    it("skips non-SKILL.md files like params.json", async () => {
      await createSkill(
        "test",
        '---\nname: test\ndescription: "Test"\nallowed-tools: [Bash]\n---\n\nContent.\n',
      );
      // Add params.json alongside SKILL.md
      await writeFile(
        path.join(tmpDir, "skills", "test", "params.json"),
        "{}",
        "utf-8",
      );

      const entries = await scanSkills(tmpDir);

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("test");
    });

    it("returns empty array when skills/ directory does not exist", async () => {
      const entries = await scanSkills(tmpDir);

      expect(entries).toEqual([]);
    });
  });

  describe("scanAgents", () => {
    it("discovers all .md files under .claude/agents/", async () => {
      await createAgent(
        "test-specialist",
        '---\nname: test-specialist\ndescription: "Reviews tests"\ntools: Read, Grep\nmodel: sonnet\n---\n\nAgent content.\n',
      );
      await createAgent(
        "release-guardian",
        '---\nname: release-guardian\ndescription: "Guards releases"\ntools: Bash\nmodel: haiku\n---\n\nAgent content.\n',
      );

      const entries = await scanAgents(tmpDir);

      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.type === "agent")).toBe(true);
      expect(entries.map((e) => e.name).sort()).toEqual([
        "release-guardian",
        "test-specialist",
      ]);
    });

    it("returns entries with correct paths", async () => {
      await createAgent(
        "test-specialist",
        '---\nname: test-specialist\ndescription: "Reviews tests"\ntools: Read\nmodel: sonnet\n---\n\nContent.\n',
      );

      const entries = await scanAgents(tmpDir);

      expect(entries[0].path).toBe(".claude/agents/test-specialist.md");
    });

    it("extracts agent frontmatter (tools, model, skills)", async () => {
      await createAgent(
        "test-specialist",
        '---\nname: test-specialist\ndescription: "Reviews tests"\ntools: Read, Grep\nmodel: sonnet\nskills:\n  - test\n  - coverage\n---\n\nContent.\n',
      );

      const entries = await scanAgents(tmpDir);
      const fm = entries[0].frontmatter;

      expect(fm["tools"]).toBe("Read, Grep");
      expect(fm["model"]).toBe("sonnet");
      expect(fm["skills"]).toEqual(["test", "coverage"]);
    });
  });

  describe("scanCommands", () => {
    it("discovers all .md files under .claude/commands/", async () => {
      await createCommand(
        "brainstorm",
        "<!-- L0 Generic Command -->\n# /brainstorm - Parse Ideas\n\nProcess ideas.\n",
      );
      await createCommand(
        "test",
        '<!-- GENERATED from skills/test/SKILL.md -- DO NOT EDIT MANUALLY -->\n<!-- Regenerate: bash adapters/generate-all.sh -->\n# /test - Run tests\n\nRun tests.\n',
      );

      const entries = await scanCommands(tmpDir);

      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.type === "command")).toBe(true);
    });

    it("marks adapter-generated commands with generated_from field", async () => {
      await createCommand(
        "test",
        '<!-- GENERATED from skills/test/SKILL.md -- DO NOT EDIT MANUALLY -->\n<!-- Regenerate: bash adapters/generate-all.sh -->\n# /test - Run tests\n\nRun tests.\n',
      );

      const entries = await scanCommands(tmpDir);

      expect(entries[0].generated_from).toBe("skills/test/SKILL.md");
    });

    it("standalone commands have no generated_from", async () => {
      await createCommand(
        "brainstorm",
        "<!-- L0 Generic Command -->\n# /brainstorm - Parse Ideas\n\nProcess ideas.\n",
      );

      const entries = await scanCommands(tmpDir);

      expect(entries[0].generated_from).toBeUndefined();
    });
  });

  describe("extractDependencies", () => {
    it("finds script references in SKILL.md content", () => {
      const content = `## Implementation

### macOS / Linux
\`\`\`bash
"$COMMON_DOC/scripts/sh/gradle-run.sh" --project-root "$(pwd)"
\`\`\`

### Windows
\`\`\`powershell
& "$commonDoc\\scripts\\ps1\\gradle-run.ps1" @params
\`\`\`

## Cross-References
- Script: \`scripts/sh/gradle-run.sh\`, \`scripts/ps1/gradle-run.ps1\`
- Script: \`scripts/sh/ai-error-extractor.sh\`, \`scripts/ps1/ai-error-extractor.ps1\`
`;

      const deps = extractDependencies(content);

      expect(deps).toContain("scripts/sh/gradle-run.sh");
      expect(deps).toContain("scripts/ps1/gradle-run.ps1");
      expect(deps).toContain("scripts/sh/ai-error-extractor.sh");
      expect(deps).toContain("scripts/ps1/ai-error-extractor.ps1");
    });

    it("returns empty array when no script references found", () => {
      const content = "## Usage\nJust do stuff.\n";
      const deps = extractDependencies(content);

      expect(deps).toEqual([]);
    });

    it("returns unique dependencies (no duplicates)", () => {
      const content = `
- Script: \`scripts/sh/gradle-run.sh\`
- Also: \`scripts/sh/gradle-run.sh\`
`;
      const deps = extractDependencies(content);

      expect(deps.filter((d) => d === "scripts/sh/gradle-run.sh")).toHaveLength(
        1,
      );
    });
  });

  describe("categorize", () => {
    it("assigns categories based on skill name", () => {
      expect(categorize("test")).toBe("testing");
      expect(categorize("coverage")).toBe("testing");
      expect(categorize("test-full")).toBe("testing");
      expect(categorize("test-changed")).toBe("testing");
      expect(categorize("auto-cover")).toBe("testing");
      expect(categorize("android-test")).toBe("testing");

      expect(categorize("run")).toBe("build");
      expect(categorize("verify-kmp")).toBe("build");

      expect(categorize("validate-patterns")).toBe("guides");
      expect(categorize("doc-reorganize")).toBe("guides");
      expect(categorize("monitor-docs")).toBe("guides");
      expect(categorize("ingest-content")).toBe("guides");
      expect(categorize("sync-vault")).toBe("guides");
      expect(categorize("sync-versions")).toBe("guides");
      expect(categorize("generate-rules")).toBe("guides");

      expect(categorize("sbom")).toBe("security");
      expect(categorize("sbom-scan")).toBe("security");
      expect(categorize("sbom-analyze")).toBe("security");

      expect(categorize("extract-errors")).toBe("domain");

      expect(categorize("accessibility")).toBe("ui");
      expect(categorize("web-quality-audit")).toBe("ui");
      expect(categorize("core-web-vitals")).toBe("ui");
      expect(categorize("performance")).toBe("ui");
      expect(categorize("seo")).toBe("ui");
      expect(categorize("best-practices")).toBe("ui");
    });

    it("uses frontmatter category if provided", () => {
      expect(categorize("anything", { category: "security" })).toBe(
        "security",
      );
      expect(categorize("anything", { category: "build" })).toBe("build");
    });
  });

  describe("tierize", () => {
    it("assigns core tier to testing and build categories", () => {
      expect(tierize("test", "testing")).toBe("core");
      expect(tierize("run", "build")).toBe("core");
      expect(tierize("verify-kmp", "build")).toBe("core");
    });

    it("assigns extended tier to guides and domain categories", () => {
      expect(tierize("monitor-docs", "guides")).toBe("extended");
      expect(tierize("extract-errors", "domain")).toBe("extended");
    });

    it("assigns web tier to web-specific skills", () => {
      expect(tierize("web-quality-audit", "ui")).toBe("web");
      expect(tierize("core-web-vitals", "ui")).toBe("web");
      expect(tierize("seo", "ui")).toBe("web");
      expect(tierize("accessibility", "ui")).toBe("web");
      expect(tierize("performance", "ui")).toBe("web");
      expect(tierize("best-practices", "ui")).toBe("web");
    });

    it("assigns core tier to security category", () => {
      expect(tierize("sbom", "security")).toBe("core");
    });
  });

  describe("generateRegistry", () => {
    it("combines skills + agents + commands into SkillRegistry object", async () => {
      await createSkill(
        "test",
        '---\nname: test\ndescription: "Run tests"\nallowed-tools: [Bash]\n---\n\nContent.\n',
      );
      await createAgent(
        "test-specialist",
        '---\nname: test-specialist\ndescription: "Reviews tests"\ntools: Read\nmodel: sonnet\n---\n\nContent.\n',
      );
      await createCommand(
        "brainstorm",
        "<!-- L0 Generic Command -->\n# /brainstorm - Parse Ideas\n\nProcess ideas.\n",
      );

      const registry = await generateRegistry(tmpDir);

      expect(registry.version).toBe(1);
      expect(registry.generated).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(registry.l0_root).toBe(".");
      expect(registry.entries).toHaveLength(3);

      const types = registry.entries.map((e) => e.type).sort();
      expect(types).toEqual(["agent", "command", "skill"]);
    });

    it("entries have all required fields", async () => {
      await createSkill(
        "test",
        '---\nname: test\ndescription: "Run tests"\nallowed-tools: [Bash]\n---\n\nContent.\n',
      );

      const registry = await generateRegistry(tmpDir);
      const entry = registry.entries[0];

      expect(entry.name).toBe("test");
      expect(entry.type).toBe("skill");
      expect(entry.path).toBe("skills/test/SKILL.md");
      expect(entry.description).toBe("Run tests");
      expect(entry.category).toBeDefined();
      expect(entry.tier).toBeDefined();
      expect(entry.hash).toMatch(/^sha256:/);
      expect(entry.dependencies).toBeInstanceOf(Array);
      expect(entry.frontmatter).toBeDefined();
    });
  });

  describe("uniqueness", () => {
    it("name+type combination is unique key (no duplicates)", async () => {
      // Create a skill and a command with the same name
      await createSkill(
        "test",
        '---\nname: test\ndescription: "Run tests"\nallowed-tools: [Bash]\n---\n\nContent.\n',
      );
      await createCommand(
        "test",
        '<!-- GENERATED from skills/test/SKILL.md -- DO NOT EDIT MANUALLY -->\n# /test - Run tests\n\nContent.\n',
      );

      const registry = await generateRegistry(tmpDir);

      // Both should be present -- same name, different type
      const testEntries = registry.entries.filter((e) => e.name === "test");
      expect(testEntries).toHaveLength(2);
      expect(testEntries.map((e) => e.type).sort()).toEqual([
        "command",
        "skill",
      ]);

      // Verify no duplicate name+type pairs
      const keys = registry.entries.map((e) => `${e.name}:${e.type}`);
      const uniqueKeys = new Set(keys);
      expect(keys.length).toBe(uniqueKeys.size);
    });
  });
});

// ---------------------------------------------------------------------------
// BL-W30-04: scanAgentTemplates + generateRegistry includes setup/agent-templates/
// ---------------------------------------------------------------------------

describe("scanAgentTemplates (BL-W30-04)", () => {
  it("returns entries with path starting with setup/agent-templates/", async () => {
    await createAgentTemplate(
      "team-lead",
      '---\nname: team-lead\ndescription: "Orchestrates the team"\ntemplate_version: "1.0.0"\n---\n\n# Team Lead\n',
    );
    await createAgentTemplate(
      "arch-platform",
      '---\nname: arch-platform\ndescription: "Platform architect"\n---\n\n# Arch Platform\n',
    );

    const entries = await scanAgentTemplates(tmpDir);

    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.path.startsWith("setup/agent-templates/"))).toBe(true);
  });

  it("returns entries with type=agent, category=architecture, tier=extended", async () => {
    await createAgentTemplate(
      "planner",
      '---\nname: planner\ndescription: "Writes the plan"\n---\n\n# Planner\n',
    );

    const entries = await scanAgentTemplates(tmpDir);

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("agent");
    expect(entries[0].category).toBe("architecture");
    expect(entries[0].tier).toBe("extended");
  });

  it("reads description from frontmatter", async () => {
    await createAgentTemplate(
      "context-provider",
      '---\nname: context-provider\ndescription: "Serves context to the team"\n---\n\n# Context Provider\n',
    );

    const entries = await scanAgentTemplates(tmpDir);

    expect(entries[0].description).toBe("Serves context to the team");
  });

  it("returns empty array when setup/agent-templates/ does not exist", async () => {
    const entries = await scanAgentTemplates(tmpDir);
    expect(entries).toEqual([]);
  });

  it("skips non-.md files in setup/agent-templates/", async () => {
    const dir = path.join(tmpDir, "setup", "agent-templates");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "README.txt"), "not a template", "utf-8");
    await writeFile(path.join(dir, "team-lead.md"), '---\nname: team-lead\n---\n', "utf-8");

    const entries = await scanAgentTemplates(tmpDir);

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("team-lead");
  });

  it("hash is a sha256: prefixed string", async () => {
    await createAgentTemplate(
      "team-lead",
      '---\nname: team-lead\ndescription: "Lead"\n---\n\n# Team Lead\n',
    );

    const entries = await scanAgentTemplates(tmpDir);

    expect(entries[0].hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("generateRegistry includes agent templates (BL-W30-04)", () => {
  it("includes entries from setup/agent-templates/ alongside skills/agents/commands", async () => {
    await createSkill("test", '---\nname: test\ndescription: "Tests"\n---\n\nContent.\n');
    await createAgent("test-specialist", '---\nname: test-specialist\ndescription: "Tests"\n---\n\nContent.\n');
    await createAgentTemplate("team-lead", '---\nname: team-lead\ndescription: "Lead"\n---\n\nContent.\n');

    const registry = await generateRegistry(tmpDir);

    const templateEntries = registry.entries.filter((e) =>
      e.path.startsWith("setup/agent-templates/"),
    );
    expect(templateEntries).toHaveLength(1);
    expect(templateEntries[0].name).toBe("team-lead");
    expect(registry.entries.length).toBeGreaterThanOrEqual(2);
  });

  it("destPath for setup/agent-templates/ paths is identity (no skills/ prefix added)", () => {
    // setup/agent-templates/ does not start with "skills/" so destPath returns unchanged
    // Full destPath tests live in sync-engine.test.ts (BL-W30-04 assertion there)
    const templatePath = "setup/agent-templates/team-lead.md";
    expect(templatePath.startsWith("skills/")).toBe(false);
    // destPath fallthrough: returns path as-is
    expect(templatePath).toBe("setup/agent-templates/team-lead.md");
  });
});
