#!/usr/bin/env node
'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A: must be the FIRST require in this file, before any require of
// runtime-role-lifecycle.cjs/runtime-bridge-codex.cjs -- registryBaseDir() is
// os.tmpdir()-rooted and shared with real production registry data on this
// machine without this preload overriding TMPDIR first.
require('./lib/private-registry-tmpdir-preload.cjs');

// R131 P2 RED-A1 (mechanical seed schema slice, corrected per Codex
// correction1.md): six focal, seam-defining tests for the not-yet-implemented
// P2 subject-bundle seed contract described by sequence1-codex-audit.json's
// codex_binding block. Each test's FIRST assertion checks that a named
// production export exists; today none of them do, so every test fails for
// exactly that reason (RED). Once GREEN lands the real export, the SAME
// assertion bodies exercise genuine behavior -- no test body is rewritten to
// make that transition succeed.
//
// House style matches runtime-role-lifecycle-registry.test.js: CommonJS
// require, node:assert, `node --test`, one fixture temp dir per test
// (mkdtemp+git init), always cleaned up in a finally block. Where a live
// MainOrchestratorBinding/SessionGeneration is needed, it is always minted
// through the real production primitives (createMainOrchestratorBinding/
// resolveSessionGeneration) -- never a hand-written binding record.

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const rll = require(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'));
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rll-p2seed-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'rll-p2seed-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'RLL P2 Seed Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function writePlanFixture(projectRoot, waveSlug) {
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + waveSlug);
  fs.mkdirSync(waveDir, { recursive: true });
  const planPath = path.join(waveDir, 'PLAN.md');
  fs.writeFileSync(planPath, '# fixture plan for runtime-role-lifecycle-prep-binding.test.js\n');
  return planPath;
}

// Fixed literals sourced from sequence1-codex-audit.json's codex_binding
// block (exact_seed_entries / seed_caps) -- never fabricated here.
const P2_SEED_SCHEMA = 'runtime/p2-subject-bundle-seed/v1';
const P2_SEED_WAVE_SLUG = 'p2-seed-red-a1';
const P2_SEED_CAPS = Object.freeze({
  max_files_per_role: 24,
  max_bytes_per_file: 1048576,
  max_total_bytes_per_role: 8388608,
});
const P2_SEED_ENTRIES_BY_ROLE = Object.freeze({
  'arch-platform': [
    'scripts/lib/runtime-bridge-codex.cjs',
    'scripts/lib/runtime-consultation.cjs',
    'scripts/lib/runtime-role-lifecycle.cjs',
    'scripts/sh/write-verdict.sh',
  ],
  'arch-testing': [
    'scripts/tests/runtime-consultation-bridge.bats',
    'scripts/tests/runtime-role-lifecycle-prep-binding.test.js',
    'scripts/tests/write-verdict.bats',
  ],
  'arch-integration': [
    '.planning/wave-portable-runtime-messaging-adapters/PLAN.md',
    'scripts/lib/runtime-bridge-codex.cjs',
    'scripts/lib/runtime-consultation.cjs',
    'scripts/lib/runtime-role-lifecycle.cjs',
    'scripts/sh/write-verdict.sh',
    'scripts/tests/runtime-consultation-bridge.bats',
    'scripts/tests/runtime-role-lifecycle-prep-binding.test.js',
    'scripts/tests/write-verdict.bats',
  ],
});

// Flattens P2_SEED_ENTRIES_BY_ROLE into a fresh, sorted `[{role,path},...]`
// array (sorted by role then path) -- the exact `entries` shape
// correction1.md requires. Returns a new array/objects every call so callers
// may freely mutate their own copy.
function buildSortedEntries() {
  const out = [];
  for (const role of Object.keys(P2_SEED_ENTRIES_BY_ROLE)) {
    for (const p of P2_SEED_ENTRIES_BY_ROLE[role]) {
      out.push({ role, path: p });
    }
  }
  out.sort((a, b) => {
    if (a.role !== b.role) return a.role < b.role ? -1 : 1;
    if (a.path === b.path) return 0;
    return a.path < b.path ? -1 : 1;
  });
  return out;
}

function buildValidP2SubjectBundleSeedRecord(dir, waveSlug) {
  writePlanFixture(dir, waveSlug);
  const plan = rll.discoverPlan(dir);
  assert.strictEqual(plan.ok, true, 'fixture: PLAN missing: ' + JSON.stringify(plan));
  const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return {
    schema: P2_SEED_SCHEMA,
    main_binding_id: crypto.randomBytes(16).toString('hex'),
    main_actor_instance_id: crypto.randomBytes(16).toString('hex'),
    session_generation_id: crypto.randomBytes(16).toString('hex'),
    repo_id: rll.computeRepoId(dir),
    worktree_id: rll.computeWorktreeId(dir),
    head,
    plan_sha256: plan.planDigest,
    wave_slug: waveSlug,
    sealed_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    caps: Object.assign({}, P2_SEED_CAPS),
    entries: buildSortedEntries(),
  };
}

function snapshotRegistryTree(dir) {
  const root = rll.registryRepoDir(dir);
  const out = [];
  function walk(current, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), rel);
      } else {
        out.push(rel);
      }
    }
  }
  walk(root, '');
  return out;
}

// ── P2-SEED-01 ───────────────────────────────────────────────────────────

test('P2-SEED-01 canonical shared subject path predicate', () => {
  assert.strictEqual(
    typeof rc.isSafeRelativeEntryPath, 'function',
    'runtime-consultation.cjs must export its existing canonical subject-bundle relative-path predicate (isSafeRelativeEntryPath) -- RED until it is added to module.exports',
  );
  const predicate = rc.isSafeRelativeEntryPath;

  assert.strictEqual(predicate('scripts/lib/runtime-consultation.cjs'), true, 'nested relative path must be accepted');
  assert.strictEqual(predicate('a/b/c.txt'), true, 'multi-segment relative path must be accepted');
  assert.strictEqual(predicate('single-segment.md'), true, 'single-segment relative path must be accepted');

  assert.strictEqual(predicate('/etc/passwd'), false, 'absolute path must be rejected');
  assert.strictEqual(predicate('../secret'), false, 'leading traversal must be rejected');
  assert.strictEqual(predicate('a/../b'), false, 'embedded traversal segment must be rejected');
  assert.strictEqual(predicate('a\\b'), false, 'backslash must be rejected unconditionally');
  assert.strictEqual(predicate('.git/config'), false, 'leading .git segment must be rejected');
  assert.strictEqual(predicate('a/.git/config'), false, 'nested .git segment must be rejected');
  assert.strictEqual(predicate(''), false, 'empty path must be rejected');
  assert.strictEqual(predicate('a\\u0000b'), false, 'NUL control character must be rejected');
  assert.strictEqual(predicate('a\\u0007b'), false, 'non-NUL control character must be rejected');
});

// ── P2-SEED-02 ───────────────────────────────────────────────────────────

