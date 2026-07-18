#!/usr/bin/env node
'use strict';
// generate-c2-schema-validators.cjs -- R13-corrected, self-contained.
//
// Contains BOTH the bundle-extraction/build logic (previously a separate
// build-c2-schema-bundle.cjs script -- merged here per R12 point C, and now
// formally SUPERSEDED, see build-c2-schema-bundle.cjs.superseded-by-r12)
// AND the Ajv-compile/standalone-codegen step.
//
// R13 point B: TWO EXPLICIT MODES, never conflated:
//
//   1. "bundle-in" mode (the DEFAULT -- what a clean checkout uses):
//        node generate-c2-schema-validators.cjs \
//          --repo-root <path> [--bundle-in <path>] [--generated-out <path>] \
//          [--ajv-path <path>] [--check]
//      Reads an ALREADY-TRACKED bundle (c2-schema-bundle.json) and either
//      regenerates c2-schema-validators.generated.cjs from it, or (with
//      --check) verifies the existing generated-out is byte-identical to
//      what regenerating from bundle-in would produce -- WITHOUT writing
//      anything. This mode NEVER references --source-schema-dir and NEVER
//      reads anything under .planning: it is the mode a fresh checkout
//      with only the tracked bundle+generator+ajv dependency must be able
//      to run (R13 finding #2: the R12 generator silently defaulted
//      --source-schema-dir to a non-existent .r12-rehearsal-source-schema
//      path even in this mode -- that default is REMOVED; this mode simply
//      never looks at source-schema-dir at all).
//
//   2. "refresh-from-source" mode (explicit opt-in, the ONLY mode that
//      touches a live schema capture):
//        node generate-c2-schema-validators.cjs --refresh-from-source \
//          --source-schema-dir <path> \
//          [--expected-schema-fingerprint <hash>] [--expected-schema-count <n>] \
//          --repo-root <path> [--bundle-out <path>] [--generated-out <path>] \
//          [--ajv-path <path>]
//      --source-schema-dir is REQUIRED with NO default/fallback in this
//      mode (R13 finding #2, again -- an omitted flag is a hard argument
//      error, never a silent guess). Before building or writing ANYTHING,
//      this mode computes the ACTUAL fingerprint/count of the received
//      --source-schema-dir using the exact same algorithm as
//      prep/gc-verify.cjs's own liveSchemaFp() (R13 point A1) and verifies
//      it against --expected-schema-fingerprint/--expected-schema-count
//      (R13 point A2) -- the bundle's own provenance block records ONLY
//      this actually-computed value, never a bare literal disconnected
//      from a real re-derivation (R13 finding #1: the R12 generator wrote
//      the pinned fingerprint/count as unaccredited literals and NEVER
//      computed or checked them against the received corpus -- a
//      description-only mutation of a source file produced a bundle that
//      still falsely claimed the official fingerprint, exit 0).
//
// Neither mode assumes __dirname co-location for its outputs -- every path
// is either explicitly supplied or derived from --repo-root.
//
// B4 (no false atomicity-of-the-PAIR claim): bundle-out and generated-out
// are two INDEPENDENT atomic renames, not one atomic transaction covering
// both. "bundle-in --check" is the deterministic mechanism that detects a
// cross/inconsistent pair (bundle and generated drifted apart, e.g. one
// was hand-edited or restored from a different revision) -- it does not
// rely on trusting that both writes landed together.
//
// FAIL-CLOSED (R12 point B, unchanged by R13): the walker visits EVERY
// subschema position (properties, patternProperties, definitions, items in
// both object and array form, additionalProperties/additionalItems object
// form, propertyNames, contains, if/then/else, not, oneOf/anyOf/allOf) and
// throws on any keyword or format outside the declared allowlists. There
// is NO strict:false fallback: any strict:true compile failure is a hard,
// non-zero-exit failure with NO output written -- strict:false may only
// ever be used as an in-memory diagnostic, never to emit an accepted
// artifact. Outputs are written ONLY after every validation step
// succeeds, via write-to-temp-then-rename (atomic on the same filesystem,
// and never leaves a partially-written or stale-but-half-updated file in
// place of a prior valid one).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================== ARG PARSING ==============================
const BOOLEAN_FLAGS = new Set(['refresh-from-source', 'check']);
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (BOOLEAN_FLAGS.has(key)) { out[key] = true; continue; }
      const val = argv[i + 1];
      out[key] = val;
      i++;
    }
  }
  return out;
}

// R13 point A: these are EXPECTATIONS to verify a freshly-computed value
// against, never a value written to the bundle without passing through
// that comparison first (see computeSourceProvenance()/main()'s refresh
// branch). Overridable via --expected-schema-fingerprint/--count for
// deliberate mutation testing.
const DEFAULT_EXPECTED_SCHEMA_FINGERPRINT = 'dfdbacfa269b089e7b33617f3845c924c30510be0f8cd15cf324dd170ba013cd';
const DEFAULT_EXPECTED_SCHEMA_COUNT = 267;

