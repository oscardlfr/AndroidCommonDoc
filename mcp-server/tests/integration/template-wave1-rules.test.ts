/**
 * Wave 1 template rules anti-regression tests.
 *
 * Enforces the 10 Wave 1 template bug fixes across the architect + team-lead
 * templates. Also enforces dual-location sync between setup/agent-templates/
 * (SOURCE) and .claude/agents/ (COPY scanned by the agent registry).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');
const AGENTS_DIR = path.join(ROOT, '.claude/agents');
const ARCHITECTS = ['arch-testing.md', 'arch-platform.md', 'arch-integration.md'];

// ---------------------------------------------------------------------------
// 1. BUG 2: "Edit directly" language removed from architects
// ---------------------------------------------------------------------------
describe('Wave 1 BUG 2: "Edit directly" language removed from architects', () => {
  for (const template of ARCHITECTS) {
    it(`${template} has no "Edit directly — max" phrase`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).not.toMatch(/Edit directly — max/);
    });

    it(`${template} has no "Edit a single import" phrase`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).not.toMatch(/Edit a single import/);
    });

    it(`${template} has no "you may fix directly" phrase`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).not.toMatch(/you may fix directly/);
    });

    it(`${template} has no "ONLY kind of direct fix" phrase`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).not.toMatch(/ONLY kind of direct fix/);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. BUG 5: "NEVER you fix" table row present in architects
// ---------------------------------------------------------------------------
describe('Wave 1 BUG 5: "NEVER you fix" table row present in architects', () => {
  for (const template of ARCHITECTS) {
    it(`${template} has "**NEVER you fix**" row`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/\*\*NEVER you fix\*\*/);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. BUG 3: Scope Validation Gate MANDATORY section
