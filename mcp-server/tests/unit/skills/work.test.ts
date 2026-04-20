import { describe, it, expect } from "vitest";

// Level 0.5 named-skill overrides — checked BEFORE Level 1 keyword scan.
// Mirrors skills/work/SKILL.md Level 0.5 table.
const LEVEL05_ROUTES: Array<{ pattern: RegExp; route: string }> = [
  { pattern: /material-3|material 3/i, route: "material-3-skill" },
  { pattern: /sync-vault/i, route: "sync-vault" },
  { pattern: /pre-pr/i, route: "pre-pr" },
  { pattern: /\bdebug\b/i, route: "debug" },
  { pattern: /\bresearch\b/i, route: "research" },
];

// Level 1 keyword routing table — mirrors skills/work/SKILL.md Level 1 table.
// \b word-boundary anchors added per 446652b — prevents substring false-matches.
// First-match-wins. Patterns are matched case-insensitively.
const LEVEL1_ROUTES: Array<{ pattern: RegExp; route: string }> = [
  { pattern: /\b(bug|error|fix|broken|crash)\b/i, route: "/debug" },
  { pattern: /\b(test|coverage|benchmark)\b/i, route: "test-specialist" },
  { pattern: /\b(review|PR|pull request)\b/i, route: "/review-pr" },
  { pattern: /\b(research|investigate|explore)\b/i, route: "/research" },
  { pattern: /\b(decide|choose|compare|tradeoff)\b/i, route: "/decide" },
  { pattern: /\b(verify|check spec|meets criteria)\b/i, route: "/verify" },
  { pattern: /\b(map|architecture|modules|inventory)\b/i, route: "/map-codebase" },
  { pattern: /\b(pre-pr|validate|ready to merge)\b/i, route: "/pre-pr" },
  { pattern: /\b(note|idea|remember)\b/i, route: "/note" },
  { pattern: /\b(audit|quality)\b/i, route: "/audit" },
  { pattern: /\b(doc|documentation|update docs)\b/i, route: "doc-updater" },
  { pattern: /\b(context|pattern|lookup|what exists)\b/i, route: "context-provider" },
  { pattern: /\b(ui|compose|screen|component)\b/i, route: "ui-specialist" },
  { pattern: /\b(domain|model|sealed|data class)\b/i, route: "domain-model-specialist" },
  { pattern: /\b(data layer|repository|encoding)\b/i, route: "data-layer-specialist" },
  { pattern: /\b(prioritize|roadmap|features|backlog)\b/i, route: "product-strategist" },
  { pattern: /\b(post|blog|social|marketing|content)\b/i, route: "content-creator" },
  { pattern: /\b(landing|page|conversion|copy|seo)\b/i, route: "landing-page-strategist" },
  { pattern: /\b(implement|feature|build|scope|plan|execute|wave)\b/i, route: "project-manager" },
];

export function resolveWorkRoute(input: string): string {
  for (const { pattern, route } of LEVEL05_ROUTES) {
    if (pattern.test(input)) return route;
  }
  for (const { pattern, route } of LEVEL1_ROUTES) {
    if (pattern.test(input)) return route;
  }
  return "project-manager"; // Level 2 fallback: act as PM in-process
}