// R13 point B: two mutually exclusive, explicit modes -- see file header.
function resolvePaths(args) {
  const repoRoot = args['repo-root'] ? path.resolve(args['repo-root']) : null;
  const mode = args['refresh-from-source'] ? 'refresh-from-source' : 'bundle-in';

  const bundleOut = args['bundle-out'] ? path.resolve(args['bundle-out']) : (repoRoot ? path.join(repoRoot, 'scripts', 'lib', 'schema', 'c2-schema-bundle.json') : null);
  const generatedOut = args['generated-out'] ? path.resolve(args['generated-out']) : (repoRoot ? path.join(repoRoot, 'scripts', 'lib', 'generated', 'c2-schema-validators.generated.cjs') : null);
  const ajvPath = args['ajv-path'] ? path.resolve(args['ajv-path']) : (repoRoot ? path.join(repoRoot, 'mcp-server', 'node_modules', 'ajv') : null);

  if (mode === 'refresh-from-source') {
    // R13 finding #2: NO default/fallback for source-schema-dir, ever -- an
    // omitted flag in this mode is a hard argument error.
    if (!args['source-schema-dir']) {
      throw new Error('--refresh-from-source requires an explicit --source-schema-dir (no default: a live schema capture is never itself tracked).');
    }
    const sourceSchemaDir = path.resolve(args['source-schema-dir']);
    const expectedFingerprint = args['expected-schema-fingerprint'] || DEFAULT_EXPECTED_SCHEMA_FINGERPRINT;
    const expectedCount = args['expected-schema-count'] ? parseInt(args['expected-schema-count'], 10) : DEFAULT_EXPECTED_SCHEMA_COUNT;
    if (!bundleOut || !generatedOut || !ajvPath) {
      throw new Error('Missing required path(s) for --refresh-from-source: supply --repo-root, or all of --bundle-out/--generated-out/--ajv-path explicitly.');
    }
    return { mode, sourceSchemaDir, bundleOut, generatedOut, ajvPath, expectedFingerprint, expectedCount };
  }

  // bundle-in mode: NEVER touches source-schema-dir, NEVER assumes .planning.
  const bundleIn = args['bundle-in'] ? path.resolve(args['bundle-in']) : bundleOut;
  if (!bundleIn || !generatedOut || !ajvPath) {
    throw new Error('Missing required path(s) for bundle-in mode: supply --repo-root, or all of --bundle-in/--generated-out/--ajv-path explicitly.');
  }
  // R14 point B: bundle-in mode ALSO validates the bundle's own declared
  // provenance against these same expectations (overridable for
  // deliberate mutation testing, exactly like refresh-from-source mode).
  const expectedFingerprint = args['expected-schema-fingerprint'] || DEFAULT_EXPECTED_SCHEMA_FINGERPRINT;
  const expectedCount = args['expected-schema-count'] ? parseInt(args['expected-schema-count'], 10) : DEFAULT_EXPECTED_SCHEMA_COUNT;
  return { mode, bundleIn, generatedOut, ajvPath, check: !!args['check'], expectedFingerprint, expectedCount };
}

// ====================== ROOT/DEFINITION CATALOG (R12 point D: direction as a SET) ======================
const INBOUND_ROOTS = [
  { name: 'InitializeResponse', ns: 'v1', file: 'v1/InitializeResponse.json' },
  { name: 'LoginAccountResponse', ns: 'v2', file: 'v2/LoginAccountResponse.json' },
  { name: 'ThreadStartResponse', ns: 'v2', file: 'v2/ThreadStartResponse.json' },
  { name: 'ThreadResumeResponse', ns: 'v2', file: 'v2/ThreadResumeResponse.json' },
  { name: 'TurnStartResponse', ns: 'v2', file: 'v2/TurnStartResponse.json' },
  { name: 'TurnInterruptResponse', ns: 'v2', file: 'v2/TurnInterruptResponse.json' },
  { name: 'ThreadArchiveResponse', ns: 'v2', file: 'v2/ThreadArchiveResponse.json' },
  { name: 'TurnStartedNotification', ns: 'v2', file: 'v2/TurnStartedNotification.json' },
  { name: 'TurnCompletedNotification', ns: 'v2', file: 'v2/TurnCompletedNotification.json' },
  { name: 'AccountUpdatedNotification', ns: 'v2', file: 'v2/AccountUpdatedNotification.json' },
  { name: 'ChatgptAuthTokensRefreshParams', ns: 'base', file: 'ChatgptAuthTokensRefreshParams.json' },
  { name: 'ApplyPatchApprovalParams', ns: 'base', file: 'ApplyPatchApprovalParams.json' },
  { name: 'AttestationGenerateParams', ns: 'base', file: 'AttestationGenerateParams.json' },
  { name: 'ExecCommandApprovalParams', ns: 'base', file: 'ExecCommandApprovalParams.json' },
  { name: 'CommandExecutionRequestApprovalParams', ns: 'base', file: 'CommandExecutionRequestApprovalParams.json' },
  { name: 'FileChangeRequestApprovalParams', ns: 'base', file: 'FileChangeRequestApprovalParams.json' },
  { name: 'PermissionsRequestApprovalParams', ns: 'base', file: 'PermissionsRequestApprovalParams.json' },
  { name: 'DynamicToolCallParams', ns: 'base', file: 'DynamicToolCallParams.json' },
  { name: 'ToolRequestUserInputParams', ns: 'base', file: 'ToolRequestUserInputParams.json' },
  { name: 'McpServerElicitationRequestParams', ns: 'base', file: 'McpServerElicitationRequestParams.json' },
  { name: 'JSONRPCResponse', ns: 'base', file: 'JSONRPCResponse.json' },
  { name: 'JSONRPCError', ns: 'base', file: 'JSONRPCError.json' },
  { name: 'JSONRPCRequest', ns: 'base', file: 'JSONRPCRequest.json' },
  { name: 'JSONRPCNotification', ns: 'base', file: 'JSONRPCNotification.json' },
];
const OUTBOUND_ROOTS = [
  { name: 'InitializeParams', ns: 'v1', file: 'v1/InitializeParams.json', producedBy: 'initialize() request' },
  { name: 'LoginAccountParams', ns: 'v2', file: 'v2/LoginAccountParams.json', producedBy: 'login() request' },
  { name: 'ThreadStartParams', ns: 'v2', file: 'v2/ThreadStartParams.json', producedBy: 'threadStart() request' },
  { name: 'ThreadResumeParams', ns: 'v2', file: 'v2/ThreadResumeParams.json', producedBy: 'threadResume() request' },
  { name: 'TurnStartParams', ns: 'v2', file: 'v2/TurnStartParams.json', producedBy: 'turnStart() request' },
  { name: 'TurnInterruptParams', ns: 'v2', file: 'v2/TurnInterruptParams.json', producedBy: 'turnInterrupt() request' },
  { name: 'ThreadArchiveParams', ns: 'v2', file: 'v2/ThreadArchiveParams.json', producedBy: 'threadArchive() request' },
  { name: 'ChatgptAuthTokensRefreshResponse', ns: 'base', file: 'ChatgptAuthTokensRefreshResponse.json', producedBy: 'SR-01 success reply' },
  { name: 'ApplyPatchApprovalResponse', ns: 'base', file: 'ApplyPatchApprovalResponse.json', producedBy: 'SR-02 frozen reply' },
  { name: 'ExecCommandApprovalResponse', ns: 'base', file: 'ExecCommandApprovalResponse.json', producedBy: 'SR-04 frozen reply' },
  { name: 'CommandExecutionRequestApprovalResponse', ns: 'base', file: 'CommandExecutionRequestApprovalResponse.json', producedBy: 'SR-05 frozen reply' },
  { name: 'FileChangeRequestApprovalResponse', ns: 'base', file: 'FileChangeRequestApprovalResponse.json', producedBy: 'SR-06 frozen reply' },
  { name: 'PermissionsRequestApprovalResponse', ns: 'base', file: 'PermissionsRequestApprovalResponse.json', producedBy: 'SR-07 frozen reply' },
  { name: 'DynamicToolCallResponse', ns: 'base', file: 'DynamicToolCallResponse.json', producedBy: 'SR-08 frozen reply' },
  { name: 'ToolRequestUserInputResponse', ns: 'base', file: 'ToolRequestUserInputResponse.json', producedBy: 'SR-09 frozen reply' },
  { name: 'McpServerElicitationRequestResponse', ns: 'base', file: 'McpServerElicitationRequestResponse.json', producedBy: 'SR-10 frozen reply' },
  // R12 point D: the 4 dual-direction envelope types -- C2 both RECEIVES
  // frames shaped like these (as INBOUND_ROOTS above already lists) AND
  // SENDS frames of these same shapes (its own outbound requests use the
  // JSONRPCRequest envelope; its own SR replies use JSONRPCResponse/Error).
  { name: 'JSONRPCRequest', ns: 'base', file: 'JSONRPCRequest.json', producedBy: 'every outbound RPC request envelope (initialize/thread.start/etc.)' },
  { name: 'JSONRPCResponse', ns: 'base', file: 'JSONRPCResponse.json', producedBy: 'every outbound SR success reply envelope' },
  { name: 'JSONRPCError', ns: 'base', file: 'JSONRPCError.json', producedBy: 'every outbound SR error reply envelope' },
  // R13 finding (E5): "C2 sends no notifications" was FALSE -- verified
  // directly against scripts/lib/runtime-bridge-codex.cjs, which writes
  // `{ method: 'initialized', params: {} }` (no `id` field: a genuine
  // JSON-RPC notification, not a request) immediately after accrediting
  // the initialize response. C2 both receives server-originated
  // notifications (turn/started, turn/completed, etc.) AND sends this one
  // of its own -- a real dual-direction envelope, not merely "for symmetry".
  { name: 'JSONRPCNotification', ns: 'base', file: 'JSONRPCNotification.json', producedBy: "the initialized notification (method:'initialized', params:{}, no id) written by runtime-bridge-codex.cjs immediately after the initialize response is accredited -- see writeJsonlFrame(stdin,{method:'initialized',params:{}},...)" },
];
const DUAL_DIRECTION_NAMES = new Set(['JSONRPCRequest', 'JSONRPCResponse', 'JSONRPCError', 'JSONRPCNotification']);

