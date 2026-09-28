/**
 * Portable agent-instruction integration tests.
 *
 * Repository authority must be reproducible on CI without the maintainer's
 * ~/.claude directory. AGENTS.md is canonical; CLAUDE.md explicitly imports it.
 */
import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePortableInstructionContract,
  validateTemplateStructure,
  validateClaudeMd,
  validateCanonicalSourceCoverage,
} from "../../src/tools/validate-claude-md.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const agents = read("AGENTS.md");
const claude = read("CLAUDE.md");

describe("repository-owned instruction authority", () => {
  it("uses a concise portable AGENTS.md contract", () => {
    expect(agents.split("\n").length).toBeLessThanOrEqual(200);
    expect(agents).toContain("AGENTS.md` is the cross-runtime source of truth");
  });

  it("uses a small explicit Claude adapter", () => {
    expect(claude.split("\n").length).toBeLessThanOrEqual(80);
    expect(claude).toMatch(/^\s*@AGENTS\.md\s*$/m);
    expect(validateTemplateStructure(claude, "L0")).toEqual([]);
    expect(validatePortableInstructionContract(claude, agents)).toEqual([]);
  });

  it("does not put live PR, branch or CI state in startup instructions", () => {
    const combined = `${agents}\n${claude}`;
    expect(combined).not.toMatch(/\bPR\s*#\d+\s+(?:OPEN|GREEN|RED|MERGED)\b/i);
    expect(combined).not.toMatch(/\bHEAD\s*[:=]\s*[0-9a-f]{7,40}\b/i);
    expect(combined).not.toMatch(/\bCI\s+(?:is\s+)?(?:GREEN|RED|RUNNING)\b/i);
  });

  it("does not reinstate retired persistent orchestrator peers", () => {
    expect(agents).not.toMatch(/^\s*-\s*(?:always|must)\s+spawn.*team-lead/im);
    expect(agents).not.toMatch(/team-lead\s+is\s+the\s+orchestrator/i);
    expect(claude).not.toMatch(/dev-lead\s+is\s+the\s+orchestrator/i);
  });
});

describe("path-scoped Claude rules", () => {
  const rulesDir = path.join(root, ".claude", "rules");
  const rules = readdirSync(rulesDir).filter((name) => name.endsWith(".md"));

  it("keeps domain detail out of the always-loaded adapter", () => {
    expect(rules).toEqual(
      expect.arrayContaining([
        "documentation.md",
        "kmp.md",
        "runtime.md",
        "testing.md",
      ]),
    );
    expect(claude).not.toContain("## Architecture");
  });

  it.each(rules)("%s declares bounded paths", (name) => {
    const content = readFileSync(path.join(rulesDir, name), "utf8");
    expect(content).toMatch(/^---\npaths:\n(?:\s+- .+\n)+---\n/);
  });
});

describe("deterministic generated adapters", () => {
  const adapter = read("adapters/claude-md-copilot-adapter.sh");
  const generator = read("adapters/generate-all.sh");

  it("never reads personal ~/.claude instructions", () => {
    expect(adapter).not.toMatch(/HOME.*\.claude\/CLAUDE\.md/);
    expect(adapter).not.toContain("expanduser('~/.claude/CLAUDE.md')");
    expect(generator).not.toContain("host-derived CLAUDE.md");
  });

  it("stages both checked-in instruction files in check mode", () => {
    expect(generator).toContain('cp "$REPO_ROOT/AGENTS.md" "$STAGED_ROOT/AGENTS.md"');
    expect(generator).toContain('cp "$REPO_ROOT/CLAUDE.md" "$STAGED_ROOT/CLAUDE.md"');
  });

  it("preserves ordered workflow obligations in the generated adapter", () => {
    const generated = read("setup/copilot-templates/copilot-instructions-from-claude-md.md");
    expect(generated).toContain("Work on a tool-owned feature branch or managed worktree");
    expect(generated).toContain("Open PRs against `develop`. Do not merge unless the user explicitly authorizes");
    expect(generated).toContain("Run focused tests while iterating. Before a PR, run one complete local gate plus GitHub CI");
  });

  it("passes generation with a poisoned personal Claude home", () => {
    const fakeHome = mkdtempSync(path.join(tmpdir(), "l0-poisoned-home-"));
    try {
      mkdirSync(path.join(fakeHome, ".claude"), { recursive: true });
      writeFileSync(
        path.join(fakeHome, ".claude", "CLAUDE.md"),
        "THIS PERSONAL TEXT MUST NEVER ENTER GENERATED OUTPUT\n",
      );
      execFileSync("bash", ["adapters/generate-all.sh", "--check"], {
        cwd: root,
        env: { ...process.env, HOME: fakeHome },
        stdio: "pipe",
      });
      expect(read("setup/copilot-templates/copilot-instructions-from-claude-md.md"))
        .not.toContain("THIS PERSONAL TEXT");
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("normalizes Windows CRLF bytes before comparing generated adapters", () => {
    const generatedRoot = mkdtempSync(path.join(tmpdir(), "l0-generated-crlf-"));
    try {
      const generated = path.join(generatedRoot, "fixture.md");
      writeFileSync(generated, "# Generated\r\n\r\n- portable\r\n", "utf8");
      execFileSync(
        "python3",
        ["adapters/normalize-line-endings.py", generatedRoot],
        { cwd: root, stdio: "pipe" },
      );
      expect(readFileSync(generated, "utf8")).toBe("# Generated\n\n- portable\n");
    } finally {
      rmSync(generatedRoot, { recursive: true, force: true });
    }
  });

  it("rejects a missing generated root instead of silently skipping it", () => {
    const missingRoot = path.join(tmpdir(), `l0-missing-generated-${Date.now()}`);
    expect(() => execFileSync(
      "python3",
      ["adapters/normalize-line-endings.py", missingRoot],
      { cwd: root, stdio: "pipe" },
    )).toThrow();
  });
});

describe("canonical rule ownership", () => {
  const canonical = JSON.parse(read("docs/guides/canonical-rules.json")) as {
    rules: Array<{ source?: string }>;
  };

  it("is repository-owned rather than sourced from a home directory", () => {
    expect(canonical.rules.length).toBeGreaterThan(0);
    for (const rule of canonical.rules) {
      expect(rule.source).toBe("docs/guides/canonical-rules.json");
    }
  });

  it("fails when a declared repository source no longer represents its rule", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "l0-canonical-source-"));
    try {
      writeFileSync(path.join(fixtureRoot, "source.md"), "unrelated text\n");
      const issues = await validateCanonicalSourceCoverage(
        fixtureRoot,
        [{
          id: "TEST-NEG",
          category: "testing",
          rule: "runTest for all coroutine tests",
          layer: "L0",
          overridable: false,
        }],
        { testing: ["source.md"] },
      );
      expect(issues).toContainEqual(expect.objectContaining({
        level: "error",
        category: "canonical-source-coverage",
      }));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("deterministic L0/L1/L2 bundle classification", () => {
  it("classifies thin consumer adapters from AGENTS.md metadata", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "l0-instruction-layers-"));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    try {
      const fakeHome = path.join(fixtureRoot, "poisoned-home");
      mkdirSync(path.join(fakeHome, ".claude"), { recursive: true });
      writeFileSync(
        path.join(fakeHome, ".claude", "CLAUDE.md"),
        "# Poisoned global instructions\n\nThis file must not become an instruction bundle.\n",
      );
      process.env.HOME = fakeHome;
      process.env.USERPROFILE = fakeHome;

      const l1 = path.join(fixtureRoot, "consumer-l1");
      const l2 = path.join(fixtureRoot, "consumer-l2");
      for (const [dir, layer] of [[l1, "L1"], [l2, "L2"]] as const) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "AGENTS.md"), `# Consumer\n\n> **Layer:** ${layer}\n`);
        writeFileSync(path.join(dir, "CLAUDE.md"), "# Claude adapter\n\n@AGENTS.md\n");
      }
      const result = await validateClaudeMd(
        root,
        undefined,
        false,
        false,
        [{ name: "consumer-l1", path: l1 }, { name: "consumer-l2", path: l2 }],
      );
      expect(result.errors).toBe(0);
      expect(result.bundles).toEqual([
        { path: "CLAUDE.md", layer: "L0" },
        { path: "consumer-l1/CLAUDE.md", layer: "L1" },
        { path: "consumer-l2/CLAUDE.md", layer: "L2" },
      ]);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reports a missing AGENTS.md independently", async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "l0-missing-agents-"));
    try {
      writeFileSync(path.join(fixtureRoot, "CLAUDE.md"), "@AGENTS.md\n");
      const result = await validateClaudeMd(
        root,
        undefined,
        false,
        false,
        [{ name: "consumer", path: fixtureRoot }],
      );
      expect(result.issues).toContainEqual(expect.objectContaining({
        level: "error",
        file: "consumer/AGENTS.md",
      }));
      expect(result.issues).not.toContainEqual(expect.objectContaining({
        file: "consumer/CLAUDE.md",
        message: expect.stringContaining("Missing CLAUDE.md"),
      }));
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
