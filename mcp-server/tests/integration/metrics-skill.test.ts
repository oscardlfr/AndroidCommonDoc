import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("/metrics skill", () => {
  const skillPath = join(__dirname, "../../../.claude/commands/metrics.md");
  const content = readFileSync(skillPath, "utf8");

  it("has required frontmatter intent: observability", () => {
    expect(content).toMatch(/^---[\s\S]*?intent:\s*observability[\s\S]*?---/);
  });

  it("references both MCP tools for harmonized dashboard", () => {
    expect(content).toContain("tool-use-analytics");
    expect(content).toContain("skill-usage-analytics");
  });

  it("documents 3 required dashboard sections", () => {
    expect(content.toLowerCase()).toContain("runtime");
    expect(content.toLowerCase()).toContain("skill");
    expect(content.toLowerCase()).toContain("cross-cutting");
  });
});
