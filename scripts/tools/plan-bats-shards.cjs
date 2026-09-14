#!/usr/bin/env node
'use strict';

// Deterministic file-level Bats shard planner: assigns every top-level
// scripts/tests/*.bats file to exactly one of N shards, greedily balanced
// by an estimated RUNTIME-COST weight (largest-first bin packing), with a
// stable secondary sort key (normalized relative path) so the plan never
// depends on directory read order. Whole-file assignment only -- a file is
// never split across shards.
//
// Weight, not raw byte size, drives balancing (Sequence C18): CI run
// 34897150035 proved byte size is not a runtime-cost proxy -- shard0
// (runtime-consultation-bridge.bats alone, 1.04MB, 119 real session-run
// spawns) finished in ~13 minutes, while shard1 (runtime-consultation-
// role-gate.bats + e2e/protocol/windows.bats, 0.80MB combined -- SMALLER
// in bytes) was still running past 20 minutes. Static analysis attributes
// this to two specific, stable helper-function call sites that each spawn
// a real Node child process and block on it: a single bridge/session-run
// spawn, and a five-role "retained plane" start (sequential per-role
// bootstrap+wait -- far more expensive per call). role-gate.bats alone
// carries 11 retained-plane starts and e2e.bats 6 -- 17 combined in one
// shard, the actual outlier. These are call sites of long-established,
// named test helpers (not a display-name/description regex), so counting
// their occurrences is a stable, source-controlled signal. (Sequence C20:
// runtime-consultation-role-gate.bats was itself later split into
// runtime-consultation-role-gate-{core,plane,evidence}.bats for the same
// reason -- even isolated, its own critical path remained the outlier.)
const fs = require('fs');
const path = require('path');

// Bytes-equivalent cost per occurrence -- a directional proxy (CI has not
// yet supplied real per-test timing; see plan-bats-shards.test.js's
// REALITY checks for what this achieves against the actual suite today).
// retainedPlaneStart is weighted ~10x a bare bridge spawn to reflect its
// sequential five-role bootstrap+wait; both ordinary suite files (0
// markers) and this weighting are validated to reproduce the observed
// shard0 < shard1 cost ordering.
const MARKER_WEIGHTS = Object.freeze({
  retainedPlaneStart: 300000,
  bridgeSpawn: 30000,
});

const MARKER_PATTERNS = Object.freeze({
  retainedPlaneStart: /_s16e2e_start_retained_plane/g,
  bridgeSpawn: /_start_bridge_bg|_s16e2e_start_bridge_bg|_run_bridge_argv_json/g,
});

/** @returns {number} bytes plus weighted occurrences of known expensive-operation call sites. */
function computeWeight(bytes, content) {
  let weight = bytes;
  for (const key of Object.keys(MARKER_PATTERNS)) {
    const matches = content.match(MARKER_PATTERNS[key]);
    weight += (matches ? matches.length : 0) * MARKER_WEIGHTS[key];
  }
  return weight;
}

// CI run 34897150035 (Sequence C19): shard1's role-gate.bats/e2e.bats both
// failed every test with APP_SERVER_WORKER_LOOP_FAILED: Cannot find module
// '@modelcontextprotocol/sdk/client/index.js' -- the old CI step built
// mcp-server only when a shard owned runtime-consultation-bridge.bats BY
// EXACT FILENAME (Sequence 11), which stopped generalizing the moment C18's
// weight-based balancing split these three files across three different
// shards. C19's own fix (a content-based symlink-text marker) was itself
// fragile to the NEXT structural change: Sequence C20 splits role-gate.bats
// into three files sharing a scripts/tests/lib/*.bash helper library, and
// the symlink line now lives ONLY in that shared library -- a file the
// planner never scans -- so a symlink-text marker would silently stop
// detecting every one of C20's split files. The durable fix is an explicit,
// closed, source-controlled DIRECTIVE on the *.bats unit itself ("# ci-
// prerequisite: mcp-server"), independent of however its fixture machinery
// happens to be composed. Still content-based and never filename/
// display-name inference -- just anchored to a stable declared contract
// instead of an implementation-detail line that can move.
const CI_PREREQUISITE_DIRECTIVE_RE = /^#\s*ci-prerequisite:\s*(\S+)\s*$/gm;
const KNOWN_CI_PREREQUISITES = Object.freeze(new Set(['mcp-server']));

