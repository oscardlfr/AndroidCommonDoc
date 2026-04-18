/**
 * Regression tests for topology bugs surfaced during L1 shared-kmp-libs
 * debug session and fixed in the Phase-21/22 follow-up commits on PR #43.
 *
 * Each test corresponds to a T-BUG or OBS finding. If any agent template
 * or doc drifts away from its fix, the corresponding test fails loudly.
 *
 * DO NOT delete a test just because it "feels redundant". Each one guards
 * a specific regression class that already hit production-side validation.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

const ROOT = path.resolve(__dirname, "../../..");
const AGENTS_DIR = path.join(ROOT, ".claude/agents");
const TEMPLATES_DIR = path.join(ROOT, "setup/agent-templates");

// ── Shared helpers ──────────────────────────────────────────────────────────

function readAgent(name: string): { claude: string; template: string } {
  return {
    claude: fs.readFileSync(path.join(AGENTS_DIR, name), "utf-8"),
    template: fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8"),
  };
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

// ── T-BUG-001: arch agents Activation Sequence ──────────────────────────────

describe("T-BUG-001: architect Activation Sequence (inbox-first)", () => {
  for (const name of ["arch-platform.md", "arch-testing.md", "arch-integration.md"]) {
    it(`${name} has Activation Sequence section`, () => {
      const { claude, template } = readAgent(name);
      for (const content of [claude, template]) {
        expect(content).toMatch(/Activation Sequence \(MANDATORY/);
        expect(content).toMatch(/Inbox-first|inbox/i);
        expect(content).toMatch(/T-BUG-001/);
      }
    });
  }
});

// ── T-BUG-002: context-provider PLAN.md freshness ───────────────────────────

describe("T-BUG-002: context-provider PLAN.md freshness validation", () => {
  it("context-provider has Rule #7 freshness check", () => {
    const { claude, template } = readAgent("context-provider.md");
    for (const content of [claude, template]) {
      expect(content).toMatch(/PLAN\.md freshness/i);
      expect(content).toMatch(/T-BUG-002/);
      expect(content).toMatch(/Validate freshness|cross-check with PM|confirm active plan/i);
    }
  });
});

// ── T-BUG-003: Google Android skills MUST surface ───────────────────────────

describe("T-BUG-003: ui-specialist and platform-auditor MUST surface skill delegation", () => {
  it("ui-specialist Rule 9 uses MANDATORY/MUST surface language", () => {
    const { claude, template } = readAgent("ui-specialist.md");
    for (const content of [claude, template]) {
      expect(content).toMatch(/### 9\. Delegated Google Android skills \(MANDATORY/);
      expect(content).toMatch(/MUST surface/i);
      expect(content).toMatch(/\/edge-to-edge/);
      expect(content).toMatch(/\/navigation-3/);
      expect(content).toMatch(/\/migrate-xml-views-to-jetpack-compose/);
    }
  });

  it("platform-auditor delegation section uses MANDATORY/MUST surface language", () => {
    const { claude, template } = readAgent("platform-auditor.md");
    for (const content of [claude, template]) {
      expect(content).toMatch(/Delegated Google Android skills \(MANDATORY/);
      expect(content).toMatch(/MUST surface/i);
      expect(content).toMatch(/\/r8-analyzer/);
      expect(content).toMatch(/\/agp-9-upgrade/);
    }
  });
});

// ── T-BUG-004: no kmp-reviewer references in catalog ────────────────────────

describe("T-BUG-004: catalog intel does not reference non-existent kmp-reviewer", () => {
  const CATALOG_PATH = path.join(ROOT, ".planning/intel/android-skills-catalog.md");

  it("catalog does not assign delegation to kmp-reviewer", () => {
    if (!fs.existsSync(CATALOG_PATH)) return; // catalog not yet in tree on fresh clones
    const content = fs.readFileSync(CATALOG_PATH, "utf-8");
    // Find the wire-up table and assert no row starts with `kmp-reviewer`
    expect(content).not.toMatch(/\|\s*`kmp-reviewer`\s*\|/);
  });
});

// ── T-BUG-005A: context-provider has WebFetch ───────────────────────────────

describe("T-BUG-005A: context-provider WebFetch tool", () => {
  it("context-provider frontmatter includes WebFetch", () => {
    const { claude, template } = readAgent("context-provider.md");
    for (const content of [claude, template]) {
      const frontmatter = extractFrontmatter(content);
      expect(frontmatter).not.toBeNull();
      expect(frontmatter!.tools).toMatch(/WebFetch/);
    }
  });
});

// ── T-BUG-005B: architects FORBID Bash curl ─────────────────────────────────

describe("T-BUG-005B: architect templates forbid Bash curl for external docs", () => {
  for (const name of ["arch-platform.md", "arch-testing.md", "arch-integration.md"]) {
    it(`${name} has External Doc Lookups section with curl/wget FORBIDDEN`, () => {
      const { claude, template } = readAgent(name);
      for (const content of [claude, template]) {
        expect(content).toMatch(/External Doc Lookups \(MANDATORY/);
        expect(content).toMatch(/T-BUG-005/);
        expect(content).toMatch(/FORBIDDEN/);
        expect(content).toMatch(/Bash curl|Bash wget/);
        expect(content).toMatch(/route through context-provider|SendMessage.*context-provider/i);
      }
    });
  }
});

// ── T-BUG-006: Nav3 Android-vs-CMP disambiguation in catalog ───────────────

describe("T-BUG-006: catalog disambiguates Google Android Nav3 vs JetBrains CMP Nav3", () => {
  const CATALOG_PATH = path.join(ROOT, ".planning/intel/android-skills-catalog.md");

  it("catalog has Nav3 disambiguation section", () => {
    if (!fs.existsSync(CATALOG_PATH)) return;
    const content = fs.readFileSync(CATALOG_PATH, "utf-8");
    expect(content).toMatch(/T-BUG-006/);
    expect(content).toMatch(/androidx\.navigation3/);
    expect(content).toMatch(/org\.jetbrains\.androidx\.navigation3/);
  });
});

// ── T-BUG-007: JDK21 toolchain guide ────────────────────────────────────────

describe("T-BUG-007: JDK21 toolchain guide exists", () => {
  const GUIDE = path.join(ROOT, "docs/guides/jdk-toolchain.md");

  it("docs/guides/jdk-toolchain.md exists", () => {
    expect(fs.existsSync(GUIDE)).toBe(true);
  });

  it("guide has valid frontmatter scannable by registry", () => {
    const content = fs.readFileSync(GUIDE, "utf-8");
    const fm = extractFrontmatter(content);
    expect(fm).not.toBeNull();
    expect(Array.isArray(fm!.scope)).toBe(true);
    expect(Array.isArray(fm!.sources)).toBe(true);
    expect(Array.isArray(fm!.targets)).toBe(true);
    // sources MUST be string entries (not objects) — see frontmatter-strings-only guard below
    for (const src of fm!.sources as unknown[]) {
      expect(typeof src).toBe("string");
    }
  });

  it("guide references JDK 21 + Foojay toolchain", () => {
    const content = fs.readFileSync(GUIDE, "utf-8");
    expect(content).toMatch(/JDK 21|JavaLanguageVersion\.of\(21\)/);
    expect(content).toMatch(/Foojay/i);
  });

  it("README Requirements row mentions JDK 21", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf-8");
    expect(readme).toMatch(/JDK 21/);
  });
});

// ── T-BUG-008: comprehensive .gitignore template ───────────────────────────

describe("T-BUG-008: comprehensive .gitignore template shipped", () => {
  const TEMPLATE = path.join(ROOT, "setup/templates/gitignore.template");

  it("setup/templates/gitignore.template exists", () => {
    expect(fs.existsSync(TEMPLATE)).toBe(true);
  });

  it("template ignores L0 skill-generated artifacts", () => {
    const content = fs.readFileSync(TEMPLATE, "utf-8");
    for (const pattern of [
      "docs/api/",
      "MODULE_MAP.md",
      "coverage-full-report.md",
      "*.stackdump",
      ".claude/agent-memory/",
      ".planning/",
      ".gradle/",
      "build/",
    ]) {
      expect(content).toContain(pattern);
    }
  });
});

// ── T-BUG-009: catalog-coverage-check script parity ────────────────────────

describe("T-BUG-009: catalog-coverage-check script exists in both shell flavors", () => {
  it("sh version exists and mentions catalog fix", () => {
    const sh = path.join(ROOT, "scripts/sh/catalog-coverage-check.sh");
    expect(fs.existsSync(sh)).toBe(true);
    const content = fs.readFileSync(sh, "utf-8");
    expect(content).toMatch(/T-BUG-009|catalog coverage/i);
  });

  it("ps1 wrapper exists and delegates to bash", () => {
    const ps1 = path.join(ROOT, "scripts/ps1/catalog-coverage-check.ps1");
    expect(fs.existsSync(ps1)).toBe(true);
    const content = fs.readFileSync(ps1, "utf-8");
    expect(content).toMatch(/catalog-coverage-check\.sh/);
    expect(content).toMatch(/bash/i);
  });
});

// ── OBS-A: architect Scope Extension Protocol ──────────────────────────────

describe("OBS-A: architect templates have Scope Extension Protocol", () => {
  for (const name of ["arch-platform.md", "arch-testing.md", "arch-integration.md"]) {
    it(`${name} has Scope Extension Protocol block`, () => {
      const { claude, template } = readAgent(name);
      for (const content of [claude, template]) {
        expect(content).toMatch(/Scope Extension Protocol|OBS-A/);
        expect(content).toMatch(/scope extension request|wait for explicit PM approval/i);
      }
    });
  }
});

// ── OBS-B: quality-gater Stash Hygiene ─────────────────────────────────────

describe("OBS-B: quality-gater Stash Hygiene rule", () => {
  it("quality-gater has Stash Hygiene section", () => {
    const { claude, template } = readAgent("quality-gater.md");
    for (const content of [claude, template]) {
      expect(content).toMatch(/Stash Hygiene|OBS-B/);
      expect(content).toMatch(/git stash pop|stash pop|Stash: popped/);
    }
  });
});

// ── OBS-C: /pre-pr references /schedule for outdated monitoring ────────────

describe("OBS-C: pre-pr skill mentions /schedule for catalog freshness", () => {
  it("skills/pre-pr/SKILL.md references /schedule skill", () => {
    const content = fs.readFileSync(path.join(ROOT, "skills/pre-pr/SKILL.md"), "utf-8");
    expect(content).toMatch(/\/schedule/);
    expect(content).toMatch(/OBS-C|catalog-freshness|check-outdated/i);
  });
});

// ── T-BUG-010: PM template main-conversation-only warning ──────────────────

describe("T-BUG-010: PM template warns it is for main conversation (team-lead), not a spawnable peer", () => {
  it("project-manager.md has WHO-READS-THIS warning + FORBIDDEN spawn instruction", () => {
    const { claude, template } = readAgent("project-manager.md");
    for (const content of [claude, template]) {
      expect(content).toMatch(/T-BUG-010/);
      expect(content).toMatch(/WHO READS THIS|main conversation|team-lead/i);
      expect(content).toMatch(/FORBIDDEN.*project-manager|Agent\(name="project-manager"/);
      expect(content).toMatch(/PM-peer spawn detected|Exiting/i);
    }
  });
});

// ── T-BUG-011: arch-* OBS-A HARD self-gate ─────────────────────────────────

describe("T-BUG-011: arch-* OBS-A is a HARD SELF-GATE (not descriptive)", () => {
  for (const name of ["arch-platform.md", "arch-testing.md", "arch-integration.md"]) {
    it(`${name} has HARD SELF-GATE with wave-distance + specialty + PLAN.md checks`, () => {
      const { claude, template } = readAgent(name);
      for (const content of [claude, template]) {
        expect(content).toMatch(/T-BUG-011/);
        expect(content).toMatch(/HARD SELF-GATE/);
        expect(content).toMatch(/Wave-distance check/);
        expect(content).toMatch(/Specialty check/);
        expect(content).toMatch(/PLAN\.md trigger check/);
        // REFUSE language must appear (hard-stop, not suggestion)
        expect(content).toMatch(/REFUSE/);
        // Anti-pattern: non-adjacent wave (N+2+) must be explicitly forbidden
        expect(content).toMatch(/non-adjacent wave|N\+2 or further/i);
      }
    });
  }
});

// ── T-BUG-012: arch-* Reporter Protocol (PM liveness + fallback) ───────────

describe("T-BUG-012: arch-* Reporter Protocol checks PM liveness and falls back to team-lead", () => {
  for (const name of ["arch-platform.md", "arch-testing.md", "arch-integration.md"]) {
    it(`${name} has Reporter Protocol section with liveness check + [PM-absent] fallback`, () => {
      const { claude, template } = readAgent(name);
      for (const content of [claude, template]) {
        expect(content).toMatch(/T-BUG-012/);
        expect(content).toMatch(/Reporter Protocol/);
        expect(content).toMatch(/Liveness check|PM.*alive|shutdown notification/i);
        expect(content).toMatch(/\[PM-absent\]/);
        expect(content).toMatch(/fall.*back.*team-lead|team-lead.*fallback|SendMessage.*team-lead/i);
      }
    });
  }
});

// ── T-BUG-013: /pre-pr wires catalog-coverage-check.sh ─────────────────────

describe("T-BUG-013: /pre-pr invokes catalog-coverage-check.sh (no more unwired tool theater)", () => {
  const PRE_PR = path.join(ROOT, "skills/pre-pr/SKILL.md");

  it("pre-pr SKILL.md references catalog-coverage-check.sh with T-BUG-013 tag", () => {
    const content = fs.readFileSync(PRE_PR, "utf-8");
    expect(content).toMatch(/T-BUG-013/);
    expect(content).toMatch(/catalog-coverage-check\.sh/);
    // Step must be conditional on .gradle.kts changes
    expect(content).toMatch(/\.gradle\.kts/);
    // Summary table row for visibility
    expect(content).toMatch(/Catalog coverage/);
  });

  it("scripts/sh/catalog-coverage-check.sh still scans *.gradle.kts literals", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts/sh/catalog-coverage-check.sh"), "utf-8");
    // The regex/grep pattern must include *.gradle.kts scanning
    expect(script).toMatch(/\*\.gradle\.kts|"\*\.gradle\.kts"|gradle\.kts/);
    // And must match the hardcoded-literal pattern (implementation/api/etc + quoted triplet)
    expect(script).toMatch(/implementation\|api\|testImplementation|implementation.*api.*testImplementation/);
  });
});

// ── T-BUG-014: L0 CI template catches apple-side regressions ──────────────

describe("T-BUG-014: L0 CI template runs metadata compile + check --continue", () => {
  const CI_TEMPLATE = path.join(ROOT, "setup/github-workflows/ci-template.yml");

  it("ci-template.yml has explicit compileCommonMainKotlinMetadata step (T-BUG-014)", () => {
    const content = fs.readFileSync(CI_TEMPLATE, "utf-8");
    expect(content).toMatch(/T-BUG-014/);
    // The step must run the metadata compile task explicitly (not rely on
    // ./gradlew build doing it transitively, which it may skip on Linux runners
    // when apple targets are configured but K/N toolchain is unavailable)
    expect(content).toMatch(/compileCommonMainKotlinMetadata/);
  });

  it("ci-template.yml runs check with --continue (surfaces all failures, aligns with /pre-pr)", () => {
    const content = fs.readFileSync(CI_TEMPLATE, "utf-8");
    expect(content).toMatch(/gradlew check.*--continue|check --no-daemon --parallel --continue/);
  });

  it("ci-template.yml documents the apple-side gap rationale", () => {
    const content = fs.readFileSync(CI_TEMPLATE, "utf-8");
    // Comment must explain WHY the metadata compile step exists
    expect(content).toMatch(/CAST_NEVER_SUCCEEDS|apple.*regression|apple-side|non-macOS/i);
  });
});

// ── Regression guard: all docs/**/*.md frontmatter `sources` are strings ──

describe("frontmatter guard: docs sources are string entries (not objects)", () => {
  const DOCS_DIR = path.join(ROOT, "docs");

  function* walk(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "archive") continue;
        yield* walk(full);
      } else if (entry.name.endsWith(".md")) {
        yield full;
      }
    }
  }

  it("every doc with frontmatter has sources as array of strings", () => {
    const violations: string[] = [];
    for (const file of walk(DOCS_DIR)) {
      const text = fs.readFileSync(file, "utf-8");
      const fm = extractFrontmatter(text);
      if (!fm || !Array.isArray(fm.sources)) continue;
      for (const src of fm.sources as unknown[]) {
        if (typeof src !== "string") {
          violations.push(`${path.relative(ROOT, file)}: non-string source entry (${typeof src})`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
