'use strict';

// Every role template forbids an L1/L2 consumer from reaching L0 executables except through the toolkit launcher.
// The runtime itself, however, hands each consultation target closed commands that name the qualified absolute
// toolkit executable: the persistent bootstrap's `FIRST Bash=` `ready` command and the consultation recipe
// (`claim`, `lease-heartbeat`, `publish-result`). A target that applied the launcher rule to those commands refused
// its claim and stopped the wave with WORKER_NOT_CLAIMED. These tests pin the exception clause in every template that
// carries the rule, and prove the clause is necessary and names exactly the subcommands the runtime renders.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = fs.realpathSync(path.resolve(__dirname, '..', '..'));
const rll = require('../lib/runtime-role-lifecycle.cjs');
const { consultationTargetCommandLine, oneShotConsultationRecipe } = require('../lib/runtime-role-lifecycle/consultation-target-recipe.cjs')
  .createConsultationTargetRecipe();
const launcher = require('../../.claude/runtime/l0-toolkit-launcher.cjs');

const LAUNCHER_RULE = 'Execute supported L0 operations only through `node .claude/runtime/l0-toolkit-launcher.cjs`.';
const NO_LAUNCHER_ID_STOP = 'If a required operation has no launcher ID, stop and report a runtime-contract defect instead of copying files or guessing a path.';
const RENDERED_COMMAND_CLAUSE = 'Commands the runtime renders for you — the `FIRST Bash=` `ready` command of your bootstrap and the consultation '
  + '`X`/`Y` recipe (`claim`, `lease-heartbeat`, `publish-result`) — are closed, host-issued commands: run them exactly as rendered, '
  + 'including their absolute toolkit path; they are not operations you resolve, so the launcher rule and the no-launcher-ID stop do '
  + 'not apply to them.';

const TEMPLATE_DIRS = Object.freeze([
  { dir: path.join(REPO_ROOT, 'setup', 'agent-templates'), suffix: '.md' },
  { dir: path.join(REPO_ROOT, 'setup', 'copilot-agent-templates'), suffix: '.agent.md' },
  { dir: path.join(REPO_ROOT, '.claude', 'agents'), suffix: '.md' },
]);
// The roles whose templates carry the consumer runtime source boundary today. The rule-bearing set may grow; it may
// never silently shrink to zero and turn assertion (a) into a vacuous pass.
const RULE_BEARING_ROLES = Object.freeze([
  'arch-integration', 'arch-platform', 'arch-testing', 'context-provider', 'doc-updater', 'planner', 'quality-gater',
  'toolkit-specialist', 'verifier',
]);

function ruleBearingTemplates() {
  const found = [];
  for (const { dir, suffix } of TEMPLATE_DIRS) {
    for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(suffix)).sort()) {
      const file = path.join(dir, name);
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes(LAUNCHER_RULE)) found.push({ file, role: name.slice(0, -suffix.length), content });
    }
  }
  return found;
}