/**
 * Parses every "# ci-prerequisite: <name>" directive line in content. Fails
 * closed on an unknown name (typo/future-directive protection) or a name
 * repeated more than once in the same file (ambiguous authorial intent).
 * @returns {Set<string>}
 */
function parseCiPrerequisites(content, relPath) {
  const found = new Set();
  let match;
  CI_PREREQUISITE_DIRECTIVE_RE.lastIndex = 0;
  while ((match = CI_PREREQUISITE_DIRECTIVE_RE.exec(content)) !== null) {
    const name = match[1];
    if (!KNOWN_CI_PREREQUISITES.has(name)) {
      fail(`${relPath}: unknown ci-prerequisite directive: ${name}`);
    }
    if (found.has(name)) {
      fail(`${relPath}: duplicate ci-prerequisite directive: ${name}`);
    }
    found.add(name);
  }
  return found;
}

/** @returns {boolean} true iff content declares "# ci-prerequisite: mcp-server". */
function needsMcpServer(content, relPath) {
  return parseCiPrerequisites(content, relPath).has('mcp-server');
}

/** Falls back to .bytes for inventory items with no computed .weight (e.g. hand-built fixtures in unit tests). */
function itemWeight(item) {
  return typeof item.weight === 'number' ? item.weight : item.bytes;
}

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
    const content = fs.readFileSync(absPath, 'utf8');
    inventory.push({
      relPath, absPath, bytes: lstat.size, weight: computeWeight(lstat.size, content),
      needsMcpServer: needsMcpServer(content, relPath),
    });
  }
  if (inventory.length === 0) fail(`empty inventory under suite root: ${suiteRootArg}`);
  return inventory;
}

function compareForAssignment(a, b) {
  const wa = itemWeight(a);
  const wb = itemWeight(b);
  if (wa !== wb) return wb - wa; // largest weight first
  return pathCompare(a.relPath, b.relPath); // stable tie-break
}

/**
 * Greedy largest-processing-time-first bin balancing: sorts the inventory
 * (estimated weight descending, normalized relative path ascending as the
 * stable tie-break), then assigns each file -- whole, never split -- to
 * whichever shard currently holds the smallest cumulative weight (ties
 * broken by the lowest shard index). Self-verifies exhaustive coverage and
 * the absence of duplicates before returning; a violation here means the
 * assignment above is broken, never the caller's input.
 * @returns {{index:number, files:{relPath:string, bytes:number, weight:number, needsMcpServer:boolean}[], totalBytes:number, totalWeight:number, needsMcpServer:boolean}[]}
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
    index, files: [], totalBytes: 0, totalWeight: 0, needsMcpServer: false,
  }));
  for (const item of ordered) {
    let target = shards[0];
    for (const shard of shards) {
      if (shard.totalWeight < target.totalWeight) target = shard;
    }
    target.files.push({
      relPath: item.relPath, bytes: item.bytes, weight: itemWeight(item),
      needsMcpServer: Boolean(item.needsMcpServer),
    });
    target.totalBytes += item.bytes;
    target.totalWeight += itemWeight(item);
    if (item.needsMcpServer) target.needsMcpServer = true;
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
    totalWeight: inventory.reduce((sum, f) => sum + itemWeight(f), 0),
    shards: plan.map((s) => ({
      index: s.index,
      fileCount: s.files.length,
      totalBytes: s.totalBytes,
      totalWeight: s.totalWeight,
      needsMcpServer: s.needsMcpServer,
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
  computeWeight, itemWeight, MARKER_WEIGHTS, MARKER_PATTERNS,
  needsMcpServer, parseCiPrerequisites, CI_PREREQUISITE_DIRECTIVE_RE, KNOWN_CI_PREREQUISITES,
});

if (require.main === module) {
  main();
}
