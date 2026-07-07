#!/usr/bin/env node
// coordination-artifact.js — single-source validator for portable coordination artifacts
// (message, consult, result, request, approval, stop) under .planning/wave-<slug>/.
//
// Dual surface (one source of truth):
//   - require() API: validate(kind, filePath, ctx) -> boolean; hasValidConsult(dir, ctx) -> boolean.
//   - CLI: node coordination-artifact.js validate <kind> <file> <slug>  -> exit 0 (valid) / 2 (invalid).
//
// Fail-closed: malformed/stale/wrong-wave/wrong-role/out-of-confinement -> false, NEVER an exception.
// Only a genuine fs/runtime error (directory truly unavailable mid-scan, etc.) may propagate — the
// gate's caller (context-provider-gate.js) already runs under an outer fail-open try/catch, so a
// thrown error there is acceptable by contract. Routine "not found yet" conditions (e.g. the inbox
// directory does not exist) are NOT genuine errors — they return false like any other no-valid case.
//
// sha256File/isAncestor/isOutside are inline-replicated here (byte-identical semantics) from
// premature-execution-gate.js:52-60 / :200-201 — they are NOT exported from hook-control-plane-utils.js
// and so cannot be require()'d.
//
// Parity-exempt: this file has no .ps1 twin (precedent: resolve-required-roles.js,
// premature-execution-gate.js — script-parity only compares direct children of scripts/sh<->scripts/ps1).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ── Constants (shared contract with the coordination-artifact bats/node tests) ──────────
const CONSULT_TTL_SECONDS = 43200;          // 12h — how far in the PAST a consult may date from
const MAX_CONSULT_FUTURE_SKEW_SECONDS = 300; // 5min — how far in the FUTURE (clock skew only)
const MAX_CONSULT_HARD_CAP = 1024; // total directory entries scanned before fail-closed abort
const MAX_CONSULT_ENTRIES = 256;   // max matching candidates kept (newest-first, order-independent)
const MAX_CONSULT_BYTES = 65536;   // per-candidate size cap — oversized files are skipped, never read

// ── Inline-replicated helpers (byte-identical to premature-execution-gate.js) ────────────

// sha256 of a file's RAW BYTES — byte-for-byte match with bash sha256sum/shasum.
function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
// True iff <ancestor> is an ancestor of (or equal to) <descendant> in projectRoot git history.
function isAncestor(projectRoot, ancestor, descendant) {
  const r = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: projectRoot, timeout: 3000 });
  return r.status === 0;
}
// True iff a path resolved via path.relative(confinementDir, target) escapes that dir.
function isOutside(p) {
  return p === '..' || p.startsWith('..' + path.sep) || path.isAbsolute(p);
}
// Resolve current HEAD (40-hex) or '' — mirrors premature-execution-gate.js:48-51 (not exported,
// so replicated here for the same reason as sha256File/isAncestor above).
function getGitHead(projectRoot) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, timeout: 3000, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

// Slug-style segment sanitizer (mirrors hook-control-plane-utils.js isValidSlug) — used to sanitize
// approval's request_kind/request_id against traversal before they touch a path.join.
function isSafeSegment(s) {
  if (typeof s !== 'string' || s === '' || s === '.' || s === '..') return false;
  if (s.includes('/') || s.includes('\\')) return false;
  return /^[A-Za-z0-9._-]+$/.test(s);
}

