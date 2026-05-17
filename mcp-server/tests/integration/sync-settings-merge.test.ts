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
 *   8. Malformed JSON: fail-open, no silent crash
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
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
          {
            type: "command",
            command: "\"$ANDROID_COMMON_DOC\"/.claude/hooks/quality-gate-pre-commit.sh",
            timeout: 5,
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

  // Assertion 2: PostToolUse 3 blocks untouched
  it("leaves all 3 PostToolUse blocks completely unchanged", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const postToolUse = (settings.hooks as Record<string, unknown>)["PostToolUse"];

    // Byte-identical to original (no additions, no mutations)
    expect(JSON.stringify(postToolUse)).toBe(JSON.stringify(FULL_L1_SETTINGS.hooks.PostToolUse));
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
    expect(cmds.some((c) => c.includes("quality-gate-pre-commit.sh"))).toBe(true);

    // L0 enforcement hooks appended
    expect(cmds.some((c) => c.includes("team-completeness-gate.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("premature-execution-gate.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("branch-guard.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("pre-push-pre-pr-gate.js"))).toBe(true);
    expect(cmds.some((c) => c.includes("commit-scope-validation-gate.js"))).toBe(true);
  });

  // Assertion 4: Write|Edit block CREATED with correct L0 entries
  it("creates Write|Edit PreToolUse block with team-completeness-gate + premature-execution-gate", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    const writeEditBlock = preToolUse.find((b) => b.matcher === "Write|Edit");

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

  // Assertion 6: Grep|Glob|Bash|Read combined matcher unchanged
  it("does not modify the Grep|Glob|Bash|Read combined matcher block", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    const cpBlock = preToolUse.find((b) => b.matcher === "Grep|Glob|Bash|Read");

    expect(cpBlock).toBeDefined();
    expect(JSON.stringify(cpBlock)).toBe(
      JSON.stringify(FULL_L1_SETTINGS.hooks.PreToolUse[0]),
    );
  });

  // Assertion 7: idempotency
  it("second call adds nothing and produces no duplicate entries", async () => {
    await writeSettings(fixtureDir, FULL_L1_SETTINGS);

    await mergeHookRegistrations(fixtureDir);
    const result2 = await mergeHookRegistrations(fixtureDir);

    expect(result2.added).toHaveLength(0);
    expect(result2.skipped).toHaveLength(8);

    // Verify no duplicates in any PreToolUse block
    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, MatcherBlock[]>)["PreToolUse"];
    for (const block of preToolUse) {
      const cmds = block.hooks.map((h) => h.command);
      expect(cmds.length).toBe(new Set(cmds).size);
    }
  });

  // Assertion 8: malformed JSON fail-open
  it("fails open on malformed JSON — warns, seeds empty structure, adds 8 entries", async () => {
    const claudeDir = join(fixtureDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), "{ this is not valid json }", "utf-8");

    // Should not throw
    const result = await mergeHookRegistrations(fixtureDir);

    expect(result.added).toHaveLength(8);
    expect(result.skipped).toHaveLength(0);

    // Output must be valid JSON
    const raw = await readFile(join(claudeDir, "settings.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  // Extra coverage: missing settings.json (creates from scratch)
  it("seeds empty structure when settings.json is missing", async () => {
    expect(existsSync(join(fixtureDir, ".claude", "settings.json"))).toBe(false);

    const result = await mergeHookRegistrations(fixtureDir);

    expect(result.added).toHaveLength(8);
    expect(existsSync(join(fixtureDir, ".claude", "settings.json"))).toBe(true);

    const settings = await readSettings(fixtureDir);
    expect((settings.hooks as Record<string, unknown>)["PreToolUse"]).toBeDefined();
  });

  // Extra coverage: dryRun does not write
  it("dryRun=true computes diff but does not modify disk", async () => {
    await writeSettings(fixtureDir, {});

    const result = await mergeHookRegistrations(fixtureDir, true);

    expect(result.dryRun).toBe(true);
    expect(result.added).toHaveLength(8);

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

  // Extra coverage: output format
  it("output JSON has 2-space indent and trailing newline", async () => {
    await writeSettings(fixtureDir, {});
    await mergeHookRegistrations(fixtureDir);

    const raw = await readFile(join(fixtureDir, ".claude", "settings.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "hooks"');
  });
});
