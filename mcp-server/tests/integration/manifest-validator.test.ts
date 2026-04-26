/**
 * Integration tests for the agents-manifest validator (Phase 2).
 *
 * Two layers of coverage:
 *   1. Library-level: synthetic fixtures in a tmp dir exercise each invariant
 *      and field-comparison branch in isolation.
 *   2. Live: run validateManifest() against the real project root and assert
 *      0 errors / 0 warnings / all invariants OK (with the intentional
 *      `feature-domain-specialist` scaffold INFO finding allowed).
 *
 * Plus a CLI subprocess test that exercises the wrapper's exit-code matrix
 * (--strict pass/fail, JSON output, bad flags).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import {
  validateManifest,
  parseToolsCsv,
  setEqual,
  setDiff,
} from "../../src/registry/manifest-validator.js";

// ── Paths ────────────────────────────────────────────────────────────────────

const REAL_PROJECT_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(os.tmpdir(), `manifest-validator-test-${process.pid}`);
const CLI_PATH = path.resolve(__dirname, "../../build/cli/validate-manifest.js");

// ── Fixture helpers ──────────────────────────────────────────────────────────

interface SyntheticEntry {
  canonical_name: string;
  subagent_type?: string;
  template_version?: string;
  category?: string;
  lifecycle?: string;
  description?: string;
  model?: string;
  tools_allowed?: string[];
  spawn_method?: string;
  /** Override frontmatter contents to introduce drift. */
  frontmatter?: Record<string, string | number>;
  /** Skip writing the template file (to test missing-file findings). */
  skipTemplate?: boolean;
  /** Skip writing the mirror file (to test missing-file findings). */
  skipMirror?: boolean;
}

