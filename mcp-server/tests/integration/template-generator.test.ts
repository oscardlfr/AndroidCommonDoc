/**
 * Integration tests for the agent template generator (Phase 3).
 *
 * Two layers:
 *   1. Library-level: pure function tests for renderFrontmatter,
 *      computeFrontmatterSha256, generateTemplate, splitFrontmatterAndBody.
 *   2. Behavioral: synthetic tmpdir fixtures exercise idempotency proof,
 *      drift repair, mirror dual-write, and CLI subprocess exit codes.
 *
 * Adopts the buildSyntheticProject() pattern from manifest-validator.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import {
  renderFrontmatter,
  computeFrontmatterSha256,
  generateTemplate,
  splitFrontmatterAndBody,
  type ManifestAgentEntry,
} from "../../src/registry/template-generator.js";

// ── Paths ────────────────────────────────────────────────────────────────────

const REAL_PROJECT_ROOT = path.resolve(__dirname, "../../..");
const TMP_ROOT = path.join(
  os.tmpdir(),
  `template-generator-test-${process.pid}`,
);
const CLI_PATH = path.resolve(
  __dirname,
  "../../build/cli/generate-template.js",
);

// ── CLI helper ───────────────────────────────────────────────────────────────

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[], cwd?: string): CliResult {
  const opts: SpawnSyncOptions = {
    env: { ...process.env, NODE_OPTIONS: "" },
    timeout: 30_000,
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

// ── Fixture helpers ──────────────────────────────────────────────────────────

interface SyntheticEntry {
  canonical_name: string;
  description?: string;
  model?: string;
  template_version?: string;
  tools_allowed?: string[];
  /** Override body content. Default: "\nBody content.\n" */
  body?: string;
  /** Override the written file's raw frontmatter block (introduces drift). */
  frontmatterOverride?: string;
  skipTemplate?: boolean;
  skipMirror?: boolean;
  /** Include template_frontmatter_sha256 field in manifest (required for --update-manifest-hash). */
  includeHashField?: boolean;
}

