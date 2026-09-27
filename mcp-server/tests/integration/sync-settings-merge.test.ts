/**
 * Integration tests for mergeHookRegistrations() — F1 BL-W47-prep-11.
 *
 * Pattern B (direct import) per arch-testing — faster than subprocess.
 * Mirrors sync-migration-integration.test.ts style.
 *
 * Covers 8 arch-testing assertions:
 *   1. permissions.deny untouched
 *   2. PostToolUse 3 blocks untouched
 *   3. PreToolUse Bash: existing hooks preserved + L0 entries appended
 *   4. PreToolUse Write|Edit block created with correct L0 entries
 *   5. PreToolUse TaskUpdate block created with correct L0 entry
 *   6. Grep|Glob|Bash|Read combined matcher unchanged
 *   7. Idempotency: second call produces no duplicates
 *   8. Malformed/unreadable JSON: fail closed and preserve consumer bytes
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { mergeHookRegistrations } from "../../src/sync/sync-engine.js";

// ---------------------------------------------------------------------------
// Fixture — mirrors real L1 settings.json structure
// ---------------------------------------------------------------------------

/** Full L1-like settings.json: permissions block + 3 PostToolUse + 2 PreToolUse blocks */
const FULL_L1_SETTINGS = {
  permissions: {
    allow: [
      "Bash(adb devices)",
      "Bash(adb -s * shell input *)",
    ],
    deny: [
      "Bash(rm -rf *)",
      "Bash(git push --force *)",
      "Bash(git checkout main)",
    ],
  },
  hooks: {
    PostToolUse: [
      {
        matcher: "Write|Edit",
        hooks: [
          {
            type: "command",
            command: "\"$ANDROID_COMMON_DOC\"/.claude/hooks/detekt-post-write.sh",
            timeout: 30,
          },
        ],
      },
      {
        matcher: ".*",
        hooks: [
          {
            type: "command",
            command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-use-logger.js",
            timeout: 5,
          },
        ],
      },
      {
        matcher: "SendMessage",
        hooks: [
          {
            type: "command",
            command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/context-provider-consulted.js",
            timeout: 5,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Grep|Glob|Bash|Read",
        hooks: [
          {
            type: "command",
            command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/context-provider-gate.js",
            timeout: 5,
          },
        ],
      },
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "\"$ANDROID_COMMON_DOC\"/.claude/hooks/detekt-pre-commit.sh",
            timeout: 60,
          },

        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeSettings(dir: string, settings: unknown): Promise<void> {
  const claudeDir = join(dir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

async function readSettings(dir: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

type MatcherBlock = { matcher: string; hooks: Array<{ command: string }> };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mergeHookRegistrations()", () => {
  let fixtureDir: string;

  beforeEach(async () => {
    fixtureDir = await (await import("node:fs/promises")).mkdtemp(join(tmpdir(), "sync-settings-merge-"));
  });

  afterEach(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  // Assertion 1: permissions.deny untouched
  it("never touches permissions.allow or permissions.deny", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const permissions = settings.permissions as typeof FULL_L1_SETTINGS.permissions;

    expect(permissions).toBeDefined();
    expect(permissions.deny).toEqual(FULL_L1_SETTINGS.permissions.deny);
    expect(permissions.allow).toEqual(FULL_L1_SETTINGS.permissions.allow);
  });

  // Assertion 2: project blocks stay unchanged while the owned Detekt hook converges.
  it("converges the owned Detekt PostToolUse command without disturbing project blocks", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const postToolUse = (settings.hooks as Record<string, unknown>)["PostToolUse"];

    expect(postToolUse).toHaveLength(3);
    expect(postToolUse[0].hooks).toEqual([{
      type: "command",
      command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/detekt-post-write.sh',
      timeout: 30,
    }]);
    expect(postToolUse.slice(1)).toEqual(FULL_L1_SETTINGS.hooks.PostToolUse.slice(1));
  });

  // Assertion 3: existing Bash entries preserved + L0 entries appended
  it("appends L0 Bash entries to existing Bash block without removing project hooks", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    const bashBlock = preToolUse.find((b) => b.matcher === "Bash");

    expect(bashBlock).toBeDefined();
    const cmds = bashBlock!.hooks.map((h) => h.command);

    // Original project hooks preserved
    expect(cmds.some((c) => c.includes("detekt-pre-commit.sh"))).toBe(true);
    // L0 enforcement hooks appended to Bash block (Commits 10a/10b moved
    // team-completeness-gate + premature-execution-gate to Write|Edit|Bash matcher)
    expect(cmds.some((c) => c.includes("branch-guard.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("push-authorization-gate.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("commit-scope-validation-gate.js"))).toBe(true);
  });

  it("converges and deduplicates owned registrations, including bash-cli-spawn-gate through the launcher", async () => {
    await writeSettings(fixtureDir, {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [
            { type: "command", command: '"$ANDROID_COMMON_DOC"/.claude/hooks/detekt-pre-commit.sh', timeout: 60 },
            { type: "command", command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/detekt-pre-commit.sh', timeout: 60 },
            { type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/bash-cli-spawn-gate.js', timeout: 5 },
          ] },
          { matcher: "Bash", hooks: [
            { type: "command", command: 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/bash-cli-spawn-gate.js', timeout: 5 },
          ] },
        ],
      },
    });

    await mergeHookRegistrations(fixtureDir, false, realpathSync(join(import.meta.dirname, "..", "..", "..")));
    const settings = await readSettings(fixtureDir);
    const commands = Object.values(settings.hooks as Record<string, MatcherBlock[]>).flatMap((blocks) =>
      blocks.flatMap((block) => block.hooks.map((hook) => hook.command)));
    expect(commands.filter((command) => command.includes("detekt-pre-commit.sh"))).toEqual([
      '"$CLAUDE_PROJECT_DIR"/.claude/hooks/detekt-pre-commit.sh',
    ]);
    expect(commands.filter((command) => command.includes("bash-cli-spawn-gate.js"))).toEqual([
      'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js bash-cli-spawn-gate.js',
    ]);
  });

  // Assertion 4: Write|Edit|Bash block CREATED with correct L0 entries
  // (Commits 10a/10b consolidated Write|Edit into Write|Edit|Bash)
  it("creates Write|Edit|Bash PreToolUse block with team-completeness-gate + premature-execution-gate", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    const writeEditBlock = preToolUse.find((b) => b.matcher === "Write|Edit|Bash");

    expect(writeEditBlock).toBeDefined();
    const cmds = writeEditBlock!.hooks.map((h) => h.command);
    expect(cmds.some((c) => c.includes("team-completeness-gate.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("premature-execution-gate.js"))).toBe(true);
  });

  // Assertion 5: TaskUpdate block CREATED with specialist-task-completion-gate
  it("creates TaskUpdate PreToolUse block with specialist-task-completion-gate.js", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    const taskUpdateBlock = preToolUse.find((b) => b.matcher === "TaskUpdate");

    expect(taskUpdateBlock).toBeDefined();
    const cmds = taskUpdateBlock!.hooks.map((h) => h.command);
    expect(cmds.some((c) => c.includes("specialist-task-completion-gate.js"))).toBe(true);
  });

  // Assertion 6: source-coupled requester gate converges to the launcher.
  it("converges the Grep|Glob|Bash|Read requester gate to the portable launcher", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    const cpBlock = preToolUse.find((b) => b.matcher === "Grep|Glob|Bash|Read");

    expect(cpBlock).toBeDefined();
    expect(cpBlock!.hooks.map((hook) => hook.command)).toEqual([
      'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js context-provider-gate.js',
    ]);
  });

  // M7/WP4 (dispatch arch-testing-20260808T142647Z, Section 6): four additive L0
  // hook registrations gain exact entries in L0_REQUIRED_HOOK_REGISTRATIONS --
  // context-provider-gate.js (requester gate, re-registered under its own
  // existing matcher), runtime-consultation-target-gate.js (target gate),
  // context-provider-write-gate.js (CP bundle grammar gate), and
  // subagent-start-context-bundle.js (existing SubagentStart capture hook).
  // Total required registrations: 10 (6 pre-existing + 4 new).

  it("M7/WP4: migrates the pre-existing local context-provider gate to one portable registration", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    const result = await mergeHookRegistrations(fixtureDir);

    const matchedSkip = result.skipped.filter(
      (s) => s.matcher === "Grep|Glob|Bash|Read" && s.file === "context-provider-gate.js",
    );
    expect(matchedSkip).toHaveLength(0);
    expect(result.added.some((a) => a.file === "context-provider-gate.js")).toBe(true);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    const cpBlock = preToolUse.find((b) => b.matcher === "Grep|Glob|Bash|Read");
    const cpCmds = cpBlock!.hooks.map((h) => h.command);
    expect(cpCmds.filter((c) => c.includes("context-provider-gate.js"))).toHaveLength(1);
    expect(cpCmds[0]).toContain("l0-source-hook-launcher.js context-provider-gate.js");
  });

  it("M7/WP4: appends runtime-consultation-target-gate.js AND context-provider-write-gate.js to the existing Bash block, alongside branch-guard/push-authorization/commit-scope, without disturbing detekt-pre-commit.sh or creating a second Bash block", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    const bashBlocks = preToolUse.filter((b) => b.matcher === "Bash");
    expect(bashBlocks).toHaveLength(1);
    const cmds = bashBlocks[0].hooks.map((h) => h.command);

    expect(cmds.some((c) => c.includes("detekt-pre-commit.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("runtime-consultation-target-gate.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("context-provider-write-gate.js"))).toBe(true);
    expect(cmds.length).toBe(new Set(cmds).size);
  });

  it("M7/WP4: creates a SubagentStart block with matcher '.*' registering subagent-start-context-bundle.js (no SubagentStart key exists in the fixture at all)", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);
    expect((FULL_L1_SETTINGS.hooks as Record<string, unknown>)["SubagentStart"]).toBeUndefined();

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const subagentStart = (settings.hooks as Record<string, MatcherBlock[]>)["SubagentStart"];
    expect(subagentStart).toBeDefined();
    const block = subagentStart.find((b) => b.matcher === ".*");
    expect(block).toBeDefined();
    expect(block!.hooks.some((h) => h.command.includes("subagent-start-context-bundle.js"))).toBe(true);
  });

  it("M7/WP4: second call after all four new entries already exist adds zero of them again (per-entry idempotency check, not just an aggregate count)", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);
    await mergeHookRegistrations(fixtureDir);
    const result2 = await mergeHookRegistrations(fixtureDir);

    const newFiles = [
      "context-provider-gate.js",
      "runtime-consultation-target-gate.js",
      "context-provider-write-gate.js",
      "subagent-start-context-bundle.js",
    ];
    for (const file of newFiles) {
      expect(result2.added.some((a) => a.file === file)).toBe(false);
      expect(result2.skipped.some((s) => s.file === file)).toBe(true);
    }
  });

  // Assertion 7: idempotency
  it("second call adds nothing and produces no duplicate entries", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);
    const result2 = await mergeHookRegistrations(fixtureDir);

    expect(result2.added).toHaveLength(0);
    // 11 gates: 6 pre-existing + 4 M7/WP4 (context-provider-gate.js,
    // runtime-consultation-target-gate.js, context-provider-write-gate.js,
    // subagent-start-context-bundle.js under SubagentStart) + 1 Part C
    // retirement-trigger (the same subagent-start-context-bundle.js, ALSO
    // registered under SubagentStop) — see dispatch Section 6 and
    // m7-completeness-verdict-2026-08-09.md Block 4 point 1.
    expect(result2.skipped).toHaveLength(14);

    // Verify no duplicates in any PreToolUse block
    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    for (const block of preToolUse) {
      const cmds = block.hooks.map((h) => h.command);
      expect(cmds.length).toBe(new Set(cmds).size);
    }
  });

  // Assertion 8: malformed JSON fails closed
  it("rejects malformed JSON and preserves the consumer bytes", async () => {
    const claudeDir = join(fixtureDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    const malformed = "{ this is not valid json }";
    const settingsPath = join(claudeDir, "settings.json");
    await writeFile(settingsPath, malformed, "utf-8");

    await expect(mergeHookRegistrations(fixtureDir)).rejects.toThrow(/Malformed JSON/);
    expect(await readFile(settingsPath, "utf-8")).toBe(malformed);
  });

  it("rejects an unreadable settings path without replacing it", async () => {
    const settingsPath = join(fixtureDir, ".claude", "settings.json");
    await mkdir(settingsPath, { recursive: true });

    await expect(mergeHookRegistrations(fixtureDir)).rejects.toThrow(/Cannot read/);
    expect(existsSync(settingsPath)).toBe(true);
  });

  it("rejects malformed hook shapes instead of normalising them", async () => {
    const settings = { permissions: { deny: ["Bash(rm -rf *)"] }, hooks: { PreToolUse: "not-an-array" } };
    await writeSettings(fixtureDir, settings);
    const settingsPath = join(fixtureDir, ".claude", "settings.json");
    const before = await readFile(settingsPath, "utf-8");

    await expect(mergeHookRegistrations(fixtureDir)).rejects.toThrow(/Malformed hooks structure/);
    expect(await readFile(settingsPath, "utf-8")).toBe(before);
  });

  // Extra coverage: missing settings.json (creates from scratch)
  it("seeds empty structure when settings.json is missing", async () => {
    expect(existsSync(join(fixtureDir, ".claude", "settings.json"))).toBe(false);

    const result = await mergeHookRegistrations(fixtureDir);

    expect(result.added).toHaveLength(14);
    expect(existsSync(join(fixtureDir, ".claude", "settings.json"))).toBe(true);

    const settings = await readSettings(fixtureDir);
    expect((settings.hooks as Record<string, unknown>)["PreToolUse"]).toBeDefined();
  });

  // Extra coverage: dryRun does not write
  it("dryRun=true computes diff but does not modify disk", async () => {
    await writeSettings(fixtureDir, {});

    const result = await mergeHookRegistrations(fixtureDir, true);

    expect(result.dryRun).toBe(true);
    expect(result.added).toHaveLength(14);

    // File must still be the empty object we wrote
    const settings = await readSettings(fixtureDir);
    expect(Object.keys(settings)).toHaveLength(0);
  });

  // Extra coverage: single Bash block invariant
  it("does not create a second Bash matcher block when one already exists", async () => {
    const settingsWithBash = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "\"$ANDROID_COMMON_DOC\"/.claude/hooks/detekt-pre-commit.sh", timeout: 60 },
            ],
          },
        ],
      },
    };

    await writeSettings(fixtureDir, settingsWithBash);
    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, Array<{ matcher: string }>>)["PreToolUse"];
    expect(preToolUse.filter((b) => b.matcher === "Bash")).toHaveLength(1);
  });

  it("recognizes an exact registration in a later duplicate matcher block", async () => {
    await writeSettings(fixtureDir, {});
    await mergeHookRegistrations(fixtureDir, false, fixtureDir);
    const seeded = await readSettings(fixtureDir) as { hooks: Record<string, MatcherBlock[]> };
    const bashBlocks = seeded.hooks.PreToolUse.filter((block) => block.matcher === "Bash");
    const sourceHook = bashBlocks[0].hooks.find((hook) =>
      hook.command.includes("context-provider-write-gate.js"));
    expect(sourceHook).toBeDefined();
    bashBlocks[0].hooks = bashBlocks[0].hooks.filter((hook) => hook !== sourceHook);
    seeded.hooks.PreToolUse.push({ matcher: "Bash", hooks: [sourceHook!] });
    await writeSettings(fixtureDir, seeded);

    const result = await mergeHookRegistrations(fixtureDir, false, fixtureDir);
    expect(result.added.some((entry) => entry.file === "context-provider-write-gate.js")).toBe(false);
    expect(result.skipped.some((entry) => entry.file === "context-provider-write-gate.js")).toBe(true);

    const after = await readSettings(fixtureDir) as { hooks: Record<string, MatcherBlock[]> };
    const occurrences = after.hooks.PreToolUse
      .filter((block) => block.matcher === "Bash")
      .flatMap((block) => block.hooks)
      .filter((hook) => hook.command.includes("context-provider-write-gate.js"));
    expect(occurrences).toHaveLength(1);
  });

  it("migrates an exact legacy absolute source registration to the portable launcher", async () => {
    const runtimeCommand = `${JSON.stringify(realpathSync(process.execPath).replace(/\\/g, "/"))} ${
      JSON.stringify(join(realpathSync(fixtureDir), ".claude", "hooks", "context-provider-gate.js").replace(/\\/g, "/"))
    }`;
    await writeSettings(fixtureDir, {
      hooks: { PreToolUse: [{ matcher: "Grep|Glob|Bash|Read", hooks: [{ type: "command", command: runtimeCommand, timeout: 5 }] }] },
    });

    const result = await mergeHookRegistrations(fixtureDir, false, fixtureDir);
    expect(result.added.some((entry) => entry.file === "context-provider-gate.js")).toBe(true);

    const after = await readSettings(fixtureDir) as { hooks: Record<string, MatcherBlock[]> };
    const occurrences = after.hooks.PreToolUse
      .flatMap((block) => block.hooks)
      .filter((hook) => hook.command.includes("context-provider-gate.js"));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].command).toBe(
      'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js context-provider-gate.js',
    );
  });

  it("preserves a custom absolute command that was not emitted by the legacy Node runtime", async () => {
    const customCommand = `${JSON.stringify("/usr/bin/bash")} ${JSON.stringify(
      "/custom/toolkit/.claude/hooks/context-provider-gate.js",
    )}`;
    await writeSettings(fixtureDir, {
      hooks: {
        PreToolUse: [{
          matcher: "Grep|Glob|Bash|Read",
          hooks: [{ type: "command", command: customCommand, timeout: 5 }],
        }],
      },
    });

    await mergeHookRegistrations(fixtureDir, false, fixtureDir);
    const after = await readSettings(fixtureDir) as { hooks: Record<string, MatcherBlock[]> };
    const commands = after.hooks.PreToolUse.flatMap((block) => block.hooks).map((hook) => hook.command);
    expect(commands).toContain(customCommand);
    expect(commands).toContain(
      'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js context-provider-gate.js',
    );
  });

  it("preserves arbitrary commands that merely mention an owned hook basename", async () => {
    const arbitrary = 'node -e "console.log(\'bash-cli-spawn-gate.js\')"';
    await writeSettings(fixtureDir, {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: arbitrary, timeout: 7 }] }] },
    });

    await mergeHookRegistrations(fixtureDir, false, realpathSync(join(import.meta.dirname, "..", "..", "..")));

    const settings = await readSettings(fixtureDir);
    const commands = (settings.hooks as Record<string, MatcherBlock[]>).PreToolUse.flatMap((block) => block.hooks);
    expect(commands).toContainEqual(expect.objectContaining({ command: arbitrary }));
    expect(commands.filter((hook) => hook.command === arbitrary)).toHaveLength(1);
  });

  // Extra coverage: output format
  it("output JSON has 2-space indent and trailing newline", async () => {
    await writeSettings(fixtureDir, {});
    await mergeHookRegistrations(fixtureDir);

    const raw = await readFile(join(fixtureDir, ".claude", "settings.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "hooks"');
  });
});