function buildSyntheticProject(entries: SyntheticEntry[]): string {
  const root = path.join(TMP_ROOT, `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.join(root, ".claude/registry"), { recursive: true });
  mkdirSync(path.join(root, "setup/agent-templates"), { recursive: true });
  mkdirSync(path.join(root, ".claude/agents"), { recursive: true });

  // Write manifest YAML by hand (small + deterministic).
  const manifestLines: string[] = [
    "manifest:",
    "  version: 1",
    '  generated_at: "2026-04-27"',
    "categories: [architect, core-specialist, context, validator, tool, domain-specialist]",
    "lifecycles: [ephemeral, persistent]",
    "invariants:",
    "  - id: NAMING_CONVENTION",
    '    description: "test"',
    "    applies_to: {}",
    "    require:",
    '      canonical_name.pattern: "^(arch-.+|.+-specialist|context-provider|test-.+|legit-.+)$"',
    "agents:",
  ];

  for (const e of entries) {
    const description = e.description ?? `${e.canonical_name} description`;
    manifestLines.push(`  ${e.canonical_name}:`);
    manifestLines.push(`    canonical_name: ${e.canonical_name}`);
    manifestLines.push(`    subagent_type: ${e.subagent_type ?? e.canonical_name}`);
    manifestLines.push(`    template_version: "${e.template_version ?? "1.0.0"}"`);
    manifestLines.push(`    category: ${e.category ?? "tool"}`);
    manifestLines.push(`    lifecycle: ${e.lifecycle ?? "ephemeral"}`);
    manifestLines.push(`    description: "${description}"`);
    manifestLines.push("    runtime:");
    manifestLines.push(`      model: ${e.model ?? "sonnet"}`);
    manifestLines.push("    tools:");
    manifestLines.push("      allowed:");
    for (const t of e.tools_allowed ?? ["Read"]) {
      manifestLines.push(`        - ${t}`);
    }
    manifestLines.push("    dispatch:");
    manifestLines.push(`      spawn_method: ${e.spawn_method ?? "Agent"}`);
    manifestLines.push("      dispatched_by: [team-lead]");
    manifestLines.push("      can_dispatch_to: []");
    manifestLines.push("      can_send_to: []");
  }

  writeFileSync(
    path.join(root, ".claude/registry/agents.manifest.yaml"),
    manifestLines.join("\n"),
    "utf-8",
  );

  // Write template + mirror files for each entry.
  for (const e of entries) {
    const fm = e.frontmatter ?? {};
    const tools = (e.tools_allowed ?? ["Read"]).join(", ");
    const nameRaw = fm.name ?? e.canonical_name;
    // YAML flow-mapping start tokens (e.g. `{{DOMAIN}}`) need quoting; quote
    // any name with a `{{` placeholder to mirror the real scaffold convention.
    const nameOut = String(nameRaw).includes("{{") ? `"${nameRaw}"` : String(nameRaw);
    const lines = [
      "---",
      `name: ${nameOut}`,
      `description: "${fm.description ?? e.description ?? `${e.canonical_name} description`}"`,
      `tools: ${fm.tools ?? tools}`,
      `model: ${fm.model ?? e.model ?? "sonnet"}`,
      `template_version: "${fm.template_version ?? e.template_version ?? "1.0.0"}"`,
      "---",
      "",
      "Body content.",
      "",
    ];
    const content = lines.join("\n");
    if (!e.skipTemplate) {
      writeFileSync(
        path.join(root, "setup/agent-templates", `${e.canonical_name}.md`),
        content,
        "utf-8",
      );
    }
    if (!e.skipMirror) {
      writeFileSync(
        path.join(root, ".claude/agents", `${e.canonical_name}.md`),
        content,
        "utf-8",
      );
    }
  }

  return root;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  try {
    if (existsSync(TMP_ROOT))
      rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* Windows file locking */
  }
});

// ── Helper unit tests ────────────────────────────────────────────────────────

describe("parseToolsCsv", () => {
  it("splits and trims a CSV string", () => {
    expect(parseToolsCsv("Read, Bash, SendMessage")).toEqual([
      "Read",
      "Bash",
      "SendMessage",
    ]);
  });

  it("handles trailing comma + extra whitespace", () => {
    expect(parseToolsCsv("  Read , Bash ,  ")).toEqual(["Read", "Bash"]);
  });

  it("returns empty array for non-string input", () => {
    expect(parseToolsCsv(undefined)).toEqual([]);
    expect(parseToolsCsv(42)).toEqual([]);
    expect(parseToolsCsv(["Read", "Bash"])).toEqual([]);
  });
});

describe("setEqual", () => {
  it("returns true for permuted arrays", () => {
    expect(setEqual(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });
  it("returns false for different sizes", () => {
    expect(setEqual(["a", "b"], ["a", "b", "c"])).toBe(false);
  });
  it("returns false for disjoint sets", () => {
    expect(setEqual(["a"], ["b"])).toBe(false);
  });
});

describe("setDiff", () => {
  it("computes missing + extra correctly", () => {
    const r = setDiff(["a", "b"], ["b", "c"]);
    expect(r.missing.sort()).toEqual(["c"]);
    expect(r.extra.sort()).toEqual(["a"]);
  });
});

// ── Library-level invariant tests ────────────────────────────────────────────

describe("validateManifest — invariants", () => {
  it("flags ARCHITECT_NO_FILE_WRITE when an architect has Write/Edit", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "arch-test",
        category: "architect",
        spawn_method: "TeamCreate-peer",
        tools_allowed: ["Read", "Write", "SendMessage"],
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    expect(r.invariantsOk).toBe(false);
    const violations = r.findings.filter(
      (f) => f.category === "invariant" && f.message.includes("ARCHITECT_NO_FILE_WRITE"),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].agent).toBe("arch-test");
  });

  it("flags IN_PROCESS_NO_AGENT when a TeamCreate-peer carries Agent tool", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        category: "core-specialist",
        spawn_method: "TeamCreate-peer",
        tools_allowed: ["Read", "Agent"],
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const violations = r.findings.filter((f) =>
      f.message.includes("IN_PROCESS_NO_AGENT"),
    );
    expect(violations).toHaveLength(1);
  });

  it("flags NAMING_CONVENTION when canonical_name doesn't match the regex", () => {
    const root = buildSyntheticProject([
      // Does not match pattern in this synthetic manifest.
      { canonical_name: "bogus-name", tools_allowed: ["Read"] },
    ]);
    const r = validateManifest({ projectRoot: root });
    const violations = r.findings.filter((f) =>
      f.message.includes("NAMING_CONVENTION"),
    );
    expect(violations).toHaveLength(1);
  });

  it("flags CANONICAL_NAME_MATCHES_SUBAGENT_TYPE on mismatch", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        subagent_type: "test-dev",
        tools_allowed: ["Read"],
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const violations = r.findings.filter((f) =>
      f.message.includes("CANONICAL_NAME_MATCHES_SUBAGENT_TYPE"),
    );
    expect(violations).toHaveLength(1);
  });

  it("flags CONTEXT_PROVIDER_READ_ONLY when context category has Write", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "context-provider",
        category: "context",
        tools_allowed: ["Read", "Write"],
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const violations = r.findings.filter((f) =>
      f.message.includes("CONTEXT_PROVIDER_READ_ONLY"),
    );
    expect(violations).toHaveLength(1);
  });
});

// ── Library-level field comparison tests ─────────────────────────────────────

describe("validateManifest — field comparisons", () => {
  it("flags name mismatch between frontmatter and manifest", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        tools_allowed: ["Read"],
        frontmatter: { name: "wrong-name" },
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const m = r.findings.find(
      (f) => f.category === "field-mismatch" && f.field === "name",
    );
    expect(m).toBeDefined();
    expect(m?.severity).toBe("error");
  });

  it("treats permuted tool order as equal (set semantics)", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        tools_allowed: ["Read", "Bash", "SendMessage"],
        frontmatter: { tools: "SendMessage, Read, Bash" }, // permuted CSV
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const toolDrift = r.findings.find(
      (f) => f.category === "field-mismatch" && f.field === "tools",
    );
    expect(toolDrift).toBeUndefined();
  });

  it("flags tool mismatch with missing + extra detail", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        tools_allowed: ["Read", "Bash", "SendMessage"],
        frontmatter: { tools: "Read, Bash, Edit" }, // SendMessage missing, Edit extra
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const drift = r.findings.find(
      (f) => f.category === "field-mismatch" && f.field === "tools",
    );
    expect(drift).toBeDefined();
    expect(drift?.message).toContain("SendMessage");
    expect(drift?.message).toContain("Edit");
  });

  it("ignores collapsed whitespace in description", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        description: "Multi  word  description.",
        tools_allowed: ["Read"],
        frontmatter: { description: "Multi word description." }, // collapsed spaces
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const descDrift = r.findings.find(
      (f) => f.category === "field-mismatch" && f.field === "description",
    );
    expect(descDrift).toBeUndefined();
  });

  it("flags real description drift (different content)", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        description: "Manifest text.",
        tools_allowed: ["Read"],
        frontmatter: { description: "Different body text." },
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const descDrift = r.findings.find(
      (f) => f.category === "field-mismatch" && f.field === "description",
    );
    expect(descDrift).toBeDefined();
    expect(descDrift?.severity).toBe("warning");
  });
});

// ── Scaffold detection ───────────────────────────────────────────────────────

describe("validateManifest — scaffold exemption", () => {
  it("skips name/tools/description for `{{...}}` placeholder names", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "legit-domain-specialist",
        tools_allowed: ["Read", "Write"],
        // canonical_name in manifest is "legit-domain-specialist", but the
        // template name has a placeholder — scaffold case.
        frontmatter: {
          name: "{{DOMAIN}}-specialist",
          tools: "Read, Write, Bash", // tools also drift
          description: "totally different",
        },
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    expect(r.findingsBySeverity.error).toBe(0);
    const info = r.findings.find((f) => f.severity === "info");
    expect(info?.message).toContain("scaffold");
  });
});

// ── File existence + orphan ─────────────────────────────────────────────────

describe("validateManifest — file existence + orphan", () => {
  it("flags missing template file", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        tools_allowed: ["Read"],
        skipTemplate: true,
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const f = r.findings.find(
      (x) => x.category === "missing-file" && x.message.includes("template"),
    );
    expect(f).toBeDefined();
  });

  it("flags missing mirror file", () => {
    const root = buildSyntheticProject([
      {
        canonical_name: "test-specialist",
        tools_allowed: ["Read"],
        skipMirror: true,
      },
    ]);
    const r = validateManifest({ projectRoot: root });
    const f = r.findings.find(
      (x) => x.category === "missing-file" && x.message.includes("mirror"),
    );
    expect(f).toBeDefined();
  });

  it("flags orphan file with no manifest entry", () => {
    const root = buildSyntheticProject([
      { canonical_name: "test-specialist", tools_allowed: ["Read"] },
    ]);
    // Drop a stray file that has no manifest entry.
    writeFileSync(
      path.join(root, "setup/agent-templates", "ghost-agent.md"),
      "---\nname: ghost-agent\n---\n",
      "utf-8",
    );
    const r = validateManifest({ projectRoot: root });
    const orphan = r.findings.find((f) => f.category === "orphan");
    expect(orphan).toBeDefined();
    expect(orphan?.agent).toBe("ghost-agent");
  });

  it("does NOT flag README.md as an orphan", () => {
    const root = buildSyntheticProject([
      { canonical_name: "test-specialist", tools_allowed: ["Read"] },
    ]);
    writeFileSync(
      path.join(root, "setup/agent-templates", "README.md"),
      "# Templates README\n",
      "utf-8",
    );
    const r = validateManifest({ projectRoot: root });
    const orphan = r.findings.find(
      (f) => f.category === "orphan" && f.agent === "README",
    );
    expect(orphan).toBeUndefined();
  });
});

// ── Live manifest smoke test ─────────────────────────────────────────────────

describe("validateManifest — live manifest", () => {
  it("returns 0 errors and 0 warnings against the real project root", () => {
    const r = validateManifest({ projectRoot: REAL_PROJECT_ROOT });
    expect(r.findingsBySeverity.error).toBe(0);
    expect(r.findingsBySeverity.warning).toBe(0);
    expect(r.invariantsOk).toBe(true);
    // 38 agents currently catalogued (Phase 1 SEED — header line 17).
    expect(r.totalAgents).toBeGreaterThanOrEqual(30);
  });
});

// ── CLI subprocess test ──────────────────────────────────────────────────────

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[], cwd?: string): CliResult {
  const opts: SpawnSyncOptions = {
    env: { ...process.env, NODE_OPTIONS: "" },
    timeout: 30000,
    encoding: "utf-8",
    cwd,
  };
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], opts);
  return {
    stdout: (result.stdout as string) ?? "",
    stderr: (result.stderr as string) ?? "",
    exitCode: result.status ?? 2,
  };
}

describe("validate-manifest CLI", () => {
  it("exits 0 on the real manifest with --strict (no errors)", () => {
    const r = runCli([REAL_PROJECT_ROOT, "--strict"]);
    expect(r.exitCode).toBe(0);
  });

  it("exits 1 with --strict when errors are present", () => {
    const root = buildSyntheticProject([
      // bogus-name violates NAMING_CONVENTION → error.
      { canonical_name: "bogus-name", tools_allowed: ["Read"] },
    ]);
    const r = runCli([root, "--strict"]);
    expect(r.exitCode).toBe(1);
  });

  it("exits 0 in WARN mode (default) even with errors present", () => {
    const root = buildSyntheticProject([
      { canonical_name: "bogus-name", tools_allowed: ["Read"] },
    ]);
    const r = runCli([root]);
    expect(r.exitCode).toBe(0);
  });

  it("emits valid JSON when --format json", () => {
    const r = runCli([REAL_PROJECT_ROOT, "--format", "json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.totalAgents).toBeGreaterThan(0);
    expect(parsed.findingsBySeverity).toBeDefined();
  });

  it("exits 2 on unknown flag", () => {
    const r = runCli([REAL_PROJECT_ROOT, "--bogus"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("unknown option");
  });
});
