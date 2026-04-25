import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

describe('agent content validation', () => {
  const agentDir = path.join(ROOT, '.claude/agents');

  describe('generic naming — no project-specific references in L0 agents', () => {
    const PROJECT_SPECIFIC = [
      'core:model', 'core:data', 'core:domain', 'core:database',
      'core-model', 'core-data', 'core-domain', 'core-database',
      'feature/player', 'feature/snapshot', 'feature/settings',
      'SettingsScreen.kt', 'PlayerScreen.kt', 'SnapshotScreen.kt',
      'DawSync', 'shared-kmp-libs',
    ];

    const synced = ['test-specialist.md', 'ui-specialist.md', 'full-audit-orchestrator.md'];

    for (const agentFile of synced) {
      it(`${agentFile} has no project-specific module names`, () => {
        const filePath = path.join(agentDir, agentFile);
        if (!fs.existsSync(filePath)) return; // skip if not present
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const term of PROJECT_SPECIFIC) {
          expect(content).not.toContain(term);
        }
      });
    }

    it('ui-specialist findings example uses ExampleScreen.kt', () => {
      const content = fs.readFileSync(path.join(agentDir, 'ui-specialist.md'), 'utf-8');
      expect(content).toContain('ExampleScreen.kt');
      expect(content).not.toContain('SettingsScreen.kt');
    });
  });

  describe('no pre-existing excuse rule', () => {
    const agentsWithRule = ['test-specialist.md', 'ui-specialist.md'];

    for (const agentFile of agentsWithRule) {
      it(`${agentFile} has "No Pre-existing Excuse" section`, () => {
        const content = fs.readFileSync(path.join(agentDir, agentFile), 'utf-8');
        expect(content).toMatch(/No.*Pre-existing.*Excuse/i);
      });

      it(`${agentFile} requires reporting hard bugs in Summary`, () => {
        const content = fs.readFileSync(path.join(agentDir, agentFile), 'utf-8');
        expect(content).toMatch(/report.*Summary|Summary.*pending/i);
      });

      it(`${agentFile} forbids silent dismissal`, () => {
        const content = fs.readFileSync(path.join(agentDir, agentFile), 'utf-8');
        expect(content).toMatch(/NEVER.*dismiss|NEVER.*ignore/i);
      });
    }

    it('main-agent-orchestration-guide.md has pre-existing excuse rule (W31.6: team-lead.md retired)', () => {
      // W31.6: team-lead.md retired — check main-agent-orchestration-guide.md
      const guidePath = path.join(ROOT, 'docs/agents/main-agent-orchestration-guide.md');
      const guideContent = fs.readFileSync(guidePath, 'utf-8');
      expect(guideContent).toMatch(/pre-existing/i);
    });
  });

  describe('test-specialist — quality over coverage', () => {
    const content = fs.readFileSync(path.join(agentDir, 'test-specialist.md'), 'utf-8');

    it('has quality auditor identity', () => {
      expect(content).toMatch(/Quality Auditor/i);
    });

    it('forbids coverage gaming', () => {
      expect(content).toMatch(/Coverage is a side effect, not a goal/i);
    });

    it('requires e2e for Model layer', () => {
      expect(content).toContain('Model layer');
      expect(content).toMatch(/serialization.*roundtrip/i);
    });

    it('requires e2e for Domain layer', () => {
      expect(content).toContain('Domain layer');
      expect(content).toMatch(/use case chain/i);
    });

    it('requires e2e for Data layer', () => {
      expect(content).toContain('Data layer');
    });

    it('requires e2e for Database layer', () => {
      expect(content).toContain('Database layer');
      expect(content).toMatch(/migration/i);
    });

    it('requires Compose tests for UI', () => {
      expect(content).toMatch(/composeTestRule|Compose Tests/i);
    });
  });

  describe('ui-specialist — mandatory checks', () => {
    const content = fs.readFileSync(path.join(agentDir, 'ui-specialist.md'), 'utf-8');

    it('has 9 mandatory checks (includes runtime UI validation + Google skills delegation)', () => {
      const checks = content.match(/^### \d+\./gm);
      expect(checks).not.toBeNull();
      expect(checks!.length).toBe(9);
    });

    it('marks missing previews as HIGH severity', () => {
      expect(content).toMatch(/preview.*HIGH|HIGH.*preview/i);
    });

    it('has zero tolerance for hardcoded strings', () => {
      expect(content).toMatch(/ZERO tolerance|zero.tolerance/i);
    });

    it('requires implementing fixes not just reporting', () => {
      expect(content).toMatch(/Implement fixes/i);
    });
  });
});

describe('v1.4.0 spec-driven agents', () => {
  const agentsDir = path.join(ROOT, '.claude/agents');
  const newAgents = ["advisor", "codebase-mapper", "debugger", "researcher", "verifier"];

  for (const agent of newAgents) {
    it(`${agent} has no GSD references`, () => {
      const content = fs.readFileSync(path.join(agentsDir, `${agent}.md`), 'utf-8');
      expect(content).not.toContain('.planning/');
      expect(content).not.toContain('.gsd/');
      expect(content).not.toContain('gsd-tools');
    });
  }

  it('debugger references /test skill', () => {
    const content = fs.readFileSync(path.join(agentsDir, 'debugger.md'), 'utf-8');
    expect(content).toContain('test');
  });
});

