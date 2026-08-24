'use strict';
// runtime-bridge-schema-validators.test.js -- WP3 (second capability-pin remint +
// C2 design addendum). Tests the tracked C2 schema-validator-bundle triad:
//   scripts/lib/schema/c2-schema-bundle.json
//   scripts/tools/generate-c2-schema-validators.cjs
//   scripts/lib/generated/c2-schema-validators.generated.cjs
// per PLAN.md's "C2 Schema Validator Bundle" section (R14 design authority --
// .planning/wave-portable-runtime-messaging-adapters/r11-spike/R14-CORRECTION-REPORT.md,
// Codex-approved SPIKE-DESIGN-GO/GREEN_LOCAL-R14).
//
// The differential-verification logic below (fixture generation, 3-oracle
// comparison, format-boundary cases, McpElicitation coverage, the Turn.durationMs
// and SR-asymmetry regressions) is ported from the R14 spike's own
// verify-schema-spike.cjs -- same algorithm, already adversarially audited;
// only the file locations change (tracked paths here, not the gitignored spike
// directory) and the pass/fail mechanism (node:test assertions here, not
// throw+process.exit). The raw-source oracle's 42 root fixture files are
// copied byte-identical into fixtures/c2-schema-source-corpus.json (R14
// Bloque C: one Path-Manifest-tracked artifact, materialized to a temp
// directory at load time -- see materializeCorpus() below) so this suite has
// no dependency on the gitignored .planning/wave-*/ tree and runs correctly
// from a fresh checkout/CI.
//
// Ajv is a TEST-TIME-ONLY oracle here (mirrors the R10 correction's established
// precedent, wp3-item-c2-r10-correction-ledger.md Block A) -- it is loaded only
// from mcp-server/node_modules, never added as a scripts/lib dependency. This
// file does NOT touch runtime-bridge-codex.cjs at all.

const assert = require('node:assert');
const { test, describe } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUNDLE_PATH = path.join(REPO_ROOT, 'scripts', 'lib', 'schema', 'c2-schema-bundle.json');
const GENERATED_PATH = path.join(REPO_ROOT, 'scripts', 'lib', 'generated', 'c2-schema-validators.generated.cjs');
const GENERATOR_PATH = path.join(REPO_ROOT, 'scripts', 'tools', 'generate-c2-schema-validators.cjs');
// R14 (Bloque C): the 42 raw-source oracle fixtures now live as ONE
// Path-Manifest-tracked artifact (c2-schema-source-corpus.json) instead of
// 40 individually-untracked files -- materializeCorpus() below writes each
// entry out to a fresh temp directory so every downstream FIXTURES_DIR
// consumer below is unchanged.
const CORPUS_PATH = path.join(__dirname, 'fixtures', 'c2-schema-source-corpus.json');
const AJV_PATH = path.join(REPO_ROOT, 'mcp-server', 'node_modules', 'ajv');
const AJV_FORMATS_PATH = path.join(REPO_ROOT, 'mcp-server', 'node_modules', 'ajv-formats');

const EXPECTED_SCHEMA_SET_FINGERPRINT = 'dfdbacfa269b089e7b33617f3845c924c30510be0f8cd15cf324dd170ba013cd';
const EXPECTED_SCHEMA_SET_FILE_COUNT = 267;
const EXPECTED_ROOT_COUNT = 42;
const EXPECTED_DEFINITION_COUNT = 135;
const EXPECTED_VALIDATOR_COUNT = 177;
const EXPECTED_TRANSFORMATION_COUNT = 136;
const EXPECTED_FORMAT_COUNT = 7;

function sha256File(p) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// R14 (Bloque C): a canonical relative POSIX path -- never absolute, never
// backslash-separated, never containing a "." or ".." segment (traversal).
function isCanonicalRelativePath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.startsWith('/') || p.includes('\\')) return false;
  const segments = p.split('/');
  return segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// Pure check -- returns every violation found (empty array = clean). Shared
// by the throw-on-load materializer below AND the describe block's own
// explicit assertions, so the two can never drift apart.
function findCorpusViolations(corpus) {
  const violations = [];
  if (!corpus || typeof corpus !== 'object' || !Array.isArray(corpus.entries)) {
    violations.push('corpus is not a {entries:[...]} object');
    return violations;
  }
  const seenPaths = new Set();
  let previousPath = null;
  for (const entry of corpus.entries) {
    const label = entry && typeof entry === 'object' && typeof entry.path === 'string' ? entry.path : JSON.stringify(entry);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).sort().join(',') !== 'content,path') {
      violations.push('entry has an unexpected shape, expected exactly {path, content}: ' + label);
      continue;
    }
    if (!isCanonicalRelativePath(entry.path)) { violations.push('non-canonical path (absolute, backslash, or ./.. segment): ' + label); continue; }
    if (seenPaths.has(entry.path)) { violations.push('duplicate path: ' + label); continue; }
    if (previousPath !== null && entry.path <= previousPath) violations.push('out-of-order path (corpus must be strictly ascending): ' + label);
    seenPaths.add(entry.path);
    previousPath = entry.path;
    if (typeof entry.content !== 'string') violations.push('non-string content: ' + label);
  }
  return violations;
}

// R14 (Bloque C): fail-closed -- an integrity violation throws during module
// load (same failure mode as the BUNDLE_PATH/GENERATED_PATH requires below),
// never a silently-skipped or partially-materialized fixture set.
function materializeCorpus(corpusPath) {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const violations = findCorpusViolations(corpus);
  if (violations.length > 0) throw new Error('c2-schema-source-corpus.json failed integrity validation:\n' + violations.join('\n'));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-schema-source-corpus-'));
  for (const entry of corpus.entries) {
    const dest = path.join(tmpDir, entry.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.content, 'utf8');
  }
  return tmpDir;
}