/** Lowercase backticked tokens of the clause are the subcommands it exempts (`X`, `Y`, `FIRST Bash=` are not). */
function clauseSubcommands(clause) {
  return [...clause.matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((token) => /^[a-z][a-z-]*$/.test(token)).sort();
}

function renderedTargetSubcommands(commandLine) {
  return [...commandLine.matchAll(/X\+\["([a-z-]+)"\]/g)].map((match) => match[1]);
}

test('(a) every template carrying the launcher-only rule also carries the rendered-command exception clause', () => {
  const templates = ruleBearingTemplates();
  for (const { dir, suffix } of TEMPLATE_DIRS) {
    const roles = templates.filter((entry) => path.dirname(entry.file) === dir).map((entry) => entry.role);
    for (const role of RULE_BEARING_ROLES) {
      assert.ok(roles.includes(role), `${path.relative(REPO_ROOT, path.join(dir, role + suffix))} must carry the launcher rule`);
    }
  }
  for (const { file, content } of templates) {
    const where = path.relative(REPO_ROOT, file);
    const line = content.split('\n').find((candidate) => candidate.includes(LAUNCHER_RULE));
    assert.ok(line.includes(NO_LAUNCHER_ID_STOP + ' ' + RENDERED_COMMAND_CLAUSE),
      `${where}: the launcher rule must be followed in the same paragraph by the rendered-command exception`);
    assert.equal(content.split(RENDERED_COMMAND_CLAUSE).length - 1, 1, `${where}: the clause must appear exactly once`);
  }
});

test('(b) the persistent bootstrap renders absolute toolkit executables for ready and the consultation recipe, never the launcher', () => {
  const consumerRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rendered-command-consumer-')));
  try {
    assert.notEqual(consumerRoot, REPO_ROOT, 'the consumer root must differ from the toolkit root');
    const message = rll.claudeReadyBootstrapMessageFor('a'.repeat(32), 'context-provider', consumerRoot);
    const firstLine = message.split('\n')[0];
    const prefix = 'FIRST Bash=';
    const suffix = ';require READY else report/stop;WAIT.';
    assert.ok(firstLine.startsWith(prefix) && firstLine.endsWith(suffix), firstLine);
    const readyArgv = rll.parsePosixDirect(firstLine.slice(prefix.length, -suffix.length));
    assert.ok(path.isAbsolute(readyArgv[0]), 'node is rendered as an absolute executable');
    assert.equal(readyArgv[1], path.join(REPO_ROOT, 'scripts', 'lib', 'runtime-role-lifecycle.cjs'));
    assert.ok(!readyArgv[1].startsWith(consumerRoot + path.sep), 'ready never resolves below the consumer');
    assert.notEqual(path.basename(readyArgv[1]), 'l0-toolkit-launcher.cjs');
    assert.deepEqual(readyArgv.slice(2, 4), ['ready', '--action']);

    const assignment = /;C=("[^"]+")/.exec(message);
    assert.ok(assignment, 'an external consumer receives a literal absolute consultation executable: ' + message);
    const consultationCli = JSON.parse(assignment[1]);
    assert.equal(consultationCli, path.join(REPO_ROOT, 'scripts', 'lib', 'runtime-consultation.cjs'));
    assert.notEqual(path.basename(consultationCli), 'l0-toolkit-launcher.cjs');
    assert.ok(message.includes('X=[n,C]'), 'the recipe executes C directly with node');
    assert.ok(message.includes(consultationTargetCommandLine()));
  } finally {
    fs.rmSync(consumerRoot, { recursive: true, force: true });
  }
});

test('(b) the one-shot recipe names the same absolute toolkit executable the execution gate derives', () => {
  const consumerRoot = '/consumer/product';
  const coordinationRoot = consumerRoot + '/.planning/coordination';
  // agent-spawn-execution-gate.js derives it relative to its own toolkit location, never from the consumer root.
  const consultationCliPath = path.resolve(REPO_ROOT, '.claude', 'hooks', '../../scripts/lib/runtime-consultation.cjs');
  const recipe = oneShotConsultationRecipe({
    role: 'context-provider', projectRoot: consumerRoot, consultationCliPath, coordinationRoot,
    requestPath: coordinationRoot + '/r/w/p/transactions/abc/request.json',
  });
  const assignment = /;C=("[^"]+")/.exec(recipe);
  assert.ok(assignment, recipe);
  const rendered = JSON.parse(assignment[1]);
  assert.ok(path.isAbsolute(rendered));
  assert.equal(rendered, path.join(REPO_ROOT, 'scripts', 'lib', 'runtime-consultation.cjs'));
  assert.notEqual(path.basename(rendered), 'l0-toolkit-launcher.cjs');
  assert.ok(recipe.includes('X=[n,C]') && recipe.includes(consultationTargetCommandLine()));
});

test('(b) the clause names exactly the rendered subcommands, and the launcher cannot express any of them', () => {
  const rendered = renderedTargetSubcommands(consultationTargetCommandLine());
  assert.deepEqual(rendered, ['claim', 'lease-heartbeat', 'publish-result'], 'grammar order: claim, heartbeat, publish');
  assert.deepEqual(clauseSubcommands(RENDERED_COMMAND_CLAUSE), ['ready', ...rendered].sort());

  // Necessity: the requester launcher admits none of the target subcommands, and no launcher operation reaches the
  // lifecycle CLI that `ready` runs. Without the exception a role obeying its template cannot claim or become READY.
  const consult = launcher.TOOL_SPECS['runtime-consult'];
  assert.equal(consult.relative, 'scripts/lib/runtime-consultation.cjs');
  for (const subcommand of rendered) {
    assert.ok(!consult.allowedSubcommands.includes(subcommand), `launcher runtime-consult must not admit ${subcommand}`);
  }
  for (const [id, spec] of Object.entries(launcher.TOOL_SPECS)) {
    assert.notEqual(spec.relative, 'scripts/lib/runtime-role-lifecycle.cjs', `launcher op ${id} must not wrap the lifecycle CLI`);
  }
});

test('tl-session-start explains the same exception next to the requester launcher rule', () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'agents', 'tl-session-start.md'), 'utf8');
  const paragraph = doc.split('\n').find((line) => line.includes('a consumer never invokes the toolkit path directly'));
  assert.ok(paragraph, 'the requester launcher rule paragraph must exist');
  for (const fragment of ['`FIRST Bash=` `ready`', '(`claim`, `lease-heartbeat`, `publish-result`)', 'exactly as rendered',
    'no-launcher-ID stop']) {
    assert.ok(paragraph.includes(fragment), 'tl-session-start must state ' + fragment);
  }
});
