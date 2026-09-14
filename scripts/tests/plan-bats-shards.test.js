#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  discoverInventory, buildPlan, selectShard, formatNulDelimited, formatPlanReport, parseArgs,
  computeWeight, itemWeight, MARKER_WEIGHTS, MARKER_PATTERNS,
  needsMcpServer, parseCiPrerequisites, CI_PREREQUISITE_DIRECTIVE_RE, KNOWN_CI_PREREQUISITES,
} = require('../tools/plan-bats-shards.cjs');

const PLANNER_PATH = path.join(__dirname, '..', 'tools', 'plan-bats-shards.cjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function makeFixture(nameToBytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-bats-shards-fixture-'));
  for (const [name, bytes] of Object.entries(nameToBytes)) {
    fs.writeFileSync(path.join(root, name), 'x'.repeat(bytes));
  }
  return root;
}

function allFiles(plan) {
  return plan.flatMap((shard) => shard.files.map((f) => f.relPath));
}

// ── discoverInventory ─────────────────────────────────────────────────────

test('discoverInventory finds only top-level *.bats files, with byte sizes', () => {
  const root = makeFixture({ 'a.bats': 10, 'b.bats': 5, 'c.txt': 999 });
  try {
    const inventory = discoverInventory(root);
    assert.deepStrictEqual(
      inventory.map((f) => f.relPath.split('/').pop()).sort(),
      ['a.bats', 'b.bats'],
    );
    const byName = Object.fromEntries(inventory.map((f) => [f.relPath.split('/').pop(), f.bytes]));
    assert.strictEqual(byName['a.bats'], 10);
    assert.strictEqual(byName['b.bats'], 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverInventory fails closed on an empty inventory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-bats-shards-empty-'));
  try {
    assert.throws(() => discoverInventory(root), /empty inventory/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverInventory fails closed on a missing suite root', () => {
  assert.throws(() => discoverInventory(path.join(os.tmpdir(), 'plan-bats-shards-does-not-exist-xyz')), /does not exist/);
});

test('discoverInventory fails closed on a non-regular-file match (a directory named *.bats)', () => {
  const root = makeFixture({ 'real.bats': 3 });
  try {
    fs.mkdirSync(path.join(root, 'fake-dir.bats'));
    assert.throws(() => discoverInventory(root), /non-regular-file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverInventory fails closed on a symlinked *.bats entry', () => {
  const root = makeFixture({ 'real.bats': 3 });
  try {
    fs.symlinkSync(path.join(root, 'real.bats'), path.join(root, 'link.bats'));
    assert.throws(() => discoverInventory(root), /symlink/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverInventory fails closed on a symlinked suite root itself (Sequence 10 #1)', () => {
  const realRoot = makeFixture({ 'real.bats': 3 });
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-bats-shards-symroot-'));
  const linkedRoot = path.join(container, 'suite-link');
  try {
    fs.symlinkSync(realRoot, linkedRoot, 'junction');
    assert.throws(() => discoverInventory(linkedRoot), /refusing symlinked suite root/);
  } finally {
    fs.rmSync(container, { recursive: true, force: true });
    fs.rmSync(realRoot, { recursive: true, force: true });
  }
});

test('discoverInventory fails closed on a newline-containing filename (skips if the OS refuses to create one)', () => {
  const root = makeFixture({ 'real.bats': 3 });
  try {
    let created = true;
    try {
      fs.writeFileSync(path.join(root, 'weird\nname.bats'), 'x');
    } catch {
      created = false;
    }
    if (!created) return; // platform cannot represent the filename; nothing to assert
    assert.throws(() => discoverInventory(root), /newline/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── buildPlan: determinism, coverage, duplicates, tie-break ────────────────

test('buildPlan is deterministic for identical inputs', () => {
  const root = makeFixture({ 'a.bats': 100, 'b.bats': 40, 'c.bats': 40, 'd.bats': 10, 'e.bats': 5 });
  try {
    const inventory = discoverInventory(root);
    const planA = buildPlan(inventory, 3);
    const planB = buildPlan(inventory.slice().reverse(), 3); // input order must not matter either
    assert.deepStrictEqual(planA, planB);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildPlan produces an exhaustive union with no duplicates across shards', () => {
  const root = makeFixture({
    'a.bats': 777, 'b.bats': 321, 'c.bats': 321, 'd.bats': 12, 'e.bats': 1, 'f.bats': 1,
  });
  try {
    const inventory = discoverInventory(root);
    const plan = buildPlan(inventory, 4);
    const assigned = allFiles(plan);
    assert.strictEqual(assigned.length, inventory.length);
    assert.strictEqual(new Set(assigned).size, inventory.length);
    assert.deepStrictEqual(new Set(assigned), new Set(inventory.map((f) => f.relPath)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildPlan tie-break on equal byte size is normalized-relative-path ascending', () => {
  // Four same-size files across 2 shards: greedy LPT with a fully equal-size
  // input degenerates to pure path order -- z, y, x, w assigned in that
  // scan order to whichever shard is currently lightest (0, then 1, then
  // 0, then 1), landing shard 0 = {w, y}, shard 1 = {x, z} once each
  // shard's own file list is re-sorted ascending for output.
  const root = makeFixture({ 'w.bats': 10, 'x.bats': 10, 'y.bats': 10, 'z.bats': 10 });
  try {
    const inventory = discoverInventory(root);
    const plan = buildPlan(inventory, 2);
    const names = (shard) => plan[shard].files.map((f) => f.relPath.split('/').pop());
    assert.deepStrictEqual(names(0), ['w.bats', 'y.bats']);
    assert.deepStrictEqual(names(1), ['x.bats', 'z.bats']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildPlan greedily balances an unequal-size inventory (largest file alone does not overload its shard)', () => {
  const root = makeFixture({ 'huge.bats': 1000, 'mid1.bats': 400, 'mid2.bats': 400, 'mid3.bats': 400 });
  try {
    const inventory = discoverInventory(root);
    const plan = buildPlan(inventory, 3);
    const hugeShard = plan.find((s) => s.files.some((f) => f.relPath.endsWith('huge.bats')));
    assert.strictEqual(hugeShard.files.length, 1, 'the largest file should not share a shard under this balance');
    for (const shard of plan) assert.ok(shard.totalBytes <= 1000, 'no shard should exceed the largest single file by much');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildPlan fails closed on a non-positive or non-integer shard count', () => {
  const inventory = [{ relPath: 'a.bats', absPath: '/x/a.bats', bytes: 1 }];
  assert.throws(() => buildPlan(inventory, 0), /positive integer/);
  assert.throws(() => buildPlan(inventory, -1), /positive integer/);
  assert.throws(() => buildPlan(inventory, 1.5), /positive integer/);
});

test('selectShard fails closed on an out-of-range or non-integer shard index', () => {
  const inventory = [{ relPath: 'a.bats', absPath: '/x/a.bats', bytes: 1 }];
  const plan = buildPlan(inventory, 2);
  assert.throws(() => selectShard(plan, -1), /out of range/);
  assert.throws(() => selectShard(plan, 2), /out of range/);
  assert.throws(() => selectShard(plan, 1.5), /out of range/);
  assert.deepStrictEqual(selectShard(plan, 0).concat(selectShard(plan, 1)).sort(), ['a.bats']);
});

// ── formatting ───────────────────────────────────────────────────────────

test('formatNulDelimited NUL-terminates every entry, including the last', () => {
  const out = formatNulDelimited(['a.bats', 'b.bats']);
  assert.strictEqual(out, 'a.bats\0b.bats\0');
});

test('formatPlanReport totals match the inventory and every shard file list is present', () => {
  const inventory = [
    { relPath: 'a.bats', absPath: '/x/a.bats', bytes: 10 },
    { relPath: 'b.bats', absPath: '/x/b.bats', bytes: 20 },
  ];
  const plan = buildPlan(inventory, 2);
  const report = formatPlanReport('scripts/tests', plan, inventory);
  assert.strictEqual(report.totalFiles, 2);
  assert.strictEqual(report.totalBytes, 30);
  assert.strictEqual(report.shardCount, 2);
  assert.strictEqual(report.shards.reduce((n, s) => n + s.fileCount, 0), 2);
});

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs rejects an unrecognized argument', () => {
  assert.throws(() => parseArgs(['--bogus']), /unrecognized argument/);
});

test('parseArgs rejects a missing --shard-count', () => {
  assert.throws(() => parseArgs(['--shard-index', '0']), /--shard-count is required/);
});

test('parseArgs rejects a non-integer --shard-count or --shard-index', () => {
  assert.throws(() => parseArgs(['--shard-count', '4.5', '--shard-index', '0']), /--shard-count must be/);
  assert.throws(() => parseArgs(['--shard-count', '4', '--shard-index', 'x']), /--shard-index must be/);
});

test('parseArgs requires --shard-index unless --json is given', () => {
  assert.throws(() => parseArgs(['--shard-count', '4']), /--shard-index is required/);
  const parsed = parseArgs(['--shard-count', '4', '--json']);
  assert.strictEqual(parsed.json, true);
  assert.strictEqual(parsed.shardIndex, null);
});

// Sequence 10 #2: reject duplicate flags and missing-value shapes explicitly.

test('parseArgs rejects a duplicated --shard-count', () => {
  assert.throws(
    () => parseArgs(['--shard-count', '4', '--shard-index', '0', '--shard-count', '8']),
    /duplicate argument: --shard-count/,
  );
});

test('parseArgs rejects a duplicated --shard-index', () => {
  assert.throws(
    () => parseArgs(['--shard-count', '4', '--shard-index', '0', '--shard-index', '1']),
    /duplicate argument: --shard-index/,
  );
});

test('parseArgs rejects a duplicated --suite-root', () => {
  assert.throws(
    () => parseArgs(['--suite-root', 'a', '--suite-root', 'b', '--shard-count', '4', '--shard-index', '0']),
    /duplicate argument: --suite-root/,
  );
});

test('parseArgs rejects a flag with no following token at all', () => {
  assert.throws(() => parseArgs(['--shard-count']), /missing value for --shard-count/);
});

test('parseArgs rejects a flag whose "value" is actually the next flag\'s name', () => {
  assert.throws(
    () => parseArgs(['--shard-count', '--json']),
    /missing value for --shard-count/,
  );
  assert.throws(
    () => parseArgs(['--shard-count', '4', '--shard-index', '--suite-root']),
    /missing value for --shard-index/,
  );
});

// ── CLI smoke tests (spawns the real script) ────────────────────────────

test('CLI: NUL-delimited default output is a safe exhaustive partition across all shards', () => {
  const root = makeFixture({ 'a.bats': 30, 'b.bats': 20, 'c.bats': 10, 'd.bats': 5 });
  try {
    const shardCount = 3;
    const collected = new Set();
    for (let i = 0; i < shardCount; i += 1) {
      const out = execFileSync('node', [
        PLANNER_PATH, '--suite-root', root, '--shard-index', String(i), '--shard-count', String(shardCount),
      ], { encoding: 'utf8' });
      const entries = out.length === 0 ? [] : out.split('\0').filter((s) => s.length > 0);
      for (const entry of entries) {
        assert.ok(!collected.has(entry), `duplicate across CLI shard invocations: ${entry}`);
        collected.add(entry);
      }
    }
    assert.strictEqual(collected.size, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: --json emits a full multi-shard report', () => {
  const root = makeFixture({ 'a.bats': 30, 'b.bats': 20 });
  try {
    const out = execFileSync('node', [PLANNER_PATH, '--suite-root', root, '--shard-count', '2', '--json'], { encoding: 'utf8' });
    const report = JSON.parse(out);
    assert.strictEqual(report.totalFiles, 2);
    assert.strictEqual(report.shards.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: fails closed (nonzero exit, stderr message) on an out-of-range shard index', () => {
  const root = makeFixture({ 'a.bats': 3 });
  try {
    assert.throws(() => execFileSync('node', [
      PLANNER_PATH, '--suite-root', root, '--shard-index', '9', '--shard-count', '2',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── weight (Sequence C18: runtime-cost proxy, not raw byte size) ─────────

test('computeWeight adds bytes plus each marker occurrence at its configured weight', () => {
  const bytes = 1000;
  const plain = 'no markers here at all';
  assert.strictEqual(computeWeight(bytes, plain), bytes);

  const oneSpawn = '_start_bridge_bg "$argv_json" BG_OUT';
  assert.strictEqual(computeWeight(bytes, oneSpawn), bytes + MARKER_WEIGHTS.bridgeSpawn);

  const onePlane = '_s16e2e_start_retained_plane "$session_id"';
  assert.strictEqual(computeWeight(bytes, onePlane), bytes + MARKER_WEIGHTS.retainedPlaneStart);

  const both = oneSpawn + '\n' + onePlane + '\n' + onePlane;
  assert.strictEqual(
    computeWeight(bytes, both),
    bytes + MARKER_WEIGHTS.bridgeSpawn + 2 * MARKER_WEIGHTS.retainedPlaneStart,
  );
});

test('computeWeight counts every alias in the bridgeSpawn pattern (bridge.bats and the role-gate split files each use a different one)', () => {
  assert.strictEqual(computeWeight(0, '_start_bridge_bg'), MARKER_WEIGHTS.bridgeSpawn);
  assert.strictEqual(computeWeight(0, '_s16e2e_start_bridge_bg'), MARKER_WEIGHTS.bridgeSpawn);
  assert.strictEqual(computeWeight(0, '_run_bridge_argv_json'), MARKER_WEIGHTS.bridgeSpawn);
});

test('itemWeight falls back to .bytes when .weight is absent (hand-built fixtures, backward compatible)', () => {
  assert.strictEqual(itemWeight({ bytes: 42 }), 42);
  assert.strictEqual(itemWeight({ bytes: 42, weight: 999 }), 999);
});

test('buildPlan balances by weight, not raw bytes: a small-bytes/high-marker-count file outweighs a much larger plain file', () => {
  const heavySmall = {
    relPath: 'heavy-small.bats', absPath: '/x/heavy-small.bats',
    bytes: 100, weight: computeWeight(100, '_s16e2e_start_retained_plane '.repeat(3)),
  };
  const lightLarge = {
    relPath: 'light-large.bats', absPath: '/x/light-large.bats',
    bytes: 900000, weight: 900000,
  };
  assert.ok(itemWeight(heavySmall) > itemWeight(lightLarge), 'fixture sanity: three retained-plane starts must outweigh 900000 plain bytes');
  const plan = buildPlan([heavySmall, lightLarge], 2);
  // Each in its OWN shard (the greedy balancer never doubles up the two
  // heaviest items while an empty shard remains) -- proves the DECISION
  // used weight, since by raw bytes heavySmall (100) would trivially have
  // been packed alongside lightLarge instead.
  const shardOf = (relPath) => plan.find((s) => s.files.some((f) => f.relPath === relPath)).index;
  assert.notStrictEqual(shardOf('heavy-small.bats'), shardOf('light-large.bats'));
});

// ── mcp-server prerequisite classification ───────────────────────────────
//
// Sequence C19 (CI run 34897150035) keyed this off an exact symlink-text
// line. Sequence C20 replaced that with an explicit, closed, source-
// controlled directive ("# ci-prerequisite: mcp-server") because splitting
// runtime-consultation-role-gate.bats into three files sharing a
// scripts/tests/lib/*.bash helper library moved the symlink line OUT of
// every *.bats file the planner scans and into the shared library instead --
// a symlink-text marker would have silently stopped detecting any of the
// split files. Still content-based, never filename/display-name inference --
// just anchored to a declared contract instead of an implementation detail.

test('parseCiPrerequisites finds zero, one, or many directive lines and fails closed on an unknown or duplicate name', () => {
  assert.deepStrictEqual(parseCiPrerequisites('no directive here at all', 'x.bats'), new Set());
  assert.deepStrictEqual(parseCiPrerequisites('# ci-prerequisite: mcp-server', 'x.bats'), new Set(['mcp-server']));
  // Whitespace tolerance and mid-file placement.
  assert.deepStrictEqual(
    parseCiPrerequisites('line one\n#   ci-prerequisite:   mcp-server  \nline three', 'x.bats'),
    new Set(['mcp-server']),
  );
  assert.throws(
    () => parseCiPrerequisites('# ci-prerequisite: not-a-real-thing', 'x.bats'),
    /unknown ci-prerequisite directive: not-a-real-thing/,
  );
  assert.throws(
    () => parseCiPrerequisites('# ci-prerequisite: mcp-server\n# ci-prerequisite: mcp-server', 'x.bats'),
    /duplicate ci-prerequisite directive: mcp-server/,
  );
});

test('KNOWN_CI_PREREQUISITES is currently exactly {mcp-server} -- a deliberately closed set, never open-ended', () => {
  assert.deepStrictEqual([...KNOWN_CI_PREREQUISITES], ['mcp-server']);
});

test('needsMcpServer is true only for an explicit ci-prerequisite directive, never a mere textual mention of mcp-server', () => {
  const plain = 'no mcp-server mention here at all';
  assert.strictEqual(needsMcpServer(plain, 'x.bats'), false);

  // A mere textual mention (a comment, or a narrower symlink of just one
  // sub-package, e.g. agent-spawn-validator.bats's own
  // mcp-server/node_modules/yaml symlink) must NOT trip this -- only the
  // literal directive line does.
  const narrowMention = 'ln -sfn "$PROJECT_ROOT/mcp-server/node_modules/yaml" "$tmp_root/mcp-server/node_modules/yaml"';
  assert.strictEqual(needsMcpServer(narrowMention, 'x.bats'), false);
  const symlinkAlone = 'ln -s "$BATS_TEST_DIRNAME/../../mcp-server/node_modules" "$PROJ/mcp-server/node_modules"';
  assert.strictEqual(needsMcpServer(symlinkAlone, 'x.bats'), false);

  assert.strictEqual(needsMcpServer('# ci-prerequisite: mcp-server', 'x.bats'), true);
});

test('discoverInventory and buildPlan propagate needsMcpServer from the directive to the owning shard', () => {
  const root = makeFixture({
    'hot.bats': 10,
    'cold.bats': 900,
  });
  try {
    fs.writeFileSync(path.join(root, 'hot.bats'), '#!/usr/bin/env bats\n# ci-prerequisite: mcp-server\n');
    const inventory = discoverInventory(root);
    const hot = inventory.find((f) => f.relPath.endsWith('/hot.bats'));
    const cold = inventory.find((f) => f.relPath.endsWith('/cold.bats'));
    assert.strictEqual(hot.needsMcpServer, true);
    assert.strictEqual(cold.needsMcpServer, false);

    const plan = buildPlan(inventory, 2);
    const hotShard = plan.find((s) => s.files.some((f) => f.relPath === hot.relPath));
    const coldShard = plan.find((s) => s.files.some((f) => f.relPath === cold.relPath));
    assert.strictEqual(hotShard.needsMcpServer, true);
    assert.strictEqual(
      hotShard.files.find((f) => f.relPath === hot.relPath).needsMcpServer, true,
    );
    if (coldShard !== hotShard) assert.strictEqual(coldShard.needsMcpServer, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discoverInventory fails closed on a file with an unknown ci-prerequisite directive', () => {
  const root = makeFixture({ 'bad.bats': 1 });
  try {
    fs.writeFileSync(path.join(root, 'bad.bats'), '# ci-prerequisite: bogus-thing\n');
    assert.throws(() => discoverInventory(root), /unknown ci-prerequisite directive: bogus-thing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('formatPlanReport exposes needsMcpServer per shard', () => {
  const inventory = [
    { relPath: 'a.bats', absPath: '/x/a.bats', bytes: 10, needsMcpServer: true },
    { relPath: 'b.bats', absPath: '/x/b.bats', bytes: 20, needsMcpServer: false },
  ];
  const plan = buildPlan(inventory, 2);
  const report = formatPlanReport('scripts/tests', plan, inventory);
  const shardOf = (relPath) => report.shards.find((s) => s.files.includes(relPath));
  assert.strictEqual(shardOf('a.bats').needsMcpServer, true);
  assert.strictEqual(shardOf('b.bats').needsMcpServer, false);
});

// ── reality check against the real suite ────────────────────────────────

test('REALITY: the real scripts/tests suite plans into 4 shards, exhaustively, with the largest file whole in exactly one shard', () => {
  const realTestsDir = path.join(REPO_ROOT, 'scripts', 'tests');
  const inventory = discoverInventory(realTestsDir);
  const plan = buildPlan(inventory, 4);
  const assigned = allFiles(plan);
  assert.strictEqual(new Set(assigned).size, inventory.length);
  assert.deepStrictEqual(new Set(assigned), new Set(inventory.map((f) => f.relPath)));

  const largest = inventory.slice().sort((a, b) => b.bytes - a.bytes)[0];
  const owners = plan.filter((s) => s.files.some((f) => f.relPath === largest.relPath));
  assert.strictEqual(owners.length, 1, 'the largest suite file must be assigned to exactly one shard');
  assert.strictEqual(
    owners[0].files.filter((f) => f.relPath === largest.relPath).length, 1,
    'the largest suite file must appear exactly once within its shard',
  );
});

// Sequence C18 regression guard: CI run 34897150035 proved that byte-only
// balancing concentrates runtime-consultation-role-gate.bats,
// runtime-consultation-e2e.bats, runtime-consultation-protocol.bats and
// runtime-consultation-windows.bats together in one shard (with
// runtime-consultation-bridge.bats alone in another) -- the combined shard
// ran past 20 minutes despite fewer total bytes than the bridge-only shard,
// because the retained-plane/bridge-spawn cost these three "hot" files
// carry is not proportional to their byte size. C18's fix pinned the three
// hot files of that era to three different shards; Sequence C20 then split
// runtime-consultation-role-gate.bats itself into three files (-core/-plane/
// -evidence) because even isolated, its own critical path (~19 minutes)
// remained the outlier -- only -plane and -evidence carry any
// retained-plane/bridge-spawn marker (-core is deliberately zero-marker, the
// grant-mechanics tests that never touch a live plane). The current hot set
// is therefore FOUR files, known by name here (not a display-name/
// description regex) and expected in four DIFFERENT shards now that
// shardCount also happens to be four.
const HOT_BASENAMES = Object.freeze([
  'runtime-consultation-bridge.bats',
  'runtime-consultation-role-gate-plane.bats',
  'runtime-consultation-role-gate-evidence.bats',
  'runtime-consultation-e2e.bats',
]);

test('REALITY WEIGHT: bridge/role-gate-plane/role-gate-evidence/e2e (the only files with retained-plane/bridge-spawn markers) are assigned to four different shards', () => {
  const realTestsDir = path.join(REPO_ROOT, 'scripts', 'tests');
  const inventory = discoverInventory(realTestsDir);
  // discoverInventory's relPath is suiteRootArg-relative (absolute here,
  // since realTestsDir is absolute) -- match by basename suffix, never a
  // hardcoded repo-relative string shape.
  const hotEntries = HOT_BASENAMES.map((name) => {
    const found = inventory.find((f) => f.relPath.endsWith('/' + name));
    assert.ok(found, `expected suite file missing: ${name}`);
    return found;
  });
  const plan = buildPlan(inventory, 4);
  const shardOf = (relPath) => plan.find((s) => s.files.some((f) => f.relPath === relPath)).index;
  const shardIndices = hotEntries.map((f) => shardOf(f.relPath));
  assert.strictEqual(
    new Set(shardIndices).size, HOT_BASENAMES.length,
    `expected ${HOT_BASENAMES.length} distinct shards, got ${JSON.stringify(shardIndices)} for ${JSON.stringify(HOT_BASENAMES)}`,
  );
});

test('REALITY WEIGHT: runtime-consultation-role-gate-core.bats (the zero-marker split sibling) carries weight equal to its own bytes', () => {
  const realTestsDir = path.join(REPO_ROOT, 'scripts', 'tests');
  const inventory = discoverInventory(realTestsDir);
  const core = inventory.find((f) => f.relPath.endsWith('/runtime-consultation-role-gate-core.bats'));
  assert.ok(core, 'expected runtime-consultation-role-gate-core.bats in the real suite');
  assert.strictEqual(core.weight, core.bytes, 'the core split file must carry zero retained-plane/bridge-spawn markers');
});

test('REALITY WEIGHT: every top-level suite file other than the four hot files carries zero retained-plane/bridge-spawn markers (weight equals bytes)', () => {
  const realTestsDir = path.join(REPO_ROOT, 'scripts', 'tests');
  const inventory = discoverInventory(realTestsDir);
  const isHot = (relPath) => HOT_BASENAMES.some((name) => relPath.endsWith('/' + name));
  const unexpectedlyHeavy = inventory.filter((f) => !isHot(f.relPath) && f.weight !== f.bytes);
  assert.deepStrictEqual(
    unexpectedlyHeavy.map((f) => f.relPath.split('/').pop()), [],
    'a new file outside the known four now carries expensive-operation markers -- update HOT_BASENAMES above if intentional',
  );
});

// Sequence C20 regression guard: exactly the four files above declare
// "# ci-prerequisite: mcp-server" (grep-verified against every *.bats file
// in this suite) -- a DIFFERENT, independently-declared fact from
// HOT_BASENAMES' own weight-marker membership (one is a derived runtime-cost
// proxy, the other an authorial directive), which currently happen to
// coincide but are asserted separately so a future divergence in either
// direction is caught rather than silently assumed.
const MCP_PREREQUISITE_BASENAMES = Object.freeze([
  'runtime-consultation-bridge.bats',
  'runtime-consultation-role-gate-plane.bats',
  'runtime-consultation-role-gate-evidence.bats',
  'runtime-consultation-e2e.bats',
]);

test('REALITY MCP: exactly the four known files need mcp-server (including the split role-gate siblings); every other suite file, including role-gate-core.bats, does not', () => {
  const realTestsDir = path.join(REPO_ROOT, 'scripts', 'tests');
  const inventory = discoverInventory(realTestsDir);
  const isMcpHot = (relPath) => MCP_PREREQUISITE_BASENAMES.some((name) => relPath.endsWith('/' + name));
  const mismatched = inventory.filter((f) => f.needsMcpServer !== isMcpHot(f.relPath));
  assert.deepStrictEqual(
    mismatched.map((f) => ({ name: f.relPath.split('/').pop(), needsMcpServer: f.needsMcpServer })), [],
    'needsMcpServer classification disagrees with the known mcp-prerequisite file set -- a file gained/lost its ci-prerequisite directive',
  );
});

test('REALITY MCP: in the real 4-shard plan, every shard needsMcpServer exactly iff it holds an mcp-prerequisite file', () => {
  const realTestsDir = path.join(REPO_ROOT, 'scripts', 'tests');
  const inventory = discoverInventory(realTestsDir);
  const plan = buildPlan(inventory, 4);
  const isMcpHot = (relPath) => MCP_PREREQUISITE_BASENAMES.some((name) => relPath.endsWith('/' + name));
  const mcpShardIndices = new Set(
    plan.filter((s) => s.files.some((f) => isMcpHot(f.relPath))).map((s) => s.index),
  );
  for (const shard of plan) {
    assert.strictEqual(
      shard.needsMcpServer, mcpShardIndices.has(shard.index),
      `shard ${shard.index} needsMcpServer=${shard.needsMcpServer} disagrees with whether it holds an mcp-prerequisite file`,
    );
  }
  // Under the CURRENT real suite all four mcp-prerequisite files land in
  // four different shards (the REALITY WEIGHT test above), so every shard
  // legitimately needs the build today -- no "at least one shard without"
  // assumption here, since that would no longer be true and would only be
  // an artifact of today's exact file set, not a real invariant.
});