// ── Load the tracked artifacts fresh for every test run (no caching across files) ──
const bundleRaw = fs.readFileSync(BUNDLE_PATH, 'utf8');
const bundle = JSON.parse(bundleRaw);
const generated = require(GENERATED_PATH);
const FIXTURES_DIR = materializeCorpus(CORPUS_PATH);

const Ajv = require(AJV_PATH);
const addFormats = require(AJV_FORMATS_PATH);

// ==================== Infra: bundle shape, provenance, counts, hashes ====================

describe('bundle shape and provenance', () => {
  test('bundle is canonical (re-serializing parsed JSON + newline reproduces the file byte-for-byte)', () => {
    const canonical = canonicalStringify(bundle) + '\n';
    assert.strictEqual(canonical, bundleRaw, 'bundle.json on disk is not canonically serialized -- hand-edit or non-canonical writer suspected');
  });

  test('top-level bundle shape is closed (exactly schema_draft, roots, definitions, provenance)', () => {
    assert.deepStrictEqual(Object.keys(bundle).sort(), ['definitions', 'provenance', 'roots', 'schema_draft']);
  });

  test('provenance block shape is closed and required fields present', () => {
    const prov = bundle.provenance;
    assert.ok(prov, 'provenance block missing');
    for (const key of ['source_schema_set_fingerprint', 'source_schema_set_file_count', 'source_regeneration_command', 'generator_sha256', 'transformation_count', 'transformation_log']) {
      assert.ok(Object.prototype.hasOwnProperty.call(prov, key), `provenance missing required key: ${key}`);
    }
  });

  test('exact source schema-set fingerprint and file count (matches live gc-verify.cjs pin)', () => {
    assert.strictEqual(bundle.provenance.source_schema_set_fingerprint, EXPECTED_SCHEMA_SET_FINGERPRINT);
    assert.strictEqual(bundle.provenance.source_schema_set_file_count, EXPECTED_SCHEMA_SET_FILE_COUNT);
  });

  test('exact final schema contract: 42 roots + 135 definitions = 177 total validators', () => {
    const rootCount = Object.keys(bundle.roots).length;
    const definitionCount = Object.keys(bundle.definitions).length;
    assert.strictEqual(rootCount, EXPECTED_ROOT_COUNT);
    assert.strictEqual(definitionCount, EXPECTED_DEFINITION_COUNT);
    assert.strictEqual(rootCount + definitionCount, EXPECTED_VALIDATOR_COUNT);
  });

  test('generator_sha256 in the bundle matches the ACTUAL current hash of the tracked generator script', () => {
    const actual = sha256File(GENERATOR_PATH);
    assert.strictEqual(bundle.provenance.generator_sha256, actual, 'bundle.provenance.generator_sha256 does not match the currently-tracked generator -- bundle was built by a different generator version (cross-pair)');
  });

  test('final transformation contract is exactly 136 entries, and exactly 7 distinct formats appear', () => {
    assert.strictEqual(bundle.provenance.transformation_count, EXPECTED_TRANSFORMATION_COUNT);
    assert.strictEqual(bundle.provenance.transformation_log.length, bundle.provenance.transformation_count);
    const formats = new Set(bundle.provenance.transformation_log.map((e) => e.format));
    assert.strictEqual(formats.size, EXPECTED_FORMAT_COUNT, `expected exactly ${EXPECTED_FORMAT_COUNT} distinct pinned format transformations, got ${formats.size}: ${[...formats].sort().join(',')}`);
    for (const entry of bundle.provenance.transformation_log) {
      assert.deepStrictEqual(Object.keys(entry).sort(), ['format', 'loc']);
    }
  });

  test('4 dual-direction roots carry non-null producedBy text', () => {
    for (const key of ['base::JSONRPCError', 'base::JSONRPCNotification', 'base::JSONRPCRequest', 'base::JSONRPCResponse']) {
      assert.ok(bundle.roots[key], `expected dual-direction root missing: ${key}`);
      assert.strictEqual(typeof bundle.roots[key].producedBy, 'string', `${key}.producedBy should be a non-null string`);
      assert.ok(bundle.roots[key].producedBy.length > 0, `${key}.producedBy should be non-empty`);
    }
  });

  test('thread/read roots are mapped in their exact runtime directions', () => {
    assert.deepStrictEqual(bundle.roots['v2::ThreadReadResponse']?.directions, ['INBOUND_RUNTIME']);
    assert.deepStrictEqual(bundle.roots['v2::ThreadReadParams']?.directions, ['OUTBOUND_PRODUCED']);
    assert.strictEqual(typeof generated.roots['v2::ThreadReadResponse'], 'function');
    assert.strictEqual(typeof generated.roots['v2::ThreadReadParams'], 'function');
  });

  test('directional root census is closed: 25 inbound, 21 outbound, 42 union, 21/17/4 exclusive split', () => {
    const roots = Object.entries(bundle.roots);
    const inbound = roots.filter(([, root]) => root.directions.includes('INBOUND_RUNTIME'));
    const outbound = roots.filter(([, root]) => root.directions.includes('OUTBOUND_PRODUCED'));
    const dual = roots.filter(([, root]) => root.directions.includes('INBOUND_RUNTIME') && root.directions.includes('OUTBOUND_PRODUCED'));
    assert.deepStrictEqual(
      {
        inbound: inbound.length,
        outbound: outbound.length,
        union: new Set([...inbound, ...outbound].map(([name]) => name)).size,
        inboundOnly: inbound.length - dual.length,
        outboundOnly: outbound.length - dual.length,
        dual: dual.length,
      },
      { inbound: 25, outbound: 21, union: 42, inboundOnly: 21, outboundOnly: 17, dual: 4 },
    );
  });
});

