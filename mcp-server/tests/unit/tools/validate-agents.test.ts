import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  stripCodeFences,
  validateAgents,
} from "../../../src/tools/validate-agents.js";

describe("stripCodeFences", () => {
  it("strips inline backtick spans", () => {
    const result = stripCodeFences("text with `inline code` here");
    expect(result).toBe("text with  here");
  });

  it("strips fenced code blocks", () => {
    const result = stripCodeFences("before\n```\nsome code\n```\nafter");
    expect(result).toBe("before\n\nafter");
  });

  it("strips both fenced blocks and inline spans in mixed content", () => {
    const input =
      "Call `Agent()` or use:\n```\nAgent(subagent_type='foo')\n```\nDone.";
    const result = stripCodeFences(input);
    expect(result).not.toContain("`Agent()`");
    expect(result).not.toContain("Agent(subagent_type");
    expect(result).toContain("Done.");
  });

  it("leaves plain text untouched", () => {
    const result = stripCodeFences("no backticks here at all");
    expect(result).toBe("no backticks here at all");
  });
});

// ---------------------------------------------------------------------------
// validateAgents — tool-body-xref: inline backtick false-positive regression
// ---------------------------------------------------------------------------

const MINIMAL_MIGRATIONS = JSON.stringify({
  templates: { "test-agent": { "1.0.0": { desc: "initial" } } },
});

function agentContent(body: string): string {
  return `---
name: test-agent
description: A test agent
tools: Read, SendMessage
model: claude-sonnet-4-6
token_budget: 10000
template_version: 1.0.0
---

${body}`;
}

describe("validateAgents — tool-body-xref inline backtick fix", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "validate-agents-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("does NOT warn when Agent() appears only inside inline backticks", async () => {
    // Body mentions `Agent()` in backticks but does not call it directly.
    // Before the fix, this produced a false-positive tool-body-xref WARN.
    const content = agentContent(
      "Use `Agent()` only when explicitly authorized.\n\nSendMessage to coordinator.",
    );

    const templatesDir = path.join(tmpDir, "setup", "agent-templates");
    const agentsDir = path.join(tmpDir, ".claude", "agents");
    await mkdir(templatesDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(templatesDir, "test-agent.md"), content);
    await writeFile(
      path.join(templatesDir, "MIGRATIONS.json"),
      MINIMAL_MIGRATIONS,
    );

    const result = await validateAgents(tmpDir);

    const xrefWarns = result.issues.filter(
      (i) => i.category === "tool-body-xref" && i.message.includes("Agent"),
    );
    expect(xrefWarns).toHaveLength(0);
  });

  it("DOES warn when Agent() appears as a bare call outside backticks", async () => {
    // Agent( bare call — not in backticks — should still trigger xref warn
    // because Agent is not in the tools frontmatter field.
    const content = agentContent(
      "MANDATORY: call Agent(subagent_type='foo') to spawn.\n\nSendMessage to coordinator.",
    );

    const templatesDir = path.join(tmpDir, "setup", "agent-templates");
    const agentsDir = path.join(tmpDir, ".claude", "agents");
    await mkdir(templatesDir, { recursive: true });
    await mkdir(agentsDir, { recursive: true });
    await writeFile(path.join(templatesDir, "test-agent.md"), content);
    await writeFile(
      path.join(templatesDir, "MIGRATIONS.json"),
      MINIMAL_MIGRATIONS,
    );

    const result = await validateAgents(tmpDir);

    const xrefWarns = result.issues.filter(
      (i) => i.category === "tool-body-xref" && i.message.includes("Agent"),
    );
    expect(xrefWarns.length).toBeGreaterThan(0);
  });
});
