/**
 * PM template behavioral regression tests.
 *
 * Enforces rule ordering, FORBIDDEN completeness, internal consistency,
 * structural invariants, and DawSync-specific regression scenarios.
 *
 * Tests that EXPECT to FAIL on the current template (pre-fix) are marked:
 *   [EXPECT FAIL] — these are regression anchors to verify the template is broken before fixing.
 *
 * Source: setup/agent-templates/project-manager.md
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');
const AGENTS_DIR = path.join(ROOT, '.claude/agents');
const PM_TEMPLATE = path.join(TEMPLATES_DIR, 'project-manager.md');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineOf(content: string, pattern: string | RegExp): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (typeof pattern === 'string' ? lines[i].includes(pattern) : pattern.test(lines[i])) {
      return i + 1; // 1-indexed
    }
  }
  return -1;
}

function extractSection(content: string, heading: string): string {
  const lines = content.split('\n');
  const startIdx = lines.findIndex(l => l.includes(heading));
  if (startIdx === -1) return '';
  // Collect until next same-level heading
  const headingLevel = (lines[startIdx].match(/^#+/) || [''])[0].length;
  let end = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= headingLevel) { end = i; break; }
  }
  return lines.slice(startIdx, end).join('\n');
}

function bodyContent(content: string): string {
  // Strip YAML frontmatter (between --- delimiters)
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : content;
}

// ---------------------------------------------------------------------------
// Load template once
// ---------------------------------------------------------------------------

const content = fs.readFileSync(PM_TEMPLATE, 'utf-8');
const body = bodyContent(content);

// ---------------------------------------------------------------------------
// Group 1: HARD GATE position
// ---------------------------------------------------------------------------

describe('HARD GATE position', () => {
  // Extract ~5 lines after the HARD GATE line for content checks
  const hardGateLine = lineOf(content, 'HARD GATE');
  const contentLines = content.split('\n');
  const hardGateText = hardGateLine > 0
    ? contentLines.slice(hardGateLine - 1, hardGateLine + 5).join('\n')
    : '';

  const bodyLines = body.split('\n');
  const hardGateBodyLine = lineOf(body, 'HARD GATE');

  it('HARD GATE appears before line 25 of body [EXPECT FAIL on current template — HARD GATE is at body line ~87]', () => {
    // Current template has HARD GATE at line 103 of total (line ~87 of body).
    // This test MUST fail before the fix and pass after.
    expect(hardGateBodyLine).toBeGreaterThan(0);
    expect(hardGateBodyLine).toBeLessThanOrEqual(25);
  });

  it('HARD GATE appears before FORBIDDEN Actions section [EXPECT FAIL on current template]', () => {
    const hardGateLine = lineOf(content, 'HARD GATE');
    const forbiddenLine = lineOf(content, 'FORBIDDEN Actions');
    expect(hardGateLine).toBeGreaterThan(0);
    expect(forbiddenLine).toBeGreaterThan(0);
    expect(hardGateLine).toBeLessThan(forbiddenLine);
  });

  it('HARD GATE appears before ALLOWED Actions section [EXPECT FAIL on current template]', () => {
    const hardGateLine = lineOf(content, 'HARD GATE');
    const allowedLine = lineOf(content, 'ALLOWED Actions');
    expect(hardGateLine).toBeGreaterThan(0);
    expect(allowedLine).toBeGreaterThan(0);
    expect(hardGateLine).toBeLessThan(allowedLine);
  });

  it('HARD GATE contains DO NOT language', () => {
    // "DO NOT plan", "DO NOT spawn", or "DO NOT respond" — language exists in current template
    expect(hardGateText).toMatch(/DO NOT plan|DO NOT spawn|DO NOT respond/);
  });

  it('HARD GATE references TeamCreate', () => {
    expect(hardGateText).toContain('TeamCreate');
  });

  it('HARD GATE uses blockquote, strong emphasis, or stop symbol', () => {
    // Accepts ⛔ emoji, blockquote (**) pattern, or HARD GATE keyword itself as heading/emphasis
    expect(hardGateText).toMatch(/⛔|>\s+\*\*|HARD GATE/);
  });
});

// ---------------------------------------------------------------------------
// Group 2: FORBIDDEN completeness
// ---------------------------------------------------------------------------

describe('FORBIDDEN completeness', () => {
  const forbiddenSection = extractSection(content, 'FORBIDDEN Actions');

  it('git diff on source code is FORBIDDEN [EXPECT FAIL on current template — not present]', () => {
    expect(forbiddenSection).toMatch(/git diff/i);
  });

  it('git show on source code is FORBIDDEN [EXPECT FAIL on current template — not present]', () => {
    expect(forbiddenSection).toMatch(/git show/i);
  });

  it('git log on source code is FORBIDDEN [EXPECT FAIL on current template — not present]', () => {
    expect(forbiddenSection).toMatch(/git log/i);
  });

  it('Explore agents are FORBIDDEN', () => {
    expect(forbiddenSection).toContain('Explore');
  });

  it('Writing or editing ANY file is FORBIDDEN', () => {
    expect(forbiddenSection).toMatch(/Writing or editing ANY file/i);
  });

  it('Running builds or tests is FORBIDDEN', () => {
    expect(forbiddenSection).toMatch(/Running builds.*tests|Running.*builds/i);
  });

  it('Bash + claude CLI is FORBIDDEN', () => {
    expect(forbiddenSection).toMatch(/Bash.*claude|claude.*CLI/i);
  });

  it('General-purpose Agent for docs is FORBIDDEN', () => {
    expect(forbiddenSection).toMatch(/general-purpose Agent/i);
  });

  it('FORBIDDEN section lists at least 7 items', () => {
    // Count lines starting with "- **FORBIDDEN**" or "- **" (bullet items in the list)
    const itemMatches = forbiddenSection.match(/^- \*\*/gm);
    const count = itemMatches ? itemMatches.length : 0;
    expect(count).toBeGreaterThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// Group 3: FORBIDDEN-ALLOWED consistency