// ============================== FORMAT TRANSFORMS (7, fail-closed on an 8th) ==============================
const FORMAT_TRANSFORMS = {
  double: (schema) => { delete schema.format; },
  int32: (schema) => {
    delete schema.format;
    if (schema.minimum === undefined) schema.minimum = -2147483648;
    if (schema.maximum === undefined) schema.maximum = 2147483647;
  },
  int64: (schema) => { delete schema.format; },
  uint: (schema) => {
    delete schema.format;
    if (schema.minimum === undefined) throw new Error('uint format stripped but no pre-existing minimum found');
  },
  uint16: (schema) => {
    delete schema.format;
    if (schema.minimum === undefined) throw new Error('uint16 format stripped but no pre-existing minimum found');
    if (schema.maximum === undefined) schema.maximum = 65535;
  },
  uint32: (schema) => {
    delete schema.format;
    if (schema.minimum === undefined) throw new Error('uint32 format stripped but no pre-existing minimum found');
    if (schema.maximum === undefined) schema.maximum = 4294967295;
  },
  uint64: (schema) => {
    delete schema.format;
    if (schema.minimum === undefined) throw new Error('uint64 format stripped but no pre-existing minimum found');
  },
};
const KNOWN_STRUCTURAL_KEYWORDS = new Set([
  '$schema', '$ref', 'title', 'description', 'type', 'required', 'properties',
  'items', 'oneOf', 'anyOf', 'allOf', 'enum', 'additionalProperties', 'default',
  'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'definitions', 'format', 'const', 'nullable', 'exclusiveMinimum', 'exclusiveMaximum',
  'pattern', 'additionalItems', 'uniqueItems', 'minProperties', 'maxProperties',
  'propertyNames', 'patternProperties', 'if', 'then', 'else', 'not', 'contains',
]);

