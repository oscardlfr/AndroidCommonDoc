/**
 * Anti-regression tests for Wave 30 BL-W30-11.
 *
 * Covers:
 *  - BL-W30-11: planner template enforces T-BUG-015 Search Dispatch Protocol
 *    Both setup/agent-templates/planner.md and .claude/agents/planner.md must:
 *    - Have template_version "1.7.0"
 *    - Contain "T-BUG-015" citation
 *    - Contain "Search Dispatch Protocol" section
 *    - Contain "FORBIDDEN at ALL times during planning" enforcement language
 *    - NOT contain the old "read current content first" phrase
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

      it('has template_version "1.7.0"', () => {
        expect(frontmatter).not.toBeNull();
        expect(frontmatter?.template_version).toBe("1.7.0");
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
    });
  }
});
