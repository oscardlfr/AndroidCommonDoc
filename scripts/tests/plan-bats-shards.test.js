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