// ============================== COMPREHENSIVE WALKER (R12 point B1) ==============================
// Visits EVERY position that can hold a subschema: properties,
// patternProperties, definitions, items (object AND array form),
// additionalProperties (object form -- boolean form holds no subschema),
// additionalItems (object form), propertyNames, contains, if/then/else,
// not, oneOf/anyOf/allOf. Throws on any keyword outside the allowlist, or
// any format outside the 7 declared transforms, wherever it appears --
// including nested arbitrarily deep under if/then/else/not/contains, not
// merely the positions the R11 walker happened to cover.
function transformSchemaNode(node, loc, transformLog) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  for (const k of Object.keys(node)) {
    if (!KNOWN_STRUCTURAL_KEYWORDS.has(k)) {
      throw new Error(`FAIL-CLOSED: unrecognized JSON-Schema keyword "${k}" at ${loc} -- no declared transformation, refusing to silently pass through.`);
    }
  }
  if (typeof node.format === 'string') {
    const fmt = node.format;
    if (!FORMAT_TRANSFORMS[fmt]) {
      throw new Error(`FAIL-CLOSED: format "${fmt}" at ${loc} is not one of the 7 declared transformations -- refusing to silently pass through an 8th format.`);
    }
    const before = JSON.stringify(node);
    FORMAT_TRANSFORMS[fmt](node);
    if (transformLog) transformLog.push({ loc, format: fmt, before, after: JSON.stringify(node) });
  }
  if (node.properties) for (const [pn, ps] of Object.entries(node.properties)) transformSchemaNode(ps, loc + '.properties.' + pn, transformLog);
  if (node.patternProperties) for (const [pn, ps] of Object.entries(node.patternProperties)) transformSchemaNode(ps, loc + '.patternProperties.' + pn, transformLog);
  if (node.definitions) for (const [dn, ds] of Object.entries(node.definitions)) transformSchemaNode(ds, loc + '.definitions.' + dn, transformLog);
  if (node.items) {
    if (Array.isArray(node.items)) node.items.forEach((it, i) => transformSchemaNode(it, loc + '.items[' + i + ']', transformLog));
    else if (typeof node.items === 'object') transformSchemaNode(node.items, loc + '.items', transformLog);
  }
  if (node.additionalItems && typeof node.additionalItems === 'object') transformSchemaNode(node.additionalItems, loc + '.additionalItems', transformLog);
  if (node.additionalProperties && typeof node.additionalProperties === 'object') transformSchemaNode(node.additionalProperties, loc + '.additionalProperties', transformLog);
  if (node.propertyNames && typeof node.propertyNames === 'object') transformSchemaNode(node.propertyNames, loc + '.propertyNames', transformLog);
  if (node.contains && typeof node.contains === 'object') transformSchemaNode(node.contains, loc + '.contains', transformLog);
  if (node.if && typeof node.if === 'object') transformSchemaNode(node.if, loc + '.if', transformLog);
  if (node.then && typeof node.then === 'object') transformSchemaNode(node.then, loc + '.then', transformLog);
  if (node.else && typeof node.else === 'object') transformSchemaNode(node.else, loc + '.else', transformLog);
  if (node.not && typeof node.not === 'object') transformSchemaNode(node.not, loc + '.not', transformLog);
  for (const combinator of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(node[combinator])) node[combinator].forEach((sub, i) => transformSchemaNode(sub, loc + '.' + combinator + '[' + i + ']', transformLog));
  }
}

// ============================== PROVENANCE (R13 point A, R14-hardened) ==============================
// EXACT clone of prep/gc-verify.cjs's own liveSchemaFp() algorithm: same
// aggregate-exclusion set, same relative-path walk (posix-separated), same
// "<relpath>\t<sha256(raw-bytes)>" row format, same sort, same join by
// "\n", same final sha256 of the joined buffer. This is the ONLY place in
// this file a corpus fingerprint is computed -- the bundle's own
// provenance block (below) records ONLY the value this function returns,
// never a bare literal.
//
// R14 point A (TOCTOU fix): the R13 version of this function computed the
// fingerprint from one set of fs.readFileSync calls, and buildBundle()
// SEPARATELY re-read the same files a second time to construct the actual
// bundle content -- a genuine time-of-check-to-time-of-use race. Codex
// reproduced it directly: mutate a root file's bytes BETWEEN the
// provenance computation and the bundle build, and the bundle ends up
// declaring the OLD (pre-mutation) fingerprint while actually containing
// the NEW (mutated) bytes. Fixed by capturing every file's raw Buffer
// ONCE, right here, during the same walk that computes the fingerprint --
// the returned `snapshot` Map is the ONLY source of file content
// buildBundle() is now permitted to use; it performs zero fs.readFileSync
// calls of its own against sourceSchemaDir.
const AGGREGATE_SCHEMA_FILENAMES = new Set([
  'codex_app_server_protocol.schemas.json',
  'codex_app_server_protocol.v2.schemas.json',
]);
function computeSourceProvenance(sourceSchemaDir) {
  const snapshot = new Map(); // relpath -> raw Buffer, captured EXACTLY ONCE, here.
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith('.json') && !AGGREGATE_SCHEMA_FILENAMES.has(entry.name)) {
        const rel = path.relative(sourceSchemaDir, abs).split(path.sep).join('/');
        snapshot.set(rel, fs.readFileSync(abs)); // the ONE and ONLY read of this file's bytes.
      }
    }
  })(sourceSchemaDir);
  const files = [...snapshot.keys()];
  const rows = files.map((rel) => `${rel}\t${crypto.createHash('sha256').update(snapshot.get(rel)).digest('hex')}`).sort();
  const fingerprint = crypto.createHash('sha256').update(Buffer.from(rows.join('\n'))).digest('hex');
  return { fingerprint, count: files.length, snapshot };
}

// R14 point B/D2: hash of THIS SCRIPT's own current source -- embedded
// into every bundle it builds (generator_sha256), and re-derived at
// bundle-in-consumption time to confirm the bundle was built by the
// EXACT generator version now trying to use it (a genuine cross-version
// pair is a real inconsistency, not a false positive: a tracked bundle and
// the generator that produced it are meant to travel together in the same
// commit).
function computeSelfSha256() {
  return crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
}

