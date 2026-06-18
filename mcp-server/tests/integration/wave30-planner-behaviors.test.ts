/**
 * Anti-regression tests for the planner template (BL-W30-11 + later).
 *
 * Both setup/agent-templates/planner.md and .claude/agents/planner.md must:
 *  - Have template_version matching the current pin (asserted below)
 *  - Contain "T-BUG-015" citation + "Search Dispatch Protocol" section
 *  - Contain "FORBIDDEN at ALL times during planning" enforcement language
 *  - NOT contain the old "read current content first" phrase
 *  - NOT reference AskUserQuestion — the planner's tools are Read/Write/Bash/SendMessage,
 *    so instructing a user-facing prompt tool is role-leakage (CodeRabbit, bl-w47-tail).
 *  - KEEP the Ex-PR1 Spec-Ambiguity Clarification step (section header + the
 *    SendMessage(to="team-lead", summary="spec questions") relay) — positive coverage so the
 *    feature itself can't be silently deleted with CI still green (P2, bl-w47-tail).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(__dirname, "../../..");

const files = [
  {
    label: "setup/agent-templates/planner.md",
    path: path.join(ROOT, "setup/agent-templates/planner.md"),
  },
  {
    label: ".claude/agents/planner.md",
    path: path.join(ROOT, ".claude/agents/planner.md"),
  },
];

function extractFrontmatter(raw: string): Record<string, unknown> | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try {
    return parseYaml(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractBody(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

describe("planner template enforces T-BUG-015 Search Dispatch Protocol", () => {
  for (const { label, path: filePath } of files) {
    describe(label, () => {
      const raw = fs.readFileSync(filePath, "utf-8");
      const frontmatter = extractFrontmatter(raw);
      const body = extractBody(raw);

      it('has template_version "1.19.0"', () => {
        // BL-W48 team-model migration: bumped 1.17.0 → 1.18.0 (session-team removal),
        // then 1.18.0 → 1.19.0 (planner reframe as pure single-use subagent).
        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.template_version).toBe("1.19.0");
      });

      it("body contains T-BUG-015", () => {
        expect(body).toContain("T-BUG-015");
      });

      it("body contains Search Dispatch Protocol", () => {
        expect(body).toContain("Search Dispatch Protocol");
      });

      it("body contains FORBIDDEN at ALL times during planning", () => {
        expect(body).toContain("FORBIDDEN at ALL times during planning");
      });

      it("body does NOT contain old invitation phrase", () => {
        expect(body).not.toContain("read current content first");
      });

      it("body does NOT reference AskUserQuestion (role-leak guard: planner lacks that tool)", () => {
        expect(body).not.toContain("AskUserQuestion");
      });

      it("body KEEPS the Ex-PR1 Spec-Ambiguity Clarification step (BL-W48: team-lead relay removed)", () => {
        // BL-W48 team-model migration: planner is now a pure single-use subagent.
        // Spec ambiguities are surfaced via PLAN.md ### Open Questions section for the
        // orchestrator to read from disk — the old SendMessage(to="team-lead") relay
        // is gone (no team inbox; planner uses disk as the load-bearing carrier).
        // Spec-Ambiguity Clarification step is KEPT; Q→Open Questions flow is KEPT.
        expect(body).toContain("Spec-Ambiguity Clarification");
        expect(body).toContain("Open Questions");
        // Planner no longer sends SendMessage(to="team-lead") — verify it doesn't
        // accidentally re-introduce the retired relay pattern.
        expect(body).not.toContain('SendMessage(to="team-lead"');
      });
    });
  }
});
