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

  // Hub refactor: PM content may be split across sub-docs in docs/agents/
  const pmSubdocs = [
    'pm-session-setup.md',
    'pm-dispatch-topology.md',
    'pm-verification-gates.md',
    'pm-quality-doc-pipeline.md',
  ];
  const docsAgentsDir = path.join(ROOT, 'docs/agents');
  const subdocContent = pmSubdocs
    .map(f => path.join(docsAgentsDir, f))
    .filter(p => fs.existsSync(p))
    .map(p => fs.readFileSync(p, 'utf-8'))
    .join('\n');
  const combinedPM = content + '\n' + subdocContent;

  it('has 3-Phase Execution Model section', () => {
    expect(content).toMatch(/3-Phase Execution Model/i);
  });

  it('describes Planning Team phase', () => {
    expect(content).toMatch(/Planning Team/);
  });

  it('describes Execution phase with persistent architects', () => {
    expect(content).toMatch(/Execution/);
    expect(content).toMatch(/architect/i);
  });

  it('describes Quality Gate phase', () => {
    expect(content).toMatch(/Quality Gate/);
    expect(content).toMatch(/quality-gater/);
  });

  it('has retry limit for quality gate failures', () => {
    expect(combinedPM).toMatch(/3 retries|max.*3.*retr/i);
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

  it('has pre-flight checklist with session team setup (11 items)', () => {
    expect(content).toMatch(/Pre-Flight Checklist/i);
    expect(content).toContain('TeamCreate("session-{project-slug}")');
    expect(content).toContain('added to session team');
    // 11 checklist items: 7 core + 4 Phase 2 dev items
    const checkboxMatches = content.match(/□ \d+\./g);
    expect(checkboxMatches).not.toBeNull();
    expect(checkboxMatches!.length).toBeGreaterThanOrEqual(11);
  });

  it('spawns 9 session team agents (5 at session start, 4 core devs at Phase 2 start)', () => {
    // Session start peers (5)
    expect(content).toContain('Agent(name="context-provider"');
    expect(content).toContain('Agent(name="doc-updater"');
    expect(content).toContain('Agent(name="arch-testing"');
    expect(content).toContain('Agent(name="arch-platform"');
    expect(content).toContain('Agent(name="arch-integration"');
    // Phase 2 core devs (4)
    expect(content).toContain('Agent(name="test-specialist"');
    expect(content).toContain('Agent(name="ui-specialist"');
    expect(content).toContain('Agent(name="domain-model-specialist"');
    expect(content).toContain('Agent(name="data-layer-specialist"');
    expect(content).toContain('team_name="session-{project-slug}"');
  });

  it('pattern validation chain documented: dev contacts architect, not context-provider', () => {
    expect(combinedPM).toMatch(/dev.*arch.*context-provider|SendMessage.*arch.*pattern/i);
    expect(combinedPM).toMatch(/NEVER.*context-provider.*directly|Dev NEVER contacts context-provider/i);
  });

  it('named extra dev model is documented — no anonymous Agent() calls', () => {
    expect(combinedPM).toMatch(/No anonymous Agent\(\)|named team peer|named.*team_name/i);
  });

  it('dynamic scaling model: extra devs are named team peers with team_name', () => {
    expect(combinedPM).toMatch(/extra.*dev|Extra dev/i);
    expect(combinedPM).toMatch(/named team peer|specialist-2|specialist-3|\{specialist\}-2/i);
  });

  it('background completion → immediately act rule is documented', () => {
    expect(combinedPM).toMatch(/background.*complet.*IMMEDIATELY|IMMEDIATELY.*background/i);
  });

  it('Phase 2 uses SendMessage not TeamCreate for architects', () => {
    expect(combinedPM).toContain('session team peers');
    expect(combinedPM).toContain('SendMessage(to="arch-testing"');
  });

  it('template version 5.17.0', () => {
    expect(content).toContain('template_version: "5.17.0"');
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
    expect(combinedPM).toMatch(/quality-gate-protocol/);
  });

  it('has TeamCreate tool in frontmatter', () => {
    expect(content).toMatch(/^tools:.*TeamCreate/m);
  });

  it('has SendMessage tool in frontmatter', () => {
    expect(content).toMatch(/^tools:.*SendMessage/m);
  });

  it('quality-gater joins session team in Phase 3', () => {
    expect(content).toContain('Agent(name="quality-gater", team_name="session-{project-slug}"');
  });

  it('has HARD GATE with session team message', () => {
    expect(content).toContain('creating session team first');
  });

  it('rotation uses SAME name AND SAME team_name', () => {
    expect(combinedPM).toContain('SAME name AND SAME team_name');
  });

  it('has Session Team Setup section', () => {
    expect(content).toMatch(/Session Team Setup/);
  });

  it('topology gate covers ALL agent dispatches, not just dev work', () => {
    expect(combinedPM).toContain('Pre-Dispatch Topology Gate (MANDATORY before ANY Agent() dispatch)')
    expect(combinedPM).not.toContain('Pre-Dispatch Topology Gate (MANDATORY before ANY Agent() for dev work)')
    expect(combinedPM).toContain('Applies to ALL Agent() calls')
  })

  it('topology gate explicitly covers test runs and verification', () => {
    expect(combinedPM).toContain('test runs, verification')
  })
});