// ============================== BUNDLE BUILD ==============================
function canonicalStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalStringify(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

// R14 point A3/A5: buildBundle takes ONLY the provenance object (whose
// `.snapshot` Map is the sole source of file bytes) -- it is now
// STRUCTURALLY incapable of reading sourceSchemaDir a second time, not
// merely disciplined not to. The description-only and count-drift
// mutation tests from R13 remain valid and are re-verified this round
// (they mutate the corpus BEFORE computeSourceProvenance ever captures
// its snapshot, so they still correctly fail the provenance gate in
// main() before buildBundle is ever called at all).
function buildBundle(provenance) {
  const transformLog = [];
  function loadRoot(root, direction) {
    const buf = provenance.snapshot.get(root.file);
    if (!buf) {
      throw new Error(`FAIL-CLOSED: root file "${root.file}" is not present in the provenance snapshot -- refusing to read it separately, which would reopen the exact TOCTOU race this snapshot exists to close.`);
    }
    const raw = JSON.parse(buf.toString('utf8'));
    // R14 point D3: keep a PRISTINE pre-transform copy for the raw-conflict
    // check below, before transformSchemaNode mutates `raw` in place.
    const rawSchema = JSON.parse(JSON.stringify(raw));
    transformSchemaNode(raw, `${direction}:${root.ns}::${root.name}`, transformLog);
    return { ...root, schema: raw, rawSchema, direction };
  }
  // R12 point D: direction is a SET (array) per root -- the 4 dual roots get BOTH.
  const rootDirections = new Map(); // "ns::name" -> Set(directions)
  const rootSchemas = new Map(); // "ns::name" -> loaded schema (first occurrence; verified identical below)
  const allLoads = [];
  for (const r of INBOUND_ROOTS) allLoads.push(loadRoot(r, 'INBOUND_RUNTIME'));
  for (const r of OUTBOUND_ROOTS) allLoads.push(loadRoot(r, 'OUTBOUND_PRODUCED'));

  // R14 point D3: detect conflicts in the RAW (pre-transform) content FIRST,
  // as an independent check from the post-transform one below -- a
  // deterministic transform function should never create or hide a
  // conflict, but this is defense-in-depth rather than an assumption.
  const rawConflicts = [];
  const rawRootSeen = new Map();
  for (const loaded of allLoads) {
    const key = `${loaded.ns}::${loaded.name}`;
    if (!rawRootSeen.has(key)) rawRootSeen.set(key, loaded);
    else if (JSON.stringify(rawRootSeen.get(key).rawSchema) !== JSON.stringify(loaded.rawSchema)) {
      rawConflicts.push({ key, note: 'same root name+namespace loaded twice with DIFFERING RAW (pre-transform) content across direction categories' });
    }
  }
  const rawDefConflicts = [];
  const rawDefsSeen = new Map();
  for (const loaded of allLoads) {
    for (const [defName, defValue] of Object.entries(loaded.rawSchema.definitions || {})) {
      const serialized = JSON.stringify(defValue);
      if (!rawDefsSeen.has(defName)) rawDefsSeen.set(defName, serialized);
      else if (rawDefsSeen.get(defName) !== serialized) rawDefConflicts.push({ name: defName, note: 'RAW (pre-transform) content differs across roots' });
    }
  }
  if (rawConflicts.length > 0 || rawDefConflicts.length > 0) {
    throw new Error('FAIL-CLOSED: RAW (pre-transform) conflicts detected: ' + JSON.stringify({ rawConflicts, rawDefConflicts }));
  }

  const conflicts = [];
  for (const loaded of allLoads) {
    const key = `${loaded.ns}::${loaded.name}`;
    if (!rootDirections.has(key)) rootDirections.set(key, new Set());
    rootDirections.get(key).add(loaded.direction);
    if (!rootSchemas.has(key)) {
      rootSchemas.set(key, loaded);
    } else {
      const existing = rootSchemas.get(key);
      if (JSON.stringify(existing.schema) !== JSON.stringify(loaded.schema)) {
        conflicts.push({ key, note: 'same root name+namespace loaded twice with DIFFERING content across direction categories' });
      }
    }
  }
  if (conflicts.length > 0) throw new Error('FAIL-CLOSED: root-level conflicts: ' + JSON.stringify(conflicts));

  // Merge every embedded definition across ALL loaded roots (both directions), verify zero conflicts.
  const mergedDefs = {};
  const defConflicts = [];
  for (const loaded of allLoads) {
    for (const [defName, defValue] of Object.entries(loaded.schema.definitions || {})) {
      const serialized = JSON.stringify(defValue);
      if (!(defName in mergedDefs)) mergedDefs[defName] = { value: defValue, serialized, sources: [`${loaded.direction}:${loaded.ns}::${loaded.name}`] };
      else {
        mergedDefs[defName].sources.push(`${loaded.direction}:${loaded.ns}::${loaded.name}`);
        if (mergedDefs[defName].serialized !== serialized) defConflicts.push({ name: defName, first: mergedDefs[defName].sources[0], conflicting: `${loaded.direction}:${loaded.ns}::${loaded.name}` });
      }
    }
  }
  if (defConflicts.length > 0) throw new Error('FAIL-CLOSED: cross-root definition conflicts: ' + JSON.stringify(defConflicts));

  // R14 point D2: merge producedBy across ALL loads sharing a root key, not
  // just whichever `loaded` object rootSchemas.entries() happens to keep as
  // the canonical schema representative (that was ALWAYS the FIRST-seen
  // one, i.e. the INBOUND_ROOTS entry for the 4 dual-direction roots --
  // none of which define a producedBy at all -- silently discarding the
  // OUTBOUND_ROOTS entry's meaningful producedBy text for those exact 4
  // keys). Collects the DISTINCT non-null producedBy strings per key: zero
  // -> null (unchanged for pure-inbound roots), exactly one -> that string
  // (unchanged for the 16 single-direction outbound roots), 2+ -> a sorted
  // array (only reachable if a future root genuinely has two DIFFERENT
  // producedBy texts across its directions).
  const producedByMap = new Map();
  for (const loaded of allLoads) {
    if (!loaded.producedBy) continue;
    const key = `${loaded.ns}::${loaded.name}`;
    if (!producedByMap.has(key)) producedByMap.set(key, new Set());
    producedByMap.get(key).add(loaded.producedBy);
  }

  const roots = {};
  for (const [key, loaded] of rootSchemas.entries()) {
    const schemaCopy = { ...loaded.schema };
    delete schemaCopy.definitions; // kept separately below; roots reference the shared pool.
    const producedBySet = producedByMap.get(key);
    const producedByList = producedBySet ? [...producedBySet].sort() : [];
    roots[key] = {
      ...schemaCopy,
      directions: [...rootDirections.get(key)].sort(),
      producedBy: producedByList.length === 0 ? null : (producedByList.length === 1 ? producedByList[0] : producedByList),
    };
  }

  // R14 point D2/B: transformation_log embedded directly in the bundle,
  // DETERMINISTIC (sorted by loc, independent of root-processing order)
  // and representing the UNION of every transform actually applied --
  // `before`/`after` full schema dumps are deliberately OMITTED (redundant
  // with the bundle's own already-embedded post-transform content); `loc`
  // + `format` is the minimal information needed to independently confirm
  // what happened and where, linked to this exact bundle via
  // generator_sha256 below.
  const transformationLog = transformLog
    .map((t) => ({ loc: t.loc, format: t.format }))
    .sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));

  const bundle = {
    schema_draft: 'http://json-schema.org/draft-07/schema#',
    provenance: {
      // R14 (honest provenance, per Codex's explicit framing): this string
      // documents the EXPECTED regeneration command -- it is NOT proof
      // this generator invoked or verified any specific codex binary. This
      // script never itself invokes the codex binary; it only reads a
      // directory some OTHER process (a human, or prep/gc-verify.cjs)
      // already populated. Schema count + fingerprint + the byte snapshot
      // captured by computeSourceProvenance() are the actual authority
      // over WHAT was captured; any binary SHA is, at most,
      // pinned-environment context recorded elsewhere (source-fingerprint.txt),
      // never a claim this script verified.
      source_regeneration_command: 'codex app-server generate-json-schema --out <dir>',
      // R13 point A3: the ACTUALLY-COMPUTED value passed in by main() --
      // ONLY reached here after main() already confirmed it matches
      // --expected-schema-fingerprint/--expected-schema-count. Never a
      // bare literal disconnected from a real re-derivation.
      source_schema_set_fingerprint: provenance.fingerprint,
      source_schema_set_file_count: provenance.count,
      formats_transformed: [...new Set(transformLog.map((t) => t.format))].sort(),
      transformation_count: transformLog.length,
      // R14 point B/D2: NEW fields, linking this bundle to the EXACT
      // generator script that built it and the deterministic transform
      // log that produced it -- validated by validateBundleContract()
      // before any future bundle-in consumption.
      transformation_log: transformationLog,
      generator_sha256: computeSelfSha256(),
    },
    roots,
    definitions: Object.fromEntries(Object.entries(mergedDefs).map(([k, v]) => [k, { schema: v.value, reachable_from: v.sources.sort() }])),
  };
  return { bundle, transformLog };
}

