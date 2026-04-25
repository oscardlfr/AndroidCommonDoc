/**
 * Anti-regression tests for Wave 25 behaviors.
 *
 * Covers:
 *  - MCP wiring: 10 core agents declare MCP tools in frontmatter (not just prose)
 *  - Naming: no active reference to `project-manager` or `PM` as standalone word in docs/templates
 *  - Ingestion loop: context-provider emits ingestion-request; team-lead has handler; doc-updater has §5
 *  - Naming drift: agents reference actual registered MCP names (verify-kmp-packages, check-doc-freshness)
 *  - context-provider v3.0.0: Spawn Protocol section with pre-cache (no "NOT eagerly pre-read")
 *  - Dual-location sync: setup/agent-templates/ == .claude/agents/
 *  - Audit script: scripts/audit-wiring.sh returns non-zero orphans only for expected L2 tools
 *  - Registry parity: all MCP tools declared in frontmatter exist as registered callable names
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(__dirname, "../../..");
const AGENTS_DIR = path.join(ROOT, ".claude/agents");
const TEMPLATES_DIR = path.join(ROOT, "setup/agent-templates");
const DOCS_AGENTS_DIR = path.join(ROOT, "docs/agents");
const TOOLS_DIR = path.join(ROOT, "mcp-server/src/tools");

// Helper: read agent/template both copies
function readBothAgent(name: string): string[] {
  return [
    fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8"),
    fs.readFileSync(path.join(AGENTS_DIR, name), "utf-8"),
  ];
}

// Helper: extract frontmatter
function getFrontmatter(raw: string): Record<string, unknown> | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try {
    return parseYaml(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Helper: extract MCP tool names from a comma-separated `tools:` string
function getMcpTools(toolsField: unknown): string[] {
  if (typeof toolsField !== "string") return [];
  return toolsField
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.startsWith("mcp__"));
}

// Helper: list all registered MCP tool callable names (from server.registerTool/tool calls)
function registeredMcpTools(): Set<string> {
  const names = new Set<string>();
  const files = fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  for (const f of files) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, f), "utf-8");
    const m = src.match(/server\.(?:registerTool|tool)\(\s*\n?\s*"([a-z][a-z-]+)"/);
    if (m) names.add(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Group 1: 10 core agents have MCP tools declared in frontmatter
// ---------------------------------------------------------------------------

const CORE_AGENTS_WITH_MIN_MCP_TOOLS: Array<[string, number]> = [
  ["context-provider.md", 8],
  ["doc-updater.md", 6],
  ["doc-alignment-agent.md", 8],
  ["l0-coherence-auditor.md", 5],
  ["arch-platform.md", 5],
  ["arch-testing.md", 3],
  ["arch-integration.md", 3],
  ["codebase-mapper.md", 4],
  ["beta-readiness-agent.md", 4],
  ["verifier.md", 3],
  ["test-specialist.md", 2],
  ["ui-specialist.md", 2],
  ["release-guardian-agent.md", 3],
  ["quality-gater.md", 3],
];

describe("Wave 25: 10 core agents declare MCP tools in frontmatter", () => {
  for (const [name, minTools] of CORE_AGENTS_WITH_MIN_MCP_TOOLS) {
    it(`${name} declares at least ${minTools} MCP tools in tools: frontmatter`, () => {
      for (const raw of readBothAgent(name)) {
        const fm = getFrontmatter(raw);
        expect(fm, `${name}: no frontmatter`).not.toBeNull();
        const mcp = getMcpTools(fm!.tools);
        expect(
          mcp.length,
          `${name}: expected >= ${minTools} MCP tools, got ${mcp.length} (${mcp.join(", ")})`,
        ).toBeGreaterThanOrEqual(minTools);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Group 2: team-lead rename — no active references to project-manager or PM
// ---------------------------------------------------------------------------

describe("Wave 25: team-lead rename — no active project-manager references", () => {
  const activePaths = [
    TEMPLATES_DIR,
    AGENTS_DIR,
    DOCS_AGENTS_DIR,
  ];

  it("no 'project-manager' filenames remain in active agent dirs", () => {
    for (const dir of activePaths.slice(0, 2)) {
      const files = fs.readdirSync(dir);
      expect(files).not.toContain("project-manager.md");
    }
  });

  it("no 'pm-*' filenames remain in docs/agents/", () => {
    const files = fs.readdirSync(DOCS_AGENTS_DIR);
    const pmPrefixed = files.filter((f) => /^pm-/.test(f));
    expect(pmPrefixed, `found stale pm-* files: ${pmPrefixed.join(", ")}`).toHaveLength(0);
  });

  it("team-lead template files are DELETED (W31.6 retirement)", () => {
    // W31.6: team-lead.md deprecated — content moved to docs/agents/main-agent-orchestration-guide.md
    expect(fs.existsSync(path.join(TEMPLATES_DIR, "team-lead.md"))).toBe(false);
    expect(fs.existsSync(path.join(AGENTS_DIR, "team-lead.md"))).toBe(false);
  });

  it("main-agent-orchestration-guide.md exists in docs/agents/ (W31.6 replacement)", () => {
    const guidePath = path.join(DOCS_AGENTS_DIR, "main-agent-orchestration-guide.md");
    expect(fs.existsSync(guidePath)).toBe(true);
    const content = fs.readFileSync(guidePath, "utf-8");
    // Must have doc frontmatter (not subagent frontmatter)
    expect(content).toMatch(/^category: agents/m);
    expect(content).not.toMatch(/^name: team-lead/m);
  });

  it("core agent templates do not contain 'project-manager' in body (only team-lead)", () => {
    // Historical/migration notes intentionally keep the old name; body of active agents should not
    const corePaths = [
      "arch-platform.md",
      "arch-testing.md",
      "arch-integration.md",
      "context-provider.md",
      "doc-updater.md",
      "quality-gater.md",
    ];
    for (const name of corePaths) {
      for (const raw of readBothAgent(name)) {
        expect(
          raw.includes("project-manager"),
          `${name}: still contains 'project-manager' — run Wave 25 rename`,
        ).toBe(false);
      }
    }
  });

  it("MIGRATIONS.json root key is 'team-lead' (not 'project-manager')", () => {
    const migrations = JSON.parse(
      fs.readFileSync(path.join(TEMPLATES_DIR, "MIGRATIONS.json"), "utf-8"),
    );
    expect(migrations.templates).toHaveProperty("team-lead");
    expect(migrations.templates).not.toHaveProperty("project-manager");
  });
});

// ---------------------------------------------------------------------------
// Group 3: Ingestion loop wiring (context-provider → team-lead → doc-updater)
// ---------------------------------------------------------------------------

describe("Wave 25: ingestion loop is fully wired", () => {
  it("context-provider emits ingestion-request SendMessage pattern", () => {
    for (const raw of readBothAgent("context-provider.md")) {
      expect(raw).toMatch(/ingestion-request/i);
      expect(raw).toMatch(/SendMessage\(to="team-lead"/);
      expect(raw).toMatch(/proposed_slug/);
      expect(raw).toMatch(/proposed_category/);
    }
  });

  it("main-agent-orchestration-guide.md has Ingestion-Request Handler section (W31.6)", () => {
    // team-lead.md retired W31.6 — content moved to main-agent-orchestration-guide.md
    const guidePath = path.join(DOCS_AGENTS_DIR, "main-agent-orchestration-guide.md");
    const raw = fs.readFileSync(guidePath, "utf-8");
    expect(raw).toMatch(/Ingestion-?Request Handler/i);
    expect(raw).toMatch(/approved_by:\s*user/);
  });

  it("doc-updater has Ingestion Handler (§5) with ingest-content call", () => {
    for (const raw of readBothAgent("doc-updater.md")) {
      expect(raw).toMatch(/Ingestion Handler/i);
      expect(raw).toMatch(/mcp__androidcommondoc__ingest-content/);
      expect(raw).toMatch(/approved_by/);
    }
  });

  it("doc-updater declares mcp__androidcommondoc__ingest-content in tools frontmatter", () => {
    for (const raw of readBothAgent("doc-updater.md")) {
      const fm = getFrontmatter(raw);
      const tools = typeof fm?.tools === "string" ? (fm.tools as string) : "";
      expect(tools).toContain("mcp__androidcommondoc__ingest-content");
    }
  });

  it("docs/agents/ingestion-loop.md exists and documents the flow", () => {
    const p = path.join(DOCS_AGENTS_DIR, "ingestion-loop.md");
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, "utf-8");
    expect(content).toMatch(/context-provider/);
    expect(content).toMatch(/team-lead/);
    expect(content).toMatch(/doc-updater/);
    expect(content).toMatch(/ingest-content/);
    expect(content).toMatch(/approved_by:\s*user/);
  });
});

// ---------------------------------------------------------------------------
// Group 4: context-provider v3.0.0 Spawn Protocol (pre-cache)
// ---------------------------------------------------------------------------

describe("Wave 25: context-provider v3.x Spawn Protocol pre-cache", () => {
  it("context-provider has Spawn Protocol section (not Oracle Protocol)", () => {
    for (const raw of readBothAgent("context-provider.md")) {
      expect(raw).toMatch(/Spawn Protocol/);
    }
  });

  it("context-provider does NOT tell agents to avoid eager pre-read", () => {
    for (const raw of readBothAgent("context-provider.md")) {
      // Wave 25: v3.0 reversed the "do NOT eagerly pre-read" rule into mandatory pre-cache
      expect(raw).not.toMatch(/do NOT eagerly pre-read/i);
    }
  });

  it("context-provider Spawn Protocol references find-pattern category batch", () => {
    for (const raw of readBothAgent("context-provider.md")) {
      expect(raw).toMatch(/find-pattern/);
      expect(raw).toMatch(/pre-cache|pattern index/i);
    }
  });

  it("context-provider template_version is 3.x", () => {
    for (const raw of readBothAgent("context-provider.md")) {
      expect(raw).toMatch(/template_version:\s*"3\.\d+\.\d+"/);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 5: MCP tool naming drift — declared names must exist as callables
// ---------------------------------------------------------------------------

describe("Wave 25: declared MCP tools match registered callable names", () => {
  it("all agent-declared MCP tools exist as registered callables", () => {
    const registered = registeredMcpTools();
    const allAgents = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
    const missing: string[] = [];
    for (const name of allAgents) {
      const raw = fs.readFileSync(path.join(AGENTS_DIR, name), "utf-8");
      const fm = getFrontmatter(raw);
      const mcp = getMcpTools(fm?.tools);
      for (const t of mcp) {
        // Only check our MCP server tools; external (context7, etc.) are out of scope
        if (!t.startsWith("mcp__androidcommondoc__")) continue;
        const callable = t.replace("mcp__androidcommondoc__", "");
        if (!registered.has(callable)) {
          missing.push(`${name}: ${t} (callable '${callable}' not registered)`);
        }
      }
    }
    expect(
      missing,
      `Agents declare MCP tools that don't exist as registered callables:\n${missing.join("\n")}`,
    ).toHaveLength(0);
  });

  it("known naming drifts are documented in agent-core-rules §8", () => {
    const rules = fs.readFileSync(path.join(DOCS_AGENTS_DIR, "agent-core-rules.md"), "utf-8");
    expect(rules).toMatch(/verify-kmp\.ts.*verify-kmp-packages/s);
    expect(rules).toMatch(/check-freshness\.ts.*check-doc-freshness/s);
  });
});

// ---------------------------------------------------------------------------
// Group 6: Level A skill analytics — by_skill field + dead-skill detection
// ---------------------------------------------------------------------------

describe("Wave 25 Level A: tool-use-analytics computes by_skill", () => {
  it("ToolUseReport type has by_skill, dead_skills, user_invokable_skills fields", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "mcp-server/src/tools/tool-use-analytics.ts"),
      "utf-8",
    );
    expect(src).toMatch(/by_skill:\s*SkillUsage\[\]/);
    expect(src).toMatch(/dead_skills:\s*string\[\]/);
    expect(src).toMatch(/user_invokable_skills:\s*string\[\]/);
  });

  it("computeToolUseReport accepts projectRoot parameter for dead-skill detection", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "mcp-server/src/tools/tool-use-analytics.ts"),
      "utf-8",
    );
    // Signature includes projectRoot (even if optional)
    expect(src).toMatch(/projectRoot\?:\s*string/);
  });

  it("markdown renderer includes 'Skill Usage' section and 'Dead skills' heading", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "mcp-server/src/tools/tool-use-analytics.ts"),
      "utf-8",
    );
    expect(src).toMatch(/Skill Usage/);
    expect(src).toMatch(/Dead skills/);
  });
});

// ---------------------------------------------------------------------------
// Group 7: Dual-location sync (setup/agent-templates/ == .claude/agents/)
// ---------------------------------------------------------------------------

describe("Wave 25: setup/agent-templates == .claude/agents for all pairs", () => {
  it("all agent templates are identical between setup and .claude", () => {
    // Excludes: README.md (docs about setup/ dir, not a template)
    const NON_TEMPLATE = new Set(["README.md"]);
    const setupFiles = fs
      .readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith(".md") && !NON_TEMPLATE.has(f));
    const drift: string[] = [];
    for (const f of setupFiles) {
      const setupPath = path.join(TEMPLATES_DIR, f);
      const claudePath = path.join(AGENTS_DIR, f);
      if (!fs.existsSync(claudePath)) {
        drift.push(`${f}: missing in .claude/agents/`);
        continue;
      }
      const a = fs.readFileSync(setupPath, "utf-8");
      const b = fs.readFileSync(claudePath, "utf-8");
      if (a !== b) drift.push(`${f}: content drift between setup and .claude`);
    }
    expect(drift, `Dual-location drift:\n${drift.join("\n")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group 8: Wave 27 anti-regression — arch-* and team-lead must NOT hold pattern-search tools
// ---------------------------------------------------------------------------

describe("Wave 27: pattern-search tools removed from architects and team-lead", () => {
  const PATTERN_SEARCH_TOOLS = [
    "mcp__androidcommondoc__find-pattern",
    "mcp__androidcommondoc__pattern-coverage",
    "mcp__androidcommondoc__search-docs",
  ];

  const AGENTS_THAT_MUST_NOT_HAVE_SEARCH: string[] = [
    "arch-testing.md",
    "arch-platform.md",
    "arch-integration.md",
    // team-lead.md retired W31.6 — no longer exists as a template file
  ];

  for (const agentFile of AGENTS_THAT_MUST_NOT_HAVE_SEARCH) {
    it(`${agentFile} does NOT declare pattern-search tools in frontmatter`, () => {
      for (const raw of readBothAgent(agentFile)) {
        const fm = getFrontmatter(raw);
        const mcp = getMcpTools(fm?.tools);
        for (const forbidden of PATTERN_SEARCH_TOOLS) {
          expect(
            mcp,
            `${agentFile}: found forbidden pattern-search tool '${forbidden}' — must route via context-provider (W27 BL-W26-06)`,
          ).not.toContain(forbidden);
        }
      }
    });
  }

  it("module-health is NOT declared by arch-testing, arch-platform, arch-integration, or team-lead", () => {
    for (const agentFile of AGENTS_THAT_MUST_NOT_HAVE_SEARCH) {
      for (const raw of readBothAgent(agentFile)) {
        const fm = getFrontmatter(raw);
        const mcp = getMcpTools(fm?.tools);
        expect(
          mcp,
          `${agentFile}: found forbidden 'mcp__androidcommondoc__module-health' — must route via context-provider (W27 BL-W26-06)`,
        ).not.toContain("mcp__androidcommondoc__module-health");
      }
    }
  });

  it("context-provider retains find-pattern, module-health, search-docs (it IS the entry point)", () => {
    for (const raw of readBothAgent("context-provider.md")) {
      const fm = getFrontmatter(raw);
      const mcp = getMcpTools(fm?.tools);
      expect(mcp).toContain("mcp__androidcommondoc__find-pattern");
      expect(mcp).toContain("mcp__androidcommondoc__module-health");
      expect(mcp).toContain("mcp__androidcommondoc__search-docs");
    }
  });

  it("arch-testing Pattern delivery chain prose present", () => {
    for (const raw of readBothAgent("arch-testing.md")) {
      expect(raw).toMatch(/you are the MCP tool holder for pattern discovery|Pattern delivery chain|Why you hold the pattern chain|pattern-chain-rationale/i);
    }
  });

  it("arch-platform Pattern delivery chain prose present", () => {
    for (const raw of readBothAgent("arch-platform.md")) {
      expect(raw).toMatch(/you are the MCP tool holder for pattern discovery|Pattern delivery chain|Why you hold the pattern chain|pattern-chain-rationale/i);
    }
  });

  it("arch-integration Pattern delivery chain prose present", () => {
    for (const raw of readBothAgent("arch-integration.md")) {
      expect(raw).toMatch(/you are the MCP tool holder for pattern discovery|Pattern delivery chain|Why you hold the pattern chain|pattern-chain-rationale/i);
    }
  });
});
