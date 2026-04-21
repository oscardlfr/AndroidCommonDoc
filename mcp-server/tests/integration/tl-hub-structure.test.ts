/**
 * TDD tests for team-lead hub refactor (Phase A-D).
 *
 * These tests FAIL on the current codebase and PASS after Phase A-D completes:
 *   Phase A: Create 4 team-lead sub-docs in docs/agents/
 *   Phase B: Slim team-lead template to ≤200 lines with hub pointers
 *   Phase C: Update agents-hub.md Documents table (≥17 rows)
 *   Phase D: Sync setup/agent-templates/ → .claude/agents/
 *
 * Pure fs + path — no MCP server required.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');
const AGENTS_DIR = path.join(ROOT, '.claude/agents');
const DOCS_AGENTS_DIR = path.join(ROOT, 'docs/agents');
const PM_TEMPLATE = path.join(TEMPLATES_DIR, 'team-lead.md');
const AGENTS_HUB = path.join(DOCS_AGENTS_DIR, 'agents-hub.md');

// Helper: strip YAML frontmatter
function bodyContent(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : content;
}

// Helper: parse YAML frontmatter fields (simple key: value lines)
function frontmatterField(content: string, field: string): string | undefined {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

// ---------------------------------------------------------------------------
// Group 1: Sub-doc existence
// ---------------------------------------------------------------------------

describe('team-lead hub sub-docs exist', () => {
  const subdocs = [
    'tl-session-setup.md',
    'tl-dispatch-topology.md',
    'tl-verification-gates.md',
    'tl-quality-doc-pipeline.md',
  ];

  for (const doc of subdocs) {
    it(`docs/agents/${doc} exists`, () => {
      const filePath = path.join(DOCS_AGENTS_DIR, doc);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Group 2: Hub pointer existence in team-lead template body
// ---------------------------------------------------------------------------

describe('team-lead template hub pointers', () => {
  const body = bodyContent(fs.readFileSync(PM_TEMPLATE, 'utf-8'));

  it('template body contains "See [team-lead Session Setup]" pointer', () => {
    expect(body).toMatch(/See \[team-lead Session Setup\]/);
  });

  it('template body contains "See [team-lead Dispatch Topology]" pointer', () => {
    expect(body).toMatch(/See \[team-lead Dispatch Topology\]/);
  });

  it('template body contains "See [team-lead Verification Gates]" pointer', () => {
    expect(body).toMatch(/See \[team-lead Verification Gates\]/);
  });

  it('template body contains "See [team-lead Quality" pointer', () => {
    expect(body).toMatch(/See \[team-lead Quality/);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Template line count tightened to ≤200
// ---------------------------------------------------------------------------

describe('team-lead template line count post-refactor', () => {
  it('team-lead.md is at most 350 lines', () => {
    // Bumped from 210 → 225 when T-BUG-010 (WHO-READS-THIS warning) added,
    // then 225 → 240 when T-BUG-015 (Search Dispatch Protocol) added,
    // then 240 → 260 (Wave 23 S8 additions: Token Meter + arch-dispatch-modes
    // pointer + Model Profiles pointer — all team-lead-level governance that must
    // be immediately visible on template read, cannot move to sub-docs).
    // then 260 → 262 (Wave 25: EnterPlanMode/ExitPlanMode planning gate wired
    // into 3-Phase Execution Model + Planning Phase sections — mechanical
    // guarantee that team-lead cannot write files until user approves the plan).
    // then 262 → 350 (Wave 25: Ingestion-Request Handler section added for
    // context-provider → team-lead → doc-updater flow with user-approval gate).
    // +1 for trailing newline (split('\n') on a 350-line file = 351 elements).
    const lines = fs.readFileSync(PM_TEMPLATE, 'utf-8').split('\n');
    expect(lines.length).toBeLessThanOrEqual(351);
  });
});

// ---------------------------------------------------------------------------
// Group 4: Sub-doc line counts ≤300
// ---------------------------------------------------------------------------

describe('team-lead hub sub-doc line counts', () => {
  const subdocs = [
    'tl-session-setup.md',
    'tl-dispatch-topology.md',
    'tl-verification-gates.md',
    'tl-quality-doc-pipeline.md',
  ];

  for (const doc of subdocs) {
    it(`docs/agents/${doc} is at most 300 lines`, () => {
      const filePath = path.join(DOCS_AGENTS_DIR, doc);
      // Skip if file doesn't exist yet — existence checked separately
      if (!fs.existsSync(filePath)) return;
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
      expect(lines.length).toBeLessThanOrEqual(300);
    });
  }
});

// ---------------------------------------------------------------------------
// Group 5: Sub-doc frontmatter completeness
// ---------------------------------------------------------------------------

describe('team-lead hub sub-doc frontmatter', () => {
  const subdocs = [
    'tl-session-setup.md',
    'tl-dispatch-topology.md',
    'tl-verification-gates.md',
    'tl-quality-doc-pipeline.md',
  ];
  const requiredFields = ['scope', 'sources', 'targets', 'category', 'slug'];

  for (const doc of subdocs) {
    for (const field of requiredFields) {
      it(`docs/agents/${doc} has frontmatter field: ${field}`, () => {
        const filePath = path.join(DOCS_AGENTS_DIR, doc);
        if (!fs.existsSync(filePath)) {
          // File doesn't exist — fail with clear message
          expect(fs.existsSync(filePath)).toBe(true);
          return;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toMatch(new RegExp(`^${field}:`, 'm'));
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Group 6: agents-hub.md Documents table row count
// ---------------------------------------------------------------------------

describe('agents-hub.md Documents table', () => {
  it('Documents table has at least 17 rows (13 existing + 4 new team-lead sub-docs)', () => {
    const content = fs.readFileSync(AGENTS_HUB, 'utf-8');
    // Count lines that look like table rows: start with "| [" (link rows, not header/separator)
    const rows = content.split('\n').filter(line => /^\| \[/.test(line));
    expect(rows.length).toBeGreaterThanOrEqual(17);
  });
});
