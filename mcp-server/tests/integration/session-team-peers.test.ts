/**
 * Core dev specialist template tests (BL-W48 adapter-capability model).
 *
 * Validates that all 4 core dev agent templates exist in setup/agent-templates/
 * with the correct structure, Coordination Context section (orchestrator + adapter
 * model — background peer when the runtime supports it, else single-use + disk
 * artifacts), pattern validation chain, and reporting architect references. The named
 * session-team coupling (session-{project-slug}, "persistent session team member",
 * "team-lead spawns you at Phase 2") was retired with TeamCreate/TeamList.
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
    'test-specialist.md': '1.32.0',
    'ui-specialist.md': '1.22.0',
    'data-layer-specialist.md': '1.20.0',
    'domain-model-specialist.md': '1.20.0',
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
// 3. Each dev template has Coordination Context section (BL-W48 adapter model)
// ---------------------------------------------------------------------------
describe('dev template identity — Coordination Context (adapter-capability model)', () => {
  for (const template of DEV_TEMPLATES) {
    it(`${template} has "Coordination Context" section`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/## Coordination Context/i);
    });

    it(`${template} describes the adapter spawn model (background peer or single-use + disk)`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/background peer/i);
      expect(content).toMatch(/single-use|disk artifact/i);
    });

    it(`${template} states the orchestrator mechanically spawns it (named-team framing retired)`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/orchestrator mechanically spawns/i);
      expect(content).not.toMatch(/persistent session team member/i);
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
// 6. BL-W48: named session-team coupling retired (no session-{project-slug})
// ---------------------------------------------------------------------------
describe('dev template — named-team coupling retired (adapter model)', () => {
  for (const template of DEV_TEMPLATES) {
    it(`${template} no longer couples to the named session-{project-slug} team`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      // BL-W48: TeamCreate/TeamList removed; identity no longer binds to a named
      // session team. State lands/loads via disk artifacts; architect owns task spec.
      expect(content).not.toContain('session-{project-slug}');
      expect(content).toMatch(/disk artifact|Reporting architect/i);
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
// 9. team-topology: two-layer model (BL-W48 — named-team broadcast removed)
// ---------------------------------------------------------------------------
describe('team-topology: two-layer orchestration model', () => {
  it('team-topology documents the two-layer orchestration model', () => {
    // BL-W48 team-model root-fix: TeamCreate/TeamList removed from this Claude Code
    // build. The named-session-team model is obsolete. Broadcast workaround
    // (SendMessage(to="*")) required a team; it's removed with the team model.
    // The new two-layer model: orchestrator (main agent) + single-use subagents
    // (architects/specialists) coordinating via disk artifacts.
    const content = fs.readFileSync(
      path.join(ROOT, 'docs/agents/team-topology.md'), 'utf-8'
    );
    // Two-layer model replaces named-team topology
    expect(content).toMatch(/two-layer|single-use subagent|orchestrator.*subagent/i);
  });
});
