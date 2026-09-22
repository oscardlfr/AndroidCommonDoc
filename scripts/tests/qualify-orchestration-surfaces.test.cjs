'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { main } = require('../tools/qualify-orchestration-surfaces.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestration-qualification-'));
  for (const name of ['init-session', 'resume-work', 'work', 'quality-gate']) {
    fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), `# ${name}\n`);
    fs.mkdirSync(path.join(root, '.claude', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'commands', name + '.md'), `$SKILL_DIR/${name}/SKILL.md\n`);
  }
  fs.mkdirSync(path.join(root, '.claude', 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'registry', 'wave-topology.yaml'), 'control_plane:\n  schema: wave-phase-state/v1\n');
  return root;
}

function addAgentSurfaces(root) {
  fs.mkdirSync(path.join(root, 'mcp-server', 'node_modules'), { recursive: true });
  fs.symlinkSync(path.resolve(__dirname, '../../mcp-server/node_modules/yaml'), path.join(root, 'mcp-server', 'node_modules', 'yaml'), 'junction');
  fs.writeFileSync(path.join(root, '.claude', 'registry', 'agents.manifest.yaml'), 'agents:\n  arch-testing: {}\n');
  for (const dir of ['.claude/agents', 'setup/agent-templates', 'setup/copilot-agent-templates']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.claude', 'agents', 'arch-testing.md'), 'same\n');
  fs.writeFileSync(path.join(root, 'setup', 'agent-templates', 'arch-testing.md'), 'same\n');
  fs.writeFileSync(path.join(root, 'setup', 'copilot-agent-templates', 'arch-testing.agent.md'), 'generated\n');
}

test('canonical orchestration surfaces qualify', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(main(root).status, 'pass');
});

test('direct vendor lifecycle calls fail qualification', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'skills', 'work', 'SKILL.md'), 'Agent({ role: "x" })\n');
  assert.deepEqual(main(root).violations.map((x) => x.code), ['DIRECT_RUNTIME_BYPASS']);
});

test('command adapters cannot bypass lifecycle or reference a missing canonical skill', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.claude', 'commands', 'extra.md'), '$SKILL_DIR/missing/SKILL.md\nSendMessage({to: "x"})\n');
  assert.deepEqual(main(root).violations.map((x) => x.code).sort(), [
    'COMMAND_SKILL_TARGET_MISSING', 'DIRECT_RUNTIME_BYPASS',
  ]);
});

test('agent manifest, canonical templates, mirrors, and generated adapters must stay in parity', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  addAgentSurfaces(root);
  assert.equal(main(root).status, 'pass');
  fs.writeFileSync(path.join(root, 'setup', 'agent-templates', 'arch-testing.md'), 'drift\n');
  fs.writeFileSync(path.join(root, 'setup', 'copilot-agent-templates', 'orphan.agent.md'), 'orphan\n');
  assert.deepEqual(main(root).violations.map((x) => x.code).sort(), [
    'AGENT_SURFACE_ORPHAN', 'AGENT_TEMPLATE_MIRROR_DRIFT',
  ]);
});

test('copilot skill adapters reject both missing generated targets and orphans', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'setup', 'copilot-templates'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'quality-gate', 'SKILL.md'), '---\ncopilot: true\n---\n# Quality gate\n');
  assert.deepEqual(main(root).violations.map((x) => x.code), ['COPILOT_SKILL_ADAPTER_MISSING']);
  fs.writeFileSync(path.join(root, 'setup', 'copilot-templates', 'quality-gate.prompt.md'), 'generated\n');
  fs.writeFileSync(path.join(root, 'setup', 'copilot-templates', 'orphan.prompt.md'), 'orphan\n');
  assert.deepEqual(main(root).violations.map((x) => x.code), ['COPILOT_SKILL_ADAPTER_ORPHAN']);
});