// ==================== Infra: c2-schema-source-corpus.json integrity (R14 Bloque C) ====================
// The 42 raw-source oracle fixtures below were previously individually
// untracked files under scripts/tests/fixtures/c2-schema-source/ -- Codex's
// NO-GO flagged these as outside the Path-Manifest's single-owner coverage.
// Consolidated into ONE tracked artifact; this describe block proves the
// consolidation is genuinely deterministic/ordered/duplicate-free/traversal-safe,
// not merely assumed -- each negative case below mutates a copy of the REAL
// corpus and asserts findCorpusViolations() actually catches it.

describe('c2-schema-source-corpus integrity (consolidated single-file, Path-Manifest-tracked fixture)', () => {
  const corpusRaw = fs.readFileSync(CORPUS_PATH, 'utf8');
  const corpus = JSON.parse(corpusRaw);

  test('the real corpus on disk passes validation with zero violations', () => {
    assert.deepStrictEqual(findCorpusViolations(corpus), []);
  });

  test('the real corpus contains exactly 42 entries, materialized byte-identical to their corpus content', () => {
    assert.strictEqual(corpus.entries.length, 42);
    for (const entry of corpus.entries) {
      const materialized = fs.readFileSync(path.join(FIXTURES_DIR, entry.path), 'utf8');
      assert.strictEqual(materialized, entry.content, `materialized ${entry.path} does not match its corpus content`);
    }
  });

  test('entries are in strict ascending path order (deterministic ordering)', () => {
    const paths = corpus.entries.map((e) => e.path);
    const sorted = [...paths].sort();
    assert.deepStrictEqual(paths, sorted, 'corpus entries are not deterministically ordered');
  });

  test('a duplicate path is rejected', () => {
    const mutated = JSON.parse(corpusRaw);
    mutated.entries.push({ ...mutated.entries[0] });
    const violations = findCorpusViolations(mutated);
    assert.ok(violations.some((v) => v.includes('duplicate path')), 'expected a duplicate-path violation: ' + JSON.stringify(violations));
  });

  test('an absolute path is rejected as non-canonical', () => {
    const mutated = JSON.parse(corpusRaw);
    mutated.entries[0] = { ...mutated.entries[0], path: '/etc/passwd' };
    const violations = findCorpusViolations(mutated);
    assert.ok(violations.some((v) => v.includes('non-canonical path')), 'expected a non-canonical-path violation: ' + JSON.stringify(violations));
  });

  test('a parent-directory traversal segment is rejected as non-canonical', () => {
    const mutated = JSON.parse(corpusRaw);
    mutated.entries[0] = { ...mutated.entries[0], path: '../../etc/passwd' };
    const violations = findCorpusViolations(mutated);
    assert.ok(violations.some((v) => v.includes('non-canonical path')), 'expected a non-canonical-path (traversal) violation: ' + JSON.stringify(violations));
  });

  test('a backslash-separated path is rejected as non-canonical', () => {
    const mutated = JSON.parse(corpusRaw);
    mutated.entries[0] = { ...mutated.entries[0], path: 'v2\\ThreadStartResponse.json' };
    const violations = findCorpusViolations(mutated);
    assert.ok(violations.some((v) => v.includes('non-canonical path')), 'expected a non-canonical-path (backslash) violation: ' + JSON.stringify(violations));
  });

  test('an out-of-order entry is rejected', () => {
    const mutated = JSON.parse(corpusRaw);
    const tmp = mutated.entries[0];
    mutated.entries[0] = mutated.entries[1];
    mutated.entries[1] = tmp;
    const violations = findCorpusViolations(mutated);
    assert.ok(violations.some((v) => v.includes('out-of-order')), 'expected an out-of-order violation: ' + JSON.stringify(violations));
  });

  test('an entry with an unexpected shape (extra or missing key) is rejected', () => {
    const mutated = JSON.parse(corpusRaw);
    mutated.entries[0] = { ...mutated.entries[0], unexpectedExtraKey: 'x' };
    const violations = findCorpusViolations(mutated);
    assert.ok(violations.some((v) => v.includes('unexpected shape')), 'expected an unexpected-shape violation: ' + JSON.stringify(violations));
  });
});

// canonicalStringify mirrors the generator's own canonical serialization (sorted
// object keys, no extra whitespace) -- ported from the same algorithm gc-verify.cjs
// and the generator itself use, so this test can independently re-derive canonicality
// rather than trusting the generator's own self-check.
function canonicalStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// ==================== Infra: generator behavior (regen, cross-pair, tamper, ajv-free, clean-cwd) ====================