describe("/work skill routing", () => {
  describe("Level 0.5 — named-skill override (fires before Level 1)", () => {
    it("Level 0.5: 'material 3 component audit' routes to material-3-skill, not /audit via Level 1", () => {
      const route = resolveWorkRoute("material 3 component audit");
      expect(route).toBe("material-3-skill");
      // Level 0.5 named-skill override fires before Level 1 audit|quality rule
    });

    it("Level 0.5: 'material-3 theme setup' routes to material-3-skill", () => {
      expect(resolveWorkRoute("material-3 theme setup")).toBe("material-3-skill");
    });

    it("Level 0.5: 'sync-vault after doc changes' routes to sync-vault, not doc-updater", () => {
      expect(resolveWorkRoute("sync-vault after doc changes")).toBe("sync-vault");
    });

    it("Level 0.5: 'pre-pr check before merging' routes to pre-pr, not /pre-pr via Level 1", () => {
      expect(resolveWorkRoute("pre-pr check before merging")).toBe("pre-pr");
    });

    it("Level 0.5: 'debug the crash' routes to debug skill, not /debug via Level 1", () => {
      expect(resolveWorkRoute("debug the crash")).toBe("debug");
    });

    it("Level 0.5: 'research coroutines patterns' routes to research skill, not /research via Level 1", () => {
      expect(resolveWorkRoute("research coroutines patterns")).toBe("research");
    });
  });

  describe("Level 1 — keyword routing — first-match-wins", () => {
    it('routes "fix flaky test in ViewModelTest" to /debug', () => {
      // "fix" matches row 1 (/bug|error|fix|broken|crash/) before "test" at row 2
      expect(resolveWorkRoute("fix flaky test in ViewModelTest")).toBe("/debug");
    });

    it('routes "investigate coverage gap in DataLayer" to test-specialist', () => {
      // "coverage" matches row 2 before "investigate" at row 4
      expect(resolveWorkRoute("investigate coverage gap in DataLayer")).toBe("test-specialist");
    });

    it('routes "review PR #45" to /review-pr', () => {
      expect(resolveWorkRoute("review PR #45")).toBe("/review-pr");
    });

    it('routes "implement new feature for wave 21" to project-manager', () => {
      expect(resolveWorkRoute("implement new feature for wave 21")).toBe("project-manager");
    });

    it('routes "update docs for sync-vault" to sync-vault via Level 0.5', () => {
      // "sync-vault" is a Level 0.5 named-skill — fires before Level 1 "doc" rule
      expect(resolveWorkRoute("update docs for sync-vault")).toBe("sync-vault");
    });

    it('routes "compose screen accessibility" to ui-specialist', () => {
      // "compose" matches ui rule (row 13) — input avoids "audit" substring
      expect(resolveWorkRoute("compose screen accessibility")).toBe("ui-specialist");
    });

    it('routes "compose screen accessibility audit" to /audit due to row ordering', () => {
      // "audit" at row 10 fires before "compose"/"screen" at row 13 (first-match-wins)
      // This documents a known ordering consequence in the SKILL.md routing table
      expect(resolveWorkRoute("compose screen accessibility audit")).toBe("/audit");
    });

    it('routes "what pattern exists for repository encoding" to context-provider', () => {
      // "pattern" matches row 12 (/context|pattern|lookup|what exists/)
      expect(resolveWorkRoute("what pattern exists for repository encoding")).toBe("context-provider");
    });
  });

  describe("T-BUG-010 regression — project-manager must be in-process, never Agent()", () => {
    it("T-BUG-010: implement/feature/wave routes to project-manager in-process, never Agent()", () => {
      const route = resolveWorkRoute("implement new feature for wave 21");
      expect(route).toBe("project-manager");
      // Documented: project-manager route = read .claude/agents/project-manager.md and act in-process
      // NEVER Agent("project-manager") — sub-agents cannot TeamCreate or spawn reliably
    });

    it("T-BUG-010: 'scope' keyword routes to project-manager", () => {
      // "scope the migration task" — no earlier-row substring collisions
      expect(resolveWorkRoute("scope the migration task")).toBe("project-manager");
    });

    it("T-BUG-010: 'wave' keyword routes to project-manager", () => {
      // "launch wave 22" — no earlier-row collisions
      expect(resolveWorkRoute("launch wave 22")).toBe("project-manager");
    });

    it("T-BUG-010: 'plan' keyword routes to project-manager", () => {
      // "plan the deployment" — no earlier-row collisions
      expect(resolveWorkRoute("plan the deployment")).toBe("project-manager");
    });

    it("T-BUG-010: 'execute' keyword routes to project-manager", () => {
      // "go execute the tasks" — no earlier-row collisions
      expect(resolveWorkRoute("go execute the tasks")).toBe("project-manager");
    });

    it("T-BUG-010: 'build a new feature' routes to project-manager (446652b fix — was ui-specialist via build→ui substring)", () => {
      // Pre-fix: bare /ui|compose|.../ matched "bu*il*d" as substring → ui-specialist
      // Post-fix: \b(ui|compose|...)\b requires whole word → "build" falls through to project-manager row
      expect(resolveWorkRoute("build a new feature")).toBe("project-manager");
    });

    it("T-BUG-010: 'plan the next sprint' routes to project-manager (446652b fix — was /review-pr via sprint→pr substring)", () => {
      // Pre-fix: bare /review|PR|.../ matched "s*pr*int" as substring → /review-pr
      // Post-fix: \b(review|PR|...)\b requires whole word → "sprint" falls through to project-manager row
      expect(resolveWorkRoute("plan the next sprint")).toBe("project-manager");
    });
  });

  describe("ordering — earlier rules take priority", () => {
    it('"test" matches test-specialist before /debug even when no bug/fix keyword', () => {
      expect(resolveWorkRoute("test the new screen")).toBe("test-specialist");
    });

    it('"audit" matches /audit before ui-specialist (row 10 before row 13)', () => {
      // Confirms that inputs containing both "audit" and "compose"/"screen" route to /audit
      expect(resolveWorkRoute("audit the compose screens")).toBe("/audit");
    });

    it('"research" as Level 0.5 named-skill routes to research skill, not /research Level 1', () => {
      expect(resolveWorkRoute("research the lookup strategy")).toBe("research");
    });

    it('"coverage" matches test-specialist before "investigate" matches /research', () => {
      expect(resolveWorkRoute("investigate coverage gaps")).toBe("test-specialist");
    });
  });
});