describe('suppressions system', () => {
  it('suppressions.sh exists in lib/', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts/sh/lib/suppressions.sh'))).toBe(true);
  });

  it('suppressions.sh exports load_suppressions function', () => {
    const content = fs.readFileSync(
      path.join(ROOT, 'scripts/sh/lib/suppressions.sh'), 'utf-8'
    );
    expect(content).toContain('load_suppressions');
  });

  it('suppressions.sh exports is_suppressed function', () => {
    const content = fs.readFileSync(
      path.join(ROOT, 'scripts/sh/lib/suppressions.sh'), 'utf-8'
    );
    expect(content).toContain('is_suppressed');
  });

  it('supports prefix matching with asterisk', () => {
    const content = fs.readFileSync(
      path.join(ROOT, 'scripts/sh/lib/suppressions.sh'), 'utf-8'
    );
    expect(content).toMatch(/\\\*|prefix|glob/i);
  });

  it('supports expiry dates', () => {
    const content = fs.readFileSync(
      path.join(ROOT, 'scripts/sh/lib/suppressions.sh'), 'utf-8'
    );
    expect(content).toMatch(/expires|expir/i);
  });

  it('audit-suppressions guide exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs/guides/audit-suppressions.md'))).toBe(true);
  });

  it('audit-suppressions guide has schema documentation', () => {
    const content = fs.readFileSync(
      path.join(ROOT, 'docs/guides/audit-suppressions.md'), 'utf-8'
    );
    expect(content).toMatch(/dedupe_key/);
    expect(content).toMatch(/expires/);
    expect(content).toMatch(/suppressed_by/);
  });
});

describe('pattern-lint cancellation-rethrow check', () => {
  const content = fs.readFileSync(
    path.join(ROOT, 'scripts/sh/pattern-lint.sh'), 'utf-8'
  );

  it('handles Windows drive letter paths', () => {
    expect(content).toMatch(/A-Za-z\]:/);
  });

  it('checks context before catch for prior CancellationException catch', () => {
    expect(content).toMatch(/line - 5|start.*line/);
  });

  it('skips catch blocks that rethrow the exception', () => {
    expect(content).toMatch(/throw.*e\b|throw.*it\b|throw.*ex\b/);
  });

  it('filters KDoc lines by checking trimmed code content', () => {
    expect(content).toContain('trimmed');
    expect(content).toMatch(/trimmed.*\\\*/);
  });

  it('does NOT use simple wc -l count (context-aware loop instead)', () => {
    // The old approach was: grep | wc -l. New approach uses while loop with context
    const cancellationSection = content.split('cancellation-rethrow')[1]?.split('Check 2')[0] || '';
    expect(cancellationSection).toContain('while IFS=');
    expect(cancellationSection).not.toMatch(/wc -l.*tr -d/);
  });
});

describe("v1.5.0 extensible routing", () => {
  const agentsDir = path.join(ROOT, ".claude", "agents");

  it("all agents have domain frontmatter", () => {
    const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith(".md"));
    const missing: string[] = [];
    for (const agent of agents) {
      const content = fs.readFileSync(path.join(agentsDir, agent), "utf8");
      if (!content.match(/^domain:/m)) missing.push(agent);
    }
    expect(missing, `Agents missing domain: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("all agents have intent frontmatter", () => {
    const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith(".md"));
    const missing: string[] = [];
    for (const agent of agents) {
      const content = fs.readFileSync(path.join(agentsDir, agent), "utf8");
      if (!content.match(/^intent:/m)) missing.push(agent);
    }
    expect(missing, `Agents missing intent: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("test-specialist has script-first execution rules", () => {
    const content = fs.readFileSync(path.join(agentsDir, "test-specialist.md"), "utf8");
    expect(content).toContain("NEVER run");
    expect(content).toContain("/test");
    expect(content).toContain("/benchmark");
  });
});

describe('L0 agent frontmatter completeness', () => {
  const agentsDir = path.join(ROOT, '.claude/agents');

  it('all L0 agents with domain field have intent field', () => {
    const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    const mismatched: string[] = [];
    for (const agent of agents) {
      const content = fs.readFileSync(path.join(agentsDir, agent), 'utf8');
      const hasDomain = /^domain:/m.test(content);
      const hasIntent = /^intent:/m.test(content);
      if (hasDomain && !hasIntent) mismatched.push(agent);
    }
    expect(mismatched, `Agents with domain but missing intent: ${mismatched.join(', ')}`).toHaveLength(0);
  });

  it('no L0 agent is missing token_budget', () => {
    const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
    const missing: string[] = [];
    for (const agent of agents) {
      const content = fs.readFileSync(path.join(agentsDir, agent), 'utf8');
      if (!/^token_budget:/m.test(content)) missing.push(agent);
    }
    expect(missing, `L0 agents missing token_budget: ${missing.join(', ')}`).toHaveLength(0);
  });
});

describe('readme-audit CRLF compatibility', () => {
  const content = fs.readFileSync(
    path.join(ROOT, 'scripts/sh/readme-audit.sh'), 'utf-8'
  );

  it('all wc -l pipes include \\r in tr -d', () => {
    const lines = content.split('\n');
    const wcTrLines = lines.filter(l => l.includes('wc -l') && l.includes("tr -d"));
    expect(wcTrLines.length).toBeGreaterThan(0);
    for (const line of wcTrLines) {
      expect(line).toContain('\\r');
    }
  });

  it('tr -d on parentheses includes \\r', () => {
    const lines = content.split('\n');
    const parenTrLines = lines.filter(l => l.includes("tr -d") && l.includes('()'));
    for (const line of parenTrLines) {
      expect(line).toContain('\\r');
    }
  });
});
