#!/usr/bin/env node
'use strict';

// Deterministic file-level Bats shard planner: assigns every top-level
// scripts/tests/*.bats file to exactly one of N shards, greedily balanced
// by byte size (largest-first bin packing), with a stable secondary sort
// key (normalized relative path) so the plan never depends on directory
// read order. Whole-file assignment only -- a file is never split across
// shards, so the largest suite file stays intact in exactly one shard.

const fs = require('fs');
const path = require('path');

function fail(message) {
  const err = new Error(message);
  err.planBatsShardsFailClosed = true;
  throw err;
}

function normalizeRelPath(suiteRootArg, basename) {
  const joined = suiteRootArg.replace(/[/\\]+$/, '') + '/' + basename;
  return joined.split(path.sep).join('/');
}

function pathCompare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Discovers every top-level `*.bats` file directly under suiteRootArg
 * (non-recursive). Fails closed on: a missing/non-directory root, an empty
 * inventory, any symlink, any non-regular-file match, or any resulting
 * path containing a newline.
 * @returns {{relPath:string, absPath:string, bytes:number}[]}
 */
function discoverInventory(suiteRootArg) {
  if (typeof suiteRootArg !== 'string' || suiteRootArg.length === 0) {
    fail('suite root must be a nonempty string');
  }
  const absRoot = path.resolve(suiteRootArg);
  let rootLstat;
  try {
    rootLstat = fs.lstatSync(absRoot);
  } catch (cause) {
    fail(`suite root does not exist: ${suiteRootArg} (${cause.message})`);
  }
  if (rootLstat.isSymbolicLink()) fail(`refusing symlinked suite root: ${suiteRootArg}`);
  if (!rootLstat.isDirectory()) fail(`suite root is not a directory: ${suiteRootArg}`);

  const entries = fs.readdirSync(absRoot, { withFileTypes: true })
    .filter((e) => e.name.endsWith('.bats'))
    .sort((a, b) => pathCompare(a.name, b.name));

  const inventory = [];
  for (const entry of entries) {
    const absPath = path.join(absRoot, entry.name);
    const relPath = normalizeRelPath(suiteRootArg, entry.name);
    if (relPath.includes('\n')) fail(`refusing newline-containing path: ${JSON.stringify(relPath)}`);
    const lstat = fs.lstatSync(absPath);
    if (lstat.isSymbolicLink()) fail(`refusing symlink: ${relPath}`);
    if (!lstat.isFile()) fail(`refusing non-regular-file entry: ${relPath}`);
    inventory.push({ relPath, absPath, bytes: lstat.size });
  }
  if (inventory.length === 0) fail(`empty inventory under suite root: ${suiteRootArg}`);
  return inventory;
}

function compareForAssignment(a, b) {
  if (a.bytes !== b.bytes) return b.bytes - a.bytes; // largest first
  return pathCompare(a.relPath, b.relPath); // stable tie-break
}

/**
 * Greedy largest-processing-time-first bin balancing: sorts the inventory
 * (byte size descending, normalized relative path ascending as the stable
 * tie-break), then assigns each file -- whole, never split -- to whichever
 * shard currently holds the smallest cumulative byte total (ties broken by
 * the lowest shard index). Self-verifies exhaustive coverage and the
 * absence of duplicates before returning; a violation here means the
 * assignment above is broken, never the caller's input.
 * @returns {{index:number, files:{relPath:string, bytes:number}[], totalBytes:number}[]}
 */
function buildPlan(inventory, shardCount) {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    fail('inventory must be a nonempty array');
  }
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    fail(`shard count must be a positive integer: ${shardCount}`);
  }
  const ordered = inventory.slice().sort(compareForAssignment);
  const shards = Array.from({ length: shardCount }, (_, index) => ({
    index, files: [], totalBytes: 0,
  }));
  for (const item of ordered) {
    let target = shards[0];
    for (const shard of shards) {
      if (shard.totalBytes < target.totalBytes) target = shard;
    }
    target.files.push({ relPath: item.relPath, bytes: item.bytes });
    target.totalBytes += item.bytes;
  }
  for (const shard of shards) shard.files.sort((a, b) => pathCompare(a.relPath, b.relPath));

  const seen = new Set();
  let coveredCount = 0;
  for (const shard of shards) {
    for (const file of shard.files) {
      if (seen.has(file.relPath)) fail(`internal invariant violated -- duplicate assignment: ${file.relPath}`);
      seen.add(file.relPath);
      coveredCount += 1;
    }
  }
  if (coveredCount !== inventory.length) {
    fail(`internal invariant violated -- coverage mismatch: assigned ${coveredCount}, discovered ${inventory.length}`);
  }
  for (const item of inventory) {
    if (!seen.has(item.relPath)) fail(`internal invariant violated -- coverage mismatch: missing ${item.relPath}`);
  }

  return shards;
}

