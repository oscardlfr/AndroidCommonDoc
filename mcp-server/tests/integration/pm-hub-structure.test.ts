/**
 * TDD tests for PM hub refactor (Phase A-D).
 *
 * These tests FAIL on the current codebase and PASS after Phase A-D completes:
 *   Phase A: Create 4 PM sub-docs in docs/agents/
 *   Phase B: Slim PM template to ≤200 lines with hub pointers
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
const PM_TEMPLATE = path.join(TEMPLATES_DIR, 'project-manager.md');
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

describe('PM hub sub-docs exist', () => {
  const subdocs = [
    'pm-session-setup.md',
    'pm-dispatch-topology.md',
    'pm-verification-gates.md',
    'pm-quality-doc-pipeline.md',
  ];

  for (const doc of subdocs) {
    it(`docs/agents/${doc} exists`, () => {
      const filePath = path.join(DOCS_AGENTS_DIR, doc);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Group 2: Hub pointer existence in PM template body
// ---------------------------------------------------------------------------

describe('PM template hub pointers', () => {
  const body = bodyContent(fs.readFileSync(PM_TEMPLATE, 'utf-8'));

  it('template body contains "See [PM Session Setup]" pointer', () => {
    expect(body).toMatch(/See \[PM Session Setup\]/);
  });

  it('template body contains "See [PM Dispatch Topology]" pointer', () => {
    expect(body).toMatch(/See \[PM Dispatch Topology\]/);
  });

  it('template body contains "See [PM Verification Gates]" pointer', () => {
    expect(body).toMatch(/See \[PM Verification Gates\]/);
  });

  it('template body contains "See [PM Quality" pointer', () => {
    expect(body).toMatch(/See \[PM Quality/);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Template line count tightened to ≤200
// ---------------------------------------------------------------------------

describe('PM template line count post-refactor', () => {
  it('project-manager.md is at most 200 lines', () => {
    const lines = fs.readFileSync(PM_TEMPLATE, 'utf-8').split('\n');
    expect(lines.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Group 4: Sub-doc line counts ≤300
// ---------------------------------------------------------------------------

describe('PM hub sub-doc line counts', () => {
  const subdocs = [
    'pm-session-setup.md',
    'pm-dispatch-topology.md',
    'pm-verification-gates.md',
    'pm-quality-doc-pipeline.md',
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

describe('PM hub sub-doc frontmatter', () => {
  const subdocs = [
    'pm-session-setup.md',
    'pm-dispatch-topology.md',
    'pm-verification-gates.md',
    'pm-quality-doc-pipeline.md',
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
  it('Documents table has at least 17 rows (13 existing + 4 new PM sub-docs)', () => {
    const content = fs.readFileSync(AGENTS_HUB, 'utf-8');
    // Count lines that look like table rows: start with "| [" (link rows, not header/separator)
    const rows = content.split('\n').filter(line => /^\| \[/.test(line));
    expect(rows.length).toBeGreaterThanOrEqual(17);
  });
});