// Read+parse a JSON file, requiring its realpath to resolve UNDER realpath(confinementDir)
// (any depth — result/request/approval/message legitimately live in nested subdirs). Returns
// null on ANY failure (missing, escape, malformed) — never throws.
function readConfinedJson(filePath, confinementDir) {
  try {
    const realFile = fs.realpathSync(filePath);
    const realDir = fs.realpathSync(confinementDir);
    const rel = path.relative(realDir, realFile);
    if (rel === '' || isOutside(rel)) return null;
    const raw = fs.readFileSync(realFile, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

// ── consult/v1 per-candidate validation (shared by validate('consult',...) and hasValidConsult) ──
//
// ctx: {slug, projectRoot, now, expectedDir?} — expectedDir lets hasValidConsult pass the already-
// known scan dir; when absent (standalone validate() call) it is derived from slug/projectRoot.
function isConsultFileValid(filePath, ctx) {
  try {
    const expectedDir = ctx.expectedDir || path.join(ctx.projectRoot, '.planning', 'wave-' + ctx.slug, 'inbox', 'context-provider');
    const realFile = fs.realpathSync(filePath);
    const realDir = fs.realpathSync(expectedDir);
    const rel = path.relative(realDir, realFile);
    // Non-recursive: candidate must be a DIRECT child of the inbox dir — reject escapes and
    // symlinks that resolve into a nested subdirectory (mirrors the "never descend" contract).
    if (rel === '' || isOutside(rel) || rel.includes(path.sep)) return false;

    const st = fs.statSync(realFile);
    if (!st.isFile()) return false;
    if (st.size > MAX_CONSULT_BYTES) return false; // oversized -> skip as invalid, do NOT read

    const raw = fs.readFileSync(realFile, 'utf8'); // bounded by the size check above
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return false;
    if (obj.schema !== 'coordination/consult/v1') return false;
    if (obj.to !== 'context-provider') return false;
    if (obj.wave_slug !== ctx.slug) return false;
    if (typeof obj.created_at !== 'string') return false;

    const createdMs = Date.parse(obj.created_at);
    if (Number.isNaN(createdMs)) return false;
    const now = (typeof ctx.now === 'number') ? ctx.now : Date.now();
    // Directional freshness (security-review hardening): a symmetric abs() check accepted
    // consults dated up to CONSULT_TTL_SECONDS in the FUTURE too (~2x the intended window).
    // Valid window is [now - TTL, now + FUTURE_SKEW] — generous in the past, tight in the future
    // (only enough future-skew to tolerate clock drift between writer and gate).
    if (now - createdMs > CONSULT_TTL_SECONDS * 1000) return false; // too old (stale)
    if (createdMs - now > MAX_CONSULT_FUTURE_SKEW_SECONDS * 1000) return false; // too far in the future

    return true;
  } catch {
    return false;
  }
}

// ── stop/v1 — presence + role match; body is OPTIONAL (flat `stop-<role>.flag`) ──────────
function isStopFileValid(filePath, ctx) {
  try {
    const realFile = fs.realpathSync(filePath);
    const realWaveDir = fs.realpathSync(ctx.waveDir);
    const rel = path.relative(realWaveDir, realFile);
    if (rel === '' || isOutside(rel) || rel.includes(path.sep)) return false; // flat: direct child only
    if (!/^stop-[A-Za-z0-9._-]+\.flag$/.test(path.basename(realFile))) return false;
    if (!fs.statSync(realFile).isFile()) return false;

    const raw = fs.readFileSync(realFile, 'utf8');
    if (raw.trim() === '') return true; // bare presence flag — valid
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      return true; // non-JSON body tolerated — presence is the signal, body is optional
    }
    if (obj && typeof obj === 'object') {
      if (obj.schema !== undefined && obj.schema !== 'coordination/stop/v1') return false;
      if (obj.wave_slug !== undefined && obj.wave_slug !== ctx.slug) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Shared base fields for post-PLAN kinds (message/result/request/approval; NOT consult) ──
// Every kind carries schema/wave_slug/from/to/created_at + head (ancestor-bound) + plan_sha256
// (matching the live PLAN.md).
function isBaseArtifactValid(obj, kind, ctx) {
  const { slug, projectRoot } = ctx;
  if (obj.schema !== 'coordination/' + kind + '/v1') return false;
  if (obj.wave_slug !== slug) return false;
  if (typeof obj.from !== 'string' || obj.from === '') return false;
  if (typeof obj.to !== 'string' || obj.to === '') return false;
  if (typeof obj.created_at !== 'string' || Number.isNaN(Date.parse(obj.created_at))) return false;

  let planHash;
  try {
    planHash = sha256File(path.join(projectRoot, '.planning', 'wave-' + slug, 'PLAN.md'));
  } catch {
    return false; // no PLAN.md on disk -> cannot verify freshness -> fail closed
  }
  if (obj.plan_sha256 !== planHash) return false;

  if (typeof obj.head !== 'string' || !/^[0-9a-f]{40}$/.test(obj.head)) return false;
  const currentHead = getGitHead(projectRoot);
  if (!/^[0-9a-f]{40}$/.test(currentHead)) return false;
  if (!isAncestor(projectRoot, obj.head, currentHead)) return false;

  return true;
}

function isResultValid(obj) {
  return obj.status === 'ready-for-review' || obj.status === 'done' || obj.status === 'blocked';
}

function isRequestValid(obj) {
  if (typeof obj.request_id !== 'string' || obj.request_id === '') return false;
  if (obj.kind === 'scope-extension' && (!Array.isArray(obj.files) || obj.files.length === 0)) return false;
  return true;
}

// approval/v1 — must resolve EXACTLY ONE confined path requests/<request_kind>/<request_id>.json
// (sanitized, realpath-confined, NO glob) and require that linked request to exist AND validate.
function isApprovalValid(obj, waveDir, ctx) {
  if (obj.decision !== 'authorized' && obj.decision !== 'denied') return false;
  if (!isSafeSegment(obj.request_id) || !isSafeSegment(obj.request_kind)) return false;

  const requestsDir = path.join(waveDir, 'requests');
  const requestPath = path.join(requestsDir, obj.request_kind, obj.request_id + '.json');
  try {
    const realRequestsDir = fs.realpathSync(requestsDir);
    const realRequest = fs.realpathSync(requestPath);
    const rel = path.relative(realRequestsDir, realRequest);
    if (rel === '' || isOutside(rel)) return false;
    if (!fs.statSync(realRequest).isFile()) return false;
    return validate('request', realRequest, ctx);
  } catch {
    return false; // linked request missing/unreadable -> approval-forge/replay guard
  }
}

// ── Public API: validate(kind, filePath, ctx) ────────────────────────────────────────────
// kind ∈ {consult, result, request, approval, stop, message}. ctx = {slug, projectRoot, now?}.
function validate(kind, filePath, ctx) {
  if (!ctx || !ctx.slug || !ctx.projectRoot) return false;
  const { slug, projectRoot } = ctx;
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + slug);

  if (kind === 'consult') {
    return isConsultFileValid(filePath, { slug, projectRoot, now: ctx.now });
  }
  if (kind === 'stop') {
    return isStopFileValid(filePath, { slug, waveDir });
  }
  if (kind === 'result' || kind === 'request' || kind === 'approval' || kind === 'message') {
    const obj = readConfinedJson(filePath, waveDir);
    if (!obj) return false;
    if (!isBaseArtifactValid(obj, kind, ctx)) return false;
    if (kind === 'result') return isResultValid(obj);
    if (kind === 'request') return isRequestValid(obj);
    if (kind === 'approval') return isApprovalValid(obj, waveDir, ctx);
    return true; // message: base fields are the whole contract
  }
  return false;
}

// Bounded top-K insert: keeps 'list' sorted ascending, evicting the smallest (oldest) once it
// exceeds 'capacity'. Small capacity (<=256) so an O(capacity) shift-insert is negligible —
// this is what makes the newest-256 selection deterministic regardless of scan/iteration order.
function insertCandidate(list, name, capacity) {
  let i = list.length;
  list.push(name);
  while (i > 0 && list[i - 1] > list[i]) {
    const tmp = list[i - 1];
    list[i - 1] = list[i];
    list[i] = tmp;
    i -= 1;
  }
  if (list.length > capacity) list.shift();
}

// ── Public API: hasValidConsult(dir, ctx) — bounded scan for the newest valid consult-*.json ──
// ctx = {slug, projectRoot, now?}.
function hasValidConsult(dir, ctx) {
  // NULL-SLUG INVARIANT (arch-platform PREP finding): centralize the guard here so every caller
  // gets it for free — no slug means no wave to scope a consult to, so never even touch disk.
  if (!ctx || !ctx.slug) return false;

  let dirHandle;
  try {
    dirHandle = fs.opendirSync(dir);
  } catch {
    return false; // dir absent/unreadable — routine "no consult yet", not a genuine error
  }

  const candidates = []; // ascending-sorted; bounded to the MAX_CONSULT_ENTRIES newest names
  let totalSeen = 0;
  try {
    let entry = dirHandle.readSync();
    while (entry !== null) {
      totalSeen += 1;
      if (totalSeen > MAX_CONSULT_HARD_CAP) {
        return false; // DoS guard — abort without inspecting this or any further entry
      }
      if (entry.isFile() && /^consult-.*\.json$/.test(entry.name)) {
        insertCandidate(candidates, entry.name, MAX_CONSULT_ENTRIES);
      }
      entry = dirHandle.readSync();
    }
  } catch {
    return false;
  } finally {
    try { dirHandle.closeSync(); } catch { /* best-effort close */ }
  }

  const now = (typeof ctx.now === 'number') ? ctx.now : Date.now();
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidatePath = path.join(dir, candidates[i]);
    if (isConsultFileValid(candidatePath, { slug: ctx.slug, projectRoot: ctx.projectRoot, now, expectedDir: dir })) {
      return true;
    }
  }
  return false;
}

module.exports = {
  CONSULT_TTL_SECONDS,
  MAX_CONSULT_FUTURE_SKEW_SECONDS,
  MAX_CONSULT_HARD_CAP,
  MAX_CONSULT_ENTRIES,
  MAX_CONSULT_BYTES,
  validate,
  hasValidConsult,
};

// ── CLI ───────────────────────────────────────────────────────────────────────────────
//   node coordination-artifact.js validate <kind> <file> <slug>  ->  exit 0 (valid) / 2 (invalid)
//   node coordination-artifact.js const <NAME>                   ->  prints the constant, exit 0
//     (unknown NAME -> exit 2; single source of truth so bats/tests never hardcode a duplicate)
if (require.main === module) {
  const argv = process.argv.slice(2);
  const USAGE = 'Usage: coordination-artifact.js validate <kind> <file> <slug> | const <NAME>\n';

  if (argv[0] === 'const' && argv.length === 2) {
    const CONSTANTS = { CONSULT_TTL_SECONDS, MAX_CONSULT_FUTURE_SKEW_SECONDS, MAX_CONSULT_HARD_CAP, MAX_CONSULT_ENTRIES, MAX_CONSULT_BYTES };
    if (!Object.prototype.hasOwnProperty.call(CONSTANTS, argv[1])) {
      process.stderr.write(USAGE);
      process.exit(2);
    }
    process.stdout.write(String(CONSTANTS[argv[1]]) + '\n');
    process.exit(0);
  }

  if (argv[0] !== 'validate' || argv.length !== 4) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const [, kind, filePath, slug] = argv;
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ok = validate(kind, filePath, { slug, projectRoot });
  process.exit(ok ? 0 : 2);
}