function selectShard(plan, shardIndex) {
  if (!Array.isArray(plan) || plan.length === 0) fail('plan must be a nonempty array');
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= plan.length) {
    fail(`shard index out of range: ${shardIndex} (shard count ${plan.length})`);
  }
  return plan[shardIndex].files.map((f) => f.relPath);
}

function formatNulDelimited(relPaths) {
  return relPaths.map((p) => p + '\0').join('');
}

function formatPlanReport(suiteRootArg, plan, inventory) {
  return {
    suiteRoot: suiteRootArg,
    shardCount: plan.length,
    totalFiles: inventory.length,
    totalBytes: inventory.reduce((sum, f) => sum + f.bytes, 0),
    shards: plan.map((s) => ({
      index: s.index,
      fileCount: s.files.length,
      totalBytes: s.totalBytes,
      files: s.files.map((f) => f.relPath),
    })),
  };
}

function isCleanIntegerArg(raw) {
  return typeof raw === 'string' && raw.trim().length > 0
    && Number.isInteger(Number(raw)) && String(Number(raw)) === raw.trim();
}

const VALUE_FLAGS = Object.freeze({
  '--suite-root': 'suiteRoot',
  '--shard-index': 'shardIndex',
  '--shard-count': 'shardCount',
});
const KNOWN_FLAGS = new Set([...Object.keys(VALUE_FLAGS), '--json']);

function parseArgs(argv) {
  const args = { suiteRoot: 'scripts/tests', shardIndex: null, shardCount: null, json: false };
  const seenFlags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const prop = VALUE_FLAGS[arg];
    if (prop) {
      if (seenFlags.has(arg)) fail(`duplicate argument: ${arg}`);
      seenFlags.add(arg);
      const value = argv[i + 1];
      if (value === undefined || KNOWN_FLAGS.has(value)) fail(`missing value for ${arg}`);
      args[prop] = value;
      i += 1;
      continue;
    }
    if (arg === '--json') { args.json = true; continue; }
    fail(`unrecognized argument: ${arg}`);
  }
  if (typeof args.suiteRoot !== 'string' || args.suiteRoot.length === 0) {
    fail('--suite-root requires a nonempty value');
  }
  if (args.shardCount === null) fail('--shard-count is required');
  if (!isCleanIntegerArg(args.shardCount)) fail(`--shard-count must be a positive integer: ${args.shardCount}`);
  const shardCount = Number(args.shardCount);
  if (shardCount < 1) fail(`--shard-count must be a positive integer: ${args.shardCount}`);

  let shardIndex = null;
  if (!args.json) {
    if (args.shardIndex === null) fail('--shard-index is required unless --json is given');
    if (!isCleanIntegerArg(args.shardIndex)) fail(`--shard-index must be an integer: ${args.shardIndex}`);
    shardIndex = Number(args.shardIndex);
  }
  return { suiteRoot: args.suiteRoot, shardCount, shardIndex, json: args.json };
}

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    const inventory = discoverInventory(parsed.suiteRoot);
    const plan = buildPlan(inventory, parsed.shardCount);
    if (parsed.json) {
      process.stdout.write(JSON.stringify(formatPlanReport(parsed.suiteRoot, plan, inventory), null, 2) + '\n');
      return;
    }
    process.stdout.write(formatNulDelimited(selectShard(plan, parsed.shardIndex)));
  } catch (err) {
    process.stderr.write('plan-bats-shards: ' + ((err && err.message) || String(err)) + '\n');
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  discoverInventory, buildPlan, selectShard, formatNulDelimited, formatPlanReport, parseArgs,
});

if (require.main === module) {
  main();
}