// ============================== TEMP+PUBLISH WRITE (R12 point B4) ==============================
function writeAtomic(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = targetPath + '.tmp-' + crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, targetPath); // atomic on the same filesystem -- never leaves a half-written file in the target's place.
}

// ============================== BUNDLE CONTRACT VALIDATION (R14 point B) ==============================
// generateValidators() below only ever reads bundle.roots/bundle.definitions
// -- it NEVER reads bundle.provenance at all. This means a bundle whose
// provenance was tampered with (e.g. the fingerprint zeroed out) would
// previously regenerate byte-identical CODE and pass --check trivially,
// exit 0 (reproduced directly this round: source_schema_set_fingerprint
// set to 64 zeros, generated file left untouched, --check still reported
// pair_consistent:true). This function is the fix: it independently
// validates the bundle's own declared provenance/shape/contract, and is
// called BEFORE any generation or comparison in bundle-in mode, both with
// and without --check.
const EXPECTED_BUNDLE_TOP_LEVEL_KEYS = ['schema_draft', 'provenance', 'roots', 'definitions'].sort();
const EXPECTED_PROVENANCE_KEYS = [
  'source_regeneration_command', 'source_schema_set_fingerprint', 'source_schema_set_file_count',
  'formats_transformed', 'transformation_count', 'transformation_log', 'generator_sha256',
].sort();
const EXPECTED_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema#';
const EXPECTED_FORMATS_TRANSFORMED = Object.keys(FORMAT_TRANSFORMS).sort();

function validateBundleContract(rawBundleText, expectedFingerprint, expectedCount) {
  let parsed;
  try {
    parsed = JSON.parse(rawBundleText);
  } catch (e) {
    throw new Error('FAIL-CLOSED (bundle contract): bundle-in is not valid JSON: ' + e.message);
  }
  // 1. Canonical byte-for-byte check -- the file on disk must BE its own
  // canonical form, not merely parse to an equivalent value (catches
  // hand-edits/reordering/whitespace tampering that JSON.parse alone would miss).
  const canonicalRoundTrip = canonicalStringify(parsed) + '\n';
  if (canonicalRoundTrip !== rawBundleText) {
    throw new Error('FAIL-CLOSED (bundle contract): bundle-in is not byte-for-byte its own canonical form (canonicalStringify round-trip differs) -- possible hand-edit or non-canonical write.');
  }
  // 2. Closed shape -- exactly the expected top-level and provenance keys, no more, no less.
  const topKeys = Object.keys(parsed).sort();
  if (JSON.stringify(topKeys) !== JSON.stringify(EXPECTED_BUNDLE_TOP_LEVEL_KEYS)) {
    throw new Error(`FAIL-CLOSED (bundle contract): unexpected top-level shape. Got ${JSON.stringify(topKeys)}, expected exactly ${JSON.stringify(EXPECTED_BUNDLE_TOP_LEVEL_KEYS)}.`);
  }
  const provKeys = Object.keys(parsed.provenance || {}).sort();
  if (JSON.stringify(provKeys) !== JSON.stringify(EXPECTED_PROVENANCE_KEYS)) {
    throw new Error(`FAIL-CLOSED (bundle contract): unexpected provenance shape. Got ${JSON.stringify(provKeys)}, expected exactly ${JSON.stringify(EXPECTED_PROVENANCE_KEYS)}.`);
  }
  // 3. schema_draft, exact fingerprint, exact count, exact 7 formats.
  if (parsed.schema_draft !== EXPECTED_SCHEMA_DRAFT) {
    throw new Error(`FAIL-CLOSED (bundle contract): schema_draft mismatch: ${parsed.schema_draft}`);
  }
  if (parsed.provenance.source_schema_set_fingerprint !== expectedFingerprint) {
    throw new Error(`FAIL-CLOSED (bundle contract): provenance fingerprint ${parsed.provenance.source_schema_set_fingerprint} !== expected ${expectedFingerprint}.`);
  }
  if (parsed.provenance.source_schema_set_file_count !== expectedCount) {
    throw new Error(`FAIL-CLOSED (bundle contract): provenance file count ${parsed.provenance.source_schema_set_file_count} !== expected ${expectedCount}.`);
  }
  const gotFormats = JSON.stringify([...(parsed.provenance.formats_transformed || [])].sort());
  const wantFormats = JSON.stringify(EXPECTED_FORMATS_TRANSFORMED);
  if (gotFormats !== wantFormats) {
    throw new Error(`FAIL-CLOSED (bundle contract): formats_transformed ${gotFormats} !== expected exactly the 7 known formats ${wantFormats}.`);
  }
  // 4. generator SHA + transformation log, per the final provenance contract (D2).
  if (!/^[0-9a-f]{64}$/.test(parsed.provenance.generator_sha256 || '')) {
    throw new Error('FAIL-CLOSED (bundle contract): provenance.generator_sha256 missing or not a well-formed sha256 hex string.');
  }
  const selfSha = computeSelfSha256();
  if (parsed.provenance.generator_sha256 !== selfSha) {
    throw new Error(`FAIL-CLOSED (bundle contract): bundle's provenance.generator_sha256 (${parsed.provenance.generator_sha256}) does not match the CURRENTLY running generator's own hash (${selfSha}) -- cross/inconsistent pair (bundle was built by a different generator version).`);
  }
  if (!Array.isArray(parsed.provenance.transformation_log)) {
    throw new Error('FAIL-CLOSED (bundle contract): provenance.transformation_log is not an array.');
  }
  if (parsed.provenance.transformation_log.length !== parsed.provenance.transformation_count) {
    throw new Error(`FAIL-CLOSED (bundle contract): transformation_log length (${parsed.provenance.transformation_log.length}) !== transformation_count (${parsed.provenance.transformation_count}).`);
  }
  for (const entry of parsed.provenance.transformation_log) {
    if (!entry || typeof entry.loc !== 'string' || typeof entry.format !== 'string' || !FORMAT_TRANSFORMS[entry.format]) {
      throw new Error('FAIL-CLOSED (bundle contract): transformation_log contains a malformed or unrecognized-format entry: ' + JSON.stringify(entry));
    }
  }
  return parsed;
}