describe('generator behavior', () => {
  test('bundle-in --check against the tracked pair reports pair_consistent:true with the exact counts', () => {
    const r = spawnSync(process.execPath, [GENERATOR_PATH, '--repo-root', REPO_ROOT, '--check'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `--check should exit 0 on the untouched tracked pair; stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.pair_consistent, true);
    assert.strictEqual(out.roots, EXPECTED_ROOT_COUNT);
    assert.strictEqual(out.definitions, EXPECTED_DEFINITION_COUNT);
  });

  test('bundle-in --check contains zero .planning references in its stdout', () => {
    const r = spawnSync(process.execPath, [GENERATOR_PATH, '--repo-root', REPO_ROOT, '--check'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.ok(!r.stdout.includes('.planning'), 'bundle-in --check output must never reference .planning');
  });

  test('deterministic regeneration: two independent regenerations from the same tracked bundle are byte-identical', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-schema-regen-'));
    const out1 = path.join(tmp, 'gen1.cjs');
    const out2 = path.join(tmp, 'gen2.cjs');
    try {
      const r1 = spawnSync(process.execPath, [GENERATOR_PATH, '--repo-root', REPO_ROOT, '--bundle-in', BUNDLE_PATH, '--generated-out', out1], { encoding: 'utf8' });
      assert.strictEqual(r1.status, 0, `first regeneration failed: ${r1.stderr}`);
      const r2 = spawnSync(process.execPath, [GENERATOR_PATH, '--repo-root', REPO_ROOT, '--bundle-in', BUNDLE_PATH, '--generated-out', out2], { encoding: 'utf8' });
      assert.strictEqual(r2.status, 0, `second regeneration failed: ${r2.stderr}`);
      const c1 = fs.readFileSync(out1);
      const c2 = fs.readFileSync(out2);
      assert.ok(c1.equals(c2), 'two regenerations from the same bundle produced different bytes -- generator is not deterministic');
      // Also confirm the regenerated content matches the currently-tracked generated file exactly.
      const tracked = fs.readFileSync(GENERATED_PATH);
      assert.ok(c1.equals(tracked), 'fresh regeneration from the tracked bundle does not match the tracked generated file -- they have drifted apart');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('cross-pair mismatch: a generated file that disagrees with the bundle is detected, never silently accepted', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-schema-crosspair-'));
    const mutatedGenerated = path.join(tmp, 'generated.cjs');
    try {
      const tampered = fs.readFileSync(GENERATED_PATH, 'utf8') + '\n// mutated for cross-pair test\n';
      fs.writeFileSync(mutatedGenerated, tampered);
      const r = spawnSync(process.execPath, [GENERATOR_PATH, '--repo-root', REPO_ROOT, '--bundle-in', BUNDLE_PATH, '--generated-out', mutatedGenerated, '--check'], { encoding: 'utf8' });
      assert.notStrictEqual(r.status, 0, 'a mutated generated file must fail --check, not exit 0');
      assert.ok(!r.stdout.includes('"pair_consistent":true'), 'pair_consistent:true must never be printed for a mismatched pair');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('tampered bundle provenance is rejected FAIL-CLOSED (zeroed fingerprint), never printing pair_consistent:true', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-schema-tamper-'));
    const tamperedBundlePath = path.join(tmp, 'bundle.json');
    try {
      const tampered = JSON.parse(bundleRaw);
      tampered.provenance.source_schema_set_fingerprint = '0'.repeat(64);
      fs.writeFileSync(tamperedBundlePath, canonicalStringify(tampered) + '\n');
      const r = spawnSync(process.execPath, [GENERATOR_PATH, '--repo-root', REPO_ROOT, '--bundle-in', tamperedBundlePath, '--generated-out', path.join(tmp, 'generated.cjs'), '--check'], { encoding: 'utf8' });
      assert.notStrictEqual(r.status, 0, 'a tampered-provenance bundle must fail --check, not exit 0');
      assert.ok(!r.stdout.includes('"pair_consistent":true'), 'pair_consistent:true must never be printed for a tampered-provenance bundle');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('the tracked generated validators file has zero runtime require/import of ajv', () => {
    const src = fs.readFileSync(GENERATED_PATH, 'utf8');
    assert.ok(!/require\(\s*['"].*ajv.*['"]\s*\)/i.test(src), 'generated validators must never require ajv at runtime');
  });

  test('the tracked generated validators file loads standalone from an unrelated cwd with ajv unresolvable', () => {
    const probe = `
      const path = require('path');
      try { require.resolve('ajv', { paths: [path.dirname(process.argv[1])] }); console.log('AJV_RESOLVABLE'); } catch (e) { console.log('AJV_NOT_RESOLVABLE'); }
      const mod = require(${JSON.stringify(GENERATED_PATH)});
      console.log('LOADED', typeof mod.roots, typeof mod.definitions, Object.keys(mod.roots).length, Object.keys(mod.definitions).length);
      const sample = mod.roots['v2::InitializeResponse'] || Object.values(mod.roots)[0];
      console.log('SAMPLE_CALLABLE', typeof sample === 'function');
    `;
    const probeFile = path.join(os.tmpdir(), `c2-schema-probe-${process.pid}-${Date.now() % 100000}.js`);
    fs.writeFileSync(probeFile, probe);
    try {
      const r = spawnSync(process.execPath, [probeFile], { encoding: 'utf8', cwd: os.tmpdir() });
      assert.strictEqual(r.status, 0, `standalone load failed: ${r.stderr}`);
      assert.ok(r.stdout.includes('AJV_NOT_RESOLVABLE'), 'test setup invariant violated: ajv should not resolve from the generated file\'s own directory');
      assert.ok(r.stdout.includes(`LOADED object object ${EXPECTED_ROOT_COUNT} ${EXPECTED_DEFINITION_COUNT}`), `unexpected LOADED line: ${r.stdout}`);
      assert.ok(r.stdout.includes('SAMPLE_CALLABLE true'));
    } finally {
      fs.rmSync(probeFile, { force: true });
    }
  });
});

// ==================== Differential verification (ported from r11-spike/verify-schema-spike.cjs, R14) ====================
// Three oracles: (1) raw-source -- compiled from the untransformed captured
// schema fixtures with REAL ajv-formats registered; (2) transformed-bundle --
// compiled from c2-schema-bundle.json; (3) generated -- the shipped artifact.
// Every fixture asserts an EXPLICIT expected boolean; a fixture the oracle
// rejects when intended as minimal-valid is a hard test failure, never a
// silently-skipped case.

function rewriteRefs(node) {
  if (Array.isArray(node)) { node.forEach(rewriteRefs); return; }
  if (!node || typeof node !== 'object') return;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/definitions/')) node.$ref = node.$ref.slice('#/definitions/'.length);
  for (const v of Object.values(node)) rewriteRefs(v);
}

// Oracle 2: transformed-bundle (strict:true, no ajv-formats).
const bundleAjv = new Ajv({ code: { source: true, esm: false }, allErrors: true, strict: true });
for (const [name, entry] of Object.entries(bundle.definitions)) {
  const schema = JSON.parse(JSON.stringify(entry.schema));
  rewriteRefs(schema);
  bundleAjv.addSchema({ ...schema, $id: name });
}
const bundleOracleRoots = {};
for (const [key, rootSchema] of Object.entries(bundle.roots)) {
  const schema = JSON.parse(JSON.stringify(rootSchema));
  delete schema.directions; delete schema.producedBy;
  rewriteRefs(schema);
  bundleOracleRoots[key] = bundleAjv.compile({ ...schema, $id: 'bundleoracle__' + key.replace(/::/g, '__') });
}

// Oracle 1: raw-source (strict:false, REAL ajv-formats), read from the tracked
// fixtures/c2-schema-source-corpus.json copy (materialized into FIXTURES_DIR
// above) -- NOT the gitignored spike directory.
const ROOT_FILES = {
  'v1::InitializeResponse': 'v1/InitializeResponse.json', 'v2::LoginAccountResponse': 'v2/LoginAccountResponse.json',
  'v2::ThreadReadResponse': 'v2/ThreadReadResponse.json',
  'v2::ThreadStartResponse': 'v2/ThreadStartResponse.json', 'v2::ThreadResumeResponse': 'v2/ThreadResumeResponse.json',
  'v2::TurnStartResponse': 'v2/TurnStartResponse.json', 'v2::TurnInterruptResponse': 'v2/TurnInterruptResponse.json',
  'v2::ThreadArchiveResponse': 'v2/ThreadArchiveResponse.json', 'v2::TurnStartedNotification': 'v2/TurnStartedNotification.json',
  'v2::TurnCompletedNotification': 'v2/TurnCompletedNotification.json', 'v2::AccountUpdatedNotification': 'v2/AccountUpdatedNotification.json',
  'base::ChatgptAuthTokensRefreshParams': 'ChatgptAuthTokensRefreshParams.json', 'base::ApplyPatchApprovalParams': 'ApplyPatchApprovalParams.json',
  'base::AttestationGenerateParams': 'AttestationGenerateParams.json', 'base::ExecCommandApprovalParams': 'ExecCommandApprovalParams.json',
  'base::CommandExecutionRequestApprovalParams': 'CommandExecutionRequestApprovalParams.json', 'base::FileChangeRequestApprovalParams': 'FileChangeRequestApprovalParams.json',
  'base::PermissionsRequestApprovalParams': 'PermissionsRequestApprovalParams.json', 'base::DynamicToolCallParams': 'DynamicToolCallParams.json',
  'base::ToolRequestUserInputParams': 'ToolRequestUserInputParams.json', 'base::McpServerElicitationRequestParams': 'McpServerElicitationRequestParams.json',
  'base::JSONRPCResponse': 'JSONRPCResponse.json', 'base::JSONRPCError': 'JSONRPCError.json', 'base::JSONRPCRequest': 'JSONRPCRequest.json',
  'base::JSONRPCNotification': 'JSONRPCNotification.json',
  'v1::InitializeParams': 'v1/InitializeParams.json', 'v2::LoginAccountParams': 'v2/LoginAccountParams.json',
  'v2::ThreadReadParams': 'v2/ThreadReadParams.json',
  'v2::ThreadStartParams': 'v2/ThreadStartParams.json', 'v2::ThreadResumeParams': 'v2/ThreadResumeParams.json',
  'v2::TurnStartParams': 'v2/TurnStartParams.json', 'v2::TurnInterruptParams': 'v2/TurnInterruptParams.json',
  'v2::ThreadArchiveParams': 'v2/ThreadArchiveParams.json', 'base::ChatgptAuthTokensRefreshResponse': 'ChatgptAuthTokensRefreshResponse.json',
  'base::ApplyPatchApprovalResponse': 'ApplyPatchApprovalResponse.json', 'base::ExecCommandApprovalResponse': 'ExecCommandApprovalResponse.json',
  'base::CommandExecutionRequestApprovalResponse': 'CommandExecutionRequestApprovalResponse.json', 'base::FileChangeRequestApprovalResponse': 'FileChangeRequestApprovalResponse.json',
  'base::PermissionsRequestApprovalResponse': 'PermissionsRequestApprovalResponse.json', 'base::DynamicToolCallResponse': 'DynamicToolCallResponse.json',
  'base::ToolRequestUserInputResponse': 'ToolRequestUserInputResponse.json', 'base::McpServerElicitationRequestResponse': 'McpServerElicitationRequestResponse.json',
};

const rawAjv = new Ajv({ code: { source: true, esm: false }, allErrors: true, strict: false });
addFormats(rawAjv);
const rawOracleRoots = {};
{
  const rawDefsSerialized = new Map();
  const rawDefConflicts = [];
  for (const [key, relFile] of Object.entries(ROOT_FILES)) {
    const full = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, relFile), 'utf8'));
    for (const [defName, defValue] of Object.entries(full.definitions || {})) {
      const schema = JSON.parse(JSON.stringify(defValue));
      rewriteRefs(schema);
      const serialized = JSON.stringify(schema);
      if (rawDefsSerialized.has(defName)) {
        if (rawDefsSerialized.get(defName) !== serialized) rawDefConflicts.push({ defName, conflictingRoot: key });
        continue;
      }
      rawDefsSerialized.set(defName, serialized);
      rawAjv.addSchema({ ...schema, $id: defName });
    }
  }
  if (rawDefConflicts.length > 0) {
    throw new Error('raw-oracle definitions conflict across fixture roots with DIFFERING content: ' + JSON.stringify(rawDefConflicts));
  }
  for (const [key, relFile] of Object.entries(ROOT_FILES)) {
    const full = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, relFile), 'utf8'));
    const schema = { ...full };
    delete schema.definitions;
    rewriteRefs(schema);
    rawOracleRoots[key] = rawAjv.compile({ ...schema, $id: 'raworacle__' + key.replace(/::/g, '__') });
  }
}

// Fixture generation (ported unchanged from the R14 spike).
function exampleForType(propSchema) {
  const t = Array.isArray(propSchema.type) ? propSchema.type.find((x) => x !== 'null') || propSchema.type[0] : propSchema.type;
  if (propSchema.enum) return propSchema.enum[0];
  if (propSchema.$ref) return exampleForRef(propSchema.$ref);
  if (Array.isArray(propSchema.allOf) && propSchema.allOf.length === 1) return exampleForType(propSchema.allOf[0]);
  if (Array.isArray(propSchema.anyOf) && propSchema.anyOf.length > 0) return exampleForType(propSchema.anyOf.find((s) => s.type !== 'null') || propSchema.anyOf[0]);
  if (t === 'string') return 'x';
  if (t === 'integer' || t === 'number') return propSchema.minimum !== undefined ? propSchema.minimum : 0;
  if (t === 'boolean') return true;
  if (t === 'array') return [];
  if (t === 'object') return buildMinimal(propSchema);
  if (propSchema.oneOf) return exampleForType(propSchema.oneOf[0]);
  return null;
}
function exampleForRef(refName) {
  const bareName = refName.startsWith('#/definitions/') ? refName.slice('#/definitions/'.length) : refName;
  const def = bundle.definitions[bareName];
  if (!def) return null;
  return buildMinimal(def.schema);
}
function buildMinimal(schema) {
  if (schema.oneOf) return buildMinimal(schema.oneOf[0]);
  if (schema.anyOf) return buildMinimal(schema.anyOf.find((s) => s.type !== 'null') || schema.anyOf[0]);
  if (schema.allOf && schema.allOf.length === 1) return buildMinimal(schema.allOf[0]);
  if (schema.$ref) return exampleForRef(schema.$ref);
  if (schema.type === 'string') return schema.enum ? schema.enum[0] : 'x';
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum !== undefined ? schema.minimum : 0;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'array') return [];
  if (schema.type === 'object' || (!schema.type && schema.properties)) {
    const obj = {};
    for (const req of schema.required || []) if (schema.properties && schema.properties[req]) obj[req] = exampleForType(schema.properties[req]);
    return obj;
  }
  return null;
}
const UNCONSTRAINED = Symbol('unconstrained');
function resolveLeafType(schema, depth) {
  if (depth > 6) return null;
  if (schema === true) return UNCONSTRAINED;
  if (!schema || typeof schema !== 'object') return null;
  if (schema.$ref) {
    const bareName = schema.$ref.startsWith('#/definitions/') ? schema.$ref.slice('#/definitions/'.length) : schema.$ref;
    const def = bundle.definitions[bareName];
    return def ? resolveLeafType(def.schema, depth + 1) : null;
  }
  if (Array.isArray(schema.anyOf)) return resolveLeafType(schema.anyOf.find((s) => s.type !== 'null') || schema.anyOf[0], depth + 1);
  if (Array.isArray(schema.oneOf)) return resolveLeafType(schema.oneOf[0], depth + 1);
  if (Array.isArray(schema.allOf) && schema.allOf.length === 1) return resolveLeafType(schema.allOf[0], depth + 1);
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== 'null') || schema.type[0] : schema.type;
  if (!t) return UNCONSTRAINED;
  if (t === 'object') return 'object';
  return t;
}
function pickIncompatibleValue(propSchema) {
  const leaf = resolveLeafType(propSchema, 0);
  if (leaf === UNCONSTRAINED) return UNCONSTRAINED;
  if (leaf === 'string') return 42;
  if (leaf === 'integer' || leaf === 'number') return 'not-a-number';
  if (leaf === 'boolean') return 'not-a-boolean';
  if (leaf === 'array') return 'not-an-array';
  if (leaf === 'object') return 42;
  return UNCONSTRAINED;
}

function check(rootKey, fixture) {
  const raw = rawOracleRoots[rootKey](fixture);
  const bundleR = bundleOracleRoots[rootKey](fixture);
  const genR = generated.roots[rootKey](fixture);
  return { raw, bundleR, genR, allAgree: raw === bundleR && bundleR === genR };
}

describe('root sweep: 3-way differential (raw-source === transformed-bundle === generated)', () => {
  const rootKeys = Object.keys(bundle.roots);
  assert.strictEqual(rootKeys.length, EXPECTED_ROOT_COUNT);

  for (const rootKey of rootKeys) {
    test(`root ${rootKey}: required/optional/additional/boundary/nullable sweep, all 3 oracles agree`, () => {
      const rootSchema = bundle.roots[rootKey];
      const schemaForFixture = { ...rootSchema };
      delete schemaForFixture.directions; delete schemaForFixture.producedBy;
      const failures = [];

      function record(caseLabel, fixture, expected) {
        const r = check(rootKey, fixture);
        if (!r.allAgree) failures.push(`${caseLabel}: disagreement raw=${r.raw} bundle=${r.bundleR} generated=${r.genR} fixture=${JSON.stringify(fixture)}`);
        if (expected !== undefined && r.bundleR !== expected) failures.push(`${caseLabel}: expected ${expected}, got ${r.bundleR} fixture=${JSON.stringify(fixture)}`);
      }

      if (schemaForFixture.oneOf) {
        const topLevelRequired = schemaForFixture.required || [];
        const topLevelProperties = schemaForFixture.properties || {};
        const topLevelPart = {};
        for (const req of topLevelRequired) if (topLevelProperties[req]) topLevelPart[req] = exampleForType(topLevelProperties[req]);
        schemaForFixture.oneOf.forEach((variant, i) => {
          const fixture = { ...topLevelPart, ...buildMinimal(variant) };
          record(`oneOf-variant-${i}-minimal-valid`, fixture, true);
        });
        assert.strictEqual(failures.length, 0, failures.join('\n'));
        return;
      }

      const required = schemaForFixture.required || [];
      const properties = schemaForFixture.properties || {};
      const minimal = {};
      for (const req of required) minimal[req] = exampleForType(properties[req] || {});
      record('minimal-valid-all-optionals-omitted', minimal, true);

      for (const req of required) {
        const withoutReq = { ...minimal };
        delete withoutReq[req];
        record(`required-removed:${req}`, withoutReq, false);
      }
      for (const [propName, propSchema] of Object.entries(properties)) {
        if (required.includes(propName)) continue;
        const incompatible = pickIncompatibleValue(propSchema);
        if (incompatible === UNCONSTRAINED) continue;
        record(`optional-present-invalid-type:${propName}`, { ...minimal, [propName]: incompatible }, false);
      }
      const additionalAllowed = rootSchema.additionalProperties !== false;
      record('additional-property', { ...minimal, __unexpected_additional_property__: 'surplus' }, additionalAllowed);
      for (const [propName, propSchema] of Object.entries(properties)) {
        const t = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];
        if (!t.includes('integer')) continue;
        if (typeof propSchema.minimum === 'number') {
          record(`boundary-below-minimum:${propName}`, { ...minimal, [propName]: propSchema.minimum - 1 }, false);
          record(`boundary-at-minimum:${propName}`, { ...minimal, [propName]: propSchema.minimum }, true);
        }
        if (typeof propSchema.maximum === 'number') {
          record(`boundary-above-maximum:${propName}`, { ...minimal, [propName]: propSchema.maximum + 1 }, false);
          record(`boundary-at-maximum:${propName}`, { ...minimal, [propName]: propSchema.maximum }, true);
        }
      }
      for (const [propName, propSchema] of Object.entries(properties)) {
        const t = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];
        if (t.includes('null')) record(`nullable-accepts-null:${propName}`, { ...minimal, [propName]: null }, true);
      }

      assert.strictEqual(failures.length, 0, failures.join('\n'));
    });
  }
});

describe('McpElicitation* direct coverage (all 22 variants actually executed, valid + invalid)', () => {
  const MCP_ELICITATION_NAMES = Object.keys(bundle.definitions).filter((n) => n.startsWith('McpElicitation'));

  test('exactly 22 McpElicitation* definitions exist and are all generated', () => {
    assert.strictEqual(MCP_ELICITATION_NAMES.length, 22);
    for (const n of MCP_ELICITATION_NAMES) assert.strictEqual(typeof generated.definitions[n], 'function', `${n} missing from generated.definitions`);
  });

  function pickInvalidMutationForDefinition(schema, validFixture) {
    if (schema.type === 'object' && Array.isArray(schema.required) && schema.required.length > 0 && validFixture && typeof validFixture === 'object' && !Array.isArray(validFixture)) {
      const req = schema.required[0];
      const mutated = { ...validFixture };
      delete mutated[req];
      return mutated;
    }
    const incompatible = pickIncompatibleValue(schema);
    if (incompatible !== UNCONSTRAINED) return incompatible;
    return 42;
  }

  for (const name of MCP_ELICITATION_NAMES) {
    test(`${name}: minimal-valid accepted, derived-invalid rejected`, () => {
      const schema = bundle.definitions[name].schema;
      const validFixture = buildMinimal(schema);
      assert.strictEqual(generated.definitions[name](validFixture), true, `own minimal-valid fixture rejected: ${JSON.stringify(validFixture)}`);
      const invalidFixture = pickInvalidMutationForDefinition(schema, validFixture);
      assert.strictEqual(generated.definitions[name](invalidFixture), false, `derived invalid mutation wrongly accepted: ${JSON.stringify(invalidFixture)}`);
    });
  }
});

describe('format-boundary cases (7 pinned format transformations, concrete values, 3-way where meaningful)', () => {
  function checkFormatValue(defName, oneOfIdx, mutateFn, expectedBundleAndGenerated, expectedRaw) {
    const baseSchema = oneOfIdx === null ? bundle.definitions[defName].schema : bundle.definitions[defName].schema.oneOf[oneOfIdx];
    const fixture = mutateFn(buildMinimal(baseSchema));
    const rBundle = bundleAjv.getSchema(defName)(fixture);
    const rGen = generated.definitions[defName](fixture);
    const rawValidator = rawAjv.getSchema(defName);
    assert.ok(rawValidator, `${defName} not found in the raw oracle`);
    const rRaw = rawValidator(fixture);
    assert.strictEqual(rBundle, rGen, `bundle/generated disagree for ${defName}: bundle=${rBundle} generated=${rGen} fixture=${JSON.stringify(fixture)}`);
    assert.strictEqual(rBundle, expectedBundleAndGenerated, `expected bundle/generated=${expectedBundleAndGenerated}, got ${rBundle} fixture=${JSON.stringify(fixture)}`);
    assert.strictEqual(rRaw, expectedRaw, `expected RAW oracle=${expectedRaw}, got ${rRaw} (documented expectation, not agreement-only) fixture=${JSON.stringify(fixture)}`);
  }

  test('double: fractional/null accepted, non-number rejected (McpElicitationNumberSchema.default)', () => {
    checkFormatValue('McpElicitationNumberSchema', null, (f) => ({ ...f, default: 3.14 }), true, true);
    checkFormatValue('McpElicitationNumberSchema', null, (f) => ({ ...f, default: null }), true, true);
    checkFormatValue('McpElicitationNumberSchema', null, (f) => ({ ...f, default: 'not-a-number' }), false, false);
  });

  test('int32: both bounds enforced identically by raw ajv-formats (SubAgentSource.thread_spawn.depth)', () => {
    const withDepth = (f, depth) => ({ ...f, thread_spawn: { ...f.thread_spawn, depth } });
    checkFormatValue('SubAgentSource', 1, (f) => withDepth(f, -2147483648), true, true);
    checkFormatValue('SubAgentSource', 1, (f) => withDepth(f, -2147483649), false, false);
    checkFormatValue('SubAgentSource', 1, (f) => withDepth(f, 2147483647), true, true);
    checkFormatValue('SubAgentSource', 1, (f) => withDepth(f, 2147483648), false, false);
    checkFormatValue('SubAgentSource', 1, (f) => withDepth(f, 3.14), false, false);
  });

  test('int64: integer-ness only, no numeric bound (Thread.createdAt)', () => {
    checkFormatValue('Thread', null, (f) => ({ ...f, createdAt: 1700000000 }), true, true);
    checkFormatValue('Thread', null, (f) => ({ ...f, createdAt: 3.14 }), false, false);
  });

  test('uint: pre-existing minimum:0, no synthesized upper bound (ByteRange.end)', () => {
    checkFormatValue('ByteRange', null, (f) => ({ ...f, end: 0 }), true, true);
    checkFormatValue('ByteRange', null, (f) => ({ ...f, end: -1 }), false, false);
    checkFormatValue('ByteRange', null, (f) => ({ ...f, end: 999999999 }), true, true);
  });

  test('uint16: SYNTHESIZED maximum:65535 is a documented raw-divergence (CodexErrorInfo.httpConnectionFailed.httpStatusCode)', () => {
    const withCode = (f, code) => ({ ...f, httpConnectionFailed: { ...f.httpConnectionFailed, httpStatusCode: code } });
    checkFormatValue('CodexErrorInfo', 1, (f) => withCode(f, 0), true, true);
    checkFormatValue('CodexErrorInfo', 1, (f) => withCode(f, -1), false, false);
    checkFormatValue('CodexErrorInfo', 1, (f) => withCode(f, 65535), true, true);
    checkFormatValue('CodexErrorInfo', 1, (f) => withCode(f, 65536), false, true); // documented divergence: raw has no such bound
    checkFormatValue('CodexErrorInfo', 1, (f) => withCode(f, null), true, true);
  });

  test('uint32: SYNTHESIZED maximum:4294967295 is a documented raw-divergence (MemoryCitationEntry.lineEnd)', () => {
    checkFormatValue('MemoryCitationEntry', null, (f) => ({ ...f, lineEnd: 0 }), true, true);
    checkFormatValue('MemoryCitationEntry', null, (f) => ({ ...f, lineEnd: -1 }), false, false);
    checkFormatValue('MemoryCitationEntry', null, (f) => ({ ...f, lineEnd: 4294967295 }), true, true);
    checkFormatValue('MemoryCitationEntry', null, (f) => ({ ...f, lineEnd: 4294967296 }), false, true); // documented divergence
  });

  test('uint64: pre-existing minimum:0, no synthesized upper bound (ThreadItem[13:Sleep].durationMs)', () => {
    checkFormatValue('ThreadItem', 13, (f) => ({ ...f, durationMs: 0 }), true, true);
    checkFormatValue('ThreadItem', 13, (f) => ({ ...f, durationMs: -1 }), false, false);
    checkFormatValue('ThreadItem', 13, (f) => ({ ...f, durationMs: Number.MAX_SAFE_INTEGER }), true, true);
  });
});

describe('named regressions (must never re-open)', () => {
  test('the original Turn.durationMs P0 finding stays rejected by all 3 oracles; a genuinely valid Turn stays accepted', () => {
    const validTurn = { id: 't1', status: 'completed', items: [] };
    const invalidTurn = { id: 't1', status: 'completed', items: [], durationMs: 'not-a-number' };
    const rawTurnValidator = rawAjv.getSchema('Turn');
    assert.ok(rawTurnValidator, 'Turn missing from raw oracle');
    assert.strictEqual(rawTurnValidator(invalidTurn), false);
    assert.strictEqual(bundleAjv.getSchema('Turn')(invalidTurn), false);
    assert.strictEqual(generated.definitions.Turn(invalidTurn), false);
    assert.strictEqual(rawTurnValidator(validTurn), true);
    assert.strictEqual(bundleAjv.getSchema('Turn')(validTurn), true);
    assert.strictEqual(generated.definitions.Turn(validTurn), true);
  });

  test('the original SR nested-validation asymmetries stay fixed (valid-omitting-optionals accepted; invalid-nested rejected)', () => {
    const validExecOmittingOptionals = { callId: 'c', conversationId: 'cv', cwd: '/x', command: ['ls'], parsedCmd: [{ cmd: 'ls', type: 'unknown' }] };
    assert.strictEqual(bundleOracleRoots['base::ExecCommandApprovalParams'](validExecOmittingOptionals), true);
    assert.strictEqual(generated.roots['base::ExecCommandApprovalParams'](validExecOmittingOptionals), true);

    const invalidNestedProposedAmendment = { threadId: 't', turnId: 'tu', itemId: 'i', startedAtMs: 1700000000000, environmentId: null, proposedExecpolicyAmendment: 42 };
    assert.strictEqual(bundleOracleRoots['base::CommandExecutionRequestApprovalParams'](invalidNestedProposedAmendment), false);
    assert.strictEqual(generated.roots['base::CommandExecutionRequestApprovalParams'](invalidNestedProposedAmendment), false);
  });
});
