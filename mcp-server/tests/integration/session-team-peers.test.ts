/**
 * Session Team Peer Dev Templates tests.
 *
 * Validates that all 4 core dev agent templates exist in setup/agent-templates/
 * with the correct structure, Team Identity section, pattern validation chain,
 * and reporting architect references.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');

const DEV_TEMPLATES = [
  'test-specialist.md',
  'ui-specialist.md',
  'data-layer-specialist.md',
  'domain-model-specialist.md',
];

// ---------------------------------------------------------------------------
// 1. All 4 dev templates exist in setup/agent-templates/
// ---------------------------------------------------------------------------
describe('dev template existence', () => {
  for (const template of DEV_TEMPLATES) {
    it(`${template} exists in setup/agent-templates/`, () => {
      expect(fs.existsSync(path.join(TEMPLATES_DIR, template))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Each dev template has template_version in frontmatter
// ---------------------------------------------------------------------------
describe('dev template structure — template_version in frontmatter', () => {
  const EXPECTED_VERSIONS: Record<string, string> = {
    'test-specialist.md': '1.9.0',
    'ui-specialist.md': '1.9.0',
    'data-layer-specialist.md': '1.8.0',
    'domain-model-specialist.md': '1.8.0',
  };

  for (const template of DEV_TEMPLATES) {
    it(`${template} has template_version field`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/^template_version:/m);
    });

    it(`${template} template_version is "${EXPECTED_VERSIONS[template]}"`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toContain(`template_version: "${EXPECTED_VERSIONS[template]}"`);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Each dev template has Team Identity section
// ---------------------------------------------------------------------------
describe('dev template identity — Team Identity section', () => {
  for (const template of DEV_TEMPLATES) {
    it(`${template} has "Team Identity" section`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/## Team Identity/i);
    });

    it(`${template} declares itself a persistent session team member`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/persistent session team member/i);
    });

    it(`${template} states team-lead spawns it at Phase 2 start`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/team-lead spawns.*Phase 2|spawns you at Phase 2/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Each dev template has Pattern validation chain content
// ---------------------------------------------------------------------------
describe('dev template chain — Pattern validation chain', () => {
  for (const template of DEV_TEMPLATES) {
    it(`${template} has Pattern validation chain section`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/Pattern validation chain/i);
    });

    it(`${template} forbids direct SendMessage to context-provider`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/NEVER.*SendMessage.*context-provider|NEVER.*contact.*context-provider/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Each dev template references its reporting architect(s)
// ---------------------------------------------------------------------------
describe('dev template architect — reporting architect assignments', () => {
  it('test-specialist reports to arch-testing', () => {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'test-specialist.md'), 'utf-8');
    expect(content).toMatch(/arch-testing/);
    expect(content).toMatch(/Reporting architect.*arch-testing|arch-testing.*Reporting/i);
  });

  it('ui-specialist reports to arch-testing and arch-integration', () => {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'ui-specialist.md'), 'utf-8');
    expect(content).toMatch(/arch-testing/);
    expect(content).toMatch(/arch-integration/);
  });

  it('domain-model-specialist reports to arch-platform', () => {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'domain-model-specialist.md'), 'utf-8');
    expect(content).toMatch(/arch-platform/);
    expect(content).toMatch(/Reporting architect.*arch-platform|arch-platform.*Reporting/i);
  });

  it('data-layer-specialist reports to arch-platform and arch-integration', () => {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'data-layer-specialist.md'), 'utf-8');
    expect(content).toMatch(/arch-platform/);
    expect(content).toMatch(/arch-integration/);
  });
});

// ---------------------------------------------------------------------------
// 6. Each dev template references session-{project-slug}
// ---------------------------------------------------------------------------
describe('dev template team — session-{project-slug} reference', () => {
  for (const template of DEV_TEMPLATES) {
    it(`${template} references session-{project-slug}`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toContain('session-{project-slug}');
    });
  }
});

// ---------------------------------------------------------------------------
// 7. All dev templates are within the 400-line limit
// ---------------------------------------------------------------------------
describe('dev template size limits', () => {
  for (const template of DEV_TEMPLATES) {
    it(`${template} is <=400 lines`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      const lines = content.split('\n').length;
      expect(lines).toBeLessThanOrEqual(400);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. All dev templates also exist in .claude/agents/ (dual-location rule)
// ---------------------------------------------------------------------------
describe('dev template dual-location — also in .claude/agents/', () => {
  const AGENTS_DIR = path.join(ROOT, '.claude/agents');

  for (const template of DEV_TEMPLATES) {
    it(`${template} also exists in .claude/agents/`, () => {
      expect(fs.existsSync(path.join(AGENTS_DIR, template))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 9. team-topology broadcast workaround documentation
// ---------------------------------------------------------------------------
describe('team-topology broadcast workaround documentation', () => {
  it('team-topology documents SendMessage broadcast workaround', () => {
    const content = fs.readFileSync(
      path.join(ROOT, 'docs/agents/team-topology.md'), 'utf-8'
    );
    expect(content).toContain('SendMessage(to="*")');
    expect(content).toMatch(/workaround|individual messages/i);
  });
});
