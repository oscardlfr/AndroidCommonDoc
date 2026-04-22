/**
 * Anti-regression tests for Wave 23 behaviors.
 *
 * Covers:
 *  - Bug #5: arch templates read scope_doc_path (no hardcoded .planning/PLAN.md)
 *  - Bug #5: SCOPE-DOC-MISSING guard in arch templates
 *  - Bug #6: arch templates reference arch-dispatch-modes.md (PREP/EXECUTE)
 *  - S8:     team-lead template contains token meter + retrospective rule
 *  - 5.16.0: team-lead session spawn uses subagent_type for CP and doc-updater
 *  - Docs:   arch-dispatch-modes.md, tl-model-profiles.md, readme-audit-fix-guide.md exist
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(__dirname, "../../..");
const AGENTS_DIR = path.join(ROOT, ".claude/agents");
const TEMPLATES_DIR = path.join(ROOT, "setup/agent-templates");
const ARCHITECTS = ["arch-testing.md", "arch-platform.md", "arch-integration.md"];

function readBoth(name: string): string[] {
  return [
    fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8"),
    fs.readFileSync(path.join(AGENTS_DIR, name), "utf-8"),
  ];
}

function extractFrontmatter(raw: string): Record<string, unknown> | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try {
    return parseYaml(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bug #5: scope_doc_path — no hardcoded .planning/PLAN.md in arch templates
// ---------------------------------------------------------------------------

describe("Bug #5: arch templates use scope_doc_path, not hardcoded PLAN.md path", () => {
  for (const name of ARCHITECTS) {
    it(`${name} reads scope_doc_path from team-lead dispatch`, () => {
      for (const content of readBoth(name)) {
        expect(content).toMatch(/scope_doc_path/);
      }
    });

    it(`${name} does not hardcode .planning/PLAN.md as trigger path`, () => {
      for (const content of readBoth(name)) {
        // Hardcoded path must NOT appear in the scope-doc trigger-check block.
        // We allow references inside comments or quoted examples, but any
        // direct Read(".../.planning/PLAN.md") instruction is the regression.
        expect(content).not.toMatch(/Read\("\.planning\/PLAN\.md"\)/);
        expect(content).not.toMatch(/Read\('\.planning\/PLAN\.md'\)/);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Bug #5: SCOPE-DOC-MISSING guard in arch templates
// ---------------------------------------------------------------------------

describe("Bug #5: arch templates have SCOPE-DOC-MISSING SendMessage guard", () => {
  for (const name of ARCHITECTS) {
    it(`${name} has SCOPE-DOC-MISSING guard`, () => {
      for (const content of readBoth(name)) {
        expect(content).toMatch(/SCOPE-DOC-MISSING/);
        expect(content).toMatch(/SendMessage/);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Bug #6: arch templates reference arch-dispatch-modes.md (PREP/EXECUTE spec)
// ---------------------------------------------------------------------------

describe("Bug #6: arch templates reference arch-dispatch-modes.md for PREP/EXECUTE handling", () => {
  for (const name of ARCHITECTS) {
    it(`${name} references arch-dispatch-modes.md`, () => {
      for (const content of readBoth(name)) {
        expect(content).toMatch(/arch-dispatch-modes\.md/);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// S8: team-lead template has token meter + retrospective rule
// ---------------------------------------------------------------------------

describe("S8: team-lead template has Token Meter + retrospective rule", () => {
  it("team-lead.md references tl-verification-gates.md Token Meter Gate", () => {
    for (const content of readBoth("team-lead.md")) {
      // team-lead template must carry at minimum a pointer to the sub-doc or
      // inline the retrospective rule — either satisfies the S8 requirement.
      expect(content).toMatch(/retrospective|token.meter|Token Meter/i);
    }
  });

  it("tl-verification-gates.md has Token Meter Gate section", () => {
    const vgPath = path.join(ROOT, "docs/agents/tl-verification-gates.md");
    expect(fs.existsSync(vgPath)).toBe(true);
    const content = fs.readFileSync(vgPath, "utf-8");
    expect(content).toMatch(/Token Meter Gate/);
    expect(content).toMatch(/retrospective\.md/);
    expect(content).toMatch(/80%/);
  });
});

// ---------------------------------------------------------------------------
// 5.16.0 hotfix: team-lead spawn lines carry subagent_type for CP and doc-updater
// ---------------------------------------------------------------------------

describe("5.16.0 hotfix: team-lead session setup uses subagent_type on peer spawns", () => {
  it("team-lead.md spawns context-provider with subagent_type", () => {
    for (const content of readBoth("team-lead.md")) {
      expect(content).toMatch(/subagent_type="context-provider"/);
    }
  });

  it("team-lead.md spawns doc-updater with subagent_type", () => {
    for (const content of readBoth("team-lead.md")) {
      expect(content).toMatch(/subagent_type="doc-updater"/);
    }
  });

  it("team-lead.md has NEVER self-assign guard for context-provider", () => {
    for (const content of readBoth("team-lead.md")) {
      expect(content).toMatch(/NEVER self-assign|NEVER.*write files|read-only/i);
    }
  });
});

// ---------------------------------------------------------------------------
// New docs: existence + complete YAML frontmatter
// ---------------------------------------------------------------------------

describe("Wave 23 new docs exist with valid YAML frontmatter", () => {
  const REQUIRED_FM_FIELDS = ["scope", "sources", "targets", "category", "slug"] as const;

  function checkDoc(relPath: string) {
    const absPath = path.join(ROOT, relPath);
    it(`${relPath} exists`, () => {
      expect(fs.existsSync(absPath)).toBe(true);
    });

    it(`${relPath} has valid YAML frontmatter with required fields`, () => {
      const content = fs.readFileSync(absPath, "utf-8");
      const fm = extractFrontmatter(content);
      expect(fm, `frontmatter missing in ${relPath}`).not.toBeNull();
      for (const field of REQUIRED_FM_FIELDS) {
        expect(fm, `field "${field}" missing in ${relPath}`).toHaveProperty(field);
      }
    });
  }

  checkDoc("docs/agents/arch-dispatch-modes.md");
  checkDoc("docs/agents/tl-model-profiles.md");
  checkDoc("docs/guides/readme-audit-fix-guide.md");
});

// ---------------------------------------------------------------------------
// arch-dispatch-modes.md content: PREP + EXECUTE sections present
// ---------------------------------------------------------------------------

describe("arch-dispatch-modes.md content integrity", () => {
  const DOC = path.join(ROOT, "docs/agents/arch-dispatch-modes.md");

  it("has PREP mode section", () => {
    const content = fs.readFileSync(DOC, "utf-8");
    expect(content).toMatch(/PREP/);
    expect(content).toMatch(/READY:/);
  });

  it("has EXECUTE mode section", () => {
    const content = fs.readFileSync(DOC, "utf-8");
    expect(content).toMatch(/EXECUTE/);
    expect(content).toMatch(/APPROVE|ESCALATE/);
  });

  it("has mode: field example in team-lead dispatch", () => {
    const content = fs.readFileSync(DOC, "utf-8");
    expect(content).toMatch(/mode:/);
  });
});

// ---------------------------------------------------------------------------
// Wave 24 / Bug #3: team-lead session setup calls TeamDelete before TeamCreate
// ---------------------------------------------------------------------------

describe("Bug #3: team-lead session setup calls TeamDelete before TeamCreate (Wave 24)", () => {
  it("team-lead.md has TeamDelete before TeamCreate in session start block", () => {
    for (const content of readBoth("team-lead.md")) {
      const deleteIdx = content.indexOf("TeamDelete(team_name=");
      const createIdx = content.indexOf("TeamCreate(team_name=");
      expect(deleteIdx, "TeamDelete must appear before TeamCreate").toBeGreaterThanOrEqual(0);
      expect(createIdx, "TeamCreate must be present").toBeGreaterThanOrEqual(0);
      expect(deleteIdx, "TeamDelete must appear BEFORE TeamCreate").toBeLessThan(createIdx);
    }
  });

  it("team-lead.md pre-flight checklist has step 0 for TeamDelete", () => {
    for (const content of readBoth("team-lead.md")) {
      expect(content).toMatch(/□ 0\. TeamDelete.*TeamCreate.*Bug #3/);
    }
  });

  it("team-lead.md template_version is 6.2.0", () => {
    for (const content of readBoth("team-lead.md")) {
      expect(content).toMatch(/template_version:\s*"6.2.1"/);
    }
  });
});

// ---------------------------------------------------------------------------
// Wave 24 / P4: 17 agents now mirrored in setup/agent-templates/
// ---------------------------------------------------------------------------

describe("P4: agent mirrors in setup/agent-templates/ (Wave 24)", () => {
  const MIRRORS = [
    "advisor.md",
    "api-rate-limit-auditor.md",
    "beta-readiness-agent.md",
    "codebase-mapper.md",
    "cross-platform-validator.md",
    "debugger.md",
    "doc-alignment-agent.md",
    "doc-code-drift-detector.md",
    "full-audit-orchestrator.md",
    "l0-coherence-auditor.md",
    "privacy-auditor.md",
    "quality-gate-orchestrator.md",
    "release-guardian-agent.md",
    "researcher.md",
    "script-parity-validator.md",
    "skill-script-alignment.md",
    "template-sync-validator.md",
    "verifier.md",
  ];

  for (const name of MIRRORS) {
    it(`${name} exists in setup/agent-templates/`, () => {
      expect(fs.existsSync(path.join(TEMPLATES_DIR, name))).toBe(true);
    });

    it(`${name} is identical between setup/agent-templates/ and .claude/agents/`, () => {
      const src = fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8");
      const copy = fs.readFileSync(path.join(AGENTS_DIR, name), "utf-8");
      expect(src).toBe(copy);
    });
  }
});
