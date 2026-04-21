/**
 * Wave 14 topology hardening tests.
 *
 * Enforces tool-list constraints and instruction-text rules that prevent
 * architects and devs from performing direct Grep/Glob pattern searches
 * instead of routing through context-provider.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');

const ARCH_TEMPLATES = ['arch-testing.md', 'arch-platform.md', 'arch-integration.md'];
const DEV_TEMPLATES = ['test-specialist.md', 'ui-specialist.md', 'domain-model-specialist.md', 'data-layer-specialist.md'];

// Session team agents for exclusivity checks (Group D)
const SESSION_TEAM = [
  'team-lead.md', 'planner.md',
  'context-provider.md', 'doc-updater.md',
  'arch-testing.md', 'arch-platform.md', 'arch-integration.md',
  'test-specialist.md', 'ui-specialist.md',
  'domain-model-specialist.md', 'data-layer-specialist.md',
];
const GREP_GLOB_ALLOWED = ['context-provider.md', 'doc-updater.md'];

// Hoist file reads to module scope — shared across Groups A-G
const archContents = Object.fromEntries(
  ARCH_TEMPLATES.map(t => [t, fs.readFileSync(path.join(TEMPLATES_DIR, t), 'utf-8')])
);
const devContents = Object.fromEntries(
  DEV_TEMPLATES.map(t => [t, fs.readFileSync(path.join(TEMPLATES_DIR, t), 'utf-8')])
);

// ---------------------------------------------------------------------------
// Group A: Architect tools EXCLUDE Grep/Glob (6 tests — FAIL now)
// ---------------------------------------------------------------------------
describe('Group A: architect tools exclude Grep and Glob', () => {
  for (const template of ARCH_TEMPLATES) {
    const content = archContents[template];

    it(`${template} tools do NOT include Grep [EXPECT FAIL — Grep currently in tools list]`, () => {
      expect(content).not.toMatch(/^tools:.*\bGrep\b/m);
    });

    it(`${template} tools do NOT include Glob [EXPECT FAIL — Glob currently in tools list]`, () => {
      expect(content).not.toMatch(/^tools:.*\bGlob\b/m);
    });
  }
});

// ---------------------------------------------------------------------------
// Group B: Dev tools INCLUDE SendMessage (4 tests — FAIL now)
// ---------------------------------------------------------------------------
describe('Group B: dev tools include SendMessage', () => {
  for (const template of DEV_TEMPLATES) {
    const content = devContents[template];

    it(`${template} tools include SendMessage [EXPECT FAIL — SendMessage not in tools list]`, () => {
      expect(content).toMatch(/^tools:.*\bSendMessage\b/m);
    });
  }
});

// ---------------------------------------------------------------------------
// Group C: Dev tools EXCLUDE Grep/Glob (8 tests — FAIL now)
// ---------------------------------------------------------------------------
describe('Group C: dev tools exclude Grep and Glob', () => {
  for (const template of DEV_TEMPLATES) {
    const content = devContents[template];

    it(`${template} tools do NOT include Grep [EXPECT FAIL — Grep currently in tools list]`, () => {
      expect(content).not.toMatch(/^tools:.*\bGrep\b/m);
    });

    it(`${template} tools do NOT include Glob [EXPECT FAIL — Glob currently in tools list]`, () => {
      expect(content).not.toMatch(/^tools:.*\bGlob\b/m);
    });
  }
});

// ---------------------------------------------------------------------------
// Group D: Exclusivity — only context-provider and doc-updater have Grep/Glob
// among session team agents (2 tests — FAIL now)
// ---------------------------------------------------------------------------
describe('Group D: Grep/Glob exclusivity among session team agents', () => {
  it('only context-provider and doc-updater have Grep in tools among session team agents [EXPECT FAIL — arch + dev templates currently violate this]', () => {
    for (const file of SESSION_TEAM) {
      const filePath = path.join(TEMPLATES_DIR, file);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.match(/^tools:/m)) continue;
      if (GREP_GLOB_ALLOWED.includes(file)) continue;
      expect(content).not.toMatch(/^tools:.*\bGrep\b/m);
    }
  });

  it('only context-provider and doc-updater have Glob in tools among session team agents [EXPECT FAIL — arch + dev templates currently violate this]', () => {
    for (const file of SESSION_TEAM) {
      const filePath = path.join(TEMPLATES_DIR, file);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.match(/^tools:/m)) continue;
      if (GREP_GLOB_ALLOWED.includes(file)) continue;
      expect(content).not.toMatch(/^tools:.*\bGlob\b/m);
    }
  });
});

// ---------------------------------------------------------------------------
// Group E: Arch instruction text — pattern lookup delegation rule
// (3 tests — PASS already)
// ---------------------------------------------------------------------------
describe('Group E: arch instruction text — pattern lookup delegation rule', () => {
  for (const template of ARCH_TEMPLATES) {
    const content = archContents[template];

    it(`${template} has SendMessage-to-context-provider or FORBIDDEN-Grep/Glob rule`, () => {
      expect(content).toMatch(/SendMessage.*context-provider|FORBIDDEN.*Grep.*Glob/i);
    });
  }
});

// ---------------------------------------------------------------------------
// Group F: Dev instruction text — routes to architect, not direct to context-provider
// (8 tests — PASS already)
// ---------------------------------------------------------------------------
describe('Group F: dev instruction text — routes to architect not context-provider', () => {
  for (const template of DEV_TEMPLATES) {
    const content = devContents[template];

    it(`${template} instructs routing to architect via SendMessage`, () => {
      expect(content).toMatch(/SendMessage.*arch/i);
    });

    it(`${template} does NOT contain direct SendMessage to context-provider`, () => {
      expect(content).not.toContain('SendMessage(to="context-provider"');
    });
  }
});

// ---------------------------------------------------------------------------
// Group G: Caller Grep Rule delegation — arch-platform + arch-integration
// must delegate via SendMessage to context-provider (2 tests — FAIL now)
// ---------------------------------------------------------------------------
describe('Group G: Caller Grep Rule section delegates via SendMessage to context-provider', () => {
  it('arch-platform Caller Grep Rule section delegates via SendMessage to context-provider [EXPECT FAIL — SendMessage in section points to team-lead, not context-provider]', () => {
    const content = archContents['arch-platform.md'];
    expect(content).toMatch(/Caller Grep Rule[\s\S]{0,500}SendMessage[\s\S]{0,200}context-provider/);
  });

  it('arch-integration Caller Grep Rule section delegates via SendMessage to context-provider [EXPECT FAIL — SendMessage in section points to team-lead, not context-provider]', () => {
    const content = archContents['arch-integration.md'];
    expect(content).toMatch(/Caller Grep Rule[\s\S]{0,500}SendMessage[\s\S]{0,200}context-provider/);
  });
});
