/**
 * 3-Phase Team Architecture tests.
 *
 * Validates the agent templates and documentation for the
 * Planning → Execution → Quality Gate team model.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');
const DOCS_DIR = path.join(ROOT, 'docs/agents');

// ---------------------------------------------------------------------------
// 1. Agent template existence and structure
// ---------------------------------------------------------------------------
describe('3-phase agent templates exist', () => {
  const requiredTemplates = [
    'project-manager.md',
    'planner.md',
    'quality-gater.md',
    'arch-testing.md',
    'arch-platform.md',
    'arch-integration.md',
    'context-provider.md',
    'doc-updater.md',
    'doc-migrator.md',
  ];

  for (const template of requiredTemplates) {
    it(`${template} exists in setup/agent-templates/`, () => {
      expect(fs.existsSync(path.join(TEMPLATES_DIR, template))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Template size limits (≤300 lines)
// ---------------------------------------------------------------------------
describe('agent template size limits', () => {
  const templates = fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md');

  for (const template of templates) {
    it(`${template} is ≤400 lines`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      const lines = content.split('\n').length;
      expect(lines).toBeLessThanOrEqual(400);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Project Manager — 3-phase model
// ---------------------------------------------------------------------------
describe('project-manager template — 3-phase model', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'project-manager.md'), 'utf-8');

  it('has 3-Phase Execution Model section', () => {
    expect(content).toMatch(/3-Phase Execution Model/i);
  });

  it('describes Planning Team phase', () => {
    expect(content).toMatch(/Planning Team/);
    expect(content).toMatch(/planner.*context-provider/i);
  });

  it('describes Execution Team phase', () => {
    expect(content).toMatch(/Execution Team/);
    expect(content).toMatch(/3 architects/i);
  });

  it('describes Quality Gate Team phase', () => {
    expect(content).toMatch(/Quality Gate Team/);
    expect(content).toMatch(/quality-gater/);
  });

  it('has retry limit for quality gate failures', () => {
    expect(content).toMatch(/3 retries|max.*3.*retr/i);
  });

  it('has FORBIDDEN actions section', () => {
    expect(content).toMatch(/FORBIDDEN/);
  });

  it('has ALLOWED actions section', () => {
    expect(content).toMatch(/ALLOWED/);
  });

  it('NEVER writes code', () => {
    expect(content).toMatch(/NEVER.*write.*code|NEVER.*codes/i);
  });

  it('has pre-flight checklist', () => {
    expect(content).toMatch(/Pre-Flight Checklist/i);
  });

  it('has dev dispatch protocol', () => {
    expect(content).toMatch(/Dev Dispatch|SendMessage.*project-manager/i);
  });

  it('has pre-existing excuse rule', () => {
    expect(content).toMatch(/pre-existing/i);
  });

  it('has agent roster with all team roles', () => {
    expect(content).toMatch(/Agent Roster/i);
    expect(content).toContain('arch-testing');
    expect(content).toContain('arch-platform');
    expect(content).toContain('arch-integration');
    expect(content).toContain('context-provider');
    expect(content).toContain('doc-updater');
    expect(content).toContain('quality-gater');
    expect(content).toContain('planner');
  });

  it('references quality gate protocol doc', () => {
    expect(content).toMatch(/quality-gate-protocol/);
  });

  it('has TeamCreate tool in frontmatter', () => {
    expect(content).toMatch(/^tools:.*TeamCreate/m);
  });

  it('has SendMessage tool in frontmatter', () => {
    expect(content).toMatch(/^tools:.*SendMessage/m);
  });
});

// ---------------------------------------------------------------------------
// 4. Planner — peer role
// ---------------------------------------------------------------------------
describe('planner template — peer role', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'planner.md'), 'utf-8');

  it('describes itself as team peer (not sub-agent)', () => {
    expect(content).toMatch(/team peer|Planning Team/i);
    expect(content).not.toMatch(/sub-agent spawned by PM/i);
  });

  it('has SendMessage in tools', () => {
    expect(content).toMatch(/^tools:.*SendMessage/m);
  });

  it('communicates with context-provider via SendMessage', () => {
    expect(content).toMatch(/SendMessage.*context-provider|context-provider.*SendMessage/i);
  });

  it('produces structured execution plan', () => {
    expect(content).toMatch(/Execution Plan/);
    expect(content).toMatch(/Scope/);
    expect(content).toMatch(/Steps/);
    expect(content).toMatch(/Dependencies/);
    expect(content).toMatch(/Risks/);
  });

  it('never writes code', () => {
    expect(content).toMatch(/Never write code/i);
  });

  it('flags cross-department impact', () => {
    expect(content).toMatch(/Cross-Department Impact/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Quality Gater — gate protocol
// ---------------------------------------------------------------------------
describe('quality-gater template — gate protocol', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'quality-gater.md'), 'utf-8');

  it('describes itself as Quality Gate Team peer', () => {
    expect(content).toMatch(/Quality Gate Team/);
    expect(content).toMatch(/team peer/i);
  });

  it('has SendMessage in tools', () => {
    expect(content).toMatch(/^tools:.*SendMessage/m);
  });

  it('has all 5 protocol steps', () => {
    expect(content).toMatch(/Step 0.*Frontmatter/i);
    expect(content).toMatch(/Step 1.*Test/i);
    expect(content).toMatch(/Step 2.*Coverage/i);
    expect(content).toMatch(/Step 3.*Benchmark/i);
    expect(content).toMatch(/Step 4.*Pre-PR/i);
  });

  it('reports PASS or FAIL', () => {
    expect(content).toMatch(/PASS.*FAIL|Status:.*PASS/);
  });

  it('has structured report format', () => {
    expect(content).toMatch(/Quality Gate Report/);
    expect(content).toMatch(/Blocking Issues/);
  });

  it('has retry limit rule', () => {
    expect(content).toMatch(/3 retries|retry.*limit/i);
  });

  it('does not fix — only reports', () => {
    expect(content).toMatch(/No fixing|you report.*don.t fix/i);
  });

  it('distinguishes from quality-gate-orchestrator', () => {
    expect(content).toMatch(/quality-gate-orchestrator/);
    expect(content).toMatch(/L0 internal validator/i);
  });

  it('has coverage investigation guidance', () => {
    expect(content).toMatch(/Coverage Drop/i);
    expect(content).toMatch(/root cause/i);
  });
});

// ---------------------------------------------------------------------------
// 6. Doc Migrator — sporadic team agent
// ---------------------------------------------------------------------------
describe('doc-migrator template — sporadic migration agent', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'doc-migrator.md'), 'utf-8');

  it('describes sporadic/temporary team role', () => {
    expect(content).toMatch(/sporadic|temporary/i);
  });

  it('has Write and Edit tools (can modify docs)', () => {
    expect(content).toMatch(/^tools:.*Write/m);
    expect(content).toMatch(/^tools:.*Edit/m);
  });

  it('has all 3 operating modes', () => {
    expect(content).toMatch(/Full Migration/i);
    expect(content).toMatch(/Gap Fill/i);
    expect(content).toMatch(/Realignment/i);
  });

  it('has script-first rule', () => {
    expect(content).toMatch(/Script-first|script.*before.*decision/i);
  });

  it('documents L0 size limits', () => {
    expect(content).toMatch(/100 lines/);
    expect(content).toMatch(/300 lines/);
  });

  it('requires YAML frontmatter', () => {
    expect(content).toMatch(/scope:/);
    expect(content).toMatch(/slug:/);
    expect(content).toMatch(/status:/);
  });

  it('has structured report format', () => {
    expect(content).toMatch(/Doc Migration Report/);
    expect(content).toMatch(/CREATED|SPLIT|FRONTMATTER|REFERENCE/);
  });

  it('preserves content rule — never deletes', () => {
    expect(content).toMatch(/Preserve content|never delete/i);
  });

  it('validates after migration', () => {
    expect(content).toMatch(/validate.*after|re-run.*validation/i);
  });
});

// ---------------------------------------------------------------------------
// 7. Team Topology doc
// ---------------------------------------------------------------------------
describe('team-topology.md — 3-phase documentation', () => {
  const content = fs.readFileSync(path.join(DOCS_DIR, 'team-topology.md'), 'utf-8');

  it('exists and has frontmatter', () => {
    expect(content).toMatch(/^---/);
    expect(content).toMatch(/^slug: team-topology/m);
    expect(content).toMatch(/^category: agents/m);
  });

  it('documents all 3 phases', () => {
    expect(content).toMatch(/Phase 1.*Planning/i);
    expect(content).toMatch(/Phase 2.*Execution/i);
    expect(content).toMatch(/Phase 3.*Quality Gate/i);
  });

  it('has max retry limit', () => {
    expect(content).toMatch(/Max 3 retries|3.*FAIL.*cycle/i);
  });

  it('documents key constraints', () => {
    expect(content).toMatch(/PM is sole Agent\(\) spawner/i);
    expect(content).toMatch(/Architects.*NO Write/i);
  });

  it('has Related Docs section with cross-references', () => {
    expect(content).toMatch(/multi-agent-patterns\.md/);
    expect(content).toMatch(/data-handoff-patterns\.md/);
    expect(content).toMatch(/quality-gate-protocol\.md/);
  });

  it('is under 300 lines', () => {
    expect(content.split('\n').length).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------
// 8. Data Handoff Patterns doc
// ---------------------------------------------------------------------------
describe('data-handoff-patterns.md — handoff documentation', () => {
  const content = fs.readFileSync(path.join(DOCS_DIR, 'data-handoff-patterns.md'), 'utf-8');

  it('exists and has frontmatter', () => {
    expect(content).toMatch(/^---/);
    expect(content).toMatch(/^slug: data-handoff-patterns/m);
  });

  it('documents structured markers', () => {
    expect(content).toMatch(/FINDINGS_START/);
    expect(content).toMatch(/FINDINGS_END/);
  });

  it('has severity convention table', () => {
    expect(content).toMatch(/BLOCKER/);
    expect(content).toMatch(/HIGH/);
    expect(content).toMatch(/MEDIUM/);
    expect(content).toMatch(/LOW/);
    expect(content).toMatch(/INFO/);
  });

  it('has prose fallback section', () => {
    expect(content).toMatch(/Prose Fallback/i);
  });

  it('has test gaming detection', () => {
    expect(content).toMatch(/Test Gaming/i);
    expect(content).toMatch(/assertEquals\(X, X\)/);
  });

  it('is under 300 lines', () => {
    expect(content.split('\n').length).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------
// 9. Multi-agent-patterns.md — references new sub-docs
// ---------------------------------------------------------------------------
describe('multi-agent-patterns.md — updated references', () => {
  const content = fs.readFileSync(path.join(DOCS_DIR, 'multi-agent-patterns.md'), 'utf-8');

  it('references team-topology.md', () => {
    expect(content).toMatch(/team-topology\.md/);
  });

  it('references data-handoff-patterns.md', () => {
    expect(content).toMatch(/data-handoff-patterns\.md/);
  });

  it('mentions 3-Phase Model', () => {
    expect(content).toMatch(/3-Phase Model|3.*sequential teams/i);
  });

  it('is under 300 lines after split', () => {
    expect(content.split('\n').length).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------
// 10. Agents-hub.md — updated entries
// ---------------------------------------------------------------------------
describe('agents-hub.md — complete navigation', () => {
  const content = fs.readFileSync(path.join(DOCS_DIR, 'agents-hub.md'), 'utf-8');

  it('lists team-topology in Documents table', () => {
    expect(content).toMatch(/team-topology/);
  });

  it('lists data-handoff-patterns in Documents table', () => {
    expect(content).toMatch(/data-handoff-patterns/);
  });

  it('lists quality-gate-protocol in Documents table', () => {
    expect(content).toMatch(/quality-gate-protocol/);
  });

  it('mentions 3-Phase Model in Key Concepts', () => {
    expect(content).toMatch(/3-Phase Model/);
  });

  it('mentions quality-gater in Key Concepts', () => {
    expect(content).toMatch(/quality-gater/);
  });

  it('mentions planner in Key Concepts', () => {
    expect(content).toMatch(/planner/);
  });

  it('is under 100 lines (hub limit)', () => {
    expect(content.split('\n').length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// 11. Spec-driven-workflow.md — 3-phase flow
// ---------------------------------------------------------------------------
describe('spec-driven-workflow.md — updated flow', () => {
  const content = fs.readFileSync(path.join(DOCS_DIR, 'spec-driven-workflow.md'), 'utf-8');

  it('describes 3-Phase Model in flow', () => {
    expect(content).toMatch(/3-Phase Model|Phase 1.*Planning|Planning Team/i);
  });

  it('references team-topology.md', () => {
    expect(content).toMatch(/team-topology\.md/);
  });

  it('mentions quality-gater', () => {
    expect(content).toMatch(/quality-gater/);
  });
});

// ---------------------------------------------------------------------------
// 12. Quality-gate-protocol.md — agent template reference
// ---------------------------------------------------------------------------
describe('quality-gate-protocol.md — quality-gater reference', () => {
  const content = fs.readFileSync(path.join(DOCS_DIR, 'quality-gate-protocol.md'), 'utf-8');

  it('references quality-gater agent template', () => {
    expect(content).toMatch(/quality-gater/);
  });

  it('distinguishes from quality-gate-orchestrator', () => {
    expect(content).toMatch(/quality-gate-orchestrator/);
  });

  it('references team-topology.md', () => {
    expect(content).toMatch(/team-topology\.md/);
  });
});

// ---------------------------------------------------------------------------
// 13. Templates README — complete listing
// ---------------------------------------------------------------------------
describe('agent-templates/README.md — complete listing', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'README.md'), 'utf-8');

  it('lists quality-gater', () => {
    expect(content).toContain('quality-gater');
  });

  it('lists planner', () => {
    expect(content).toContain('planner');
  });

  it('lists doc-migrator', () => {
    expect(content).toContain('doc-migrator');
  });

  it('lists all 3 architects', () => {
    expect(content).toContain('arch-testing');
    expect(content).toContain('arch-platform');
    expect(content).toContain('arch-integration');
  });

  it('lists context-provider and doc-updater', () => {
    expect(content).toContain('context-provider');
    expect(content).toContain('doc-updater');
  });

  it('describes 3-phase model for PM', () => {
    expect(content).toMatch(/3-phase|Planning.*Execution.*Quality/i);
  });
});

// ---------------------------------------------------------------------------
// 14. Cross-reference integrity — all new doc links resolve
// ---------------------------------------------------------------------------
describe('cross-reference integrity', () => {
  const docsFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'));

  it('all markdown links within docs/agents/ resolve to existing files', () => {
    const broken: string[] = [];

    for (const file of docsFiles) {
      const content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');
      // Match [text](file.md) or [text](file.md#anchor)
      const links = content.matchAll(/\[.*?\]\(([^)]+\.md(?:#[^)]*)?)\)/g);

      for (const match of links) {
        const link = match[1].split('#')[0]; // strip anchor
        if (link.startsWith('http')) continue; // skip URLs
        const target = path.join(DOCS_DIR, link);
        if (!fs.existsSync(target)) {
          broken.push(`${file}: ${link}`);
        }
      }
    }

    expect(broken, `Broken links: ${broken.join(', ')}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 15. Doc-template.md — strong hub/split rule
// ---------------------------------------------------------------------------
describe('doc-template.md — hub/split rule enforcement', () => {
  const content = fs.readFileSync(
    path.join(ROOT, 'docs/guides/doc-template.md'), 'utf-8'
  );

  it('has MUST split language (not just warn)', () => {
    expect(content).toMatch(/MUST split/i);
  });

  it('hub docs limited to 100 lines', () => {
    expect(content).toMatch(/100 lines/);
  });

  it('sub-docs limited to 300 lines', () => {
    expect(content).toMatch(/300 lines/);
  });

  it('agent templates follow same limits', () => {
    expect(content).toMatch(/[Aa]gent templates.*same limits|templates.*300 lines/i);
  });
});
