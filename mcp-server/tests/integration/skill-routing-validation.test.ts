/**
 * Skill Routing Validation - Wave 15 RED tests.
 *
 * Validates that the /work skill routing table does not spawn orchestrator
 * agents via Agent(), that all Agent() references point to existing agents,
 * and that all agent skill references point to existing skills.
 *
 * Tests marked [EXPECT FAIL] are regression anchors -- they will fail on
 * the current codebase and pass after the corresponding fix is applied.
 *
 * Issues detected:
 *   - skills/work/SKILL.md line 64: Agent(project-manager) -- orchestrator spawned as sub-agent
 *   - .claude/agents/beta-readiness-agent.md: skills.pre-release does not exist
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(ROOT, 'setup/agent-templates');
const AGENTS_DIR = path.join(ROOT, '.claude/agents');
const SKILLS_DIR = path.join(ROOT, 'skills');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all Agent("name") or Agent(`name`) calls from text. */
function extractAgentCalls(text: string): string[] {
  const pattern = /Agent\(["'`]([^"'`]+)["'`]\)/g;
  return [...text.matchAll(pattern)].map((m: RegExpMatchArray) => m[1]);
}

/** Extract skills: array from YAML frontmatter of a markdown file. */
function extractSkillsFromFrontmatter(content: string): string[] {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return [];
  const frontmatter = frontmatterMatch[1];
  const skillsBlockMatch = frontmatter.match(/^skills:\s*\n((?:\s+-\s+\S+\s*\n?)*)/m);
  if (!skillsBlockMatch) return [];
  const items = skillsBlockMatch[1].match(/-\s+(\S+)/g) || [];
  return items.map((item: string) => item.replace(/^-\s+/, '').trim());
}

/** Get all skill names (directory names under skills/ that have a SKILL.md). */
function getAllSkillNames(): string[] {
  return fs.readdirSync(SKILLS_DIR).filter((entry: string) =>
    fs.existsSync(path.join(SKILLS_DIR, entry, 'SKILL.md'))
  );
}

/** Get all known agent names from .claude/agents/ and setup/agent-templates/. */
function getAllKnownAgentNames(): Set<string> {
  const names = new Set<string>();
  for (const dir of [AGENTS_DIR, TEMPLATES_DIR]) {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir)
        .filter((f: string) => f.endsWith('.md'))
        .forEach((f: string) => names.add(f.replace(/\.md$/, '')));
    }
  }
  return names;
}

const ORCHESTRATOR_AGENTS = ['project-manager', 'dev-lead', 'quality-gater'];

// ---------------------------------------------------------------------------
// Describe: Work Skill Routing - Orchestrator Safety
// ---------------------------------------------------------------------------

describe('Work Skill Routing - Orchestrator Safety', () => {

  it('/work skill must NOT spawn project-manager via Agent() [EXPECT FAIL]', () => {
    const content = fs.readFileSync(path.join(SKILLS_DIR, 'work', 'SKILL.md'), 'utf-8');
    const agentCalls = extractAgentCalls(content);
    // project-manager is an orchestrator -- it must not be spawned as a sub-agent.
    // The skill should instead say "Read template, act in-process" or similar.
    expect(agentCalls).not.toContain('project-manager');
  });

  it('/work skill must NOT spawn dev-lead via Agent()', () => {
    const content = fs.readFileSync(path.join(SKILLS_DIR, 'work', 'SKILL.md'), 'utf-8');
    const agentCalls = extractAgentCalls(content);
    expect(agentCalls).not.toContain('dev-lead');
  });

  it('No skill should spawn orchestrator agents as sub-agents [EXPECT FAIL]', () => {
    const skillNames = getAllSkillNames();
    const violations: string[] = [];

    for (const skillName of skillNames) {
      const file = path.join(SKILLS_DIR, skillName, 'SKILL.md');
      const content = fs.readFileSync(file, 'utf-8');
      const agentCalls = extractAgentCalls(content);

      for (const agentName of agentCalls) {
        if (ORCHESTRATOR_AGENTS.includes(agentName)) {
          violations.push(`skills/${skillName}/SKILL.md -> Agent(${agentName})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// Describe: Skill Agent References Validity
// ---------------------------------------------------------------------------

describe('Skill Agent References Validity', () => {

  it('All Agent() references in /work skill point to existing agents', () => {
    const content = fs.readFileSync(path.join(SKILLS_DIR, 'work', 'SKILL.md'), 'utf-8');
    const agentCalls = extractAgentCalls(content);
    const knownAgents = getAllKnownAgentNames();

    const missing = agentCalls.filter((name: string) => !knownAgents.has(name));
    expect(missing).toEqual([]);
  });

  it('All skill to agent references across all skills are valid', () => {
    const skillNames = getAllSkillNames();
    const knownAgents = getAllKnownAgentNames();
    const missing: string[] = [];

    for (const skillName of skillNames) {
      const file = path.join(SKILLS_DIR, skillName, 'SKILL.md');
      const content = fs.readFileSync(file, 'utf-8');
      const agentCalls = extractAgentCalls(content);

      for (const agentName of agentCalls) {
        if (!knownAgents.has(agentName)) {
          missing.push(`skills/${skillName}/SKILL.md -> Agent(${agentName})`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// Describe: Agent Skill References Validity
// ---------------------------------------------------------------------------

describe('Agent Skill References Validity', () => {

  it('beta-readiness-agent skill references must all exist [EXPECT FAIL]', () => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, 'beta-readiness-agent.md'), 'utf-8');
    const skills = extractSkillsFromFrontmatter(content);
    const allSkillNames = getAllSkillNames();

    const missing = skills.filter((skill: string) => !allSkillNames.includes(skill));
    // 'pre-release' skill does not exist -- this test should FAIL until it is created
    expect(missing).toEqual([]);
  });

  it('All agents skill references point to existing skills [EXPECT FAIL]', () => {
    const allSkillNames = getAllSkillNames();
    const agentFiles = fs.readdirSync(AGENTS_DIR).filter((f: string) => f.endsWith('.md'));
    const violations: string[] = [];

    for (const agentFile of agentFiles) {
      const content = fs.readFileSync(path.join(AGENTS_DIR, agentFile), 'utf-8');
      const skills = extractSkillsFromFrontmatter(content);

      for (const skill of skills) {
        if (!allSkillNames.includes(skill)) {
          violations.push(`${agentFile} -> skill '${skill}' not found`);
        }
      }
    }

    // Should FAIL because beta-readiness-agent references 'pre-release' which does not exist
    expect(violations).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// Describe: Routing Table Consistency
// ---------------------------------------------------------------------------

describe('Routing Table Consistency', () => {

  it('/work Level 1 keywords have no duplicates', () => {
    const content = fs.readFileSync(path.join(SKILLS_DIR, 'work', 'SKILL.md'), 'utf-8');

    // Extract Level 1 routing table rows: | `pattern` | route |
    const tableRows = [...content.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)];
    const keywords = tableRows.map((m: RegExpMatchArray) => m[1]);

    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const kw of keywords) {
      if (seen.has(kw)) {
        duplicates.push(kw);
      }
      seen.add(kw);
    }

    expect(duplicates).toEqual([]);
  });

  it('/work Level 1 skill routes point to existing skills', () => {
    const content = fs.readFileSync(path.join(SKILLS_DIR, 'work', 'SKILL.md'), 'utf-8');
    const allSkillNames = getAllSkillNames();

    // Extract routes like /debug, /research, /pre-pr from routing table column 2
    // Matches lines: | `keywords` | `/skill-name` |
    const skillRouteRows = [...content.matchAll(/^\|[^|]+\|\s*`?\/([a-z][a-z0-9-]*)(?:\s|`|\s*\|)/gm)];
    const referencedSkills = skillRouteRows.map((m: RegExpMatchArray) => m[1]);

    // Also accept routes that resolve to .claude/commands/
    const commandsDir = path.join(ROOT, '.claude/commands');
    const commandNames = fs.existsSync(commandsDir)
      ? fs.readdirSync(commandsDir).filter((f: string) => f.endsWith('.md')).map((f: string) => f.replace(/\.md$/, ''))
      : [];

    const missing = referencedSkills.filter(
      (skillName: string) => !allSkillNames.includes(skillName) && !commandNames.includes(skillName)
    );

    expect(missing).toEqual([]);
  });

});
