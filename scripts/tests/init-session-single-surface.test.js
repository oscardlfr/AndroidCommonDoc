'use strict';

// A consumer session launched with `--add-dir <L0>` loads the consumer's own `.claude/skills/init-session` AND whatever
// L0 exposes through the added directory. L0's legacy `.claude/commands/init-session.md` made /init-session appear twice
// (a command and a skill). L0 now exposes the skill only, so the consumer's skill shadows it and exactly one entry remains.

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const NAME = 'init-session';

/** Mirrors how a session lists entries: per directory, skills and commands are separate kinds; the same name within one
 * kind is shadowed by the earlier (project) directory. */
function sessionEntries(directories) {
  const seen = new Set();
  const entries = [];
  for (const dir of directories) {
    const skillsDir = path.join(dir, '.claude', 'skills');
    const commandsDir = path.join(dir, '.claude', 'commands');
    const skills = fs.existsSync(skillsDir)
      ? fs.readdirSync(skillsDir).filter((n) => fs.existsSync(path.join(skillsDir, n, 'SKILL.md'))) : [];
    const commands = fs.existsSync(commandsDir)
      ? fs.readdirSync(commandsDir).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)) : [];
    for (const [kind, names] of [['skill', skills], ['command', commands]]) {
      for (const name of names) {
        if (seen.has(kind + ':' + name)) continue;
        seen.add(kind + ':' + name);
        entries.push({ kind, name, dir });
      }
    }
  }
  return entries;
}

function consumerWithInstalledSkill() {
  const consumer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'init-session-consumer-')));
  const target = path.join(consumer, '.claude', 'skills', NAME);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'skills', NAME, 'SKILL.md'), path.join(target, 'SKILL.md'));
  return consumer;
}

test('a consumer session with L0 added lists exactly one init-session entry', () => {
  const consumer = consumerWithInstalledSkill();
  try {
    const matching = sessionEntries([consumer, repoRoot]).filter((entry) => entry.name === NAME);
    assert.deepStrictEqual(matching.map((entry) => entry.kind), ['skill'], JSON.stringify(matching));
  } finally {
    fs.rmSync(consumer, { recursive: true, force: true });
  }
});

test('L0 itself still exposes /init-session, exactly once', () => {
  const matching = sessionEntries([repoRoot]).filter((entry) => entry.name === NAME);
  assert.strictEqual(matching.length, 1, JSON.stringify(matching));
  assert.strictEqual(matching[0].kind, 'skill');
});

test('the L0 skill surface is a byte-identical mirror of the canonical skill source', () => {
  assert.strictEqual(
    fs.readFileSync(path.join(repoRoot, '.claude', 'skills', NAME, 'SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(repoRoot, 'skills', NAME, 'SKILL.md'), 'utf8'),
  );
});

test('the model-mismatch guidance reaches the surface a session actually loads', () => {
  const loaded = fs.readFileSync(path.join(repoRoot, '.claude', 'skills', NAME, 'SKILL.md'), 'utf8');
  assert.match(loaded, /host-model-mismatch/);
});