test('P2-SEED-02 seed validator has closed exact shape', () => {
  assert.strictEqual(
    typeof rll.validateP2SubjectBundleSeedRecord, 'function',
    'runtime-role-lifecycle.cjs must export a pure P2 subject-bundle seed record validator (validateP2SubjectBundleSeedRecord) -- RED until it exists',
  );
  const dir = makeGitProject();
  try {
    const record = buildValidP2SubjectBundleSeedRecord(dir, P2_SEED_WAVE_SLUG);
    const result = rll.validateP2SubjectBundleSeedRecord(record);
    assert.strictEqual(
      result.ok, true,
      'an exact well-formed P2 subject-bundle seed record (three roles, fixed caps, fresh binding/generation/repo/worktree/HEAD/PLAN fields) must validate: ' + JSON.stringify(result),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2-SEED-03 ───────────────────────────────────────────────────────────

test('P2-SEED-03 seed validator rejects hostile shape', () => {
  assert.strictEqual(
    typeof rll.validateP2SubjectBundleSeedRecord, 'function',
    'runtime-role-lifecycle.cjs must export validateP2SubjectBundleSeedRecord -- RED until it exists',
  );
  const dir = makeGitProject();
  try {
    const base = buildValidP2SubjectBundleSeedRecord(dir, P2_SEED_WAVE_SLUG);

    const extraKey = Object.assign({}, base, { unexpected_extra_field: 'nope' });

    // Isolates "unknown role": entries[0] is the sole arch-integration entry
    // mutated to a bogus role; the other 7 arch-integration entries keep
    // that role represented, so this never also trips "missing role".
    const unknownRole = Object.assign({}, base, {
      entries: base.entries.map((e, i) => (i === 0 ? { role: 'arch-bogus', path: e.path } : e)),
    });

    const duplicatePath = Object.assign({}, base, {
      entries: base.entries.concat([base.entries[0]]),
    });

    const missingRole = Object.assign({}, base, {
      entries: base.entries.filter((e) => e.role !== 'arch-testing'),
    });

    const cases = [
      ['extra key', extraKey],
      ['unknown role', unknownRole],
      ['duplicate role/path', duplicatePath],
      ['missing role', missingRole],
    ];
    const reasons = cases.map(([label, candidate]) => {
      const result = rll.validateP2SubjectBundleSeedRecord(candidate);
      assert.strictEqual(result.ok, false, label + ' must be rejected: ' + JSON.stringify(candidate));
      assert.strictEqual(typeof result.reason, 'string', label + ' rejection must carry a reason string: ' + JSON.stringify(result));
      assert.ok(result.reason.length > 0, label + ' rejection reason must be non-empty');
      return result.reason;
    });
    assert.strictEqual(
      new Set(reasons).size, reasons.length,
      'each hostile shape must produce a DISTINCT invalid reason, never one shared bucket: ' + JSON.stringify(reasons),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2-SEED-04 ───────────────────────────────────────────────────────────

test('P2-SEED-04 seed validator fixes caps', () => {
  assert.strictEqual(
    typeof rll.validateP2SubjectBundleSeedRecord, 'function',
    'runtime-role-lifecycle.cjs must export validateP2SubjectBundleSeedRecord -- RED until it exists',
  );
  const dir = makeGitProject();
  try {
    const base = buildValidP2SubjectBundleSeedRecord(dir, P2_SEED_WAVE_SLUG);
    assert.strictEqual(rll.validateP2SubjectBundleSeedRecord(base).ok, true, 'sanity: the unperturbed fixture must itself validate');

    const capKeys = ['max_files_per_role', 'max_bytes_per_file', 'max_total_bytes_per_role'];
    for (const key of capKeys) {
      for (const delta of [1, -1]) {
        const perturbed = Object.assign({}, base, {
          caps: Object.assign({}, base.caps, { [key]: base.caps[key] + delta }),
        });
        const result = rll.validateP2SubjectBundleSeedRecord(perturbed);
        assert.strictEqual(
          result.ok, false,
          'cap ' + key + ' is FIXED at ' + base.caps[key] + ', never merely bounded -- delta ' + delta + ' must be rejected (never widen generic projection): ' + JSON.stringify(result),
        );
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2-SEED-05 ───────────────────────────────────────────────────────────

test('P2-SEED-05 production sealer fails closed without live main authority', () => {
  assert.strictEqual(
    typeof rll.sealP2SubjectBundleInput, 'function',
    'runtime-role-lifecycle.cjs must export the production P2 subject-bundle sealer (sealP2SubjectBundleInput) -- RED until it exists',
  );
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, P2_SEED_WAVE_SLUG);
    const input = { waveSlug: P2_SEED_WAVE_SLUG, entries: buildSortedEntries(), caps: Object.assign({}, P2_SEED_CAPS) };

    // Two-argument sealer, no caller identity fields anywhere -- the sealer
    // must derive/revalidate MainOrchestratorBinding+SessionGeneration
    // itself. Nothing is minted in this fixture, so both are absent.
    const before = snapshotRegistryTree(dir);
    const result = rll.sealP2SubjectBundleInput(dir, input);
    assert.strictEqual(result.ok, false, 'sealer must fail closed with zero live Main/Generation authority: ' + JSON.stringify(result));
    assert.strictEqual(typeof result.reason, 'string', 'failure must carry a reason string: ' + JSON.stringify(result));
    assert.ok(result.reason.length > 0);
    assert.deepStrictEqual(snapshotRegistryTree(dir), before, 'missing Main/Generation authority must cause ZERO seed writes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2-SEED-06 ───────────────────────────────────────────────────────────

test('P2-SEED-06 production sealer is no-clobber', () => {
  assert.strictEqual(
    typeof rll.sealP2SubjectBundleInput, 'function',
    'runtime-role-lifecycle.cjs must export the production P2 subject-bundle sealer (sealP2SubjectBundleInput) -- RED for the absent production seam; never fabricate authority by hand-writing a binding record to work around its absence',
  );
  const dir = makeGitProject();
  try {
    writePlanFixture(dir, P2_SEED_WAVE_SLUG);
    const entriesA = buildSortedEntries();
    const entriesB = buildSortedEntries().slice(0, -1); // deliberately different from entriesA

    // NOTE (scope, per correction1.md point 5): a live MainOrchestratorBinding
    // alone is NOT the full five-role READY authority the real sealer must
    // eventually revalidate (supervisor + all five role bindings READY).
    // Driving that complete fixture is deferred to the later bridge/roster
    // fixture slice. This test only proves the named seam is absent (RED)
    // and that two UNAUTHORIZED calls (zero live authority) with different
    // entries both fail closed and leave IDENTICAL zero seed state -- never
    // a partial or divergent write. It never fabricates authority by
    // hand-writing a binding record.
    const before = snapshotRegistryTree(dir);
    const first = rll.sealP2SubjectBundleInput(dir, { waveSlug: P2_SEED_WAVE_SLUG, entries: entriesA, caps: Object.assign({}, P2_SEED_CAPS) });
    assert.strictEqual(first.ok, false, 'unauthorized seal (zero live main authority) must fail closed: ' + JSON.stringify(first));
    const afterFirst = snapshotRegistryTree(dir);
    assert.deepStrictEqual(afterFirst, before, 'an unauthorized seal must create no seed');

    const second = rll.sealP2SubjectBundleInput(dir, { waveSlug: P2_SEED_WAVE_SLUG, entries: entriesB, caps: Object.assign({}, P2_SEED_CAPS) });
    assert.strictEqual(second.ok, false, 'a second unauthorized seal with DIFFERENT entries must also fail closed: ' + JSON.stringify(second));
    assert.deepStrictEqual(snapshotRegistryTree(dir), afterFirst, 'two unauthorized calls with different entries must leave IDENTICAL zero seed state');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2-MAT-01 ───────────────────────────────────────────────────────────

test('P2-MAT-01 fd-bound builder emits exact canonical manifest and blobs', () => {
  assert.strictEqual(
    typeof rll.buildP2SubjectBundleMaterialization, 'function',
    'runtime-role-lifecycle.cjs must export the P2 subject-bundle materialization builder (buildP2SubjectBundleMaterialization) -- RED until it exists',
  );
  const dir = makeGitProject();
  try {
    const seedRecord = buildValidP2SubjectBundleSeedRecord(dir, P2_SEED_WAVE_SLUG);
    const role = 'arch-platform';
    const roleEntries = seedRecord.entries.filter((e) => e.role === role).map((e) => e.path);

    const contents = new Map();
    for (const relPath of roleEntries) {
      const bytes = Buffer.from('P2-MAT-01 deterministic fixture bytes for ' + relPath + '\n', 'utf8');
      contents.set(relPath, bytes);
      const abs = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
    }

    const expectedEntries = roleEntries.slice().sort().map((relPath) => {
      const bytes = contents.get(relPath);
      return {
        path: relPath,
        size: bytes.length,
        digest: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
    });
    const expectedManifest = { schema: 'coordination/subject-bundle-manifest/v1', entries: expectedEntries };
    const expectedSubjectScopeDigest = crypto.createHash('sha256').update(Buffer.from(rc.canonicalJSONStringify(expectedManifest), 'utf8')).digest('hex');

    const result = rll.buildP2SubjectBundleMaterialization(dir, seedRecord, role);

    assert.strictEqual(result.ok, true, 'builder must succeed once every seed entry for the role is materialized on disk: ' + JSON.stringify(result));
    assert.deepStrictEqual(
      Object.keys(result).sort(), ['blobs', 'manifest', 'ok', 'subjectScopeDigest'],
      'success result must have exact keys: ' + JSON.stringify(result),
    );

    assert.deepStrictEqual(result.manifest, expectedManifest, 'manifest must be the exact canonical manifest: ' + JSON.stringify(result.manifest));
    assert.deepStrictEqual(
      Object.keys(result.manifest).sort(), ['entries', 'schema'],
      'manifest must have exact keys: ' + JSON.stringify(result.manifest),
    );
    for (const entry of result.manifest.entries) {
      assert.deepStrictEqual(
        Object.keys(entry).sort(), ['digest', 'path', 'size'],
        'manifest entry must have exact keys: ' + JSON.stringify(entry),
      );
    }

    const blobPaths = result.blobs.map((blob) => blob.path);
    assert.deepStrictEqual(blobPaths, blobPaths.slice().sort(), 'blobs must be sorted by path: ' + JSON.stringify(blobPaths));
    assert.deepStrictEqual(
      blobPaths, expectedEntries.map((entry) => entry.path),
      'blobs must cover exactly the materialized entries in manifest path order',
    );
    for (const blob of result.blobs) {
      assert.deepStrictEqual(
        Object.keys(blob).sort(), ['bytes', 'digest', 'path', 'size'],
        'blob must have exact keys: ' + JSON.stringify({ path: blob.path }),
      );
      const expectedBytes = contents.get(blob.path);
      assert.ok(Buffer.isBuffer(blob.bytes), 'blob.bytes must be a Buffer for ' + blob.path);
      assert.deepStrictEqual(blob.bytes, expectedBytes, 'blob.bytes must be the exact real file bytes for ' + blob.path);
      assert.strictEqual(blob.size, expectedBytes.length, 'blob.size must match the real byte length for ' + blob.path);
      assert.strictEqual(
        blob.digest, crypto.createHash('sha256').update(expectedBytes).digest('hex'),
        'blob.digest must be sha256 of the real bytes for ' + blob.path,
      );
    }

    assert.strictEqual(
      result.subjectScopeDigest, expectedSubjectScopeDigest,
      'subjectScopeDigest must be sha256 of the canonical JSON stringified manifest: ' + JSON.stringify(result),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2-MAT-02 ───────────────────────────────────────────────────────────

test('P2-MAT-02 builder filters exact role and rejects empty role scope', () => {
  assert.strictEqual(
    typeof rll.buildP2SubjectBundleMaterialization, 'function',
    'runtime-role-lifecycle.cjs must export buildP2SubjectBundleMaterialization -- RED until it exists',
  );
  const dir = makeGitProject();
  try {
    const seedRecord = buildValidP2SubjectBundleSeedRecord(dir, P2_SEED_WAVE_SLUG);
    const allPaths = Array.from(new Set(seedRecord.entries.map((entry) => entry.path))).sort();
    const contents = new Map();
    for (const relPath of allPaths) {
      const bytes = Buffer.from('P2-MAT-02 deterministic fixture bytes for ' + relPath + '\n', 'utf8');
      contents.set(relPath, bytes);
      const abs = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
    }

    const expectedPaths = seedRecord.entries
      .filter((entry) => entry.role === 'arch-testing')
      .map((entry) => entry.path)
      .sort();
    const result = rll.buildP2SubjectBundleMaterialization(dir, seedRecord, 'arch-testing');
    assert.strictEqual(result.ok, true, 'known non-empty role scope must materialize: ' + JSON.stringify(result));
    assert.deepStrictEqual(result.manifest.entries.map((entry) => entry.path), expectedPaths);
    assert.deepStrictEqual(result.blobs.map((blob) => blob.path), expectedPaths);
    for (const blob of result.blobs) {
      const expectedBytes = contents.get(blob.path);
      assert.deepStrictEqual(blob.bytes, expectedBytes, 'blob must carry exact bytes for ' + blob.path);
      assert.strictEqual(blob.size, expectedBytes.length, 'blob size must match real bytes for ' + blob.path);
      assert.strictEqual(blob.digest, crypto.createHash('sha256').update(expectedBytes).digest('hex'));
    }

    const emptyKnownRoleSeed = Object.assign({}, seedRecord, {
      entries: seedRecord.entries.filter((entry) => entry.role !== 'arch-testing'),
    });
    const empty = rll.buildP2SubjectBundleMaterialization(dir, emptyKnownRoleSeed, 'arch-testing');
    assert.deepStrictEqual(Object.keys(empty).sort(), ['ok', 'reason'], 'empty known role must fail with closed shape');
    assert.strictEqual(empty.ok, false);
    assert.strictEqual(typeof empty.reason, 'string');
    assert.ok(empty.reason.length > 0);

    const unknown = rll.buildP2SubjectBundleMaterialization(dir, seedRecord, 'arch-bogus');
    assert.deepStrictEqual(Object.keys(unknown).sort(), ['ok', 'reason'], 'unknown role must fail with closed shape');
    assert.strictEqual(unknown.ok, false);
    assert.strictEqual(typeof unknown.reason, 'string');
    assert.ok(unknown.reason.length > 0);
    assert.notStrictEqual(unknown.reason, empty.reason, 'unknown and empty-known role failures must be distinct');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2-MAT-03 ───────────────────────────────────────────────────────────

test('P2-MAT-03 builder rejects hostile filesystem sources', () => {
  assert.strictEqual(
    typeof rll.buildP2SubjectBundleMaterialization, 'function',
    'runtime-role-lifecycle.cjs must export buildP2SubjectBundleMaterialization -- RED until it exists',
  );
  const cases = ['traversal', 'symlink', 'hardlink', 'non-file'];
  const reasons = [];
  for (const hostile of cases) {
    const dir = makeGitProject();
    let outsidePath = null;
    try {
      const seedRecord = buildValidP2SubjectBundleSeedRecord(dir, P2_SEED_WAVE_SLUG);
      const targetIndex = seedRecord.entries.findIndex((entry) => entry.role === 'arch-platform');
      assert.ok(targetIndex >= 0, 'fixture must contain an arch-platform entry');
      const originalTarget = seedRecord.entries[targetIndex].path;

      for (const relPath of seedRecord.entries.filter((entry) => entry.role === 'arch-platform').map((entry) => entry.path)) {
        const abs = path.join(dir, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, Buffer.from('P2-MAT-03 control bytes for ' + relPath + '\n', 'utf8'));
      }

      if (hostile === 'traversal') {
        outsidePath = path.join(path.dirname(dir), path.basename(dir) + '-escape.txt');
        fs.writeFileSync(outsidePath, 'escape bytes\n');
        seedRecord.entries[targetIndex] = { role: 'arch-platform', path: '../' + path.basename(outsidePath) };
      } else {
        const target = path.join(dir, originalTarget);
        fs.rmSync(target, { recursive: true, force: true });
        if (hostile === 'symlink') {
          const source = path.join(dir, 'symlink-source.txt');
          fs.writeFileSync(source, 'symlink source\n');
          fs.symlinkSync(source, target);
        } else if (hostile === 'hardlink') {
          const source = path.join(dir, 'hardlink-source.txt');
          fs.writeFileSync(source, 'hardlink source\n');
          fs.linkSync(source, target);
        } else {
          fs.mkdirSync(target, { recursive: true });
        }
      }

      const result = rll.buildP2SubjectBundleMaterialization(dir, seedRecord, 'arch-platform');
      assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason'], hostile + ' must fail with no partial result');
      assert.strictEqual(result.ok, false, hostile + ' must fail closed');
      assert.strictEqual(typeof result.reason, 'string', hostile + ' must carry a reason');
      assert.ok(result.reason.length > 0, hostile + ' reason must be non-empty');
      reasons.push(result.reason);
    } finally {
      if (outsidePath) fs.rmSync(outsidePath, { force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.strictEqual(new Set(reasons).size, cases.length, 'each filesystem hostile must have a discriminating reason');
});

// ── P2-MAT-04 ───────────────────────────────────────────────────────────

test('P2-MAT-04 builder enforces file count size and total caps', () => {
  assert.strictEqual(
    typeof rll.buildP2SubjectBundleMaterialization, 'function',
    'runtime-role-lifecycle.cjs must export buildP2SubjectBundleMaterialization -- RED until it exists',
  );
  const cases = ['control', 'file-count', 'file-size', 'total-size'];
  const failureReasons = [];
  for (const capCase of cases) {
    const dir = makeGitProject();
    try {
      const seedRecord = buildValidP2SubjectBundleSeedRecord(dir, P2_SEED_WAVE_SLUG);
      if (capCase === 'file-count') {
        seedRecord.entries = seedRecord.entries.filter((entry) => entry.role !== 'arch-platform');
        for (let i = 0; i < P2_SEED_CAPS.max_files_per_role + 1; i += 1) {
          seedRecord.entries.push({ role: 'arch-platform', path: 'cap-count/file-' + String(i).padStart(2, '0') + '.bin' });
        }
      } else if (capCase === 'total-size') {
        seedRecord.entries = seedRecord.entries.filter((entry) => entry.role !== 'arch-platform');
        for (let i = 0; i < 9; i += 1) {
          seedRecord.entries.push({ role: 'arch-platform', path: 'cap-total/file-' + String(i).padStart(2, '0') + '.bin' });
        }
      }
      seedRecord.entries.sort((a, b) => a.role === b.role ? a.path.localeCompare(b.path) : a.role.localeCompare(b.role));

      const rolePaths = seedRecord.entries.filter((entry) => entry.role === 'arch-platform').map((entry) => entry.path);
      for (let i = 0; i < rolePaths.length; i += 1) {
        const relPath = rolePaths[i];
        const abs = path.join(dir, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        let bytes;
        if (capCase === 'file-size' && i === 0) {
          bytes = Buffer.alloc(P2_SEED_CAPS.max_bytes_per_file + 1, 0x61);
        } else if (capCase === 'total-size') {
          bytes = Buffer.alloc(932068, 0x62);
        } else {
          bytes = Buffer.from('P2-MAT-04 ' + capCase + ' bytes for ' + relPath + '\n', 'utf8');
        }
        fs.writeFileSync(abs, bytes);
      }

      const result = rll.buildP2SubjectBundleMaterialization(dir, seedRecord, 'arch-platform');
      if (capCase === 'control') {
        assert.strictEqual(result.ok, true, 'under-cap positive control must materialize: ' + JSON.stringify(result));
        assert.strictEqual(result.manifest.entries.length, rolePaths.length);
      } else {
        assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason'], capCase + ' must fail with no partial output');
        assert.strictEqual(result.ok, false, capCase + ' must fail closed');
        assert.strictEqual(typeof result.reason, 'string');
        assert.ok(result.reason.length > 0);
        failureReasons.push(result.reason);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  assert.strictEqual(new Set(failureReasons).size, 3, 'file-count, file-size and total-size failures must be discriminating');
});

// ── P2 request-birth wiring ─────────────────────────────────────────────

test('P2-REQ-01 consult-root selects architect materializer at request birth', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'), 'utf8');
  const start = source.indexOf('function handleConsultRoot(rawArgv)');
  const end = source.indexOf('function handleConsultRootStatus(rawArgv)', start);
  assert.ok(start >= 0 && end > start, 'handleConsultRoot source slice must remain identifiable');
  const body = source.slice(start, end);
  assert.ok(
    body.includes('const artifacts = s16MaterializeArchitectSubjectBundle(projectRoot, context, intentInput.requester_role);'),
    'consult-root must select the role-bound P2 materializer before publishing the immutable intent -- RED until the one-line wiring exists',
  );
  assert.strictEqual(
    body.includes('const artifacts = s16MaterializeCommonArtifacts(projectRoot, context);'), false,
    'consult-root must not bypass the role-bound selector with the legacy empty-bundle materializer',
  );
});

test('P2-REQ-02 immutable intent is born from materialized subject fields', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'), 'utf8');
  const start = source.indexOf('function handleConsultRoot(rawArgv)');
  const end = source.indexOf('function handleConsultRootStatus(rawArgv)', start);
  const body = source.slice(start, end);
  const retainedAt = body.indexOf('const retained = s16ResolveRetainedPair(');
  const materializeAt = body.indexOf('const artifacts = s16MaterializeArchitectSubjectBundle(');
  const recordAt = body.indexOf('const record = {');
  const publishAt = body.indexOf('publishNoClobber(rootConsultIntentPathFor(');
  assert.ok(
    retainedAt >= 0 && retainedAt < materializeAt && materializeAt < recordAt && recordAt < publishAt,
    'retained authority, role materialization, immutable record construction and no-clobber publication must occur in that exact order -- RED until wired',
  );
  assert.ok(body.includes('subject_bundle_ref: artifacts.subjectBundleRef,'));
  assert.ok(body.includes('subject_scope_digest: artifacts.subjectScopeDigest,'));
  const afterPublish = body.slice(publishAt);
  assert.strictEqual(afterPublish.includes('subject_bundle_ref ='), false, 'published subject binding must never be rewritten');
  assert.strictEqual(afterPublish.includes('subject_scope_digest ='), false, 'published subject digest must never be rewritten');
});

test('P2-REQ-03 selector preserves legacy fallback and bridge cannot materialize', () => {
  const lifecycleSource = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs'), 'utf8');
  const start = lifecycleSource.indexOf('function s16MaterializeArchitectSubjectBundle(');
  const end = lifecycleSource.indexOf('function s16ReadOptionalValidated(', start);
  assert.ok(start >= 0 && end > start, 'role-bound selector must exist as the declared sibling -- RED until implemented');
  const selector = lifecycleSource.slice(start, end);
  assert.ok(selector.includes('s16MaterializeCommonArtifacts(projectRoot, context)'), 'non-P2 or absent-seed flow must delegate verbatim to the legacy materializer');
  assert.ok(selector.includes('buildP2SubjectBundleMaterialization'), 'P2 flow must reuse the audited pure builder');
  assert.ok(selector.includes('materializeSubjectBundle'), 'P2 flow must publish through the existing canonical consultation materializer');

  const bridgeSource = fs.readFileSync(path.resolve(__dirname, '../lib/runtime-bridge-codex.cjs'), 'utf8');
  assert.strictEqual(bridgeSource.includes('buildP2SubjectBundleMaterialization'), false, 'bridge must not own request-birth materialization');
  assert.strictEqual(bridgeSource.includes('s16MaterializeArchitectSubjectBundle'), false, 'bridge must not invoke lifecycle-private materialization');
});

// ── P2 root-consult review record ───────────────────────────────────────

function buildValidP2ReviewRecord() {
  return {
    schema: 'runtime/root-consult-review/v1',
    intent_id: crypto.randomBytes(16).toString('hex'),
    binding_id: crypto.randomBytes(16).toString('hex'),
    requester_actor_instance_id: crypto.randomBytes(16).toString('hex'),
    session_generation_id: crypto.randomBytes(16).toString('hex'),
    thread_id: crypto.randomBytes(16).toString('hex'),
    resume_request_id: crypto.randomBytes(16).toString('hex'),
    cp_completion_digest: crypto.randomBytes(32).toString('hex'),
    subject_bundle_ref: 'subject-bundles/' + crypto.randomBytes(32).toString('hex') + '/manifest.json',
    subject_scope_digest: crypto.randomBytes(32).toString('hex'),
    decision: 'APPROVED_PREP',
    reviewed_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function expectedP2ReviewBinding(record) {
  return {
    intent_id: record.intent_id,
    binding_id: record.binding_id,
    requester_actor_instance_id: record.requester_actor_instance_id,
    session_generation_id: record.session_generation_id,
    thread_id: record.thread_id,
    resume_request_id: record.resume_request_id,
    cp_completion_digest: record.cp_completion_digest,
    subject_bundle_ref: record.subject_bundle_ref,
    subject_scope_digest: record.subject_scope_digest,
  };
}

test('P2-RCR-01 exact root-consult review record validates', () => {
  assert.strictEqual(typeof rll.validateRootConsultReviewRecord, 'function', 'validateRootConsultReviewRecord must exist -- RED until implemented');
  const record = buildValidP2ReviewRecord();
  const result = rll.validateRootConsultReviewRecord(record, expectedP2ReviewBinding(record));
  assert.strictEqual(result.ok, true, 'exact correlated review must validate: ' + JSON.stringify(result));
  assert.deepStrictEqual(result.record, record);
});

test('P2-RCR-02 review decision enum is closed', () => {
  assert.strictEqual(typeof rll.validateRootConsultReviewRecord, 'function', 'validateRootConsultReviewRecord must exist -- RED until implemented');
  for (const decision of ['APPROVED_PREP', 'REJECTED', 'INCONCLUSIVE']) {
    const record = Object.assign(buildValidP2ReviewRecord(), { decision });
    assert.strictEqual(rll.validateRootConsultReviewRecord(record, expectedP2ReviewBinding(record)).ok, true, decision + ' must be admitted');
  }
  for (const decision of ['', 'APPROVED', 'approved_prep', 'MANUAL']) {
    const record = Object.assign(buildValidP2ReviewRecord(), { decision });
    const result = rll.validateRootConsultReviewRecord(record, expectedP2ReviewBinding(record));
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false, decision + ' must be rejected');
  }
});

test('P2-RCR-03 review is bound to same actor session thread CP and manifest', () => {
  assert.strictEqual(typeof rll.validateRootConsultReviewRecord, 'function', 'validateRootConsultReviewRecord must exist -- RED until implemented');
  const fields = ['intent_id', 'binding_id', 'requester_actor_instance_id', 'session_generation_id', 'thread_id', 'resume_request_id', 'cp_completion_digest', 'subject_bundle_ref', 'subject_scope_digest'];
  const reasons = [];
  for (const field of fields) {
    const record = buildValidP2ReviewRecord();
    const expected = expectedP2ReviewBinding(record);
    expected[field] = field === 'subject_bundle_ref'
      ? 'subject-bundles/' + crypto.randomBytes(32).toString('hex') + '/manifest.json'
      : crypto.randomBytes(field.includes('digest') ? 32 : 16).toString('hex');
    const result = rll.validateRootConsultReviewRecord(record, expected);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason'], field + ' mismatch must have closed failure shape');
    assert.strictEqual(result.ok, false, field + ' mismatch must fail closed');
    reasons.push(result.reason);
  }
  assert.strictEqual(new Set(reasons).size, fields.length, 'each correlation mismatch must have a discriminating reason');
});

test('P2-RCR-04 review schema rejects extra missing malformed and replay shape', () => {
  assert.strictEqual(typeof rll.validateRootConsultReviewRecord, 'function', 'validateRootConsultReviewRecord must exist -- RED until implemented');
  const base = buildValidP2ReviewRecord();
  const cases = [
    Object.assign({}, base, { extra: true }),
    Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'subject_scope_digest')),
    Object.assign({}, base, { reviewed_at: 'not-an-iso-time' }),
    Object.assign({}, base, { resume_request_id: base.thread_id }),
  ];
  const reasons = [];
  for (const candidate of cases) {
    const result = rll.validateRootConsultReviewRecord(candidate, expectedP2ReviewBinding(base));
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false);
    reasons.push(result.reason);
  }
  assert.strictEqual(new Set(reasons).size, cases.length, 'closed-shape hostiles must have distinct reasons');
});

// ── P2 PREP publication intent record ───────────────────────────────────

function buildValidPrepPublicationIntentRecord() {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    schema: 'runtime/prep-publication-intent/v1',
    intent_id: crypto.randomBytes(16).toString('hex'),
    role: 'arch-platform',
    wave_slug: 'portable-runtime-messaging-adapters',
    head: 'a'.repeat(40),
    plan_sha256: crypto.randomBytes(32).toString('hex'),
    binding_id: crypto.randomBytes(16).toString('hex'),
    requester_actor_instance_id: crypto.randomBytes(16).toString('hex'),
    session_generation_id: crypto.randomBytes(16).toString('hex'),
    cp_intent_id: crypto.randomBytes(16).toString('hex'),
    cp_completion_digest: crypto.randomBytes(32).toString('hex'),
    subject_scope_digest: crypto.randomBytes(32).toString('hex'),
    review_decision: 'APPROVED_PREP',
    publication_nonce: crypto.randomBytes(16).toString('hex'),
    state: 'RESERVED',
    reserved_at: now,
    state_updated_at: now,
    expiry: new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function expectedPrepPublicationIntentBinding(record) {
  return {
    intent_id: record.intent_id,
    role: record.role,
    wave_slug: record.wave_slug,
    head: record.head,
    plan_sha256: record.plan_sha256,
    binding_id: record.binding_id,
    requester_actor_instance_id: record.requester_actor_instance_id,
    session_generation_id: record.session_generation_id,
    cp_intent_id: record.cp_intent_id,
    cp_completion_digest: record.cp_completion_digest,
    subject_scope_digest: record.subject_scope_digest,
    publication_nonce: record.publication_nonce,
  };
}

test('P2-PPI-01 exact PREP publication intent validates', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationIntentRecord, 'function', 'validatePrepPublicationIntentRecord must exist -- RED until implemented');
  const record = buildValidPrepPublicationIntentRecord();
  const result = rll.validatePrepPublicationIntentRecord(record, expectedPrepPublicationIntentBinding(record));
  assert.strictEqual(result.ok, true, 'exact correlated intent must validate: ' + JSON.stringify(result));
  assert.deepStrictEqual(result.record, record);
});

test('P2-PPI-02 intent state enum and shape are closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationIntentRecord, 'function', 'validatePrepPublicationIntentRecord must exist -- RED until implemented');
  for (const state of ['RESERVED', 'PUBLISHED_PENDING_RECEIPT', 'COMPLETED', 'CONFLICTED', 'EXPIRED']) {
    const record = Object.assign(buildValidPrepPublicationIntentRecord(), { state });
    assert.strictEqual(rll.validatePrepPublicationIntentRecord(record, expectedPrepPublicationIntentBinding(record)).ok, true, state + ' must validate');
  }
  const base = buildValidPrepPublicationIntentRecord();
  for (const candidate of [Object.assign({}, base, { extra: true }), Object.assign({}, base, { state: 'OPEN' })]) {
    const result = rll.validatePrepPublicationIntentRecord(candidate, expectedPrepPublicationIntentBinding(base));
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false);
  }
});

test('P2-PPI-03 intent binding rejects actor session CP manifest head plan role and nonce mismatch', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationIntentRecord, 'function', 'validatePrepPublicationIntentRecord must exist -- RED until implemented');
  const fields = ['role', 'wave_slug', 'head', 'plan_sha256', 'binding_id', 'requester_actor_instance_id', 'session_generation_id', 'cp_intent_id', 'cp_completion_digest', 'subject_scope_digest', 'publication_nonce'];
  const reasons = [];
  for (const field of fields) {
    const record = buildValidPrepPublicationIntentRecord();
    const expected = expectedPrepPublicationIntentBinding(record);
    if (field === 'role') expected[field] = 'arch-testing';
    else if (field === 'wave_slug') expected[field] = 'different-wave';
    else if (field === 'head') expected[field] = 'b'.repeat(40);
    else expected[field] = crypto.randomBytes(field.includes('digest') || field.includes('sha256') ? 32 : 16).toString('hex');
    const result = rll.validatePrepPublicationIntentRecord(record, expected);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason'], field + ' mismatch must fail with closed shape');
    assert.strictEqual(result.ok, false, field + ' mismatch must fail closed');
    reasons.push(result.reason);
  }
  assert.strictEqual(new Set(reasons).size, fields.length, 'intent correlation mismatches must be discriminating');
});

test('P2-PPI-04 reservation record requires APPROVED_PREP and valid chronology', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationIntentRecord, 'function', 'validatePrepPublicationIntentRecord must exist -- RED until implemented');
  const base = buildValidPrepPublicationIntentRecord();
  const cases = [
    Object.assign({}, base, { review_decision: 'REJECTED' }),
    Object.assign({}, base, { review_decision: 'INCONCLUSIVE' }),
    Object.assign({}, base, { review_decision: 'APPROVED' }),
    Object.assign({}, base, { state_updated_at: 'not-an-iso-time' }),
    Object.assign({}, base, { expiry: base.reserved_at }),
  ];
  const reasons = [];
  for (const candidate of cases) {
    const result = rll.validatePrepPublicationIntentRecord(candidate, expectedPrepPublicationIntentBinding(base));
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false);
    reasons.push(result.reason);
  }
  assert.strictEqual(new Set(reasons).size, cases.length, 'review/chronology hostiles must be discriminating');
});

// ── P2 PREP publication receipt + no-authority reservation ─────────────

function buildValidPrepPublicationReceiptRecord() {
  return {
    schema: 'runtime/prep-publication-receipt/v1',
    receipt_id: crypto.randomBytes(16).toString('hex'),
    intent_id: crypto.randomBytes(16).toString('hex'),
    role: 'arch-platform',
    wave_slug: 'portable-runtime-messaging-adapters',
    head: 'a'.repeat(40),
    plan_sha256: crypto.randomBytes(32).toString('hex'),
    binding_id: crypto.randomBytes(16).toString('hex'),
    requester_actor_instance_id: crypto.randomBytes(16).toString('hex'),
    session_generation_id: crypto.randomBytes(16).toString('hex'),
    cp_intent_id: crypto.randomBytes(16).toString('hex'),
    cp_completion_digest: crypto.randomBytes(32).toString('hex'),
    subject_scope_digest: crypto.randomBytes(32).toString('hex'),
    review_decision: 'APPROVED_PREP',
    publication_nonce: crypto.randomBytes(16).toString('hex'),
    verdict_ref: 'verdicts/arch-platform-verdict.md',
    verdict_full_sha256: crypto.randomBytes(32).toString('hex'),
    published_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

function expectedPrepPublicationReceiptBinding(record) {
  return {
    intent_id: record.intent_id,
    role: record.role,
    wave_slug: record.wave_slug,
    head: record.head,
    plan_sha256: record.plan_sha256,
    binding_id: record.binding_id,
    requester_actor_instance_id: record.requester_actor_instance_id,
    session_generation_id: record.session_generation_id,
    cp_intent_id: record.cp_intent_id,
    cp_completion_digest: record.cp_completion_digest,
    subject_scope_digest: record.subject_scope_digest,
    review_decision: record.review_decision,
    publication_nonce: record.publication_nonce,
    verdict_ref: record.verdict_ref,
    verdict_full_sha256: record.verdict_full_sha256,
  };
}

test('P2-PPI-05 exact PREP publication receipt validates', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationReceiptRecord, 'function', 'validatePrepPublicationReceiptRecord must exist -- RED until implemented');
  const record = buildValidPrepPublicationReceiptRecord();
  const result = rll.validatePrepPublicationReceiptRecord(record, expectedPrepPublicationReceiptBinding(record));
  assert.strictEqual(result.ok, true, 'exact correlated receipt must validate: ' + JSON.stringify(result));
  assert.deepStrictEqual(result.record, record);
});

test('P2-PPI-06 receipt schema and correlation fail closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationReceiptRecord, 'function', 'validatePrepPublicationReceiptRecord must exist -- RED until implemented');
  const base = buildValidPrepPublicationReceiptRecord();
  const candidates = [
    { record: Object.assign({}, base, { extra: true }), expected: expectedPrepPublicationReceiptBinding(base) },
    { record: Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'verdict_full_sha256')), expected: expectedPrepPublicationReceiptBinding(base) },
    { record: Object.assign({}, base, { review_decision: 'MANUAL' }), expected: expectedPrepPublicationReceiptBinding(base) },
    { record: base, expected: Object.assign(expectedPrepPublicationReceiptBinding(base), { head: 'b'.repeat(40) }) },
    { record: base, expected: Object.assign(expectedPrepPublicationReceiptBinding(base), { plan_sha256: crypto.randomBytes(32).toString('hex') }) },
    { record: base, expected: Object.assign(expectedPrepPublicationReceiptBinding(base), { verdict_full_sha256: crypto.randomBytes(32).toString('hex') }) },
  ];
  for (const candidate of candidates) {
    const result = rll.validatePrepPublicationReceiptRecord(candidate.record, candidate.expected);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false);
  }
});

test('P2-PPI-07 reservation without genuine live ownership fails with zero registry mutation', () => {
  assert.strictEqual(typeof rll.reservePrepPublicationIntent, 'function', 'reservePrepPublicationIntent must exist -- RED until implemented');
  const dir = makeGitProject();
  const waveSlug = 'p2-ppi-no-authority';
  try {
    writePlanFixture(dir, waveSlug);
    const review = buildValidP2ReviewRecord();
    const completion = {
      schema: 'runtime/root-consult-completion/v1',
      intent_id: review.intent_id,
      request_id: crypto.randomBytes(16).toString('hex'),
      request_digest: crypto.randomBytes(32).toString('hex'),
      result_ref: 'requests/result.json',
      result_digest: crypto.randomBytes(32).toString('hex'),
      accepted_result_ref: 'requests/accepted-result.json',
      accepted_result_digest: crypto.randomBytes(32).toString('hex'),
      ack_ref: 'requests/transaction-ack.json',
      ack_digest: crypto.randomBytes(32).toString('hex'),
      requester_actor_instance_id: review.requester_actor_instance_id,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    review.cp_completion_digest = rc.sha256String(rc.canonicalJSONStringify(completion));
    const projection = {
      subjectBundleRef: review.subject_bundle_ref,
      subjectScopeDigest: review.subject_scope_digest,
    };
    const before = snapshotRegistryTree(dir);
    const result = rll.reservePrepPublicationIntent(dir, waveSlug, 'arch-platform', completion, review, projection);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false, 'hand-seeded data records must never substitute for a live owned architect');
    assert.deepStrictEqual(snapshotRegistryTree(dir), before, 'failed reservation must not mint nonce/intent or mutate registry bytes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2 exact PREP publication grammar ─────────────────────────────────

function buildExactPrepVerdictBytes(intent, overrides = {}) {
  const values = Object.assign({
    role: intent.role,
    wave_slug: intent.wave_slug,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    phase: 'PREP',
    status: 'APPROVED-PREP',
    head: intent.head,
    plan_sha256: intent.plan_sha256,
    publication_nonce: intent.publication_nonce,
  }, overrides);
  return Buffer.from([
    '# ' + values.role + ' verdict — wave-' + values.wave_slug,
    '',
    '**Phase**: ' + values.phase,
    '**Timestamp**: ' + values.timestamp,
    '**Status**: ' + values.status,
    '**PREP-HEAD**: ' + values.head,
    '**PLAN_SHA256**: ' + values.plan_sha256,
    '**PUBLICATION-NONCE**: ' + values.publication_nonce,
    '',
    '',
  ].join('\n'), 'utf8');
}

test('P2-PPG-01 exact nine-line PREP verdict grammar validates', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const bytes = buildExactPrepVerdictBytes(intent);
  const result = rll.validatePrepPublicationGrammar(bytes, intent);
  assert.strictEqual(result.ok, true, 'exact correlated PREP grammar must validate: ' + JSON.stringify(result));
  assert.strictEqual(result.fields.phase, 'PREP');
  assert.strictEqual(result.fields.status, 'APPROVED-PREP');
  assert.strictEqual(result.fields.head, intent.head);
  assert.strictEqual(result.fields.plan_sha256, intent.plan_sha256);
  assert.strictEqual(result.fields.publication_nonce, intent.publication_nonce);
});

test('P2-PPG-02 line count order duplicates and prose fail closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const valid = buildExactPrepVerdictBytes(intent).toString('utf8').split('\n');
  const reordered = valid.slice();
  [reordered[2], reordered[3]] = [reordered[3], reordered[2]];
  const duplicate = valid.slice();
  duplicate.splice(5, 0, duplicate[4]);
  const extraProse = valid.slice();
  extraProse.splice(8, 0, 'manual approval');
  const missingBlank = valid.slice();
  missingBlank.splice(1, 1);
  for (const lines of [reordered, duplicate, extraProse, missingBlank]) {
    const result = rll.validatePrepPublicationGrammar(Buffer.from(lines.join('\n'), 'utf8'), intent);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false);
  }
});

test('P2-PPG-03 phase status head plan role and wave mismatches fail closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const candidates = [
    { phase: 'GREEN' },
    { status: 'APPROVED' },
    { head: 'b'.repeat(40) },
    { plan_sha256: crypto.randomBytes(32).toString('hex') },
    { role: 'arch-testing' },
    { wave_slug: 'different-wave' },
  ];
  for (const overrides of candidates) {
    const result = rll.validatePrepPublicationGrammar(buildExactPrepVerdictBytes(intent, overrides), intent);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false);
  }
});

test('P2-PPG-04 malformed encoding line endings and terminal newline fail closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const valid = buildExactPrepVerdictBytes(intent);
  const cases = [
    Buffer.from(valid.toString('utf8').replace(/\n/g, '\r\n'), 'utf8'),
    Buffer.concat([valid.subarray(0, 8), Buffer.from([0]), valid.subarray(8)]),
    Buffer.concat([valid.subarray(0, 8), Buffer.from([255]), valid.subarray(8)]),
    valid.subarray(0, valid.length - 1),
  ];
  for (const bytes of cases) {
    const result = rll.validatePrepPublicationGrammar(bytes, intent);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false);
  }
});

test('P2-PPG-05 wrong publication nonce fails closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const result = rll.validatePrepPublicationGrammar(buildExactPrepVerdictBytes(intent, {
    publication_nonce: crypto.randomBytes(16).toString('hex'),
  }), intent);
  assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
  assert.strictEqual(result.ok, false);
});

test('P2-PPG-06 missing publication nonce legacy grammar fails closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const lines = buildExactPrepVerdictBytes(intent).toString('utf8').split('\n');
  lines.splice(7, 1);
  const result = rll.validatePrepPublicationGrammar(Buffer.from(lines.join('\n'), 'utf8'), intent);
  assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
  assert.strictEqual(result.ok, false);
});

test('P2-PPG-07 malformed or out-of-range timestamp fails closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  for (const timestamp of ['not-an-iso-time', '2026-08-29T07:00Z', '2000-01-01T00:00:00Z']) {
    const result = rll.validatePrepPublicationGrammar(buildExactPrepVerdictBytes(intent, { timestamp }), intent);
    assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
    assert.strictEqual(result.ok, false);
  }
});

test('P2-PPG-08 unpredicted canonical timestamp inside the live window validates', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const timestamp = new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  assert.notStrictEqual(timestamp, intent.reserved_at, 'test timestamp must not be predicted from the intent fixture');
  const result = rll.validatePrepPublicationGrammar(buildExactPrepVerdictBytes(intent, { timestamp }), intent);
  assert.strictEqual(result.ok, true, 'canonical in-range timestamp must be validated rather than predicted: ' + JSON.stringify(result));
  assert.strictEqual(result.fields.timestamp, timestamp);
});

test('P2-PPG-09 nonce replay from a different terminal intent fails closed', () => {
  assert.strictEqual(typeof rll.validatePrepPublicationGrammar, 'function', 'validatePrepPublicationGrammar must exist -- RED until implemented');
  const terminalIntent = Object.assign(buildValidPrepPublicationIntentRecord(), { state: 'COMPLETED' });
  const freshIntent = buildValidPrepPublicationIntentRecord();
  assert.notStrictEqual(terminalIntent.publication_nonce, freshIntent.publication_nonce);
  const result = rll.validatePrepPublicationGrammar(buildExactPrepVerdictBytes(freshIntent, {
    publication_nonce: terminalIntent.publication_nonce,
  }), freshIntent);
  assert.deepStrictEqual(Object.keys(result).sort(), ['ok', 'reason']);
  assert.strictEqual(result.ok, false);
});

function buildParsedPrepFields(intent, timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')) {
  return {
    role: intent.role,
    wave_slug: intent.wave_slug,
    phase: 'PREP',
    timestamp,
    status: 'APPROVED-PREP',
    head: intent.head,
    plan_sha256: intent.plan_sha256,
    publication_nonce: intent.publication_nonce,
  };
}

test('P2-PPC-01 completion is input-immutable and mints one correlated terminal receipt', () => {
  assert.strictEqual(typeof rll.completePrepPublicationIntent, 'function', 'completePrepPublicationIntent must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const original = JSON.parse(JSON.stringify(intent));
  const parsed = buildParsedPrepFields(intent);
  const verdictRef = 'verdicts/arch-platform-verdict.md';
  const verdictFullSha256 = crypto.randomBytes(32).toString('hex');
  const result = rll.completePrepPublicationIntent(intent, parsed, verdictRef, verdictFullSha256);
  assert.deepStrictEqual(Object.keys(result).sort(), ['intent', 'ok', 'receipt']);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(intent, original, 'transition must not mutate the caller-owned input record');
  assert.strictEqual(result.intent.state, 'COMPLETED');
  assert.strictEqual(result.receipt.schema, 'runtime/prep-publication-receipt/v1');
  assert.strictEqual(result.receipt.intent_id, intent.intent_id);
  assert.strictEqual(result.receipt.publication_nonce, intent.publication_nonce);
  assert.strictEqual(result.receipt.verdict_ref, verdictRef);
  assert.strictEqual(result.receipt.verdict_full_sha256, verdictFullSha256);
  const receiptCheck = rll.validatePrepPublicationReceiptRecord(result.receipt, expectedPrepPublicationReceiptBinding(result.receipt));
  assert.strictEqual(receiptCheck.ok, true, 'minted receipt must satisfy the closed receipt validator');
});

test('P2-PPC-02 conflict is terminal input-immutable and cannot reopen or complete', () => {
  assert.strictEqual(typeof rll.conflictPrepPublicationIntent, 'function', 'conflictPrepPublicationIntent must exist -- RED until implemented');
  assert.strictEqual(typeof rll.completePrepPublicationIntent, 'function', 'completePrepPublicationIntent must exist -- RED until implemented');
  const intent = buildValidPrepPublicationIntentRecord();
  const original = JSON.parse(JSON.stringify(intent));
  const result = rll.conflictPrepPublicationIntent(intent, 'PREP_GRAMMAR_MISMATCH');
  assert.deepStrictEqual(Object.keys(result).sort(), ['intent', 'ok']);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(intent, original, 'conflict transition must not mutate caller-owned input');
  assert.strictEqual(result.intent.state, 'CONFLICTED');
  const reopen = rll.conflictPrepPublicationIntent(result.intent, 'SECOND_REASON');
  assert.deepStrictEqual(Object.keys(reopen).sort(), ['ok', 'reason']);
  assert.strictEqual(reopen.ok, false, 'terminal conflict must not reopen');
  const complete = rll.completePrepPublicationIntent(result.intent, buildParsedPrepFields(intent), 'verdicts/arch-platform-verdict.md', crypto.randomBytes(32).toString('hex'));
  assert.deepStrictEqual(Object.keys(complete).sort(), ['ok', 'reason']);
  assert.strictEqual(complete.ok, false, 'terminal conflict must not transition to completed');
});
