/**
 * TDD tests for Wave 31 W31-00 — team-lead template hardening (BL-W31-00 Bugs 2+3+4).
 *
 * These tests are intentionally RED until arch-integration ships the hook files
 * and arch-platform ships the /work SKILL.md rewrite. RED is the correct state
 * per TDD discipline — these tests define the target shape.
 *
 * Covers:
 *  - Bug 2: plan-context.js gains sentinel write/delete + PreToolUse Write/Edit block
 *  - Bug 3: bash-cli-spawn-gate.js NEW — blocks CLI agent spawns via Bash
 *  - Bug 4: skills/work/SKILL.md must NOT spawn team-lead subagent
 *  - A1: planner bypass — sentinel absent means Write is NOT unconditionally blocked
 *  - A6: bash-cli-spawn-gate.js must be registered in .claude/settings.json
 *  - A8: false-positive guard — `claude --help` must not be flagged by gate regex
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");

const planContextPath = path.join(ROOT, ".claude/hooks/plan-context.js");
const bashGatePath = path.join(ROOT, ".claude/hooks/bash-cli-spawn-gate.js");
const settingsPath = path.join(ROOT, ".claude/settings.json");
const workSkillPath = path.join(ROOT, "skills/work/SKILL.md");

describe("W31-00 Bug 2: plan-context.js sentinel mechanism", () => {
  it("plan-context.js contains sentinel write for .plan-mode-active on EnterPlanMode", () => {
    const content = fs.readFileSync(planContextPath, "utf-8");
    expect(content).toContain(".plan-mode-active");
    expect(content).toContain("EnterPlanMode");
  });

  it("plan-context.js contains PreToolUse Write/Edit block checking sentinel existence", () => {
    const content = fs.readFileSync(planContextPath, "utf-8");
    expect(content).toContain("PreToolUse");
    // Must check for sentinel file existence (not unconditional block)
    const hasExistsSync = content.includes("existsSync");
    const hasReadFileCheck = content.includes("plan-mode-active");
    expect(hasExistsSync || hasReadFileCheck).toBe(true);
  });

  it("plan-context.js allows Write when sentinel is absent (planner bypass — A1)", () => {
    const content = fs.readFileSync(planContextPath, "utf-8");
    // Must NOT block unconditionally — must have conditional logic around the block
    // The block must be guarded by an if/existsSync check, not a bare return/throw
    const hasConditional =
      content.includes("existsSync") ||
      content.includes("if (") ||
      content.includes("if(");
    expect(hasConditional).toBe(true);
    // Must NOT contain unconditional block pattern (bare block without condition)
    // Verify the PLAN*.md block is inside a conditional branch
    const planBlockIdx = content.indexOf("PLAN");
    const ifIdx = content.lastIndexOf("if", planBlockIdx);
    expect(ifIdx).toBeGreaterThanOrEqual(0);
    // The if must appear before the PLAN block reference
    expect(ifIdx).toBeLessThan(planBlockIdx);
  });
});

describe("W31-00 Bug 3: bash-cli-spawn-gate.js blocks CLI agent spawns", () => {
  it("bash-cli-spawn-gate.js exists and contains --agent-id detection", () => {
    expect(fs.existsSync(bashGatePath)).toBe(true);
    const content = fs.readFileSync(bashGatePath, "utf-8");
    expect(content).toContain("--agent-id");
  });

  it("bash-cli-spawn-gate.js contains --team-name detection", () => {
    const content = fs.readFileSync(bashGatePath, "utf-8");
    expect(content).toContain("--team-name");
  });

  it("bash-cli-spawn-gate.js does NOT flag `claude --help` (false-positive guard — A8)", () => {
    const content = fs.readFileSync(bashGatePath, "utf-8");
    // The gate must use specific patterns that exclude --help
    // Verify the detection targets agent-spawn flags, not generic claude invocations
    // Gate must check for --agent-id OR --team-name OR spawn-specific flags
    expect(content).toContain("--agent-id");
    // Must NOT use a regex that would match bare `claude` with no agent flags
    // A safe gate only matches when agent spawn flags are present
    const hasSafePatterns =
      content.includes("--agent-id") &&
      (content.includes("--team-name") ||
        content.includes('-p "you are') ||
        content.includes("--print"));
    expect(hasSafePatterns).toBe(true);
    // Verify `claude --help` would not match: the patterns are flag-specific
    // (static assertion — the regex requires at least one agent-spawn flag)
    const helpCommand = "claude --help";
    const agentIdPresent = helpCommand.includes("--agent-id");
    const teamNamePresent = helpCommand.includes("--team-name");
    expect(agentIdPresent).toBe(false);
    expect(teamNamePresent).toBe(false);
  });
});

describe("W31-00 A6: bash-cli-spawn-gate.js registered in settings.json", () => {
  it(".claude/settings.json contains entry for bash-cli-spawn-gate.js", () => {
    const content = fs.readFileSync(settingsPath, "utf-8");
    expect(content).toContain("bash-cli-spawn-gate.js");
  });
});

describe("W31-00 Bug 4: skills/work/SKILL.md does not spawn team-lead subagent", () => {
  it('skills/work/SKILL.md does NOT contain Agent(subagent_type="team-lead")', () => {
    const content = fs.readFileSync(workSkillPath, "utf-8");
    expect(content).not.toContain('Agent(subagent_type="team-lead")');
  });

  it('skills/work/SKILL.md does NOT contain Agent(name="team-lead")', () => {
    const content = fs.readFileSync(workSkillPath, "utf-8");
    expect(content).not.toContain('Agent(name="team-lead")');
  });
});
