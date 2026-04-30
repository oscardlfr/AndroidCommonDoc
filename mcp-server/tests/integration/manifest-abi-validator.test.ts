/**
 * Integration tests for the manifest ABI/API stability validator (BL-W31.7-11).
 *
 * Strategy: Path B -- real tmp git repo fixtures. No vi.mock on child_process.
 * Each test that requires git writes a commit, mutates the manifest on disk,
 * then calls diffManifestAbi() against the HEAD commit.
 *
 * Inline teardown only (NOT afterEach) -- required per arch-testing dispatch.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diffManifestAbi,
  classifyFieldChange,
  loadBaselineManifest,
  AbiBaselineError,
} from "../../src/registry/manifest-abi-validator.js";

// -- Git fixture helpers -------------------------------------------------------

const MANIFEST_REL = ".claude/registry/agents.manifest.yaml";

function makeGitRepo(baselineYaml: string): string {
  const tmpRepo = mkdtempSync(join(tmpdir(), "abi-baseline-"));
  execSync("git init", { cwd: tmpRepo, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmpRepo, stdio: "pipe" });
  execSync("git config user.name test", { cwd: tmpRepo, stdio: "pipe" });
  mkdirSync(join(tmpRepo, ".claude/registry"), { recursive: true });
  writeFileSync(join(tmpRepo, MANIFEST_REL), baselineYaml);
  execSync("git add -A && git commit -m baseline", {
    cwd: tmpRepo,
    stdio: "pipe",
    shell: "bash",
  });
  return tmpRepo;
}

function buildMinimalManifest(agentYamlBlock: string, invariantsYaml = "invariants: []"): string {
  return [
    "manifest:",
    "  version: 1",
    '  generated_at: "2026-04-30"',
    invariantsYaml,
    "agents:",
    agentYamlBlock,
    "",
  ].join("\n");
}

function agentBlock(name: string, overrides: Record<string, string> = {}): string {
  const toolsAllowed = overrides.toolsAllowed ?? "        - Read\n        - Write";
  const dispatchedBy = overrides.dispatchedBy ?? "        - team-lead";
  const canSendTo = overrides.canSendTo ?? "        - arch-testing";
  const model = overrides.model ?? "sonnet";
  const tokenBudget = overrides.tokenBudget ?? "4000";
  const description = overrides.description ?? (name + " description");
  const sha = overrides.sha ?? "";
  const templateVersion = overrides.templateVersion ?? "1.0.0";
  const applicableProjectTypes = overrides.applicableProjectTypes ?? "";
  const intent = overrides.intent ?? "";
  const bannedTopLevel = overrides.bannedTopLevel ?? "";
  const bannedGrepPatterns = overrides.bannedGrepPatterns ?? "";
  const bannedReadPatterns = overrides.bannedReadPatterns ?? "";

  let block = [
    "  " + name + ":",
    "    canonical_name: " + name,
    "    subagent_type: " + name,
    '    template_version: "' + templateVersion + '"',
    "    category: core-specialist",
    "    lifecycle: ephemeral",
    '    description: "' + description + '"',
    '    template_frontmatter_sha256: "' + sha + '"',
    "    runtime:",
    "      model: " + model,
    "      token_budget: " + tokenBudget,
    "    tools:",
    "      allowed:",
    toolsAllowed,
  ].join("\n") + "\n";

  if (bannedTopLevel || bannedGrepPatterns || bannedReadPatterns) {
    block += "      banned:\n";
    if (bannedTopLevel) block += "        top_level:\n" + bannedTopLevel;
    if (bannedGrepPatterns) block += "        grep_patterns:\n" + bannedGrepPatterns;
    if (bannedReadPatterns) block += "        read_patterns:\n" + bannedReadPatterns;
  }

  block += [
    "    dispatch:",
    "      spawn_method: Agent",
    "      dispatched_by:",
    dispatchedBy,
    "      can_send_to:",
    canSendTo,
    "",
  ].join("\n");

  if (applicableProjectTypes) block += "    applicable_project_types:\n" + applicableProjectTypes;
  if (intent) block += "    intent:\n" + intent;

  return block;
}

// -- classifyFieldChange unit cases -------------------------------------------

describe("classifyFieldChange -- per-field classification", () => {
  it("1. tools.allowed add -> ADDITIVE", () => {
    const changes = classifyFieldChange("tools.allowed", ["Read"], ["Read", "Write"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("ADDITIVE");
    expect(changes[0].operation).toBe("add");
  });

  it("2. tools.allowed remove -> BREAKING", () => {
    const changes = classifyFieldChange("tools.allowed", ["Read", "Write"], ["Read"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
    expect(changes[0].operation).toBe("remove");
  });

  it("3. tools.allowed reorder -> NEUTRAL", () => {
    const changes = classifyFieldChange("tools.allowed", ["Read", "Write"], ["Write", "Read"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("NEUTRAL");
    expect(changes[0].operation).toBe("reorder");
  });

  it("4. tools.banned.top_level add -> ADDITIVE", () => {
    const changes = classifyFieldChange("tools.banned.top_level", [], ["Bash"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("ADDITIVE");
    expect(changes[0].operation).toBe("add");
  });

  it("5. tools.banned.top_level remove -> BREAKING", () => {
    const changes = classifyFieldChange("tools.banned.top_level", ["Bash"], []);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
    expect(changes[0].operation).toBe("remove");
  });

  it("6. tools.banned.grep_patterns add -> ADDITIVE", () => {
    const changes = classifyFieldChange("tools.banned.grep_patterns", [], ["rg"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("ADDITIVE");
  });

  it("7. tools.banned.read_patterns remove -> BREAKING", () => {
    const changes = classifyFieldChange("tools.banned.read_patterns", ["docs/**"], []);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
    expect(changes[0].operation).toBe("remove");
  });

  it("8. dispatch.dispatched_by add -> ADDITIVE", () => {
    const changes = classifyFieldChange("dispatch.dispatched_by", ["team-lead"], ["team-lead", "arch-testing"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("ADDITIVE");
  });

  it("9. dispatch.dispatched_by remove -> BREAKING", () => {
    const changes = classifyFieldChange("dispatch.dispatched_by", ["team-lead", "arch-testing"], ["team-lead"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
    expect(changes[0].operation).toBe("remove");
  });

  it("10. dispatch.dispatched_by reorder -> NEUTRAL", () => {
    const changes = classifyFieldChange("dispatch.dispatched_by", ["team-lead", "arch-testing"], ["arch-testing", "team-lead"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("NEUTRAL");
    expect(changes[0].operation).toBe("reorder");
  });

  it("11. dispatch.can_send_to star -> list = BREAKING", () => {
    const changes = classifyFieldChange("dispatch.can_send_to", "*", ["arch-testing"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
    expect(changes[0].field).toBe("dispatch.can_send_to");
  });

  it("12. dispatch.can_send_to list -> star = ADDITIVE", () => {
    const changes = classifyFieldChange("dispatch.can_send_to", ["arch-testing"], "*");
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("ADDITIVE");
  });

  it("13. dispatch.can_send_to star -> star = NEUTRAL (no change)", () => {
    const changes = classifyFieldChange("dispatch.can_send_to", "*", "*");
    expect(changes).toHaveLength(0);
  });

  it("14. applicable_project_types add -> ADDITIVE", () => {
    const changes = classifyFieldChange("applicable_project_types", ["android"], ["android", "kmp"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("ADDITIVE");
  });

  it("15. applicable_project_types remove -> BREAKING", () => {
    const changes = classifyFieldChange("applicable_project_types", ["android", "kmp"], ["android"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
  });

  it("16. applicable_project_types absent to [any] = NEUTRAL (no change)", () => {
    const changes = classifyFieldChange("applicable_project_types", undefined, ["any"]);
    expect(changes).toHaveLength(0);
  });

  it("17. applicable_project_types absent to [node] = BREAKING (normalize: absent->any, then any->node = remove+add)", () => {
    // absent normalizes to ["any"], so diff is ["any"] -> ["node"]:
    // remove "any" (BREAKING) + add "node" (ADDITIVE) = 2 changes, at least 1 BREAKING.
    const changes = classifyFieldChange("applicable_project_types", undefined, ["node"]);
    expect(changes.length).toBeGreaterThanOrEqual(1);
    const breakingChanges = changes.filter((c) => c.severity === "BREAKING");
    expect(breakingChanges.length).toBeGreaterThan(0);
  });

  it("18. applicable_project_types [any] to absent = NEUTRAL (no change)", () => {
    const changes = classifyFieldChange("applicable_project_types", ["any"], undefined);
    expect(changes).toHaveLength(0);
  });

  it("19. intent add -> ADDITIVE", () => {
    const changes = classifyFieldChange("intent", ["audit"], ["audit", "review"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("ADDITIVE");
  });

  it("20. intent remove -> BREAKING", () => {
    const changes = classifyFieldChange("intent", ["audit", "review"], ["audit"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
  });

  it("21. runtime.model change -> BREAKING", () => {
    const changes = classifyFieldChange("runtime.model", "sonnet", "haiku");
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
    expect(changes[0].operation).toBe("change");
  });

  it("22. runtime.token_budget increase -> ADDITIVE", () => {
    const changes = classifyFieldChange("runtime.token_budget", 4000, 8000);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("ADDITIVE");
  });

  it("23. runtime.token_budget decrease -> BREAKING", () => {
    const changes = classifyFieldChange("runtime.token_budget", 8000, 4000);
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("BREAKING");
  });

  it("24. description change -> NEUTRAL", () => {
    const changes = classifyFieldChange("description", "old desc", "new desc");
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("NEUTRAL");
  });

  it("25. template_frontmatter_sha256 change -> NEUTRAL", () => {
    const changes = classifyFieldChange("template_frontmatter_sha256", "abc123", "def456");
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("NEUTRAL");
  });

  it("26. template_version bump alone -> NEUTRAL", () => {
    const changes = classifyFieldChange("template_version", "1.0.0", "1.1.0");
    expect(changes).toHaveLength(1);
    expect(changes[0].severity).toBe("NEUTRAL");
  });
});

// -- Agent-level diff via git fixture -----------------------------------------

describe("diffManifestAbi -- agent-level changes", () => {
  it("27. agent added -> AbiAgentDiff.kind = added", () => {
    const baseline = buildMinimalManifest(agentBlock("test-specialist"));
    const tmpRepo = makeGitRepo(baseline);
    try {
      const head = buildMinimalManifest(
        agentBlock("test-specialist") + agentBlock("doc-updater"),
      );
      writeFileSync(join(tmpRepo, MANIFEST_REL), head);

      const result = diffManifestAbi({ projectRoot: tmpRepo, baselineRef: "HEAD" });

      const added = result.diffs.find((d) => d.agent === "doc-updater");
      expect(added).toBeDefined();
      expect(added!.kind).toBe("added");
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("28. agent removed -> AbiAgentDiff.kind = removed, BREAKING", () => {
    const baseline = buildMinimalManifest(
      agentBlock("test-specialist") + agentBlock("doc-updater"),
    );
    const tmpRepo = makeGitRepo(baseline);
    try {
      const head = buildMinimalManifest(agentBlock("test-specialist"));
      writeFileSync(join(tmpRepo, MANIFEST_REL), head);

      const result = diffManifestAbi({ projectRoot: tmpRepo, baselineRef: "HEAD" });

      const removed = result.diffs.find((d) => d.agent === "doc-updater");
      expect(removed).toBeDefined();
      expect(removed!.kind).toBe("removed");
      expect(result.status).toBe("FAIL");
      expect(result.totalsBySeverity.BREAKING).toBeGreaterThan(0);
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("29. agent renamed (remove + add) -> two entries: removed + added", () => {
    const baseline = buildMinimalManifest(agentBlock("test-specialist"));
    const tmpRepo = makeGitRepo(baseline);
    try {
      const head = buildMinimalManifest(agentBlock("test-specialist-v2"));
      writeFileSync(join(tmpRepo, MANIFEST_REL), head);

      const result = diffManifestAbi({ projectRoot: tmpRepo, baselineRef: "HEAD" });

      const removed = result.diffs.find((d) => d.agent === "test-specialist" && d.kind === "removed");
      const added = result.diffs.find((d) => d.agent === "test-specialist-v2" && d.kind === "added");
      expect(removed).toBeDefined();
      expect(added).toBeDefined();
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });
});

// -- Baseline loading ----------------------------------------------------------

describe("loadBaselineManifest", () => {
  it("30. loads from git ref (baselineRef=HEAD)", () => {
    const baseline = buildMinimalManifest(agentBlock("test-specialist"));
    const tmpRepo = makeGitRepo(baseline);
    try {
      const { manifest, source } = loadBaselineManifest({ projectRoot: tmpRepo, baselineRef: "HEAD" });
      expect(manifest).toBeDefined();
      expect(source.ref).toBe("HEAD");
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("31. loads from file when baselineFile is provided", () => {
    const baseline = buildMinimalManifest(agentBlock("test-specialist"));
    const tmpRepo = makeGitRepo(baseline);
    try {
      const baselineFilePath = join(tmpRepo, MANIFEST_REL);
      const { manifest, source } = loadBaselineManifest({ projectRoot: tmpRepo, baselineFile: baselineFilePath });
      expect(manifest).toBeDefined();
      expect(source.file).toBe(baselineFilePath);
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("32. ref that does not exist -> throws AbiBaselineError mentioning the ref name", () => {
    // Production code throws AbiBaselineError for any git failure (unknown ref or manifest missing).
    // The message will contain either "does not exist" (refNotFound path) or
    // "Manifest file not found at ref" (fallback path) depending on platform git error text.
    const baseline = buildMinimalManifest(agentBlock("test-specialist"));
    const tmpRepo = makeGitRepo(baseline);
    try {
      let caught: unknown;
      try {
        loadBaselineManifest({ projectRoot: tmpRepo, baselineRef: "nonexistent-branch-xyz-9999" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AbiBaselineError);
      const msg = (caught as AbiBaselineError).message;
      // Must mention the ref in the error message (either path).
      expect(msg).toContain("nonexistent-branch-xyz-9999");
      expect((caught as AbiBaselineError).exitCode).toBe(2);
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });
});

// -- Special cases -------------------------------------------------------------

describe("diffManifestAbi -- special cases", () => {
  it("33. invariants block change -> single BREAKING AbiChange", () => {
    const baselineInvariants = [
      "invariants:",
      "  - id: NAMING_CONVENTION",
      '    description: "canonical name must match pattern"',
    ].join("\n");
    const baseline = buildMinimalManifest(agentBlock("test-specialist"), baselineInvariants);
    const tmpRepo = makeGitRepo(baseline);
    try {
      const changedInvariants = [
        "invariants:",
        "  - id: NAMING_CONVENTION",
        '    description: "canonical name must match pattern - updated"',
      ].join("\n");
      const head = buildMinimalManifest(agentBlock("test-specialist"), changedInvariants);
      writeFileSync(join(tmpRepo, MANIFEST_REL), head);

      const result = diffManifestAbi({ projectRoot: tmpRepo, baselineRef: "HEAD" });

      expect(result.invariantsChange).toBeDefined();
      expect(result.invariantsChange!.severity).toBe("BREAKING");
      expect(result.invariantsChange!.field).toBe("invariants");
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("34. includeNeutral=false filters NEUTRAL changes from output", () => {
    const baseline = buildMinimalManifest(
      agentBlock("test-specialist", { description: "old description" }),
    );
    const tmpRepo = makeGitRepo(baseline);
    try {
      const head = buildMinimalManifest(
        agentBlock("test-specialist", { description: "new description" }),
      );
      writeFileSync(join(tmpRepo, MANIFEST_REL), head);

      const resultWithout = diffManifestAbi({ projectRoot: tmpRepo, baselineRef: "HEAD", includeNeutral: false });
      const resultWith = diffManifestAbi({ projectRoot: tmpRepo, baselineRef: "HEAD", includeNeutral: true });

      const neutralsWithout = resultWithout.diffs.flatMap((d) => d.changes.filter((c) => c.severity === "NEUTRAL"));
      const neutralsWith = resultWith.diffs.flatMap((d) => d.changes.filter((c) => c.severity === "NEUTRAL"));

      expect(neutralsWithout).toHaveLength(0);
      expect(neutralsWith.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("35. multi-field diff: totalsBySeverity sums correctly across multiple field changes", () => {
    const baseline = buildMinimalManifest(
      agentBlock("test-specialist", { toolsAllowed: "        - Read", model: "sonnet", description: "old desc" }),
    );
    const tmpRepo = makeGitRepo(baseline);
    try {
      const head = buildMinimalManifest(
        agentBlock("test-specialist", {
          toolsAllowed: "        - Read\n        - Write",
          model: "haiku",
          description: "new desc",
        }),
      );
      writeFileSync(join(tmpRepo, MANIFEST_REL), head);

      const result = diffManifestAbi({ projectRoot: tmpRepo, baselineRef: "HEAD", includeNeutral: true });

      const totals = result.totalsBySeverity;
      const summed = totals.BREAKING + totals.ADDITIVE + totals.NEUTRAL;
      const countedFromDiffs = result.diffs.reduce((acc, d) => acc + d.changes.length, 0);
      const invariantsCount = result.invariantsChange ? 1 : 0;
      expect(summed).toBe(countedFromDiffs + invariantsCount);

      expect(totals.BREAKING).toBeGreaterThan(0);
      expect(totals.ADDITIVE).toBeGreaterThan(0);
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });
});
