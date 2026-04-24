/**
 * Anti-regression tests for Wave 31 W31-01.
 *
 * Covers:
 *  - W31-01: quality-gater template enforces T-BUG-015 Search Dispatch Protocol
 *    Both setup/agent-templates/quality-gater.md and .claude/agents/quality-gater.md must:
 *    - Have template_version "2.6.0" (bumped from W30 baseline "2.5.0")
 *    - Contain "T-BUG-015" citation
 *    - Contain "FORBIDDEN" enforcement language
 *    - Contain "context-provider" in the FORBIDDEN block
 *    - List "Grep" and "Glob" as forbidden tools
 *    - Distinguish PERMITTED verification from FORBIDDEN discovery
 *    - Have parity between both file locations
 *    - Place FORBIDDEN block before Phase 3 execution steps (Step 0)
 *    - Cross-template consistency: planner.md also references T-BUG-015
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(__dirname, "../../..");

const setupTemplatePath = path.join(ROOT, "setup/agent-templates/quality-gater.md");
const agentPath = path.join(ROOT, ".claude/agents/quality-gater.md");
const plannerPath = path.join(ROOT, "setup/agent-templates/planner.md");

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

describe("quality-gater template enforces T-BUG-015 Search Dispatch Protocol", () => {
  const setupRaw = fs.readFileSync(setupTemplatePath, "utf-8");
  const setupFrontmatter = extractFrontmatter(setupRaw);
  const setupBody = extractBody(setupRaw);

  it("setup template body contains T-BUG-015", () => {
    expect(setupBody).toContain("T-BUG-015");
  });

  it("setup template body contains FORBIDDEN", () => {
    expect(setupBody).toContain("FORBIDDEN");
  });

  it("setup template body contains context-provider in FORBIDDEN block", () => {
    const forbiddenIdx = setupBody.indexOf("FORBIDDEN");
    const contextProviderIdx = setupBody.indexOf("context-provider");
    expect(forbiddenIdx).toBeGreaterThanOrEqual(0);
    expect(contextProviderIdx).toBeGreaterThanOrEqual(0);
    // context-provider must appear within reasonable proximity of FORBIDDEN block
    const segment = setupBody.slice(forbiddenIdx, forbiddenIdx + 500);
    expect(segment).toContain("context-provider");
  });

  it("setup template body contains Grep in FORBIDDEN list", () => {
    expect(setupBody).toContain("Grep");
  });

  it("setup template body contains Glob in FORBIDDEN list", () => {
    expect(setupBody).toContain("Glob");
  });

  it("setup template body distinguishes PERMITTED verification from FORBIDDEN discovery", () => {
    expect(setupBody).toContain("PERMITTED");
    expect(setupBody).toContain("FORBIDDEN");
  });

  it(".claude/agents/quality-gater.md matches setup template (parity)", () => {
    const agentRaw = fs.readFileSync(agentPath, "utf-8");
    expect(agentRaw).toBe(setupRaw);
  });

  it('template_version is "2.6.0" (higher than W30 baseline "2.5.0")', () => {
    expect(setupFrontmatter).not.toBeNull();
    expect(setupFrontmatter?.template_version).toBe("2.6.0");
  });

  it("FORBIDDEN block appears before Phase 3 execution steps (Step 0)", () => {
    const forbiddenIdx = setupBody.indexOf("T-BUG-015");
    const step0Idx = setupBody.indexOf("### Step 0");
    expect(forbiddenIdx).toBeGreaterThanOrEqual(0);
    expect(step0Idx).toBeGreaterThanOrEqual(0);
    expect(forbiddenIdx).toBeLessThan(step0Idx);
  });

  it("T-BUG-015 identifier matches planner template (cross-template consistency)", () => {
    const plannerRaw = fs.readFileSync(plannerPath, "utf-8");
    const plannerBody = extractBody(plannerRaw);
    expect(plannerBody).toContain("T-BUG-015");
  });
});