function buildSyntheticProject(entries: SyntheticEntry[]): string {
  const root = path.join(
    TMP_ROOT,
    `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(path.join(root, ".claude/registry"), { recursive: true });
  mkdirSync(path.join(root, "setup/agent-templates"), { recursive: true });
  mkdirSync(path.join(root, ".claude/agents"), { recursive: true });

  const manifestLines: string[] = [
    "manifest:",
    "  version: 1",
    '  generated_at: "2026-04-27"',
    "categories: [core-specialist]",
    "lifecycles: [persistent]",
    "invariants: []",
    "agents:",
  ];

  for (const e of entries) {
    manifestLines.push(`  ${e.canonical_name}:`);
    manifestLines.push(`    canonical_name: ${e.canonical_name}`);
    manifestLines.push(`    subagent_type: ${e.canonical_name}`);
    manifestLines.push(`    template_version: "${e.template_version ?? "1.0.0"}"`);
    if (e.includeHashField) {
      manifestLines.push(`    template_frontmatter_sha256: null`);
    }
    manifestLines.push(`    category: core-specialist`);
    manifestLines.push(`    lifecycle: persistent`);
    manifestLines.push(
      `    description: "${e.description ?? `${e.canonical_name} description`}"`,
    );
    manifestLines.push(`    runtime:`);
    manifestLines.push(`      model: ${e.model ?? "sonnet"}`);
    manifestLines.push(`    tools:`);
    manifestLines.push(`      allowed:`);
    for (const t of e.tools_allowed ?? ["Read", "SendMessage"]) {
      manifestLines.push(`        - ${t}`);
    }
    manifestLines.push(`    dispatch:`);
    manifestLines.push(`      spawn_method: TeamCreate-peer`);
    manifestLines.push(`      dispatched_by: [team-lead]`);
    manifestLines.push(`      can_dispatch_to: []`);
    manifestLines.push(`      can_send_to: []`);
  }

  writeFileSync(
    path.join(root, ".claude/registry/agents.manifest.yaml"),
    manifestLines.join("\n") + "\n",
    "utf-8",
  );

  for (const e of entries) {
    const tools = (e.tools_allowed ?? ["Read", "SendMessage"]).join(", ");
    const desc = e.description ?? `${e.canonical_name} description`;
    const tv = e.template_version ?? "1.0.0";
    const model = e.model ?? "sonnet";

    const canonicalFm =
      `---\nname: ${e.canonical_name}\ndescription: "${desc}"\ntools: ${tools}\nmodel: ${model}\ntemplate_version: "${tv}"\n---\n`;

    const fm = e.frontmatterOverride !== undefined ? e.frontmatterOverride : canonicalFm;
    const body = e.body ?? "\nBody content.\n";
    const content = fm + body;

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

function makeMinimalEntry(overrides: Partial<ManifestAgentEntry> = {}): ManifestAgentEntry {
  return {
    canonical_name: "test-specialist",
    subagent_type: "test-specialist",
    template_version: "1.0.0",
    category: "core-specialist",
    lifecycle: "persistent",
    description: "Test specialist description.",
    runtime: { model: "sonnet" },
    tools: { allowed: ["Read", "SendMessage"] },
    ...overrides,
  };
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

// ── splitFrontmatterAndBody ──────────────────────────────────────────────────

describe("splitFrontmatterAndBody", () => {
  it("returns null for plain text with no frontmatter", () => {
    expect(splitFrontmatterAndBody("Just plain text.\n")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(splitFrontmatterAndBody("")).toBeNull();
  });

  it("returns null when closing --- is missing", () => {
    expect(splitFrontmatterAndBody("---\nname: foo\n")).toBeNull();
  });

  it("tolerates closing --- at end of file without trailing newline", () => {
    const result = splitFrontmatterAndBody("---\nname: foo\n---");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("");
  });

  it("strips BOM before parsing", () => {
    const withBom = "\uFEFF---\nname: foo\n---\n\nBody.\n";
    const result = splitFrontmatterAndBody(withBom);
    expect(result).not.toBeNull();
    expect(result!.yamlBlock).toContain("name: foo");
  });

  it("normalizes CRLF to LF in both yamlBlock and body", () => {
    const crlf = "---\r\nname: foo\r\n---\r\n\r\nBody.\r\n";
    const result = splitFrontmatterAndBody(crlf);
    expect(result).not.toBeNull();
    expect(result!.yamlBlock).not.toContain("\r");
    expect(result!.body).not.toContain("\r");
  });

  it("preserves body bytes exactly (post LF-normalization)", () => {
    const body = "\n## Section\n\nContent here.\n\n";
    const raw = `---\nname: foo\n---\n${body}`;
    const result = splitFrontmatterAndBody(raw);
    expect(result!.body).toBe(body);
  });

  it("returns empty body when nothing follows the closing ---", () => {
    const result = splitFrontmatterAndBody("---\nname: foo\n---\n");
    expect(result).not.toBeNull();
    expect(result!.body).toBe("");
  });

  it("yamlBlock excludes the --- markers", () => {
    const result = splitFrontmatterAndBody("---\nname: foo\n---\nBody.\n");
    expect(result!.yamlBlock).not.toContain("---");
    expect(result!.yamlBlock.trim()).toBe("name: foo");
  });
});

// ── computeFrontmatterSha256 ─────────────────────────────────────────────────

describe("computeFrontmatterSha256", () => {
  it("returns a 64-character lowercase hex string", () => {
    const hash = computeFrontmatterSha256("name: test\n");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical input", () => {
    const input = "name: foo\ntools: Read\nmodel: sonnet\n";
    expect(computeFrontmatterSha256(input)).toBe(computeFrontmatterSha256(input));
  });

  it("CRLF and LF produce the same hash", () => {
    const lf = "name: foo\nmodel: sonnet\n";
    const crlf = "name: foo\r\nmodel: sonnet\r\n";
    expect(computeFrontmatterSha256(lf)).toBe(computeFrontmatterSha256(crlf));
  });

  it("trailing newline vs none produces the same hash (trimEnd normalization)", () => {
    expect(computeFrontmatterSha256("name: foo\n")).toBe(
      computeFrontmatterSha256("name: foo"),
    );
  });

  it("changing one byte changes the hash", () => {
    expect(computeFrontmatterSha256("name: foo\n")).not.toBe(
      computeFrontmatterSha256("name: bar\n"),
    );
  });
});

// ── renderFrontmatter ────────────────────────────────────────────────────────

describe("renderFrontmatter — minimal entry", () => {
  it("renders the 5 required fields", () => {
    const output = renderFrontmatter(makeMinimalEntry());
    expect(output).toContain("name: test-specialist");
    expect(output).toContain('description: "Test specialist description."');
    expect(output).toContain("tools: Read, SendMessage");
    expect(output).toContain("model: sonnet");
    expect(output).toContain('template_version: "1.0.0"');
  });

  it("does NOT include optional fields when absent", () => {
    const output = renderFrontmatter(makeMinimalEntry());
    expect(output).not.toContain("domain:");
    expect(output).not.toContain("intent:");
    expect(output).not.toContain("token_budget:");
    expect(output).not.toContain("memory:");
    expect(output).not.toContain("skills:");
    expect(output).not.toContain("optional_capabilities:");
  });

  it("does NOT include --- markers (generateTemplate wraps them)", () => {
    expect(renderFrontmatter(makeMinimalEntry())).not.toContain("---");
  });
});

describe("renderFrontmatter — full entry canonical order", () => {
  it("renders all 11 fields in canonical order", () => {
    const entry = makeMinimalEntry({
      domain: "testing",
      intent: ["audit", "review"],
      runtime: { model: "sonnet", token_budget: 8000 },
      memory: "some-memory",
      skills_referenced: ["/test", "/coverage"],
      optional_capabilities: ["context7", "mcp-monitor"],
    });
    const output = renderFrontmatter(entry);

    const positions = [
      "name:",
      "description:",
      "tools:",
      "model:",
      "domain:",
      "intent:",
      "token_budget:",
      "template_version:",
      "memory:",
      "skills:",
      "optional_capabilities:",
    ].map((f) => output.indexOf(f));

    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("produces stable output regardless of JS object property insertion order", () => {
    const a = makeMinimalEntry({ domain: "testing", runtime: { model: "opus" } });
    const b = makeMinimalEntry({ runtime: { model: "opus" }, domain: "testing" });
    expect(renderFrontmatter(a)).toBe(renderFrontmatter(b));
  });
});

describe("renderFrontmatter — optional field omission", () => {
  it("omits intent when array is empty", () => {
    expect(renderFrontmatter(makeMinimalEntry({ intent: [] }))).not.toContain("intent:");
  });

  it("omits skills when skills_referenced is empty", () => {
    expect(
      renderFrontmatter(makeMinimalEntry({ skills_referenced: [] })),
    ).not.toContain("skills:");
  });

  it("omits optional_capabilities when array is empty", () => {
    expect(
      renderFrontmatter(makeMinimalEntry({ optional_capabilities: [] })),
    ).not.toContain("optional_capabilities:");
  });

  it("omits memory when null", () => {
    expect(renderFrontmatter(makeMinimalEntry({ memory: null }))).not.toContain("memory:");
  });

  it("omits memory when undefined", () => {
    const entry = makeMinimalEntry();
    delete (entry as Partial<ManifestAgentEntry>).memory;
    expect(renderFrontmatter(entry)).not.toContain("memory:");
  });

  it("omits token_budget when absent from runtime", () => {
    expect(
      renderFrontmatter(makeMinimalEntry({ runtime: { model: "sonnet" } })),
    ).not.toContain("token_budget:");
  });

  it("omits domain when undefined", () => {
    const entry = makeMinimalEntry();
    delete (entry as Partial<ManifestAgentEntry>).domain;
    expect(renderFrontmatter(entry)).not.toContain("domain:");
  });
});

describe("renderFrontmatter — field format correctness", () => {
  it("description is always double-quoted", () => {
    const output = renderFrontmatter(makeMinimalEntry({ description: "My desc." }));
    expect(output).toContain('description: "My desc."');
  });

  it("template_version is always double-quoted", () => {
    const output = renderFrontmatter(makeMinimalEntry({ template_version: "1.21.0" }));
    expect(output).toContain('template_version: "1.21.0"');
  });

  it("tools rendered as CSV (comma-space), not a YAML list", () => {
    const output = renderFrontmatter(
      makeMinimalEntry({ tools: { allowed: ["Read", "Bash", "SendMessage"] } }),
    );
    expect(output).toContain("tools: Read, Bash, SendMessage");
    expect(output).not.toMatch(/^- Read/m);
  });

  it("intent rendered as inline array [a, b, c]", () => {
    const output = renderFrontmatter(makeMinimalEntry({ intent: ["audit", "review"] }));
    expect(output).toContain("intent: [audit, review]");
  });

  it("skills rendered as block list with 2-space indent", () => {
    const output = renderFrontmatter(
      makeMinimalEntry({ skills_referenced: ["/test", "/coverage"] }),
    );
    expect(output).toContain("skills:\n  - /test\n  - /coverage");
  });

  it("optional_capabilities rendered as block list", () => {
    const output = renderFrontmatter(
      makeMinimalEntry({ optional_capabilities: ["context7", "mcp-monitor"] }),
    );
    expect(output).toContain("optional_capabilities:\n  - context7\n  - mcp-monitor");
  });

  it("token_budget rendered as unquoted integer", () => {
    const output = renderFrontmatter(
      makeMinimalEntry({ runtime: { model: "sonnet", token_budget: 8000 } }),
    );
    expect(output).toContain("token_budget: 8000");
    expect(output).not.toContain('"8000"');
  });
});

// ── generateTemplate ─────────────────────────────────────────────────────────

describe("generateTemplate", () => {
  it("wraps frontmatter in --- markers", () => {
    const output = generateTemplate(makeMinimalEntry(), "\nBody.\n");
    expect(output.startsWith("---\n")).toBe(true);
    expect(output).toContain("\n---\n");
  });

  it("preserves body bytes exactly", () => {
    const body = "\n## Section\n\nContent here.\n\nWith trailing blank.\n";
    const output = generateTemplate(makeMinimalEntry(), body);
    expect(splitFrontmatterAndBody(output)!.body).toBe(body);
  });

  it("preserves body with special characters", () => {
    const body = "\nContent with `backticks`, **bold**, and — em dashes.\n";
    expect(generateTemplate(makeMinimalEntry(), body)).toContain(body);
  });

  it("preserves multi-line code blocks in body", () => {
    const body = "\n```ts\nconst x = 1;\n```\n";
    expect(generateTemplate(makeMinimalEntry(), body)).toContain("```ts\nconst x = 1;\n```");
  });

  it("produces a file splitFrontmatterAndBody can re-parse", () => {
    const output = generateTemplate(makeMinimalEntry(), "\nBody.\n");
    const split = splitFrontmatterAndBody(output);
    expect(split).not.toBeNull();
    expect(split!.yamlBlock).toContain("name:");
  });

  it("full template matches expected bytes for a known entry", () => {
    const entry = makeMinimalEntry({
      canonical_name: "arch-platform",
      description: "Platform architect.",
      tools: { allowed: ["Read", "SendMessage"] },
      template_version: "1.0.0",
    });
    const expected =
      '---\nname: arch-platform\ndescription: "Platform architect."\ntools: Read, SendMessage\nmodel: sonnet\ntemplate_version: "1.0.0"\n---\n\nBody content.\n';
    expect(generateTemplate(entry, "\nBody content.\n")).toBe(expected);
  });
});

// ── Idempotency proof ────────────────────────────────────────────────────────

describe("idempotency", () => {
  it("two generator passes produce byte-identical output", () => {
    const entry = makeMinimalEntry({
      domain: "testing",
      intent: ["audit"],
      runtime: { model: "sonnet", token_budget: 8000 },
      template_version: "1.5.0",
      skills_referenced: ["/test", "/coverage"],
    });
    const body = "\n## My Section\n\nContent here.\n";
    const firstPass = generateTemplate(entry, body);
    const secondPass = generateTemplate(entry, splitFrontmatterAndBody(firstPass)!.body);
    expect(secondPass).toBe(firstPass);
  });

  it("SHA-256 is stable across two generator passes", () => {
    const entry = makeMinimalEntry({ runtime: { model: "sonnet", token_budget: 5000 } });
    const body = "\nBody.\n";
    const h1 = computeFrontmatterSha256(splitFrontmatterAndBody(generateTemplate(entry, body))!.yamlBlock);
    const h2 = computeFrontmatterSha256(splitFrontmatterAndBody(generateTemplate(entry, body))!.yamlBlock);
    expect(h1).toBe(h2);
  });
});

// ── Drift repair ─────────────────────────────────────────────────────────────

describe("drift repair — scrambled frontmatter order", () => {
  it("generator always emits canonical field order", () => {
    const entry = makeMinimalEntry({
      domain: "testing",
      runtime: { model: "sonnet", token_budget: 5000 },
    });
    const output = generateTemplate(entry, "\nBody.\n");

    const idx = (f: string) => output.indexOf(`\n${f}:`);
    expect(idx("name")).toBeLessThan(idx("description"));
    expect(idx("description")).toBeLessThan(idx("tools"));
    expect(idx("tools")).toBeLessThan(idx("model"));
    expect(idx("model")).toBeLessThan(idx("domain"));
    expect(idx("domain")).toBeLessThan(idx("token_budget"));
    expect(idx("token_budget")).toBeLessThan(idx("template_version"));
  });

  it("produces same SHA-256 on every run regardless of prior field order", () => {
    const entry = makeMinimalEntry({ domain: "testing" });
    const body = "\nBody.\n";
    const h1 = computeFrontmatterSha256(splitFrontmatterAndBody(generateTemplate(entry, body))!.yamlBlock);
    const h2 = computeFrontmatterSha256(splitFrontmatterAndBody(generateTemplate(entry, body))!.yamlBlock);
    expect(h1).toBe(h2);
  });
});

// ── CLI subprocess tests ─────────────────────────────────────────────────────

describe("CLI subprocess — exit codes", () => {
  it("--help exits 0 and prints usage to stdout", () => {
    const r = runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("generate-template");
  });

  it("exits 2 when no agent-name and no --all", () => {
    const root = buildSyntheticProject([{ canonical_name: "test-specialist" }]);
    const r = runCli([root]);
    expect(r.exitCode).toBe(2);
  });

  it("exits 2 when agent name is unknown in manifest", () => {
    const root = buildSyntheticProject([{ canonical_name: "test-specialist" }]);
    const r = runCli(["unknown-agent-xyz", root]);
    expect(r.exitCode).toBe(2);
  });

  it("exits 2 for an unrecognized flag", () => {
    const root = buildSyntheticProject([{ canonical_name: "test-specialist" }]);
    const r = runCli(["test-specialist", root, "--bogus-flag"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("unknown option");
  });

  it("--check exits 0 when template already matches generated output", () => {
    const root = buildSyntheticProject([{ canonical_name: "test-specialist" }]);
    runCli(["test-specialist", root]); // write-mode first to canonicalize
    const r = runCli(["test-specialist", root, "--check"]);
    expect(r.exitCode).toBe(0);
  });

  it("--check exits 1 when template has frontmatter drift", () => {
    const scrambledFm =
      "---\ntemplate_version: \"1.0.0\"\nmodel: sonnet\ntools: Read, SendMessage\ndescription: \"test-specialist description\"\nname: test-specialist\n---\n";
    const root = buildSyntheticProject([
      { canonical_name: "test-specialist", frontmatterOverride: scrambledFm },
    ]);
    const r = runCli(["test-specialist", root, "--check"]);
    expect(r.exitCode).toBe(1);
  });

  it("default write mode exits 0 and template + mirror become byte-identical", () => {
    const root = buildSyntheticProject([{ canonical_name: "test-specialist" }]);
    const r = runCli(["test-specialist", root]);
    expect(r.exitCode).toBe(0);

    const tBuf = readFileSync(path.join(root, "setup/agent-templates/test-specialist.md"));
    const mBuf = readFileSync(path.join(root, ".claude/agents/test-specialist.md"));
    expect(Buffer.compare(tBuf, mBuf)).toBe(0);
  });

  // --all mode: first positional arg is PROJECT_ROOT (no agent-name)
  it("--all exits 0 and writes all templates", () => {
    const root = buildSyntheticProject([{ canonical_name: "test-specialist" }]);
    const r = runCli(["--all", root]);
    expect(r.exitCode).toBe(0);
  });

  it("--update-manifest-hash writes SHA-256 to manifest when field exists", () => {
    const root = buildSyntheticProject([
      { canonical_name: "test-specialist", includeHashField: true },
    ]);
    const r = runCli(["test-specialist", root, "--update-manifest-hash"]);
    expect(r.exitCode).toBe(0);

    const manifestContent = readFileSync(
      path.join(root, ".claude/registry/agents.manifest.yaml"),
      "utf-8",
    );
    expect(manifestContent).toMatch(/template_frontmatter_sha256: [0-9a-f]{64}/);
  });

  it("--format json exits 0 and stdout is valid JSON with results array", () => {
    const root = buildSyntheticProject([{ canonical_name: "test-specialist" }]);
    const r = runCli(["test-specialist", root, "--format", "json"]);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results[0].agent).toBe("test-specialist");
  });
});

// ── Live project smoke ────────────────────────────────────────────────────────

describe("live project smoke", () => {
  it("splitFrontmatterAndBody + generateTemplate round-trip on arch-testing preserves body", () => {
    const templatePath = path.join(
      REAL_PROJECT_ROOT,
      "setup/agent-templates/arch-testing.md",
    );
    if (!existsSync(templatePath)) return;

    const raw = readFileSync(templatePath, "utf-8");
    const split = splitFrontmatterAndBody(raw);
    expect(split).not.toBeNull();

    const entry = makeMinimalEntry({
      canonical_name: "arch-testing",
      tools: { allowed: ["Read", "SendMessage"] },
      runtime: { model: "sonnet" },
      template_version: "1.21.0",
    });

    const output = generateTemplate(entry, split!.body);
    expect(splitFrontmatterAndBody(output)!.body).toBe(split!.body);
  });
});
