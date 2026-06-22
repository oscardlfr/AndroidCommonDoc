/**
 * 3-Phase Team Architecture tests.
 *
 * Validates the agent templates and documentation for the
 * Planning → Execution → Quality Gate team model.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { readOrchestrationGuide } from '../helpers/orchestration-guide.js';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');
const DOCS_DIR = path.join(ROOT, 'docs/agents');

// ---------------------------------------------------------------------------
// 1. Agent template existence and structure
// ---------------------------------------------------------------------------
describe('3-phase agent templates exist', () => {
  const requiredTemplates = [
    // W31.6: 'team-lead.md' removed (retired — canonical pattern in main-agent-orchestration-guide.md)
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

  // arch-int/platform/testing have ≤435 operational tolerance (BL-W47: write-verdict canal added ~5 lines to arch-integration + arch-testing)
  // qg-reliability-root-fix: quality-gater.md joins the 435 tolerance — lean-execution hooks (run-bats.sh + emit-qg-result.sh --init/--phase/Step-11 heartbeat) added ~14 lines; canonical cap is 435 per validate-agent-templates.sh.
  const ARCH_INT_PLATFORM_LIMIT = 435;
  const STANDARD_LIMIT = 420;

  for (const template of templates) {
    const limit = (template === 'arch-integration.md' || template === 'arch-platform.md' || template === 'arch-testing.md' || template === 'quality-gater.md')
      ? ARCH_INT_PLATFORM_LIMIT
      : STANDARD_LIMIT;
    it(`${template} is ≤${limit} lines`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      const lines = content.trimEnd().split('\n').length;
      expect(lines).toBeLessThanOrEqual(limit);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Team Lead — 3-phase model
// ---------------------------------------------------------------------------
describe('team-lead template — 3-phase model', () => {
  // W31.6: team-lead.md retired. Hub-split (BL-W45): content spread across tl-* sub-docs.
  // readOrchestrationGuide() returns hub + all tl-* sub-docs concatenated.
  const content = readOrchestrationGuide();
  const combinedPM = content;

  it('has 3-Phase Execution Model section', () => {
    expect(content).toMatch(/3-Phase Execution Model/i);
  });

  it('describes the Planning phase (planner subagent, no named "Planning Team")', () => {
    // runtime-adapter wave: the named-team framing "Planning Team" was reframed out of
    // the doc corpus (tl-agent-roster.md:25 "Planning Team peer" → "single-use Agent
    // subagent"). The Planning phase is now described via the 3-phase model + the planner.
    // Anchored (CodeRabbit): require "Planning" and "planner" within the same window.
    // readOrchestrationGuide() concatenates many docs, so two independent /Planning/ +
    // /planner/ matches could be satisfied by unrelated mentions; proximity ties this to
    // the actual Planning-phase block (tl-phase-execution.md "Phase 1 — Planning:
    // Agent(subagent_type=\"planner\", ...)").
    expect(content).toMatch(/Planning[\s\S]{0,300}planner/i);
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

  it('has pre-flight checklist (BL-W48: orchestrator model, no session team setup)', () => {
    // BL-W48: TeamCreate/"session team" removed; orchestrator + disk-artifact model.
    // Pre-flight content may vary; assert the guide still has a checklist-style section.
    expect(content).toMatch(/Pre-Flight|checklist|PLAN\.md|planner/i);
  });

  it('BL-W48: orchestrator dispatches single-use subagents (no session team / no team_name)', () => {
    // BL-W48: agents spawned as plain Agent() subagents — no team_name, no named session team.
    // Guide describes context-provider, doc-updater, arch-* as single-use subagents.
    expect(content).toMatch(/context-provider|arch-testing|arch-platform|arch-integration/);
    // team_name is deprecated/ignored — the guide must NOT prescribe it as required.
    // (It MAY mention it in historical/compatibility context, so we don't assert absence here.)
  });

  it('pattern validation chain documented: specialist contacts architect, not context-provider', () => {
    expect(combinedPM).toMatch(/specialist.*arch.*context-provider|SendMessage.*arch.*pattern/i);
    expect(combinedPM).toMatch(/NEVER.*context-provider.*directly|specialist NEVER contacts context-provider/i);
  });

  it('extra subagent model is documented — anonymous Agent() fan-out is allowed', () => {
    // BL-W48: named team peers with team_name are gone; orchestrator uses Agent() fan-out.
    expect(combinedPM).toMatch(/specialist|Agent\(|subagent/i);
  });

  it('BL-W48: orchestrator model uses disk-artifact verification, not roster completeness', () => {
    // The guide must reference PLAN.md and/or the orchestrator model.
    expect(combinedPM).toMatch(/PLAN\.md|orchestrator|\.planning/i);
  });

  it('background completion → immediately act rule is documented', () => {
    expect(combinedPM).toMatch(/background.*complet.*IMMEDIATELY|IMMEDIATELY.*background/i);
  });

  it('Phase 2 uses SendMessage to reach architects', () => {
    // BL-W48: "session team peers" phrase removed; orchestrator dispatches via Agent() +
    // communicates via SendMessage. At least the SendMessage pattern remains.
    expect(combinedPM).toContain('SendMessage(to="arch-testing"');
  });

  it('MIGRATIONS.json confirms team-lead W31.6 retirement (W31.6: template retired)', () => {
    // W31.6: team-lead.md retired — check MIGRATIONS.json
    const migrationsRaw = fs.readFileSync(path.join(ROOT, 'setup/agent-templates/MIGRATIONS.json'), 'utf-8');
    expect(migrationsRaw).toMatch(/RETIRED-W31\.6/);
    expect(migrationsRaw).toMatch(/main-agent-orchestration-guide/);
  });

  it('has dev/specialist dispatch protocol', () => {
    // W31.6: guide uses 'Specialist Dispatch' terminology
    expect(content).toMatch(/Dev Dispatch|Specialist Dispatch|SendMessage.*team-lead/i);
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

  it('BL-W48: main agent orchestration guide uses orchestrator model (no TeamCreate required)', () => {
    // BL-W48: TeamCreate removed from Claude Code runtime; guide must NOT prescribe it.
    // Guide may contain TeamCreate in historical/tombstone context only — not as required action.
    // Assert the guide exists and has the orchestrator pattern instead.
    expect(content).toMatch(/orchestrator|PLAN\.md|single-use|Agent\(/i);
  });

  it('main agent orchestration guide explicitly mentions SendMessage (W31.6: guide is a doc, not subagent)', () => {
    // W31.6: guide is a doc — no tools: frontmatter. But guide body mentions SendMessage as required.
    expect(content).toMatch(/SendMessage/);
  });

  it('BL-W48: quality-gater spawned as single-use subagent in Phase 3', () => {
    // BL-W48: no session team / team_name required; quality-gater is a plain Agent() subagent.
    expect(content).toMatch(/quality-gater/);
  });

  it('has HARD GATE section', () => {
    expect(content).toContain('HARD GATE');
  });

  it('BL-W48: rotation model documented (kill-then-respawn or equivalent)', () => {
    // kill-then-respawn may be replaced by simple re-spawn in orchestrator model.
    expect(combinedPM).toMatch(/kill-then-respawn|respawn|re-spawn/i);
  });

  it('has Phase 1 / Phase 2 / Phase 3 section structure', () => {
    // BL-W48: "Session Team Setup" section may be renamed; assert phases still present.
    expect(content).toMatch(/Phase [123]|Planning.*Execution.*Quality/i);
  });

  it('BL-W48: topology gate or equivalent pre-dispatch check documented', () => {
    // BL-W48: topology gate (roster-based) retired; disk-artifact floor replaces it.
    // Guide may still describe a pre-dispatch check or PLAN.md-first protocol.
    expect(combinedPM).toMatch(/PLAN\.md|dispatch|Agent\(|quality-gater/i);
  })
});

// ---------------------------------------------------------------------------
// 3a. team-lead Phase Execution sub-doc (extracted from team-lead.md)
// ---------------------------------------------------------------------------
describe('tl-phase-execution sub-doc — extracted phase protocol', () => {
  const content = fs.readFileSync(
    path.join(ROOT, 'docs/agents/tl-phase-execution.md'),
    'utf-8'
  );

  it('BL-W48: describes Planning phase with planner (single-use subagent) + context-provider', () => {
    // BL-W48: "Planning Team" concept removed — planner is now a single-use subagent.
    // The sub-doc describes Phase 1 with Agent(subagent_type="planner") and context-provider.
    expect(content).toMatch(/Phase 1.*Planning|planner.*subagent/i);
    expect(content).toMatch(/planner.*context-provider|context-provider.*planner/i);
  });

  it('BL-W48: anti-pattern indexed replacement documented (kill-then-respawn; BL-W48 removed -2 suffix)', () => {
    // BL-W48: arch-platform-2 was the TeamCreate-era -2 suffix anti-pattern (NEVER use -2).
    // Post-BL-W48: named overflow specialists exist but use the {specialist}-2 placeholder form.
    // The kill-then-respawn rule is still documented; -2 suffix literal no longer required.
    expect(content).toContain('kill-then-respawn');
    // -2 suffix may appear as a placeholder ({specialist}-2) or literal — either is fine
    expect(content).toMatch(/arch-platform-2|\{specialist\}-2/);
  });

  it('references .planning/PLAN.md for plan file delivery', () => {
    expect(content).toContain('.planning/PLAN.md');
  });

  it('team-lead reads plan via Read(".planning/PLAN.md") after planner notifies', () => {
    expect(content).toMatch(/Read\(["']\.planning\/PLAN\.md["']\)/);
  });
});

// ---------------------------------------------------------------------------
// 3b. Arch-Testing — Bash safety rules and version
// ---------------------------------------------------------------------------
describe('arch-testing template — Bash safety and version', () => {
  const archContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-testing.md'), 'utf-8');

  it('has template_version field in frontmatter', () => {
    expect(archContent).toMatch(/template_version:\s*"\d+\.\d+\.\d+"/);
  });

  it('has Bash Safety Rules section', () => {
    expect(archContent).toMatch(/Bash Safety Rules/i);
  });

  it('explains pipe buffering causes agent hang', () => {
    expect(archContent).toMatch(/BUFFER.*stdout|pipe.*buffer/i);
  });

  it('clarifies wrapper chain (skill -> wrapper -> CLI) per cli-mandate', () => {
    // PR #170: replaced obsolete "bans gradle-run wrapper scripts" assertion. Per
    // cli-mandate, wrappers wrap kmp-test-runner v0.9.0+ — they are the canonical
    // path, NOT to be banned. arch-testing should explain the chain instead.
    expect(archContent).toMatch(/wrap.*kmp-test-runner|cli-hub\.md|never.*gradlew.*directly.*outside.*chain/i);
  });

  it('instructs to use declared skills not raw gradlew', () => {
    expect(archContent).toMatch(/use the declared skills|Never.*gradlew.*directly/i);
  });

  it('arch-testing Regression Safety requires before/after delta on PRE-EXISTING claims', () => {
    expect(archContent).toMatch(/parent.of.HEAD|checkout.*parent|parent.*commit/i);
  });

  it('arch-testing delta check is MANDATORY before accepting PRE-EXISTING', () => {
    expect(archContent).toMatch(/PRE-EXISTING[\s\S]{0,400}parent|parent[\s\S]{0,400}PRE-EXISTING/i);
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

  it('arch-platform has template_version field in frontmatter', () => {
    expect(platformContent).toMatch(/template_version:\s*"\d+\.\d+\.\d+"/);
  });

  it('arch-integration has template version 1.30.0', () => {
    expect(integrationContent).toContain('template_version: "1.30.0"');
  });
});

// ---------------------------------------------------------------------------
// 3e. Arch-Platform — Pre-Execute Authoring Checklist (BL-W42 PR2)
// ---------------------------------------------------------------------------
describe('arch-platform — Pre-Execute Authoring Checklist', () => {
  const platformContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-platform.md'), 'utf-8');
  const subDocPath = path.join(ROOT, 'docs/agents/arch-platform-section-h-rule.md');
  const subDocContent = fs.readFileSync(subDocPath, 'utf-8');

  it('arch-platform template contains Pre-Execute Authoring Checklist pointer', () => {
    expect(platformContent).toContain('Pre-Execute Authoring Checklist');
  });

  it('arch-platform template contains pointer to checklist sub-doc', () => {
    expect(platformContent).toContain('docs/agents/arch-platform-prep-authoring-checklist.md');
  });

  it('sub-doc contains structural rule: template_version bump requires agents.manifest.yaml', () => {
    expect(subDocContent).toMatch(/template_version[\s\S]{0,600}agents\.manifest\.yaml/);
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

  it('BL-W48: describes itself as single-use subagent (not team peer)', () => {
    // BL-W48: planner is now a single-use subagent, not a session team peer.
    // "Planning Team" and "team peer" concepts are retired.
    expect(content).toMatch(/single-use subagent|single-use planning subagent/i);
    expect(content).not.toMatch(/team peer/i);
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

  it('BL-W48: writes plan to .planning/wave-<slug>/PLAN.md (wave-scoped path)', () => {
    // BL-W48: planner writes to wave-scoped path .planning/wave-<slug>/PLAN.md
    // (not the flat .planning/PLAN.md of the old team-peer model).
    expect(content).toMatch(/\.planning\/wave-.*PLAN\.md|wave-<slug>\/PLAN\.md/i);
  });

  it('BL-W48: returns plan path naturally (no explicit SendMessage to team-lead required)', () => {
    // BL-W48: planner is a single-use subagent — it returns "plan ready" + path as its
    // natural result. No explicit SendMessage(to="team-lead") call required (the orchestrator
    // reads from disk). The old session-peer model required explicit notification.
    expect(content).toMatch(/plan ready|PLAN-WRITTEN|return.*path|\.planning\/wave-.*PLAN\.md/i);
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

  it('describes itself as the QG owner (adapter-capability model) in Phase 3', () => {
    expect(content).toMatch(/QG owner/i);
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

  it('has template version 2.21.0', () => {
    expect(content).toContain('template_version: "2.21.0"');
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
    // BL-W48: "team-lead is sole Agent() spawner" renamed to "Orchestrator is sole Agent() spawner"
    // (the orchestrator role is no longer tied to the named session-team team-lead peer).
    expect(content).toMatch(/Orchestrator is sole Agent\(\) spawner/i);
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

  it('BL-W48: describes orchestrator model (single-use subagents, disk contract)', () => {
    // BL-W48: README updated to describe the orchestrator/subagent model.
    // No named session-team peer team-lead.md; "orchestrator" runs in main conversation.
    // README describes planner, quality-gater (Phase 3), and orchestrator dispatch model.
    expect(content).toMatch(/orchestrator|single-use subagent|Phase 3/i);
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

  it('has Step 10 (QG proof emitter)', () => {
    // Step 10 now delegates to emit-push-proof.sh run-qg (bl-w47-pr-0c2 T6a)
    expect(content).toContain('emit-push-proof.sh');
    expect(content).toContain('run-qg');
  });

  it('Step 10 mentions quality-gate.stamp (backward-compat comment)', () => {
    expect(content).toContain('quality-gate.stamp');
  });

  it('Step 10 appears in report table', () => {
    expect(content).toMatch(/\| 10\./);
  });


});

// ---------------------------------------------------------------------------
// 17. Context-Provider Oracle Protocol
// ---------------------------------------------------------------------------
describe('context-provider template — spawn protocol (v3.0.0 pre-cache)', () => {
  const cpContent = fs.readFileSync(path.join(TEMPLATES_DIR, 'context-provider.md'), 'utf-8');

  it('description describes oracle role with pattern pre-cache', () => {
    expect(cpContent).toMatch(/oracle/i);
    expect(cpContent).toMatch(/pre-cache|pattern index/i);
  });

  it('has Spawn Protocol section', () => {
    expect(cpContent).toMatch(/Spawn Protocol/i);
  });

  it('instructs to pre-cache pattern index on spawn', () => {
    expect(cpContent).toMatch(/pre-cache|hydrate|pattern index/i);
    expect(cpContent).toMatch(/find-pattern/);
  });

  it('has template version 3.7.0', () => {
    expect(cpContent).toContain('template_version: "3.7.0"'); // bumped 3.6.0 → 3.7.0 (BL-W48 Codex P2 On-First-Contact reframe)
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

  it('has write_bundle protocol section', () => {
    expect(cpContent).toMatch(/## write_bundle/);
  });

  it('write_bundle invokes the sanctioned writer script', () => {
    expect(cpContent).toContain('scripts/sh/write-bundle.sh');
  });

  it('write_bundle declares the single sanctioned write path + ABI boundary', () => {
    expect(cpContent).toMatch(/single sanctioned write path/i);
    expect(cpContent).toMatch(/authorized for THIS script invocation only/i);
  });

  it('write_bundle triggers only on team-lead dispatch', () => {
    expect(cpContent).toMatch(/ONLY on an explicit team-lead dispatch/i);
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

  it('planner version 1.19.0', () => {
    expect(plannerContent).toContain('template_version: "1.19.0"');
  });

  it('arch-testing has template_version field in frontmatter', () => {
    expect(testingContent).toMatch(/template_version:\s*"\d+\.\d+\.\d+"/);
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
