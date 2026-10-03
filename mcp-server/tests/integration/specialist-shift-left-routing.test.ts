import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SPECIALISTS = [
  "test-specialist",
  "toolkit-specialist",
  "ui-specialist",
  "domain-model-specialist",
  "data-layer-specialist",
  "feature-domain-specialist",
  "doc-updater",
] as const;
const SHIFT_LEFT_IDS = [
  "test-changed",
  "lint-resources",
  "verify-kmp",
  "check-agent-parity",
  "qg-registry-integrity",
  "version-sync",
  "audit-docs",
  "readme-audit",
] as const;

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

function launcherIds(): Set<string> {
  const launcher = read(".claude/runtime/l0-toolkit-launcher.cjs");
  return new Set([...launcher.matchAll(/^\s{2}'([a-z0-9-]+)':\s*\{/gm)].map((match) => match[1]));
}

function section(source: string, heading: string): string {
  const start = source.indexOf(heading);
  expect(start, `${heading} must exist`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\n## ", start + heading.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("D8 planner routing", () => {
  const surfaces = [
    "setup/agent-templates/planner.md",
    ".claude/agents/planner.md",
    "setup/copilot-agent-templates/planner.agent.md",
  ];

  it("routes every test-only Path-Manifest to test-specialist and never doc-updater", () => {
    for (const surface of surfaces) {
      const planner = read(surface);
      expect(planner, surface).toContain("Path-based routing is authoritative");
      expect(planner, surface).toMatch(/every changed path is a test or test fixture[\s\S]*MUST assign implementation and the commit to `test-specialist`/);
      expect(planner, surface).toMatch(/MUST NOT contain a `doc-updater` implementation row/);
      expect(planner, surface).toContain("Never route a test-only change to `doc-updater`");
    }
  });

  it("preserves the one-planner resume contract rather than spawning Pass B", () => {
    const planner = read("setup/agent-templates/planner.md");
    expect(planner).toContain("There is exactly one fresh planner spawn per wave");
    expect(planner).toContain('Orchestrator resumes the Pass A actor: SendMessage(to="planner", ...)');
    expect(planner).toContain("never call Agent again");
  });

  it("preserves the canonical 900-second requester deadline", () => {
    for (const role of ["arch-platform", "arch-testing", "arch-integration"]) {
      const architect = read(`setup/agent-templates/${role}.md`);
      expect(architect, role).toContain("'--timeout' '900'");
      expect(architect, role).not.toContain("'--timeout' '300'");
    }
  });
});

describe("D8 specialist pre-commit shift-left contract", () => {
  it("names only operation IDs that really exist in the launcher", () => {
    const installed = launcherIds();
    for (const id of SHIFT_LEFT_IDS) expect(installed.has(id), id).toBe(true);
    for (const role of SPECIALISTS) {
      const contract = section(read(`setup/agent-templates/${role}.md`), "## Pre-Commit Shift-Left Gate (MANDATORY)");
      for (const id of SHIFT_LEFT_IDS) expect(contract, `${role}:${id}`).toContain(`\`${id}\``);
    }
  });

  it("requires launcher-only checks, evidence, and a fail-closed unknown-ID path on every specialist surface", () => {
    for (const role of SPECIALISTS) {
      for (const relative of [
        `setup/agent-templates/${role}.md`,
        `.claude/agents/${role}.md`,
        `setup/copilot-agent-templates/${role}.agent.md`,
      ]) {
        const contract = section(read(relative), "## Pre-Commit Shift-Left Gate (MANDATORY)");
        expect(contract, relative).toContain("l0-toolkit-launcher.cjs run <existing-id>");
        expect(contract, relative).toContain("never invent an operation ID");
        expect(contract, relative).toContain("RUNTIME-CONTRACT-GAP: <check>");
        expect(contract, relative).toContain("stop before commit");
        expect(contract, relative).toContain("SHIFT-LEFT-EVIDENCE");
        expect(contract, relative).toMatch(/operation ID, exact argv, exit code and concise outcome/);
        expect(contract, relative).not.toMatch(/(?:bash|node) scripts\//);
        expect(contract, relative).not.toMatch(/\.\/gradlew|npm\s+(?:run|test)/);
      }
    }
  });

  it("keeps canonical specialist templates byte-identical to their installed Claude mirrors", () => {
    for (const role of SPECIALISTS) {
      expect(read(`.claude/agents/${role}.md`), role).toBe(read(`setup/agent-templates/${role}.md`));
    }
  });

  it("detects an invented launcher operation as a negative control", () => {
    const installed = launcherIds();
    expect(installed.has("imaginary-static-check")).toBe(false);
    const synthetic = "node .claude/runtime/l0-toolkit-launcher.cjs run imaginary-static-check --project-root /repo --";
    const referenced = [...synthetic.matchAll(/l0-toolkit-launcher\.cjs run ([a-z0-9-]+)/g)].map((match) => match[1]);
    expect(referenced.filter((id) => !installed.has(id))).toEqual(["imaginary-static-check"]);
  });
});
