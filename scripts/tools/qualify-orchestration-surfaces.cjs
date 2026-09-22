#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function names(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name.slice(0, -suffix.length)).sort();
}
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const at = line.indexOf(':');
    return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]] : [];
  }));
}
function files(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? files(target, suffix) : (entry.isFile() && target.endsWith(suffix) ? [target] : []);
  });
}
function main(rootArg) {
  const root = fs.realpathSync(path.resolve(rootArg || process.cwd()));
  const violations = [];
  const skillFiles = files(path.join(root, 'skills'), 'SKILL.md');
  const commandFiles = files(path.join(root, '.claude', 'commands'), '.md');
  const forbidden = /\b(?:Agent|SendMessage)\s*\(/;
  for (const file of skillFiles) {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    if (forbidden.test(text)) violations.push({ code: 'DIRECT_RUNTIME_BYPASS', path: rel });
  }
  for (const file of commandFiles) {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    if (forbidden.test(text)) violations.push({ code: 'DIRECT_RUNTIME_BYPASS', path: rel });
    for (const match of text.matchAll(/\$SKILL_DIR\/([a-z0-9-]+)\/SKILL\.md/g)) {
      if (!fs.existsSync(path.join(root, 'skills', match[1], 'SKILL.md'))) {
        violations.push({ code: 'COMMAND_SKILL_TARGET_MISSING', path: rel, name: match[1] });
      }
    }
  }
  for (const name of ['init-session', 'resume-work', 'work', 'quality-gate']) {
    const skill = path.join(root, 'skills', name, 'SKILL.md');
    const command = path.join(root, '.claude', 'commands', name + '.md');
    if (!fs.existsSync(skill)) violations.push({ code: 'CANONICAL_SKILL_MISSING', name });
    if (!fs.existsSync(command)) violations.push({ code: 'COMMAND_ADAPTER_MISSING', name });
    else if (!fs.readFileSync(command, 'utf8').includes(`$SKILL_DIR/${name}/SKILL.md`)) {
      violations.push({ code: 'COMMAND_ADAPTER_DRIFT', name });
    }
  }
  const skillNames = skillFiles.map((file) => path.basename(path.dirname(file))).sort();
  const copilotSkillDir = path.join(root, 'setup', 'copilot-templates');
  if (fs.existsSync(copilotSkillDir)) {
    for (const file of skillFiles) {
      const name = path.basename(path.dirname(file));
      const meta = frontmatter(fs.readFileSync(file, 'utf8'));
      if (meta.copilot === 'true' && !fs.existsSync(path.join(copilotSkillDir, name + '.prompt.md'))) {
        violations.push({ code: 'COPILOT_SKILL_ADAPTER_MISSING', name });
      }
    }
    for (const name of names(copilotSkillDir, '.prompt.md')) {
      if (!skillNames.includes(name)) violations.push({ code: 'COPILOT_SKILL_ADAPTER_ORPHAN', name });
    }
  }

  const manifestPath = path.join(root, '.claude', 'registry', 'agents.manifest.yaml');
  let agentCounts = null;
  if (fs.existsSync(manifestPath)) {
    const yaml = require(path.join(root, 'mcp-server', 'node_modules', 'yaml'));
    const manifest = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
    const declared = Object.keys((manifest && manifest.agents) || {}).sort();
    const claude = names(path.join(root, '.claude', 'agents'), '.md');
    const templates = names(path.join(root, 'setup', 'agent-templates'), '.md').filter((name) => name !== 'README');
    const copilot = names(path.join(root, 'setup', 'copilot-agent-templates'), '.agent.md');
    agentCounts = { declared: declared.length, claude: claude.length, templates: templates.length, copilot: copilot.length };
    for (const [surface, actual] of Object.entries({ claude, templates, copilot })) {
      for (const name of declared.filter((item) => !actual.includes(item))) violations.push({ code: 'AGENT_SURFACE_MISSING', surface, name });
      for (const name of actual.filter((item) => !declared.includes(item))) violations.push({ code: 'AGENT_SURFACE_ORPHAN', surface, name });
    }
    for (const name of declared.filter((item) => claude.includes(item) && templates.includes(item))) {
      const mirror = fs.readFileSync(path.join(root, '.claude', 'agents', name + '.md'));
      const template = fs.readFileSync(path.join(root, 'setup', 'agent-templates', name + '.md'));
      if (!mirror.equals(template)) violations.push({ code: 'AGENT_TEMPLATE_MIRROR_DRIFT', name });
    }
  }
  const topology = fs.readFileSync(path.join(root, '.claude', 'registry', 'wave-topology.yaml'));
  if (!topology.includes(Buffer.from('schema: wave-phase-state/v1'))) {
    violations.push({ code: 'CONTROL_PLANE_NOT_REGISTERED' });
  }
  return {
    schema: 'orchestration-surface-qualification/v1',
    status: violations.length ? 'fail' : 'pass',
    skills_scanned: skillFiles.length,
    commands_scanned: commandFiles.length,
    agent_surfaces: agentCounts,
    topology_sha256: sha256(topology),
    violations,
  };
}

if (require.main === module) {
  try {
    const result = main(process.argv[2]);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.status !== 'pass') process.exitCode = 2;
  } catch (error) {
    process.stdout.write(JSON.stringify({ schema: 'orchestration-surface-qualification/v1', status: 'error', reason: error.message }) + '\n');
    process.exitCode = 2;
  }
}

module.exports = { main };
