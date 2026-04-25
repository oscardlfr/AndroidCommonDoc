/**
 * Dev template behavioral regression tests.
 *
 * Enforces mandatory consultation rules, verification-before-done requirements,
 * no-changes-without-evidence prohibition, and cross-template consistency across
 * all 4 dev specialist templates.
 *
 * Tests marked [EXPECT FAIL] are regression anchors — they will fail on current
 * templates and pass after the corresponding template fix is applied.
 *
 * Templates tested:
 *   - setup/agent-templates/test-specialist.md
 *   - setup/agent-templates/ui-specialist.md
 *   - setup/agent-templates/domain-model-specialist.md
 *   - setup/agent-templates/data-layer-specialist.md
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');

// ---------------------------------------------------------------------------
// Group 1: test-specialist consultation rules
// ---------------------------------------------------------------------------

describe('test-specialist consultation rules', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'test-specialist.md'), 'utf-8');

  it('MUST consult arch-testing before reporting completion [EXPECT FAIL — current language is passive "has verified", not MUST]', () => {
    expect(content).toMatch(
      /MUST.*arch-testing.*approv|arch-testing.*MUST.*verif|consult.*arch-testing.*before.*done|MUST.*report.*arch-testing/i
    );
  });

  it('MUST run verification before reporting done [EXPECT FAIL — Regression Guard says MUST pass but not keyed to "reporting done"]', () => {
    expect(content).toMatch(/MUST pass before reporting done|tests MUST pass before report|MUST.*verif.*before.*report/i);
  });

  it('NEVER report no-changes without evidence [EXPECT FAIL — no such rule exists]', () => {
    expect(content).toMatch(/NEVER.*no changes needed|no.*changes.*without.*evidence|MUST.*evidence.*before.*no.change/i);
  });
});

// ---------------------------------------------------------------------------
// Group 2: ui-specialist consultation rules
// ---------------------------------------------------------------------------

describe('ui-specialist consultation rules', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'ui-specialist.md'), 'utf-8');

  it('MUST consult arch-testing before reporting completion [EXPECT FAIL — current language is passive "has verified", not MUST]', () => {
    expect(content).toMatch(
      /MUST.*arch-testing.*approv|arch-testing.*MUST.*verif|consult.*arch-testing.*before.*done|MUST.*report.*arch-testing/i
    );
  });

  it('MUST run verification before reporting done [EXPECT FAIL — no "MUST pass before reporting done" in ui-specialist]', () => {
    expect(content).toMatch(/MUST pass before reporting done|tests MUST pass before report|MUST.*verif.*before.*report/i);
  });

  it('NEVER report no-changes without evidence [EXPECT FAIL — no such rule exists]', () => {
    expect(content).toMatch(/NEVER.*no changes needed|no.*changes.*without.*evidence|MUST.*evidence.*before.*no.change/i);
  });
});

// ---------------------------------------------------------------------------
// Group 3: domain-model-specialist consultation rules
// ---------------------------------------------------------------------------

describe('domain-model-specialist consultation rules', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'domain-model-specialist.md'), 'utf-8');

  it('MUST consult arch-platform before reporting completion [EXPECT FAIL — current language is passive "has verified", not MUST]', () => {
    expect(content).toMatch(
      /MUST.*arch-platform.*approv|arch-platform.*MUST.*verif|consult.*arch-platform.*before.*done|MUST.*report.*arch-platform/i
    );
  });

  it('MUST run verification before reporting done', () => {
    // domain-model-specialist line 130: "tests MUST pass before reporting done"
    expect(content).toMatch(/MUST pass before reporting done|tests MUST pass before report|MUST.*verif.*before.*report/i);
  });

  it('NEVER report no-changes without evidence [EXPECT FAIL — no such rule exists]', () => {
    expect(content).toMatch(/NEVER.*no changes needed|no.*changes.*without.*evidence|MUST.*evidence.*before.*no.change/i);
  });
});

// ---------------------------------------------------------------------------
// Group 4: data-layer-specialist consultation rules
// ---------------------------------------------------------------------------

describe('data-layer-specialist consultation rules', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'data-layer-specialist.md'), 'utf-8');

  it('MUST consult reporting architects before reporting completion [EXPECT FAIL — current language is passive "has verified", not MUST]', () => {
    expect(content).toMatch(
      /MUST.*arch-platform.*approv|arch-platform.*AND.*arch-integration.*verif|MUST.*both.*arch.*approv/i
    );
  });

  it('MUST run verification before reporting done', () => {
    // data-layer-specialist line 124: "tests MUST pass before reporting done"
    expect(content).toMatch(/MUST pass before reporting done|tests MUST pass before report/i);
  });

  it('NEVER report no-changes without evidence [EXPECT FAIL — no such rule exists]', () => {
    expect(content).toMatch(/NEVER.*no changes needed|no.*changes.*without.*evidence/i);
  });
});

// ---------------------------------------------------------------------------
// Group 5: cross-template consultation consistency
// ---------------------------------------------------------------------------

describe('cross-template consultation consistency', () => {
  const DEV_TEMPLATES = [
    'test-specialist.md',
    'ui-specialist.md',
    'domain-model-specialist.md',
    'data-layer-specialist.md',
  ];

  it('all 4 dev templates require architect approval before done', () => {
    for (const t of DEV_TEMPLATES) {
      const c = fs.readFileSync(path.join(TEMPLATES_DIR, t), 'utf-8');
      expect(c, `${t} must require architect approval`).toMatch(/arch.*verif.*APPROV|APPROV.*your work|arch.*has verified/i);
    }
  });

  it('test-specialist and ui-specialist both reference arch-testing', () => {
    const testSpec = fs.readFileSync(path.join(TEMPLATES_DIR, 'test-specialist.md'), 'utf-8');
    const uiSpec = fs.readFileSync(path.join(TEMPLATES_DIR, 'ui-specialist.md'), 'utf-8');
    expect(testSpec).toMatch(/arch-testing/i);
    expect(uiSpec).toMatch(/arch-testing/i);
  });

  it('domain-model and data-layer both reference arch-platform', () => {
    const domain = fs.readFileSync(path.join(TEMPLATES_DIR, 'domain-model-specialist.md'), 'utf-8');
    const data = fs.readFileSync(path.join(TEMPLATES_DIR, 'data-layer-specialist.md'), 'utf-8');
    expect(domain).toMatch(/arch-platform/i);
    expect(data).toMatch(/arch-platform/i);
  });
});

// ---------------------------------------------------------------------------
// Group 6: dev template structural invariants
// ---------------------------------------------------------------------------

describe('dev template structural invariants', () => {
  const DEV_TEMPLATES = [
    'test-specialist.md',
    'ui-specialist.md',
    'domain-model-specialist.md',
    'data-layer-specialist.md',
  ];

  it('all 4 dev templates are at most 300 lines', () => {
    for (const t of DEV_TEMPLATES) {
      const c = fs.readFileSync(path.join(TEMPLATES_DIR, t), 'utf-8');
      expect(c.trimEnd().split('\n').length, `${t} must be ≤315 lines`).toBeLessThanOrEqual(315)  // W31.6: +14-line BANNED-TOOLS banner;
    }
  });

  it('all 4 dev templates have semver template_version', () => {
    for (const t of DEV_TEMPLATES) {
      const c = fs.readFileSync(path.join(TEMPLATES_DIR, t), 'utf-8');
      expect(c, `${t} must have semver version`).toMatch(/template_version:\s*"\d+\.\d+\.\d+"/);
    }
  });
});