// ---------------------------------------------------------------------------
describe('Wave 1 BUG 3: Scope Validation Gate MANDATORY section', () => {
  for (const template of ARCHITECTS) {
    it(`${template} has Scope Validation Gate (MANDATORY) section`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/### Scope Validation Gate \(MANDATORY\)/);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. BUG 10: DURING-WAVE Protocol MANDATORY section
// ---------------------------------------------------------------------------
describe('Wave 1 BUG 10: DURING-WAVE Protocol MANDATORY section', () => {
  for (const template of ARCHITECTS) {
    it(`${template} has DURING-WAVE Protocol (MANDATORY) section`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/### DURING-WAVE Protocol \(MANDATORY\)/);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. BUG 10 parity: "architects MUST re-consult" canonical text
// ---------------------------------------------------------------------------
describe('Wave 1 BUG 10 parity: "architects MUST re-consult" canonical text', () => {
  for (const template of ARCHITECTS) {
    it(`${template} has "architects MUST re-consult context-provider" canonical text`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/architects MUST re-consult context-provider/);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. BUG 8: Exact Fix Format MANDATORY section
// ---------------------------------------------------------------------------
describe('Wave 1 BUG 8: Exact Fix Format MANDATORY section', () => {
  for (const template of ARCHITECTS) {
    it(`${template} has Exact Fix Format (MANDATORY) section`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      expect(content).toMatch(/### Exact Fix Format \(MANDATORY\)/);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. BUG 6: Post-Wave Team Integrity Check in team-lead
// ---------------------------------------------------------------------------
describe('Wave 1 BUG 6: Post-Wave Team Integrity Check in team-lead or sub-docs', () => {
  it('Post-Wave Team Integrity Check exists in template or tl-verification-gates sub-doc', () => {
    // W31.6: team-lead.md retired — read guide instead
    const templateContent = fs.readFileSync(path.join(ROOT, 'docs/agents/main-agent-orchestration-guide.md'), 'utf-8');
    const verGatesPath = path.join(ROOT, 'docs/agents/tl-verification-gates.md');
    const verGatesContent = fs.existsSync(verGatesPath) ? fs.readFileSync(verGatesPath, 'utf-8') : '';
    const combined = templateContent + '\n' + verGatesContent;
    expect(combined).toMatch(/Post-Wave Team Integrity Check/);
  });
});

// ---------------------------------------------------------------------------
// 8. Wave 1: template_version bumped in architects
// ---------------------------------------------------------------------------
describe('Wave 1: template_version bumped in architects', () => {
  it('arch-testing.md template_version is "1.21.0"', () => {
    // W31.6: bumped from 1.20.0 → 1.21.0 (PREP/EXECUTE clarification + ban reminder)
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-testing.md'), 'utf-8');
    expect(content).toMatch(/template_version:\s*"1.21.0"/);
  });

  it('arch-platform.md template_version is "1.19.0"', () => {
    // W31.6: bumped from 1.18.0 → 1.19.0 (PREP/EXECUTE clarification + ban reminder)
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-platform.md'), 'utf-8');
    expect(content).toMatch(/template_version:\s*"1.19.0"/);
  });

  it('arch-integration.md template_version is "1.18.0"', () => {
    // W31.6: bumped from 1.17.0 → 1.18.0 (PREP/EXECUTE clarification + ban reminder)
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-integration.md'), 'utf-8');
    expect(content).toMatch(/template_version:\s*"1.18.0"/);
  });

  it('MIGRATIONS.json has W31.6 RETIRED entry for team-lead (W31.6: retired)', () => {
    // W31.6: team-lead.md retired — MIGRATIONS.json entry confirms retirement
    // Structure: { "templates": { "team-lead": { "RETIRED-W31.6": {...} } } }
    const migrationsRaw = fs.readFileSync(path.join(ROOT, 'setup/agent-templates/MIGRATIONS.json'), 'utf-8');
    const migrations = JSON.parse(migrationsRaw);
    const tlEntry = migrations?.templates?.['team-lead'];
    expect(tlEntry).toBeDefined();
    expect(tlEntry['RETIRED-W31.6']).toBeDefined();
    expect(migrationsRaw).toMatch(/RETIRED-W31\.6/);
    expect(migrationsRaw).toMatch(/main-agent-orchestration-guide/);
  });
});

// ---------------------------------------------------------------------------
// 9. BUG 7: "ALL fixes go through team-lead" preamble in architects
// ---------------------------------------------------------------------------
describe('Wave 1 BUG 7: "ALL fixes go through team-lead" preamble in architects', () => {
  for (const template of ARCHITECTS) {
    it(`${template} has "ALL fixes go through team-lead → specialist" preamble`, () => {
      const content = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
      // W32 naming audit: arrow target renamed "dev" → "specialist". Must match
      // the canonical specialist name; legacy "→ dev" must NOT appear.
      expect(content).toMatch(/\*\*ALL fixes go through team-lead → specialist\. You have NO Write\/Edit tool/);
      expect(content).not.toMatch(/\*\*ALL fixes go through team-lead → dev\b/);
    });
  }
});

// ---------------------------------------------------------------------------
// 10. dual-location sync: setup/agent-templates/ == .claude/agents/
// ---------------------------------------------------------------------------
describe('dual-location sync: setup/agent-templates/ == .claude/agents/', () => {
  const syncedTemplates = [
    // W31.6: team-lead.md removed (retired — see MIGRATIONS.json RETIRED-W31.6)
    'planner.md',
    'quality-gater.md',
    'arch-testing.md',
    'arch-platform.md',
    'arch-integration.md',
    'context-provider.md',
    'doc-updater.md',
    'doc-migrator.md',
  ];

  for (const template of syncedTemplates) {
    it(`${template} is identical between SOURCE and COPY`, () => {
      const sourcePath = path.join(TEMPLATES_DIR, template);
      const copyPath = path.join(AGENTS_DIR, template);
      const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
      const copyContent = fs.readFileSync(copyPath, 'utf-8');
      expect(sourceContent).toBe(copyContent);
    });
  }
});

// ---------------------------------------------------------------------------
// 11. BUG-T7: Mock in commonTest routing row in arch-testing Dev Routing Table
// ---------------------------------------------------------------------------
describe('BUG-T7: Mock in commonTest routing row in arch-testing Dev Routing Table', () => {
  it('arch-testing.md has "Mock in commonTest" routing row', () => {
    const content = fs.readFileSync(path.join(TEMPLATES_DIR, 'arch-testing.md'), 'utf-8');
    expect(content).toMatch(/Mock in commonTest \(banned by testing-hub/);
  });
});
