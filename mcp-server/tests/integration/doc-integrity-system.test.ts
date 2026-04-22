/**
 * Doc Integrity System integration tests.
 *
 * Validates the complete documentation integrity pipeline:
 * MCP tools, shared utils, templates, skills, categories, and cross-references.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');
const DOCS_DIR = path.join(ROOT, 'docs/agents');
const SKILLS_DIR = path.join(ROOT, 'skills');
const MCP_TOOLS_DIR = path.join(ROOT, 'mcp-server/src/tools');
const MCP_UTILS_DIR = path.join(ROOT, 'mcp-server/src/utils');
const SCRIPTS_SH = path.join(ROOT, 'scripts/sh');
const SCRIPTS_PS1 = path.join(ROOT, 'scripts/ps1');

// ── Helper ───────────────────────────────────────────────────────────────────

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

// ── 1. MCP Tool source files ─────────────────────────────────────────────────

describe('MCP tools exist', () => {
  const newTools = [
    'kdoc-coverage.ts',
    'validate-doc-update.ts',
    'check-doc-patterns.ts',
  ];

  for (const tool of newTools) {
    it(`${tool} exists in mcp-server/src/tools/`, () => {
      expect(fileExists(path.join(MCP_TOOLS_DIR, tool))).toBe(true);
    });
  }

  it('doc-scoring.ts shared util exists', () => {
    expect(fileExists(path.join(MCP_UTILS_DIR, 'doc-scoring.ts'))).toBe(true);
  });
});

// ── 2. Tool registration in index.ts ─────────────────────────────────────────

describe('tool registration', () => {
  const indexContent = readFile(path.join(MCP_TOOLS_DIR, 'index.ts'));

  it('kdoc-coverage is imported', () => {
    expect(indexContent).toContain('registerKdocCoverageTool');
  });

  it('validate-doc-update is imported', () => {
    expect(indexContent).toContain('registerValidateDocUpdateTool');
  });

  it('check-doc-patterns is imported', () => {
    expect(indexContent).toContain('registerCheckDocPatternsTool');
  });

  it('registers 47 tools', () => {
    expect(indexContent).toMatch(/Registered 47 tools/);
  });
});

// ── 3. search-docs uses shared util ──────────────────────────────────────────

describe('search-docs refactor', () => {
  const searchDocs = readFile(path.join(MCP_TOOLS_DIR, 'search-docs.ts'));

  it('imports from doc-scoring util', () => {
    expect(searchDocs).toContain('from "../utils/doc-scoring.js"');
  });

  it('does not have private tokenize function', () => {
    expect(searchDocs).not.toMatch(/^function tokenize/m);
  });

  it('does not have private scoreEntry function', () => {
    expect(searchDocs).not.toMatch(/^function scoreEntry/m);
  });
});

// ── 4. doc-scoring shared util ───────────────────────────────────────────────

describe('doc-scoring util exports', () => {
  const docScoring = readFile(path.join(MCP_UTILS_DIR, 'doc-scoring.ts'));

  it('exports tokenize', () => {
    expect(docScoring).toContain('export function tokenize');
  });

  it('exports scoreEntry', () => {
    expect(docScoring).toContain('export function scoreEntry');
  });

  it('exports jaccardSimilarity', () => {
    expect(docScoring).toContain('export function jaccardSimilarity');
  });

  it('exports normalizeForComparison', () => {
    expect(docScoring).toContain('export function normalizeForComparison');
  });
});

// ── 5. kdoc-coverage tool ────────────────────────────────────────────────────

describe('kdoc-coverage tool', () => {
  const content = readFile(path.join(MCP_TOOLS_DIR, 'kdoc-coverage.ts'));

  it('exports analyzeFile for direct testing', () => {
    expect(content).toContain('export function analyzeFile');
  });

  it('exports registerKdocCoverageTool', () => {
    expect(content).toContain('export function registerKdocCoverageTool');
  });

  it('detects public functions', () => {
    expect(content).toContain("fun\\s+");
  });

  it('detects classes and interfaces', () => {
    expect(content).toContain('class');
    expect(content).toContain('interface');
  });

  it('excludes override declarations', () => {
    expect(content).toContain('OVERRIDE_RE');
  });

  it('excludes actual declarations (KMP)', () => {
    expect(content).toContain('ACTUAL_RE');
  });

  it('skips private/internal/protected', () => {
    expect(content).toContain('NON_PUBLIC_MODIFIERS');
  });

  it('persists to audit-log.jsonl', () => {
    expect(content).toContain('kdoc_coverage');
    expect(content).toContain('audit-log.jsonl');
  });

  it('supports changed_files parameter', () => {
    expect(content).toContain('changed_files');
  });
});

// ── 6. validate-doc-update tool ──────────────────────────────────────────────

describe('validate-doc-update tool', () => {
  const content = readFile(path.join(MCP_TOOLS_DIR, 'validate-doc-update.ts'));

  it('has generated file guard (check 1)', () => {
    expect(content).toContain('checkGeneratedGuard');
    expect(content).toContain('generated: true');
  });

  it('has duplicate detection (check 2)', () => {
    expect(content).toContain('checkDuplicates');
    expect(content).toContain('jaccardSimilarity');
  });

  it('has coherence check (check 3)', () => {
    expect(content).toContain('checkCoherence');
    expect(content).toContain('SUBDIR_TO_CATEGORIES');
  });

  it('has anti-pattern filter (check 4)', () => {
    expect(content).toContain('checkAntiPatterns');
    expect(content).toContain('ANTI_PATTERNS');
  });

  it('detects data class UiState anti-pattern', () => {
    expect(content).toContain('sealed interface');
  });

  it('detects Channel for events anti-pattern', () => {
    expect(content).toContain('SharedFlow');
  });

  it('has size limit check (check 5)', () => {
    expect(content).toContain('checkSize');
    expect(content).toContain('checkSizeLimits');
  });

  it('returns VALID/FIXABLE/REJECTED status', () => {
    expect(content).toContain('"VALID"');
    expect(content).toContain('"FIXABLE"');
    expect(content).toContain('"REJECTED"');
  });

  it('provides split suggestions', () => {
    expect(content).toContain('split_suggestion');
  });
});

// ── 7. check-doc-patterns tool ───────────────────────────────────────────────

describe('check-doc-patterns tool', () => {
  const content = readFile(path.join(MCP_TOOLS_DIR, 'check-doc-patterns.ts'));

  it('detects normative language (MUST/NEVER/ALWAYS)', () => {
    expect(content).toContain('NORMATIVE_RE');
    expect(content).toMatch(/MUST|NEVER|ALWAYS|FORBIDDEN|REQUIRED/);
  });

  it('finds rule candidates without rules: frontmatter', () => {
    expect(content).toContain('findRuleCandidates');
  });

  it('finds orphaned rules', () => {
    expect(content).toContain('findOrphanedRules');
  });

  it('checks rule-doc alignment', () => {
    expect(content).toContain('checkRuleAlignment');
  });

  it('uses rule-parser from generation pipeline', () => {
    expect(content).toContain('parseRuleDefinitions');
  });
});

// ── 8. APPROVED_CATEGORIES includes api ──────────────────────────────────────

describe('category system', () => {
  const content = readFile(path.join(MCP_TOOLS_DIR, 'validate-doc-structure.ts'));

  it('APPROVED_CATEGORIES includes "api" (20 total)', () => {
    expect(content).toContain('"api"');
  });

  it('SUBDIR_TO_CATEGORIES maps api directory', () => {
    expect(content).toContain('api: ["api"]');
  });
});

// ── 9. doc-updater template ──────────────────────────────────────────────────

describe('doc-updater template', () => {
  const content = readFile(path.join(TEMPLATES_DIR, 'doc-updater.md'));

  it('has SendMessage in tools', () => {
    expect(content).toMatch(/tools:.*SendMessage/);
  });

  it('has Pre-Write Validation section', () => {
    expect(content).toContain('Pre-Write Validation');
  });

  it('references validate-doc-update MCP tool', () => {
    expect(content).toContain('validate-doc-update');
  });

  it('has rejection protocol', () => {
    expect(content).toContain('Rejection Protocol');
    expect(content).toContain('REJECTED');
  });

  it('has Detekt rule notification', () => {
    expect(content).toContain('Detekt Rule Notification');
    expect(content).toContain('/generate-rules');
  });

  it('has generated file protection', () => {
    expect(content).toContain('Generated File Protection');
    expect(content).toContain('generated: true');
  });

  it('template version bumped to 2.4.0', () => {
    expect(content).toContain('template_version: "2.5.0"');
  });
});

// ── 10. quality-gater template ───────────────────────────────────────────────

describe('quality-gater template', () => {
  const content = readFile(path.join(TEMPLATES_DIR, 'quality-gater.md'));

  it('has dynamic rule discovery (Step 1)', () => {
    expect(content).toContain('Project Rule Discovery');
  });

  it('references /pre-pr as primary enforcement', () => {
    expect(content).toContain('/pre-pr');
  });

  it('has KDoc coverage step', () => {
    expect(content).toContain('kdoc-coverage');
  });

  it('has production file verification', () => {
    expect(content).toContain('Production File Verification');
  });

  it('has project rule cross-check', () => {
    expect(content).toContain('Project Rule Cross-Check');
  });

  it('template version 2.5.0', () => {
    expect(content).toContain('template_version: "2.5.0"');
  });

  it('has architect deliberation step', () => {
    expect(content).toContain('Architect Deliberation');
  });
});

// ── 11. quality-gate-protocol doc ────────────────────────────────────────────

describe('quality-gate-protocol doc', () => {
  const content = readFile(path.join(DOCS_DIR, 'quality-gate-protocol.md'));

  it('has dynamic rule discovery', () => {
    expect(content).toContain('Project Rule Discovery');
  });

  it('references /pre-pr as primary enforcement', () => {
    expect(content).toContain('/pre-pr');
  });

  it('has KDoc coverage step', () => {
    expect(content).toContain('KDoc');
  });

  it('has production file verification', () => {
    expect(content).toContain('Production File Verification');
  });

  it('version bumped to 3', () => {
    expect(content).toContain('version: 3');
  });

  it('has architect deliberation step', () => {
    expect(content).toContain('Architect Deliberation');
  });
});

// ── 12. Skills exist ─────────────────────────────────────────────────────────

describe('doc integrity skills', () => {
  const skills = ['kdoc-audit', 'kdoc-migrate', 'generate-api-docs'];

  for (const skill of skills) {
    it(`${skill}/SKILL.md exists`, () => {
      expect(fileExists(path.join(SKILLS_DIR, skill, 'SKILL.md'))).toBe(true);
    });
  }

  it('kdoc-audit references kdoc-coverage MCP tool', () => {
    const content = readFile(path.join(SKILLS_DIR, 'kdoc-audit/SKILL.md'));
    expect(content).toContain('kdoc-coverage');
  });

  it('kdoc-migrate references find-pattern for context', () => {
    const content = readFile(path.join(SKILLS_DIR, 'kdoc-migrate/SKILL.md'));
    expect(content).toContain('find-pattern');
  });

  it('kdoc-migrate has no-stubs rule', () => {
    const content = readFile(path.join(SKILLS_DIR, 'kdoc-migrate/SKILL.md'));
    expect(content).toContain('No stubs');
  });

  it('generate-api-docs references dokka-markdown-plugin', () => {
    const content = readFile(path.join(SKILLS_DIR, 'generate-api-docs/SKILL.md'));
    expect(content).toContain('dokka-markdown-plugin');
  });

  it('generate-api-docs no longer references dokka-to-docs.sh', () => {
    const content = readFile(path.join(SKILLS_DIR, 'generate-api-docs/SKILL.md'));
    expect(content).not.toContain('dokka-to-docs.sh');
  });

  it('generate-api-docs is marked optional', () => {
    const content = readFile(path.join(SKILLS_DIR, 'generate-api-docs/SKILL.md'));
    expect(content).toContain('Optional');
  });
});

// ── 13. Dokka markdown plugin (external — repo: oscardlfr/dokka-markdown-plugin) ─

describe('Dokka markdown plugin (external)', () => {
  const PLUGIN_POINTER_README = path.join(ROOT, 'tools/dokka-markdown-plugin/README.md');

  it('pointer README exists at original L0 path', () => {
    expect(fileExists(PLUGIN_POINTER_README)).toBe(true);
  });

  it('pointer README points at external repo', () => {
    const content = readFile(PLUGIN_POINTER_README);
    expect(content).toContain('github.com/oscardlfr/dokka-markdown-plugin');
    expect(content).toContain('MOVED');
  });

  it('versions-manifest.json tracks dokka-markdown-plugin', () => {
    const content = readFile(path.join(ROOT, 'versions-manifest.json'));
    expect(content).toContain('dokka-markdown-plugin');
  });

  it('versions-manifest.json marks dokka-markdown-plugin as external', () => {
    const content = readFile(path.join(ROOT, 'versions-manifest.json'));
    expect(content).toContain('"external": true');
    expect(content).toContain('maven.pkg.github.com/oscardlfr/dokka-markdown-plugin');
  });

  it('convention plugin template exists', () => {
    expect(fileExists(path.join(ROOT, 'setup/templates/build-logic/dokka-convention.gradle.kts.template'))).toBe(true);
  });

  it('convention plugin is marked optional', () => {
    const content = readFile(path.join(ROOT, 'setup/templates/build-logic/dokka-convention.gradle.kts.template'));
    expect(content.toUpperCase()).toContain('OPTIONAL');
  });
});

// ── 14. Cross-references ─────────────────────────────────────────────────────

describe('cross-references', () => {
  it('kdoc-audit skill references quality gate Step 0.5', () => {
    const content = readFile(path.join(SKILLS_DIR, 'kdoc-audit/SKILL.md'));
    expect(content).toContain('Step 0.5');
  });

  it('kdoc-audit skill references doc-alignment-agent', () => {
    const content = readFile(path.join(SKILLS_DIR, 'kdoc-audit/SKILL.md'));
    expect(content).toContain('doc-alignment-agent');
  });

  it('kdoc-migrate skill references /generate-api-docs', () => {
    const content = readFile(path.join(SKILLS_DIR, 'kdoc-migrate/SKILL.md'));
    expect(content).toContain('generate-api-docs');
  });

  it('quality-gate-protocol references dynamic rule discovery', () => {
    const content = readFile(path.join(DOCS_DIR, 'quality-gate-protocol.md'));
    expect(content).toContain('Project Rule Discovery');
    expect(content).toContain('/pre-pr');
  });

  it('validate-doc-update imports from doc-scoring', () => {
    const content = readFile(path.join(MCP_TOOLS_DIR, 'validate-doc-update.ts'));
    expect(content).toContain('from "../utils/doc-scoring.js"');
  });

  it('validate-doc-update imports from validate-doc-structure', () => {
    const content = readFile(path.join(MCP_TOOLS_DIR, 'validate-doc-update.ts'));
    expect(content).toContain('from "./validate-doc-structure.js"');
  });
});

// ── 14.5. /pre-pr Step 5.7 — check-outdated ─────────────────────────────────

describe('/pre-pr has Step 5.7 referencing check-outdated', () => {
  const content = readFile(path.join(SKILLS_DIR, 'pre-pr/SKILL.md'));

  it('has Step 5.7 heading', () => {
    expect(content).toContain('Step 5.7');
  });

  it('Step 5.7 references Dependency freshness', () => {
    expect(content).toContain('Dependency freshness');
  });

  it('Step 5.7 references check-outdated CLI', () => {
    expect(content).toContain('check-outdated.js');
  });

  it('Step 5.7 checks for libs.versions.toml existence', () => {
    expect(content).toContain('libs.versions.toml');
  });

  it('Dep freshness appears in summary table', () => {
    expect(content).toContain('Dep freshness');
  });
});

// ── 15. dispatcher-scopes doc drift coverage (Wave 1) ───────────────────────

describe('dispatcher-scopes doc drift coverage (Wave 1)', () => {
  const DISPATCHER_SCOPES = path.join(ROOT, 'docs/testing/testing-patterns-dispatcher-scopes.md');
  const TESTING_PATTERNS = path.join(ROOT, 'docs/testing/testing-patterns.md');

  it('testing-patterns-dispatcher-scopes includes Path B2 section', () => {
    const content = readFile(DISPATCHER_SCOPES);
    expect(content).toContain('Path B2');
    expect(content).toContain('SharedFlow');
    expect(content).toContain('testScheduler');
  });

  it('testing-patterns-dispatcher-scopes includes BANNED block for runTest(UnconfinedTestDispatcher())', () => {
    const content = readFile(DISPATCHER_SCOPES);
    expect(content).toContain('BANNED');
    expect(content).toContain('runTest(UnconfinedTestDispatcher())');
  });

  it('testing-patterns.md Quick Reference mentions Path B2', () => {
    const content = readFile(TESTING_PATTERNS);
    expect(content).toContain('Path B2');
  });
});

// ── 16. Test file coverage ───────────────────────────────────────────────────

describe('test files exist for all new components', () => {
  const testDir = path.join(ROOT, 'mcp-server/tests/unit/tools');
  const utilTestDir = path.join(ROOT, 'mcp-server/tests/unit/utils');

  it('kdoc-coverage.test.ts exists', () => {
    expect(fileExists(path.join(testDir, 'kdoc-coverage.test.ts'))).toBe(true);
  });

  it('validate-doc-update.test.ts exists', () => {
    expect(fileExists(path.join(testDir, 'validate-doc-update.test.ts'))).toBe(true);
  });

  it('check-doc-patterns.test.ts exists', () => {
    expect(fileExists(path.join(testDir, 'check-doc-patterns.test.ts'))).toBe(true);
  });

  it('doc-scoring.test.ts exists', () => {
    expect(fileExists(path.join(utilTestDir, 'doc-scoring.test.ts'))).toBe(true);
  });
});
