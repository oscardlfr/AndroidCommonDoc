/**
 * Anti-regression tests for Wave 28 behaviors.
 *
 * Covers:
 *  - BL-W27-01: CP Spawn Protocol uses search-docs(query) not find-pattern(category)
 *  - W17 HIGH #3: Message Topic Discipline section present in arch templates
 *  - W17 HIGH #4: Scope Immutability Gate section present in arch templates
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const TEMPLATES_DIR = path.join(ROOT, "setup/agent-templates");
const AGENTS_DIR = path.join(ROOT, ".claude/agents");

function readBothAgent(name: string): string[] {
  return [
    fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8"),
    fs.readFileSync(path.join(AGENTS_DIR, name), "utf-8"),
  ];
}

// ---------------------------------------------------------------------------
// Group 1: BL-W27-01 — CP Spawn Protocol uses search-docs not find-pattern
// ---------------------------------------------------------------------------

describe("Wave 28 BL-W27-01: context-provider Step 2 uses search-docs not find-pattern(category)", () => {
  it("context-provider Step 2 uses search-docs(query) not find-pattern(category)", () => {
    for (const raw of readBothAgent("context-provider.md")) {
      expect(raw).toMatch(/mcp__androidcommondoc__search-docs/);
      expect(raw).not.toMatch(/Call.*find-pattern.*\{category/);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 2: W17 HIGH #3 — Message Topic Discipline present in arch templates
// ---------------------------------------------------------------------------

describe("Wave 28 W17-HIGH-3: Message Topic Discipline section present in arch templates", () => {
  const targets = [
    "setup/agent-templates/arch-testing.md",
    "setup/agent-templates/arch-platform.md",
    "setup/agent-templates/arch-integration.md",
    "docs/agents/tl-dispatch-topology.md",
  ];
  for (const rel of targets) {
    it(`${rel} contains Message Topic Discipline section`, () => {
      const content = fs.readFileSync(path.join(ROOT, rel), "utf-8");
      expect(content).toMatch(/Message Topic Discipline/i);
    });
  }
});

// ---------------------------------------------------------------------------
// Group 3: W17 HIGH #4 — Scope Immutability Gate present in arch templates
// ---------------------------------------------------------------------------

describe("Wave 28 W17-HIGH-4: Scope Immutability Gate present in arch templates and topology doc", () => {
  const targets = [
    "setup/agent-templates/arch-testing.md",
    "setup/agent-templates/arch-platform.md",
    "setup/agent-templates/arch-integration.md",
    "docs/agents/arch-topology-protocols.md",
  ];
  for (const rel of targets) {
    it(`${rel} contains Scope Immutability Gate section`, () => {
      const content = fs.readFileSync(path.join(ROOT, rel), "utf-8");
      expect(content).toMatch(/Scope Immutability Gate/i);
    });
  }
});