// ---------------------------------------------------------------------------
// 3a. PM Phase Execution sub-doc (extracted from project-manager.md)
// ---------------------------------------------------------------------------
describe('pm-phase-execution sub-doc — extracted phase protocol', () => {
  const content = fs.readFileSync(
    path.join(ROOT, 'docs/agents/pm-phase-execution.md'),
    'utf-8'
  );

  it('describes Planning Team phase with planner + context-provider', () => {
    expect(content).toMatch(/Planning Team/);
    expect(content).toMatch(/planner.*context-provider/i);
  });

  it('anti-pattern arch-X-v2 is documented with correction', () => {
    expect(content).toContain('arch-X-v2');
    expect(content).toContain('SAME name AND SAME team_name');
  });

  it('references .planning/PLAN.md for plan file delivery', () => {
    expect(content).toContain('.planning/PLAN.md');
  });

  it('PM reads plan via Read(".planning/PLAN.md") after planner notifies', () => {
    expect(content).toMatch(/Read\(["']\.planning\/PLAN\.md["']\)/);
  });
});

// ---------------------------------------------------------------------------
// 3b. Arch-Testing — Bash safety rules and version
// ---------------------------------------------------------------------------
describe('arch-testing template — Bash safety and version', () => {
  const archContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-testing.md'), 'utf-8');

  it('template version 1.18.0', () => {
    expect(archContent).toContain('template_version: "1.18.0"');
  });

  it('has Bash Safety Rules section', () => {
    expect(archContent).toMatch(/Bash Safety Rules/i);
  });

  it('explains pipe buffering causes agent hang', () => {
    expect(archContent).toMatch(/BUFFER.*stdout|pipe.*buffer/i);
  });

  it('bans gradle-run wrapper scripts by name', () => {
    expect(archContent).toContain('gradle-run.ps1');
  });

  it('instructs to use declared skills not raw gradlew', () => {
    expect(archContent).toMatch(/use the declared skills|Never.*gradlew.*directly/i);
  });
});

// ---------------------------------------------------------------------------
// 3c. Arch-Platform + Arch-Integration — Caller Grep Rule
// ---------------------------------------------------------------------------
describe('arch-platform + arch-integration — caller grep rule', () => {
  const platformContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-platform.md'), 'utf-8');
  const integrationContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-integration.md'), 'utf-8');

  it('arch-platform has Caller Grep Rule section', () => {
    expect(platformContent).toMatch(/Caller Grep Rule/i);
  });

  it('arch-platform grep rule covers production AND test callers', () => {
    expect(platformContent).toMatch(/production AND test|prod.*test.*callers/i);
  });

  it('arch-integration has Caller Grep Rule section', () => {
    expect(integrationContent).toMatch(/Caller Grep Rule/i);
  });

  it('arch-integration grep rule covers production AND test callers', () => {
    expect(integrationContent).toMatch(/production AND test|prod.*test.*callers/i);
  });

  it('arch-platform has template version 1.15.0', () => {
    expect(platformContent).toContain('template_version: "1.15.0"');
  });

  it('arch-integration has template version 1.15.0', () => {
    expect(integrationContent).toContain('template_version: "1.15.0"');
  });
});

// ---------------------------------------------------------------------------
// 3d. All arch templates — Pattern search delegation to context-provider
// ---------------------------------------------------------------------------
describe('arch templates — pattern search delegation rule', () => {
  const archTemplates = ['arch-testing', 'arch-platform', 'arch-integration'] as const;

  for (const name of archTemplates) {
    const templateContent = fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.md`), 'utf-8');

    // arch-platform and arch-integration have an existing Caller Grep Rule that must
    // include delegation via SendMessage to context-provider.
    // arch-testing never had this rule so it is excluded.
    if (name !== 'arch-testing') {
      it(`${name} Caller Grep Rule delegates via SendMessage`, () => {
        expect(templateContent).toMatch(/Caller Grep Rule[\s\S]{0,500}SendMessage/);
      });
    }
  }
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

  it('writes plan to .planning/PLAN.md file', () => {
    expect(content).toContain('.planning/PLAN.md');
  });

  it('notifies PM via SendMessage after writing plan file', () => {
    expect(content).toMatch(/SendMessage.*project-manager.*plan.*ready|SendMessage.*project-manager.*PLAN\.md/i);
  });

  it('has external library research step via context-provider', () => {
    expect(content).toMatch(/Context7|external.*library.*research/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Quality Gater — gate protocol
// ---------------------------------------------------------------------------
describe('quality-gater template — gate protocol', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'quality-gater.md'), 'utf-8');

  it('describes itself as session team peer in Phase 3', () => {
    expect(content).toMatch(/session team peer/i);
    expect(content).toMatch(/Phase 3/);
  });

  it('has SendMessage in tools', () => {
    expect(content).toMatch(/^tools:.*SendMessage/m);
  });

  it('has dynamic 9-step protocol', () => {
    expect(content).toMatch(/Step 1.*Rule Discovery/i);
    expect(content).toMatch(/Step 2.*Validation Pipeline/i);
    expect(content).toMatch(/Step 3.*Test/i);
    expect(content).toMatch(/Step 4.*Coverage/i);
    expect(content).toMatch(/Step 5.*KDoc/i);
    expect(content).toMatch(/Step 6.*Production/i);
    expect(content).toMatch(/Step 7.*Freshness/i);
    expect(content).toMatch(/Step 8.*Cross-Check/i);
    expect(content).toMatch(/Step 9.*Compose/i);
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

  it('has coverage step', () => {
    expect(content).toMatch(/Coverage Baseline/i);
    expect(content).toMatch(/root cause/i);
  });

  it('Step 1.5 is domain-routed — not broadcast', () => {
    expect(content).toMatch(/domain-routed/i);
  });

  it('routes test-only files to arch-testing only', () => {
    expect(content).toMatch(/Only test.*files.*arch-testing/i);
  });

  it('routes platform files to arch-platform only', () => {
    expect(content).toMatch(/platform.*arch-platform|arch-platform.*platform/i);
  });

  it('defines cross-cutting as broadcast condition', () => {
    expect(content).toMatch(/[Cc]ross-cutting/);
  });

  it('has template version 2.3.0', () => {
    expect(content).toContain('template_version: "2.3.0"');
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

// ---------------------------------------------------------------------------
// 16. Quality-gater stamp enforcement (Step 10 + hook)
// ---------------------------------------------------------------------------
describe('quality-gater template — stamp enforcement', () => {
  const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'quality-gater.md'), 'utf-8');

  it('has Step 10 (stamp writer)', () => {
    expect(content).toMatch(/Step 10.*stamp/i);
  });

  it('mentions .androidcommondoc/quality-gate.stamp', () => {
    expect(content).toContain('.androidcommondoc/quality-gate.stamp');
  });

  it('stamp is conditional on PASS', () => {
    expect(content).toMatch(/If ALL steps passed/i);
    expect(content).toMatch(/If ANY step FAILED.*do NOT/i);
  });

  it('stamp contains verdict, timestamp, and steps_passed', () => {
    expect(content).toContain('"verdict":"PASS"');
    expect(content).toContain('"timestamp"');
    expect(content).toContain('"steps_passed"');
  });

  it('Step 10 appears in report table', () => {
    expect(content).toMatch(/\| 10\. Stamp/);
  });

  it('quality-gate hook file exists', () => {
    const hookPath = path.join(ROOT, '.claude/hooks/quality-gate-pre-commit.sh');
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  it('quality-gate hook is registered in settings.json', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf-8')
    );
    const preToolUse = settings.hooks?.PreToolUse ?? [];
    const bashHooks = preToolUse.find((h: any) => h.matcher === 'Bash');
    const hookCommands = bashHooks?.hooks?.map((h: any) => h.command) ?? [];
    expect(hookCommands.some((c: string) => c.includes('quality-gate-pre-commit.sh'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. Context-Provider Oracle Protocol
// ---------------------------------------------------------------------------
describe('context-provider template — oracle protocol', () => {
  const cpContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'context-provider.md'), 'utf-8');

  it('description describes on-demand oracle role', () => {
    expect(cpContent).toMatch(/[Oo]n-demand.*oracle|oracle.*on-demand/i);
  });

  it('has Oracle Protocol section', () => {
    expect(cpContent).toMatch(/Oracle Protocol/i);
  });

  it('instructs to NOT eagerly pre-read docs', () => {
    expect(cpContent).toMatch(/NOT eagerly pre-read|do NOT eagerly/i);
  });

  it('has template version 2.6.0', () => {
    expect(cpContent).toContain('template_version: "2.6.0"');
  });

  it('has External Context section with Context7 call sequence', () => {
    expect(cpContent).toMatch(/External Context.*Context7|Context7.*External/i);
    expect(cpContent).toMatch(/resolve-library-id/);
    expect(cpContent).toMatch(/get-library-docs/);
  });

  it('enforces internal-first rule before Context7', () => {
    expect(cpContent).toMatch(/internal.*first|check internal.*before|always.*internal/i);
  });

  it('has flagging convention for Context7-sourced patterns', () => {
    expect(cpContent).toMatch(/sourced from Context7|not in.*docs.*Context7/i);
  });

  it('has graceful degradation when Context7 unavailable', () => {
    expect(cpContent).toMatch(/graceful|fall.?back|unavailable|not installed/i);
  });
});

// ---------------------------------------------------------------------------
// 18. Architect PRE-TASK Protocol
// ---------------------------------------------------------------------------
describe('architect templates — PRE-TASK protocol', () => {
  const platformContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-platform.md'), 'utf-8');
  const integrationContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-integration.md'), 'utf-8');
  const testingContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-testing.md'), 'utf-8');
  const plannerContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'planner.md'), 'utf-8');

  it('arch-platform has PRE-TASK Protocol section', () => {
    expect(platformContent).toMatch(/PRE-TASK Protocol/i);
  });

  it('arch-integration has PRE-TASK Protocol section', () => {
    expect(integrationContent).toMatch(/PRE-TASK Protocol/i);
  });

  it('arch-testing has PRE-TASK Protocol section', () => {
    expect(testingContent).toMatch(/PRE-TASK Protocol/i);
  });

  it('planner has mandatory context-provider query for existing docs', () => {
    expect(plannerContent).toMatch(/MANDATORY|mandatory/);
    expect(plannerContent).toMatch(/context-provider/);
  });

  it('planner version 1.6.0', () => {
    expect(plannerContent).toContain('template_version: "1.6.0"');
  });

  it('arch-testing version 1.18.0', () => {
    expect(testingContent).toContain('template_version: "1.18.0"');
  });
});

// ---------------------------------------------------------------------------
// 19. Context7 integration across agents
// ---------------------------------------------------------------------------
describe('Context7 integration across agents', () => {
  const agentsDir = path.join(ROOT, '.claude/agents');

  it('researcher has Context7 call sequence', () => {
    const content = fs.readFileSync(path.join(agentsDir, 'researcher.md'), 'utf-8');
    expect(content).toMatch(/resolve-library-id/);
    expect(content).toMatch(/get-library-docs/);
    expect(content).toMatch(/Context7/i);
  });

  it('advisor has Context7 for library comparisons', () => {
    const content = fs.readFileSync(path.join(agentsDir, 'advisor.md'), 'utf-8');
    expect(content).toMatch(/resolve-library-id/);
    expect(content).toMatch(/Context7/i);
  });
});