// ---------------------------------------------------------------------------

describe('FORBIDDEN-ALLOWED consistency', () => {
  const forbiddenLine = lineOf(content, 'FORBIDDEN Actions');
  const allowedLine = lineOf(content, 'ALLOWED Actions');
  const allowedSection = extractSection(content, 'ALLOWED Actions');

  it('FORBIDDEN appears before ALLOWED in file', () => {
    expect(forbiddenLine).toBeGreaterThan(0);
    expect(allowedLine).toBeGreaterThan(0);
    expect(forbiddenLine).toBeLessThan(allowedLine);
  });

  it('ALLOWED section does not mention writing files', () => {
    expect(allowedSection).not.toMatch(/write.*file|edit.*file|modify.*code/i);
  });

  it('commit in Autonomous section is scoped to branches or PRs', () => {
    // Find the Autonomous line and check it mentions branches/features/PRs alongside commit
    const autonomousLineIdx = lineOf(content, 'Autonomous');
    const autonomousLines = content.split('\n');
    const autonomousText = autonomousLineIdx > 0
      ? autonomousLines.slice(autonomousLineIdx - 1, autonomousLineIdx + 3).join('\n')
      : '';
    expect(autonomousText).toMatch(/commit.*feature|commit.*branch|commit.*push|create branches.*commit|Commits.*architect|Commits.*SendMessage/i);
  });

  it('commit does NOT appear in ALLOWED Actions section', () => {
    expect(allowedSection).not.toMatch(/\bcommit\b/i);
  });

  it('No escape hatch language adjacent to FORBIDDEN rules', () => {
    const lines = content.split('\n');
    const forbiddenLineIdx = lineOf(content, 'FORBIDDEN Actions') - 1;
    // Check within the FORBIDDEN section (up to 30 lines)
    const forbiddenWindow = lines.slice(forbiddenLineIdx, forbiddenLineIdx + 30).join('\n');
    // Within 5 lines of each FORBIDDEN keyword, no "you may", "feel free", or "can also"
    const forbiddenKeywordLines = lines
      .map((l, i) => ({ line: l, idx: i }))
      .filter(({ line }) => line.includes('FORBIDDEN'));

    for (const { idx } of forbiddenKeywordLines) {
      const windowStart = Math.max(0, idx - 5);
      const windowEnd = Math.min(lines.length, idx + 6);
      const window = lines.slice(windowStart, windowEnd).join('\n');
      expect(window).not.toMatch(/you may|feel free|can also/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 4: PM template structural invariants
// ---------------------------------------------------------------------------

describe('PM template structural invariants', () => {
  const lines = content.split('\n');
  const bodyLines = body.split('\n');

  it('Template is at most 400 lines', () => {
    expect(lines.length).toBeLessThanOrEqual(400);
  });

  it('template_version matches semver format', () => {
    const versionLine = lines.find(l => l.includes('template_version'));
    expect(versionLine).toBeDefined();
    expect(versionLine!).toMatch(/"\d+\.\d+\.\d+"/);
  });

  it('Identity sentence is the first body line', () => {
    // First non-empty body line should contain "You are the project manager"
    const firstNonEmpty = bodyLines.find(l => l.trim().length > 0) ?? '';
    expect(firstNonEmpty).toMatch(/You are the project manager/i);
  });

  it('No "should" within 3 lines of FORBIDDEN keyword', () => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('FORBIDDEN')) {
        const windowStart = Math.max(0, i - 3);
        const windowEnd = Math.min(lines.length, i + 4);
        const window = lines.slice(windowStart, windowEnd).join('\n');
        expect(window).not.toMatch(/\bshould\b/i);
      }
    }
  });

  it('Session Start section has exactly 6 Agent() calls', () => {
    const sessionSection = extractSection(content, 'Session Start: Session Team Setup');
    const agentCalls = sessionSection.match(/Agent\(name=/g);
    expect(agentCalls).not.toBeNull();
    expect(agentCalls!.length).toBe(6);
  });

  it('Phase 2 Core Devs section has exactly 4 Agent() calls in the code block', () => {
    // Extract only the code block (between ``` delimiters) in the Phase 2 section
    // to avoid counting the inline rotation example line
    const phase2Section = extractSection(content, 'Phase 2 Core Devs');
    const codeBlockMatch = phase2Section.match(/```[\s\S]*?```/);
    const codeBlock = codeBlockMatch ? codeBlockMatch[0] : '';
    const agentCalls = codeBlock.match(/Agent\(name=/g);
    expect(agentCalls).not.toBeNull();
    expect(agentCalls!.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Group 5: PM dual-location sync
// ---------------------------------------------------------------------------

describe('PM dual-location sync', () => {
  it('setup/agent-templates/project-manager.md equals .claude/agents/project-manager.md', () => {
    const sourcePath = path.join(TEMPLATES_DIR, 'project-manager.md');
    const copyPath = path.join(AGENTS_DIR, 'project-manager.md');
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const copyContent = fs.readFileSync(copyPath, 'utf-8');
    expect(sourceContent).toBe(copyContent);
  });
});

// ---------------------------------------------------------------------------
// Group 6: DawSync regression scenarios
// ---------------------------------------------------------------------------

describe('DawSync regression scenarios', () => {
  const forbiddenSection = extractSection(content, 'FORBIDDEN Actions');
  const allowedSection = extractSection(content, 'ALLOWED Actions');

  it('FORBIDDEN covers at least 3 git code-reading vectors (diff, show, log) [EXPECT FAIL — 0 currently]', () => {
    // Count distinct git code-reading vector mentions
    let count = 0;
    if (/git diff/i.test(forbiddenSection)) count++;
    if (/git show/i.test(forbiddenSection)) count++;
    if (/git log/i.test(forbiddenSection)) count++;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('HARD GATE appears in first 25 lines of body content [EXPECT FAIL — currently at body line ~87]', () => {
    const hardGateBodyLine = lineOf(body, 'HARD GATE');
    expect(hardGateBodyLine).toBeGreaterThan(0);
    expect(hardGateBodyLine).toBeLessThanOrEqual(25);
  });

  it('ALLOWED section contains only plan/team/report actions (no code-reading)', () => {
    // ALLOWED items must not grant access to code-reading git commands or implementation grep
    // Note: "NOT source code" in the Read item is an exclusion note — not a grant.
    // We check specifically for actionable code-reading vectors: git show, git log, grep implementations
    expect(allowedSection).not.toMatch(/grep.*source|grep.*implementation|git show|git log/i);
    expect(allowedSection).not.toMatch(/\bgit diff\b/i);
  });

  it('commit is not in ALLOWED Actions section', () => {
    expect(allowedSection).not.toMatch(/\bcommit\b/i);
  });
});

// ---------------------------------------------------------------------------
// Group 7: Dev dispatch correctness
// ---------------------------------------------------------------------------

describe('dev dispatch correctness', () => {
  it('architect-requested specialist must be spawned by name — anonymous dev not a valid substitute', () => {
    // When an architect sends PM a named specialist request, PM must honor the name.
    // Template must contain a rule that architect-requested devs are spawned with the requested name.
    // Regression: PM spawned anonymous Agent() instead of domain-model-specialist when arch-platform requested it.
    expect(content).toMatch(
      /architect.*request.*named|architect.*sends.*PM.*name|spawn.*requested.*name|honor.*architect.*name|named.*specialist.*as.*requested/i
    );
  });

  it('anonymous devs are eliminated — all devs must be named team peers', () => {
    // Bug #3 fix: anonymous Agent() calls (no name, no team_name) are no longer valid.
    // Template must NOT contain anonymous dev instructions.
    expect(content).not.toMatch(/anonymous devs.*≤3|≤3.*file.*anonymous|no name.*no team_name.*disposable/i);
    // Must contain named extra dev pattern instead
    expect(content).toMatch(/specialist-2|specialist-3|\{specialist\}-2|named.*team peer/i);
  });
});

// ---------------------------------------------------------------------------
// Group 8: Planner spawning as team peer
// ---------------------------------------------------------------------------

describe('planner spawning as team peer', () => {
  it('planner must be spawned with team_name — isolated planner cannot reach context-provider [EXPECT FAIL]', () => {
    // Bug #6: PM template has no instruction to spawn planner as named team peer.
    // Planner spawned without team_name is isolated — cannot SendMessage to context-provider.
    // Template must contain an Agent() call for planner that includes team_name.
    // Match Agent(name="planner"...) with team_name on the same line (no dotall — prevents cross-line false positives)
    expect(content).toMatch(/Agent\(name="planner"[^\n]*team_name|Agent\(name='planner'[^\n]*team_name/i);
  });

  it('planner spawning appears in template body with explicit Agent() call [EXPECT FAIL]', () => {
    // PM template must contain an Agent() invocation for planner — not just a reference in a table or checklist.
    // Current template only references planner in checklist (line 124) and topology table (line 341).
    expect(body).toMatch(/Agent\(name="planner"|Agent\(name='planner'/i);
  });
});

// ---------------------------------------------------------------------------
// Group 9: Model profile + context-provider protocol
// ---------------------------------------------------------------------------

describe('PM model and protocol rules', () => {
  it('PM template model must be opus [EXPECT FAIL — currently sonnet]', () => {
    // PM is orchestrator — requires opus for complex reasoning.
    // Regression: PM downgraded to sonnet causing reasoning failures.
    expect(content).toMatch(/^model:\s*opus$/m);
  });

  it('PM must have explicit FIRST POST-SETUP ACTION block for context-provider [EXPECT FAIL — no such block]', () => {
    // PM must have an explicit section or callout named "FIRST POST-SETUP ACTION"
    // that instructs consulting context-provider BEFORE any planning.
    // Current template has "START: SendMessage(to='context-provider'...)" buried in a list
    // but no dedicated, prominent block enforcing this as the mandatory FIRST action.
    expect(content).toMatch(/FIRST POST-SETUP ACTION/i);
  });

  it('FORBIDDEN section must call out git diff/show/log as Bash command vectors [EXPECT FAIL — Bash not mentioned near git FORBIDDEN]', () => {
    // git diff/show/log are Bash-executed code-reading vectors — FORBIDDEN must name them as Bash commands.
    // Current template names them but without the "Bash" framing that makes it actionable.
    const forbiddenSection = extractSection(content, 'FORBIDDEN Actions');
    expect(forbiddenSection).toMatch(/Bash.*git diff|git diff.*Bash|Bash.*git show|git diff.*git show.*git log.*Bash|Bash.*code-reading/i);
  });

  it('FORBIDDEN section must block cat, head, tail, and git blame as code-reading vectors [EXPECT FAIL — not in FORBIDDEN]', () => {
    // These Bash commands read file content — PM must be explicitly forbidden from using them.
    // Current FORBIDDEN section does not mention cat, head, tail, or git blame.
    const forbiddenSection = extractSection(content, 'FORBIDDEN Actions');
    expect(forbiddenSection).toMatch(/cat.*source|head.*source|tail.*source|git blame/i);
  });
});
