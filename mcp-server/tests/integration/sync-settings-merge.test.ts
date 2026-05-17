/**
 * Integration tests for mergeHookRegistrations() — F1 BL-W47-prep-11.
 *
 * Tests the additive merge of L0 enforcement hook registrations into a
 * downstream project's .claude/settings.json. Uses direct function import
 * per arch-platform recommendation (faster than subprocess).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, existsSync } from "node:fs";
import { mergeHookRegistrations } from "../../src/sync/sync-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sync-settings-merge-"));
}

/** Minimal L1 settings.json with only detekt + context-provider-gate (no enforcement hooks) */
const MINIMAL_SETTINGS = {
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

/** Settings with all 9 required L0 entries already present */
function makeFullSettings() {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [
            { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/team-completeness-gate.js", timeout: 5 },
            { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/premature-execution-gate.js", timeout: 5 },
          ],
        },
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/team-completeness-gate.js", timeout: 5 },
            { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/premature-execution-gate.js", timeout: 5 },
            { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/branch-guard.js", timeout: 5 },
            { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/pre-push-pre-pr-gate.js", timeout: 5 },
            { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/commit-scope-validation-gate.js", timeout: 5 },
          ],
        },
        {
          matcher: "TaskUpdate",
          hooks: [
            { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/specialist-task-completion-gate.js", timeout: 5 },
          ],
        },
      ],
    },
  };
}

async function writeSettings(dir: string, settings: unknown): Promise<void> {
  const claudeDir = join(dir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

async function readSettings(dir: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(dir, ".claude", "settings.json"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mergeHookRegistrations()", () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = makeTmpDir();
  });

  afterEach(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("adds all 9 required entries to an empty settings.json", async () => {
    // Fixture: empty settings.json
    await writeSettings(fixtureDir, {});

    const result = await mergeHookRegistrations(fixtureDir);

    expect(result.added).toHaveLength(8);
    expect(result.skipped).toHaveLength(0);

    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, unknown[]>)["PreToolUse"] as Array<{ matcher: string; hooks: Array<{ command: string }> }>;
    expect(preToolUse).toBeDefined();

    // team-completeness-gate.js must appear in Write|Edit block
    const writeEditBlock = preToolUse.find((b) => b.matcher === "Write|Edit");
    expect(writeEditBlock).toBeDefined();
    expect(writeEditBlock!.hooks.some((h) => h.command.includes("team-completeness-gate.js"))).toBe(true);

    // team-completeness-gate.js must appear in Bash block
    const bashBlock = preToolUse.find((b) => b.matcher === "Bash");
    expect(bashBlock).toBeDefined();
    expect(bashBlock!.hooks.some((h) => h.command.includes("team-completeness-gate.js"))).toBe(true);

    // specialist-task-completion-gate.js must be in TaskUpdate block
    const taskUpdateBlock = preToolUse.find((b) => b.matcher === "TaskUpdate");
    expect(taskUpdateBlock).toBeDefined();
    expect(taskUpdateBlock!.hooks.some((h) => h.command.includes("specialist-task-completion-gate.js"))).toBe(true);
  });

  it("preserves existing project-specific hooks while adding L0 entries", async () => {
    await writeSettings(fixtureDir, MINIMAL_SETTINGS);

    const result = await mergeHookRegistrations(fixtureDir);

    expect(result.added.length).toBeGreaterThan(0);

    const settings = await readSettings(fixtureDir);
    const hooks = settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>>;

    // PostToolUse must be completely untouched
    const postToolUse = hooks["PostToolUse"];
    expect(postToolUse).toBeDefined();
    expect(postToolUse).toHaveLength(1);
    expect(postToolUse[0].matcher).toBe("Write|Edit");
    expect(postToolUse[0].hooks[0].command).toContain("detekt-post-write.sh");

    // Existing Bash block must still contain detekt-pre-commit
    const preToolUse = hooks["PreToolUse"];
    const bashBlock = preToolUse.find((b) => b.matcher === "Bash");
    expect(bashBlock).toBeDefined();
    expect(bashBlock!.hooks.some((h) => h.command.includes("detekt-pre-commit.sh"))).toBe(true);

    // Existing Grep|Glob|Bash|Read block preserved
    const cpBlock = preToolUse.find((b) => b.matcher === "Grep|Glob|Bash|Read");
    expect(cpBlock).toBeDefined();
    expect(cpBlock!.hooks.some((h) => h.command.includes("context-provider-gate.js"))).toBe(true);
  });

  it("is idempotent: second call produces no duplicate entries", async () => {
    await writeSettings(fixtureDir, MINIMAL_SETTINGS);

    await mergeHookRegistrations(fixtureDir);
    const result2 = await mergeHookRegistrations(fixtureDir);

    expect(result2.added).toHaveLength(0);
    expect(result2.skipped).toHaveLength(8);

    // Verify no duplicates in file
    const settings = await readSettings(fixtureDir);
    const preToolUse = (settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>>)["PreToolUse"];

    for (const block of preToolUse) {
      const commands = block.hooks.map((h) => h.command);
      const uniqueCommands = new Set(commands);
      expect(commands.length).toBe(uniqueCommands.size);
    }
  });

  it("leaves PostToolUse untouched when PostToolUse entries are present", async () => {
    const settingsWithPost = {
      hooks: {
        PostToolUse: [
          {
            matcher: ".*",
            hooks: [
              { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/tool-use-logger.js", timeout: 5 },
            ],
          },
          {
            matcher: "SendMessage",
            hooks: [
              { type: "command", command: "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/context-provider-consulted.js", timeout: 5 },
            ],
          },
        ],
        PreToolUse: [],
      },
    };

    await writeSettings(fixtureDir, settingsWithPost);
    await mergeHookRegistrations(fixtureDir);

    const settings = await readSettings(fixtureDir);
    const postToolUse = (settings.hooks as Record<string, unknown>)["PostToolUse"] as Array<unknown>;

    // PostToolUse must have exactly the same 2 blocks as before
    expect(postToolUse).toHaveLength(2);
    expect(JSON.stringify(postToolUse)).toBe(JSON.stringify(settingsWithPost.hooks.PostToolUse));
  });

  it("fails open on malformed JSON — seeds empty structure and adds all 8 entries", async () => {
    const claudeDir = join(fixtureDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "settings.json"), "{ this is not valid json }", "utf-8");

    // Should not throw — fail-open
    const result = await mergeHookRegistrations(fixtureDir);

    // All 8 entries should be added from the seeded empty structure
    expect(result.added).toHaveLength(8);
    expect(result.skipped).toHaveLength(0);

    // The file should be valid JSON now
    const raw = await readFile(join(claudeDir, "settings.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("seeds empty structure and creates settings.json when file is missing", async () => {
    // No settings.json written — just the empty fixture dir
    expect(existsSync(join(fixtureDir, ".claude", "settings.json"))).toBe(false);

    const result = await mergeHookRegistrations(fixtureDir);

    expect(result.added).toHaveLength(8);
    expect(existsSync(join(fixtureDir, ".claude", "settings.json"))).toBe(true);

    const settings = await readSettings(fixtureDir);
    expect((settings.hooks as Record<string, unknown>)["PreToolUse"]).toBeDefined();
  });

  it("dryRun=true computes diff but does not write to disk", async () => {
    await writeSettings(fixtureDir, {});

    const result = await mergeHookRegistrations(fixtureDir, true);

    expect(result.dryRun).toBe(true);
    expect(result.added).toHaveLength(8);

    // File should still be the empty settings we wrote (no write happened)
    const settings = await readSettings(fixtureDir);
    expect(Object.keys(settings)).toHaveLength(0);
  });

  it("output JSON has 2-space indent and ends with newline", async () => {
    await writeSettings(fixtureDir, {});
    await mergeHookRegistrations(fixtureDir);

    const raw = await readFile(join(fixtureDir, ".claude", "settings.json"), "utf-8");
    // Ends with newline
    expect(raw.endsWith("\n")).toBe(true);
    // 2-space indent: first level keys indented by 2 spaces
    expect(raw).toContain('  "hooks"');
  });

  it("does not create a second Bash matcher block when one already exists", async () => {
    // Fixture with existing Bash block containing some hooks
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
    const bashBlocks = preToolUse.filter((b) => b.matcher === "Bash");

    // Must still be exactly ONE Bash block
    expect(bashBlocks).toHaveLength(1);
  });
});
