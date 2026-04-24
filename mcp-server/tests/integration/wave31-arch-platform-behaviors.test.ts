/**
 * Anti-regression tests for Wave 31 W31-02.
 *
 * Covers:
 *  - W31-02: kmp-features-2026.md created with valid frontmatter
 *  - W31-02: arch-platform template (setup) contains Knowledge Currency Gate
 *  - W31-02: arch-platform template (setup) references kmp-features-2026.md
 *  - W31-02: .claude/agents/arch-platform.md is bit-for-bit identical to setup template
 *  - W31-02: kmp-architecture-sourceset.md has cross-ref to kmp-features-2026.md
 *  - W31-02: kmp-features-2026.md contains Myths section with at least one myth entry
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(__dirname, "../../..");

const kmpFeaturesPath = path.join(ROOT, "docs/architecture/kmp-features-2026.md");
const setupTemplatePath = path.join(ROOT, "setup/agent-templates/arch-platform.md");
const agentPath = path.join(ROOT, ".claude/agents/arch-platform.md");
const sourcesetPath = path.join(ROOT, "docs/architecture/kmp-architecture-sourceset.md");

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

describe("W31-02: kmp-features-2026.md and arch-platform Knowledge Currency Gate", () => {
  it("kmp-features-2026.md exists with valid YAML frontmatter (slug + category)", () => {
    const raw = fs.readFileSync(kmpFeaturesPath, "utf-8");
    const fm = extractFrontmatter(raw);
    expect(fm).not.toBeNull();
    expect(fm?.slug).toBe("kmp-features-2026");
    expect(fm?.category).toBe("architecture");
  });

  it("arch-platform setup template contains Knowledge Currency Gate", () => {
    const raw = fs.readFileSync(setupTemplatePath, "utf-8");
    const body = extractBody(raw);
    expect(body).toContain("Knowledge Currency Gate");
  });

  it("arch-platform setup template references kmp-features-2026.md", () => {
    const raw = fs.readFileSync(setupTemplatePath, "utf-8");
    const body = extractBody(raw);
    expect(body).toContain("kmp-features-2026.md");
  });

  it(".claude/agents/arch-platform.md matches setup template (parity)", () => {
    const setupRaw = fs.readFileSync(setupTemplatePath, "utf-8");
    const agentRaw = fs.readFileSync(agentPath, "utf-8");
    expect(agentRaw).toBe(setupRaw);
  });

  it("kmp-architecture-sourceset.md contains cross-ref to kmp-features-2026.md", () => {
    const raw = fs.readFileSync(sourcesetPath, "utf-8");
    expect(raw).toContain("kmp-features-2026.md");
  });

  it('kmp-features-2026.md contains "Myths" section header and at least one myth entry', () => {
    const raw = fs.readFileSync(kmpFeaturesPath, "utf-8");
    const body = extractBody(raw);
    expect(body).toContain("## Myths & Common Misconceptions");
    expect(body).toContain("WRONG");
  });
});