// ============================== GENERATOR (strict:true ONLY -- R12 point B3) ==============================
function generateValidators(bundle, ajvPath) {
  const Ajv = require(ajvPath);
  const standaloneCode = require(path.join(ajvPath, 'dist', 'standalone')).default;

  // R13 (empirically found this round via a refresh-then-check round-trip,
  // not a Codex-cited finding): CANONICALIZE the incoming bundle wholesale
  // -- deep, recursive, every nesting level -- before Ajv ever sees it.
  // bundle-in mode loads bundle.json via JSON.parse, whose key order at
  // EVERY level reflects canonicalStringify's own recursive alphabetical
  // sort; refresh mode instead hands generateValidators() the FRESH
  // in-memory object straight out of buildBundle(), whose key order at
  // every level (top-level definitions/roots AND every nested `properties`
  // object, oneOf branch, etc.) follows array-processing / object-literal
  // construction order instead. Ajv's standalone codegen output is
  // sensitive to iteration order at ALL of these levels, not just the
  // top one -- an earlier fix that only sorted the top-level
  // definitions/roots entries was NOT sufficient (verified empirically: a
  // fresh refresh-from-source run still failed its own immediate --check).
  // Round-tripping through canonicalStringify (the exact function used to
  // write bundle.json to disk) and back guarantees BOTH code paths always
  // hand Ajv byte-identical input structure for byte-identical logical
  // content, at every level, by construction.
  bundle = JSON.parse(canonicalStringify(bundle));

  function rewriteRefs(node) {
    if (Array.isArray(node)) { node.forEach(rewriteRefs); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/definitions/')) node.$ref = node.$ref.slice('#/definitions/'.length);
    for (const v of Object.values(node)) rewriteRefs(v);
  }

  const flatDefinitions = {};
  for (const [name, entry] of Object.entries(bundle.definitions)) {
    const schema = JSON.parse(JSON.stringify(entry.schema));
    rewriteRefs(schema);
    flatDefinitions[name] = schema;
  }
  const flatRoots = {};
  for (const [key, rootSchema] of Object.entries(bundle.roots)) {
    const schema = JSON.parse(JSON.stringify(rootSchema));
    delete schema.directions; delete schema.producedBy;
    rewriteRefs(schema);
    flatRoots[key] = schema;
  }

  // ---- ONE attempt: strict:true. NO fallback. Any failure = throw, no output ever written. ----
  const ajv = new Ajv({ code: { source: true, esm: false }, allErrors: true, strict: true });
  for (const [name, schema] of Object.entries(flatDefinitions)) ajv.addSchema({ ...schema, $id: name });
  const compiledDefValidators = {};
  for (const name of Object.keys(flatDefinitions)) {
    const v = ajv.getSchema(name);
    if (!v) throw new Error(`FAIL-CLOSED (strict:true): getSchema("${name}") returned nothing after addSchema -- no output written.`);
    compiledDefValidators[name] = v;
  }
  const compiledRootValidators = {};
  for (const [key, schema] of Object.entries(flatRoots)) {
    const safeId = 'root__' + key.replace(/::/g, '__'); // colon-containing $id breaks Ajv's URI resolver -- verified via direct repro this session.
    compiledRootValidators[key] = ajv.compile({ ...schema, $id: safeId }); // throws directly on any strict:true incompatibility -- not caught/suppressed here.
  }

  const idsForCodegen = {};
  for (const name of Object.keys(compiledDefValidators)) idsForCodegen['def__' + name] = name;
  for (const key of Object.keys(compiledRootValidators)) idsForCodegen['root__' + key.replace(/::/g, '__')] = 'root__' + key.replace(/::/g, '__');
  let moduleCode = standaloneCode(ajv, idsForCodegen);

  // ---- Detect and inline any Ajv-internal runtime helper require() calls (see R12 point B2 mutation: "non-self-contained helper"). ----
  const RUNTIME_REQUIRE_RE = /require\("ajv\/dist\/runtime\/([a-zA-Z0-9_]+)"\)\.default/g;
  const helpersFound = new Set();
  let m;
  while ((m = RUNTIME_REQUIRE_RE.exec(moduleCode))) helpersFound.add(m[1]);
  const inlinedHelperDefs = [];
  for (const helperName of helpersFound) {
    const helperPath = path.join(ajvPath, 'dist', 'runtime', helperName + '.js');
    if (!fs.existsSync(helperPath)) throw new Error(`FAIL-CLOSED: standalone output requires ajv/dist/runtime/${helperName}, file not found -- no output written.`);
    const helperSrc = fs.readFileSync(helperPath, 'utf8');
    const helperSrcNoStringsOrComments = helperSrc.replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/require\(/.test(helperSrcNoStringsOrComments)) {
      throw new Error(`FAIL-CLOSED: runtime helper ajv/dist/runtime/${helperName}.js is not self-contained (contains its own require() outside strings/comments) -- refusing to inline a transitive dependency chain. No output written.`);
    }
    const helperExports = require(helperPath);
    const helperFn = helperExports.default || helperExports;
    if (typeof helperFn !== 'function') throw new Error(`FAIL-CLOSED: ajv/dist/runtime/${helperName}.js default export is not a function -- no output written.`);
    const localName = '__inlined_' + helperName;
    inlinedHelperDefs.push(`const ${localName} = ${helperFn.toString()};`);
    moduleCode = moduleCode.split(`require("ajv/dist/runtime/${helperName}").default`).join(localName);
  }
  if (/require\(/.test(moduleCode)) {
    throw new Error('FAIL-CLOSED: a require() call remains after helper inlining -- no output written. Remaining: ' + JSON.stringify((moduleCode.match(/require\([^)]*\)/g) || [])));
  }

  const wrapped = `'use strict';
/* GENERATED -- do not edit by hand. Produced by generate-c2-schema-validators.cjs from c2-schema-bundle.json. */
${inlinedHelperDefs.join('\n')}
function buildGenerated() {
  const exports = {};
${moduleCode}
  return exports;
}
const generated = buildGenerated();
const definitions = {};
const roots = {};
for (const key of Object.keys(generated)) {
  if (key.startsWith('def__')) definitions[key.slice(5)] = generated[key];
  else if (key.startsWith('root__')) {
    const rest = key.slice(6);
    const sepIdx = rest.indexOf('__');
    const ns = rest.slice(0, sepIdx);
    const name = rest.slice(sepIdx + 2);
    roots[ns + '::' + name] = generated[key];
  }
}
module.exports = { definitions, roots };
`;
  return { code: wrapped, defCount: Object.keys(compiledDefValidators).length, rootCount: Object.keys(compiledRootValidators).length };
}

// ============================== MAIN ==============================
function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = resolvePaths(args);

  if (resolved.mode === 'refresh-from-source') {
    const { sourceSchemaDir, bundleOut, generatedOut, ajvPath, expectedFingerprint, expectedCount } = resolved;
    if (!fs.existsSync(sourceSchemaDir)) throw new Error(`source schema dir does not exist: ${sourceSchemaDir}`);
    if (!fs.existsSync(ajvPath)) throw new Error(`ajv path does not exist: ${ajvPath}`);

    // R13 point A2: compute the REAL provenance and verify it BEFORE
    // building or writing anything -- a mismatch here means neither
    // bundleOut nor generatedOut is ever touched.
    const provenance = computeSourceProvenance(sourceSchemaDir);
    if (provenance.count !== expectedCount) {
      throw new Error(`FAIL-CLOSED (provenance): source schema file count ${provenance.count} !== expected ${expectedCount}. No bundle/generated written.`);
    }
    if (provenance.fingerprint !== expectedFingerprint) {
      throw new Error(`FAIL-CLOSED (provenance): source schema fingerprint ${provenance.fingerprint} !== expected ${expectedFingerprint}. No bundle/generated written.`);
    }

    // R14 point A3: buildBundle takes ONLY provenance -- sourceSchemaDir is
    // never passed, so it is structurally incapable of re-reading it.
    const { bundle, transformLog } = buildBundle(provenance);
    // strict:true generation happens BEFORE any file is written -- if it throws, neither bundleOut nor generatedOut is touched.
    const { code, defCount, rootCount } = generateValidators(bundle, ajvPath);

    const bundleJson = canonicalStringify(bundle) + '\n';
    writeAtomic(bundleOut, bundleJson); // independently atomic -- NOT a joint transaction with the write below (B4).
    writeAtomic(generatedOut, code);

    console.log(JSON.stringify({
      mode: 'refresh-from-source',
      provenance_verified: true, provenance_fingerprint: provenance.fingerprint, provenance_count: provenance.count,
      bundle_out: bundleOut, bundle_bytes: bundleJson.length,
      generated_out: generatedOut, generated_bytes: code.length,
      definitions: defCount, roots: rootCount,
      transform_operations: transformLog.length,
      strict_mode: true,
    }, null, 2));
    return;
  }

  // bundle-in mode (the default): never touches source-schema-dir, never reads .planning.
  const { bundleIn, generatedOut, ajvPath, check, expectedFingerprint, expectedCount } = resolved;
  if (!fs.existsSync(bundleIn)) throw new Error(`bundle-in does not exist: ${bundleIn}`);
  if (!fs.existsSync(ajvPath)) throw new Error(`ajv path does not exist: ${ajvPath}`);
  const rawBundleText = fs.readFileSync(bundleIn, 'utf8');
  // R14 point B: validate the bundle's own provenance/shape/contract BEFORE
  // any generation or comparison -- both with and without --check.
  const bundle = validateBundleContract(rawBundleText, expectedFingerprint, expectedCount);
  const { code, defCount, rootCount } = generateValidators(bundle, ajvPath);

  if (check) {
    // R13 point B4: the deterministic cross/inconsistent-pair check --
    // regenerate in-memory from the tracked bundle and byte-compare
    // against the tracked generated file. Writes nothing either way.
    if (!fs.existsSync(generatedOut)) {
      throw new Error(`FAIL-CLOSED (--check): generated-out does not exist to compare against: ${generatedOut}`);
    }
    const existing = fs.readFileSync(generatedOut, 'utf8');
    const pairConsistent = existing === code;
    console.log(JSON.stringify({
      mode: 'bundle-in --check', bundle_in: bundleIn, generated_out: generatedOut,
      pair_consistent: pairConsistent, definitions: defCount, roots: rootCount,
    }, null, 2));
    if (!pairConsistent) {
      throw new Error('FAIL-CLOSED (--check): regenerating from bundle-in does NOT byte-match the existing generated-out -- inconsistent/cross pair detected. No write performed.');
    }
    return;
  }

  writeAtomic(generatedOut, code);
  console.log(JSON.stringify({
    mode: 'bundle-in', bundle_in: bundleIn,
    generated_out: generatedOut, generated_bytes: code.length,
    definitions: defCount, roots: rootCount, strict_mode: true,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('FAIL-CLOSED:', err.message);
    process.exit(1);
  }
}

module.exports = { buildBundle, generateValidators, transformSchemaNode, canonicalStringify, parseArgs, resolvePaths, writeAtomic, computeSourceProvenance, validateBundleContract, computeSelfSha256 };
