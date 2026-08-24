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
//
// Wave 1 (portable-runtime-messaging-adapters) addendum: hasValidV2InboxRef(dir, ctx) below
// is an additive, NOT-YET-WIRED v2-recognition helper (same pre-wiring shape hasValidConsult
// itself was in before an earlier wave wired it into context-provider-gate.js). It delegates
// schema/correlation/durability checks to runtime-consultation.cjs's `validate --kind
// inbox-ref-v1` via spawnSync (that file has nothing require()-able for this purpose), then
// applies this file's own consult-style freshness window on top (validateInboxRefV1 itself
// enforces no TTL). See the WP1 cross-verify note under
// .planning/wave-portable-runtime-messaging-adapters/ for the full contract.

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

// M7/WP4 RED group D (dispatch arch-testing-20260810T074058Z), tightened by
// the M6+M7 requester-authority closure (Group H, 2026-08-10): active
// approved-ingestion consumer, the hook-local equivalent of PLAN.md ~L216's
// validate_ingestion_result_for(request_v1, approval_v1, result_v1) ->
// valid|reason. A generic 'result' kind is validated in complete isolation by
// isResultValid alone (status only, unconditionally — no sibling-file lookup
// of ANY kind) — a caller cannot otherwise distinguish a genuine doc-updater
// ingestion completion from a forged, foreign-producer, out-of-scope result
// claiming the same thing. Group H removed the EARLIER filename-correlated
// path (isIngestionResultValid, reached from the generic isResultValid the
// moment a same-named requests/ingestion/<id>.json sibling happened to
// exist, even a malformed one) — checkIngestionResultFields below is now
// reachable ONLY through the explicit-path validateIngestionResultFor
// (exported below), never implicitly via a filename collision. Uses only the
// existing request/requests/<kind>/<id>.json + approval + result shapes and
// this file's own existing validate()/sha256File API — no parallel artifact
// directory or approval mechanism.
const INGESTION_RESULT_DISPOSITION_ENUM = ['written', 'deduplicated', 'blocked'];

// M7/WP4 correction pass (pre-fix group D, dispatch arch-testing-20260810T074058Z):
// bound for the ingestion result's own `follow_ups` list (PLAN.md ~L219:
// "bounded follow_ups" -- PLAN.md itself does not pin the exact number).
// This is the production-side mirror of the SAME named constant/value the
// test file pins (runtime-consultation-protocol.bats's own
// MAX_INGESTION_FOLLOW_UPS=16) -- not a second, independent design decision.
const MAX_INGESTION_FOLLOW_UPS = 16;

// M6+M7 RESIDUAL AUTHORITY CORRECTION (Section E, item 8): the canonical
// doc-updater ingestion-result basename grammar -- supersedes the prior
// deliberate "no frozen filename regex, safe-segment + .json is the whole
// check" design; Section E's frozen spec now requires this exact shape.
const INGESTION_RESULT_BASENAME_RE = /^doc-updater-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{5,}\.json$/;

// Exact canonical-path accreditation for the specialized ingestion consumer.
// It rejects lexical aliases, final-component symlinks, non-regular files,
// and symlinked/repointed directory components below the real wave root.
function isCanonicalRegularWaveChild(candidatePath, waveDir, directorySegments, expectedBasename) {
  if (typeof candidatePath !== 'string' || typeof expectedBasename !== 'string') return false;
  const lexicalDir = path.join(waveDir, ...directorySegments);
  const lexicalExpected = path.join(lexicalDir, expectedBasename);
  if (path.resolve(candidatePath) !== path.resolve(lexicalExpected)) return false;
  let lst;
  try {
    lst = fs.lstatSync(candidatePath);
  } catch {
    return false;
  }
  if (lst.isSymbolicLink() || !lst.isFile()) return false;
  try {
    const realWave = fs.realpathSync(waveDir);
    const expectedRealDir = path.join(realWave, ...directorySegments);
    if (fs.realpathSync(lexicalDir) !== expectedRealDir) return false;
    return fs.realpathSync(candidatePath) === path.join(expectedRealDir, expectedBasename);
  } catch {
    return false;
  }
}

// Real filesystem confinement for a files_touched/written_file candidate,
// resolved against `approvedRoot` (the WHOLE project root -- docs/ lives
// outside .planning/, so waveDir is never the right root here). Mirrors
// readConfinedJson's own realpath-both-sides confinement pattern (line
// ~76-89) plus an unconditional pre-realpath symlink rejection: a symlink
// whose OWN target is still nominally in-tree must still be rejected -- no
// symlink is ever acceptable here, not just an escaping one.
// Returns one of: 'invalid' | 'outside' | 'missing' | 'symlink' |
// 'not-regular' | 'ok'. A pure-path containment check runs FIRST (before
// any filesystem access) so a traversal/absolute-escape attempt is rejected
// even when the target does not exist on disk at all. 'missing' is reported
// but is NOT itself a rejection for every caller: files_touched tolerates a
// not-yet-materialized reference (see checkIngestionResultFields), while a
// 'deduplicated' disposition's written_file requires the full 'ok' outcome.
function classifyConfinedFileCandidate(candidate, approvedRoot) {
  if (typeof candidate !== 'string' || candidate === '') return 'invalid';
  const resolved = path.resolve(approvedRoot, candidate);
  const relPure = path.relative(approvedRoot, resolved);
  if (relPure === '' || isOutside(relPure)) return 'outside';

  let lst;
  try {
    lst = fs.lstatSync(resolved);
  } catch {
    return 'missing';
  }
  if (lst.isSymbolicLink()) return 'symlink';

  let real;
  let realRoot;
  try {
    real = fs.realpathSync(resolved);
    realRoot = fs.realpathSync(approvedRoot);
  } catch {
    return 'missing';
  }
  const rel = path.relative(realRoot, real);
  if (rel === '' || isOutside(rel)) return 'outside';

  let st;
  try {
    st = fs.statSync(real);
  } catch {
    return 'missing';
  }
  if (!st.isFile()) return 'not-regular';

  return 'ok';
}

// R4-TWO-PHASE-CLASSIFICATION (Codex ruling, M6-M7-PRODUCTION-REACHABILITY-
// 20260819 round 2): the ONE shared approval-authority predicate for a
// single ingestion request_id -- factored out of validateIngestionResultFor's
// own former inline approval-checking block (canonical path, generic
// approval/v1 compatibility, request_kind, request_id correlation, path
// re-check, freshness) PLUS the decision/approver checks that used to live
// inside checkIngestionResultFields below (moved here so BOTH
// validateIngestionResultFor and the new classifyIngestionNotifyArtifact
// request-phase branch call the SAME logic, never a second, divergent
// copy). `approvalPath` is re-proven to resolve to the ONE canonical
// approvals/<reqObj.request_id>.json location -- never merely trusted
// because a caller named it that (closes the same "shadow approval, same
// fields, different confined location" gap this file's own RCP-D30
// regression guards). Approver must be the authorized `user` as an EXPLICIT
// own property on the approval body -- never inferred via a from-fallback
// (generic approval/v1 compatibility, isApprovalValid, which never inspects
// approver/from at all, is unaffected: this stronger requirement applies
// only to this specialized ingestion-completion profile).
// @param {string} approvalPath
// @param {object} reqObj - already-read request/v1 body (only .request_id is trusted here).
// @param {string} waveDir
// @param {{slug:string, projectRoot:string}} ctx
// @returns {{valid:boolean, reason:string, apprObj?:object}}
function checkIngestionApprovalAuthority(approvalPath, reqObj, waveDir, ctx) {
  if (!isSafeSegment(reqObj.request_id)) return { valid: false, reason: 'request-id-unsafe' };
  const canonicalApprovalPath = path.join(waveDir, 'approvals', reqObj.request_id + '.json');
  if (!isCanonicalRegularWaveChild(approvalPath, waveDir, ['approvals'], reqObj.request_id + '.json')) {
    return { valid: false, reason: 'approval-path-not-canonical' };
  }
  if (!validate('approval', approvalPath, ctx)) return { valid: false, reason: 'approval-base-invalid' };
  const apprObj = readConfinedJson(approvalPath, waveDir);
  if (!apprObj) return { valid: false, reason: 'approval-unreadable' };
  if (apprObj.request_kind !== 'ingestion') return { valid: false, reason: 'approval-request-kind-not-ingestion' };
  if (apprObj.request_id !== reqObj.request_id) return { valid: false, reason: 'approval-request-id-mismatch' };
  if (path.resolve(approvalPath) !== path.resolve(canonicalApprovalPath)) {
    return { valid: false, reason: 'approval-path-not-canonical' };
  }
  if (apprObj.decision !== 'authorized') return { valid: false, reason: 'approval-not-authorized' };
  if (!Object.prototype.hasOwnProperty.call(apprObj, 'approver') || apprObj.approver !== 'user') {
    return { valid: false, reason: 'approval-approver-invalid' };
  }
  const apprCreatedMs = Date.parse(apprObj.created_at);
  if (Number.isNaN(apprCreatedMs) || (Date.now() - apprCreatedMs) > CONSULT_TTL_SECONDS * 1000) {
    return { valid: false, reason: 'approval-stale' };
  }
  return { valid: true, reason: 'ok', apprObj };
}

// Shared per-field ingestion-result correctness core -- reachable ONLY
// through the explicit-path validateIngestionResultFor (exported below); the
// EARLIER filename-correlated call site (isIngestionResultValid, reached
// from the generic isResultValid) was removed by the M6+M7 requester-
// authority closure (Group H). `apprPath` is the REAL, already-resolved path
// the approval bytes were read from -- never reconstructed from a filename
// convention here. decision/approver authority is now checked EARLIER, by
// the shared checkIngestionApprovalAuthority predicate above (R4-TWO-PHASE-
// CLASSIFICATION) -- by the time this function runs, both are already
// proven; re-checking them here would be dead, duplicated logic.
function checkIngestionResultFields(obj, reqObj, apprObj, apprPath, projectRoot) {
  // approval_sha256 is RECOMPUTED from the durable approval bytes on disk —
  // never trusted as merely claimed by the result.
  let apprDigest;
  try {
    apprDigest = sha256File(apprPath);
  } catch {
    return false;
  }
  if (typeof obj.approval_sha256 !== 'string' || obj.approval_sha256 !== apprDigest) return false;

  // Result must be FROM the canonical producer, TO the request's own
  // ORIGINATOR (PLAN.md ~L219: "to == request.from" -- the result goes back
  // to whoever OPENED the request, never merely to the request's own
  // addressee).
  if (obj.from !== 'doc-updater') return false;
  if (obj.to !== reqObj.from) return false;

  // audit_status is now MANDATORY (PLAN.md ~L219's own required body-field
  // list) — missing or empty fails closed.
  if (typeof obj.audit_status !== 'string' || obj.audit_status === '') return false;

  // follow_ups is a MANDATORY, bounded array of non-empty strings.
  if (!Array.isArray(obj.follow_ups) || obj.follow_ups.length > MAX_INGESTION_FOLLOW_UPS) return false;
  for (const followUp of obj.follow_ups) {
    if (typeof followUp !== 'string' || followUp === '') return false;
  }

  if (!INGESTION_RESULT_DISPOSITION_ENUM.includes(obj.disposition)) return false;

  // status/disposition coherence (PLAN.md ~L219 area): 'blocked' disposition
  // iff 'blocked' status -- e.g. disposition:"written" + status:"blocked" is
  // incoherent and rejected (obj.status is already constrained to the base
  // ready-for-review|done|blocked enum by isResultValid before this runs).
  if ((obj.disposition === 'blocked') !== (obj.status === 'blocked')) return false;

  // files_touched is a MANDATORY array (PLAN.md ~L219's own required
  // body-field list) whose length/content is disposition-dependent.
  if (!Array.isArray(obj.files_touched)) return false;
  // 'written' REQUIRES genuine evidence a file was actually touched --
  // PLAN.md ~L219: "treats `written` as valid only with non-empty confined
  // `files_touched`".
  if (obj.disposition === 'written' && obj.files_touched.length === 0) return false;
  // 'deduplicated'/'blocked' both represent "no NEW file was written" --
  // files_touched must be exactly empty for either.
  if ((obj.disposition === 'deduplicated' || obj.disposition === 'blocked') && obj.files_touched.length !== 0) {
    return false;
  }
  for (const touched of obj.files_touched) {
    if (typeof touched !== 'string' || touched === '') return false;
    const outcome = classifyConfinedFileCandidate(touched, projectRoot);
    // M6+M7 requester-authority closure (Group 3, bullet 2): 'written' is the
    // ONLY disposition whose files_touched ever reaches this loop with any
    // entries at all (enforced above: 'deduplicated'/'blocked' both require
    // an EMPTY files_touched) -- PLAN.md ~L219 requires genuine,
    // already-present evidence for 'written' ("non-empty confined
    // files_touched"), so 'missing' is now a hard rejection here too, not
    // merely 'outside' (traversal/escape)/'symlink'/'not-regular'/'invalid'.
    if (outcome !== 'ok') return false;
  }

  // 'deduplicated' is "a successful no-new-file completion with the
  // existing document reference" (PLAN.md ~L219) -- written_file MUST
  // genuinely exist, stay confined, be a regular file, and never be a
  // symlink; a merely-claimed or omitted reference is no reference at all.
  if (obj.disposition === 'deduplicated') {
    if (classifyConfinedFileCandidate(obj.written_file, projectRoot) !== 'ok') return false;
  }

  return true;
}

// M6+M7 requester-authority closure (Group H, 2026-08-10): status-only,
// unconditionally -- no filename-derived requests/ingestion/<id>.json
// sibling lookup. The EARLIER behavior silently upgraded to the full
// ingestion-specific check the moment ANY same-named sibling existed at that
// conventional path, even a malformed one; specialized ingestion validation
// is now reachable ONLY through the explicit-path validateIngestionResultFor
// below, never implicitly via a filename collision.
function isResultValid(obj) {
  return obj.status === 'ready-for-review' || obj.status === 'done' || obj.status === 'blocked';
}

// M7/WP4 correction pass (pre-fix group D, dispatch arch-testing-20260810T074058Z):
// the NAMED, independently-callable ingestion-result consumer PLAN.md ~L216
// itself names (`validate_ingestion_result_for(request_v1, approval_v1,
// result_v1) -> valid|reason`). Takes three explicit file PATHS — never
// infers correlation from any filename (the new canonical result path,
// `results/doc-updater/<doc-updater-timestamp-unique>.json`, makes filename
// correlation structurally impossible; PLAN.md ~L219's own explicit result
// body-field list — `request_id`, `request_kind` — is the field-based
// correlation mechanism this profile requires instead). Reuses the existing
// base-envelope `validate('request'|'approval'|'result', ...)` checks as a
// NECESSARY precondition (they remain the generic compatibility check —
// passing them is necessary but not sufficient, RCP-D3) plus
// checkIngestionResultFields's shared per-field logic above. The generic
// validate()'s own EXISTING behavior/contract for non-ingestion callers is
// UNCHANGED by this function's existence — RCP-D3 explicitly re-confirms the
// generic check still ACCEPTS a base-field-valid-but-forged-producer result
// at the new canonical path; that is intentional, this function is the
// stronger, additive consumer.
// @param {string} requestPath
// @param {string} approvalPath
// @param {string} resultPath
// @param {{slug:string, projectRoot:string}} ctx
// @returns {{valid:boolean, reason:string}}
function validateIngestionResultFor(requestPath, approvalPath, resultPath, ctx) {
  if (!ctx || !ctx.slug || !ctx.projectRoot) return { valid: false, reason: 'missing-ctx' };
  if (!isSafeSegment(ctx.slug)) return { valid: false, reason: 'unsafe-slug' };
  const { slug, projectRoot } = ctx;
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + slug);

  const requestBasename = path.basename(path.resolve(requestPath));
  if (!isSafeSegment(requestBasename) || !requestBasename.endsWith('.json')) {
    return { valid: false, reason: 'request-path-not-canonical' };
  }
  if (!isCanonicalRegularWaveChild(requestPath, waveDir, ['requests', 'ingestion'], requestBasename)) {
    return { valid: false, reason: 'request-path-not-canonical' };
  }
  if (!validate('request', requestPath, ctx)) return { valid: false, reason: 'request-base-invalid' };
  const reqObj = readConfinedJson(requestPath, waveDir);
  if (!reqObj) return { valid: false, reason: 'request-unreadable' };
  // M6+M7 requester-authority closure (Group 3, bullet 1): PROVE requestPath
  // is the exact canonical confined file for reqObj's own request_id --
  // closes the "shadow request, same ID value, different file" gap. Checked
  // BEFORE trusting any other field read from reqObj (e.g. `kind` below) --
  // request_id itself is the one exception, since it is required to compute
  // the canonical path in the first place.
  if (!isSafeSegment(reqObj.request_id)) return { valid: false, reason: 'request-id-unsafe' };
  const canonicalRequestPath = path.join(waveDir, 'requests', 'ingestion', reqObj.request_id + '.json');
  if (path.resolve(requestPath) !== path.resolve(canonicalRequestPath)) {
    return { valid: false, reason: 'request-path-not-canonical' };
  }
  if (reqObj.kind !== 'ingestion') return { valid: false, reason: 'request-kind-not-ingestion' };

  // R4-TWO-PHASE-CLASSIFICATION: the full approval-authority check (canonical
  // path, generic approval/v1 compatibility, request_kind, request_id
  // correlation, path re-check, decision/approver authority, freshness) now
  // lives in the ONE shared checkIngestionApprovalAuthority predicate above
  // -- also used by classifyIngestionNotifyArtifact's own request-phase
  // branch below, so the two callers can never drift.
  const approvalCheck = checkIngestionApprovalAuthority(approvalPath, reqObj, waveDir, ctx);
  if (!approvalCheck.valid) return { valid: false, reason: approvalCheck.reason };
  const apprObj = approvalCheck.apprObj;

  const resultBasename = path.basename(path.resolve(resultPath));
  if (!isSafeSegment(resultBasename) || !INGESTION_RESULT_BASENAME_RE.test(resultBasename)) {
    return { valid: false, reason: 'result-path-not-canonical' };
  }
  if (!isCanonicalRegularWaveChild(resultPath, waveDir, ['results', 'doc-updater'], resultBasename)) {
    return { valid: false, reason: 'result-path-not-canonical' };
  }
  if (!validate('result', resultPath, ctx)) return { valid: false, reason: 'result-base-invalid' };
  const obj = readConfinedJson(resultPath, waveDir);
  if (!obj) return { valid: false, reason: 'result-unreadable' };
  // result.request_id is read from the RESULT BODY and cross-checked
  // against the request's own request_id — never inferred from the
  // result's filename.
  if (obj.request_id !== reqObj.request_id) return { valid: false, reason: 'result-request-id-mismatch' };
  if (obj.request_kind !== 'ingestion') return { valid: false, reason: 'result-request-kind-not-ingestion' };

  if (!checkIngestionResultFields(obj, reqObj, apprObj, approvalPath, projectRoot)) {
    return { valid: false, reason: 'ingestion-field-check-failed' };
  }

  return { valid: true, reason: 'ok' };
}

// ── R4-TWO-PHASE-CLASSIFICATION (Codex ruling, M6-M7-PRODUCTION-REACHABILITY-
// 20260819 round 2 "continue_same_stage") ────────────────────────────────
//
// The single classifier `runtime-role-lifecycle.cjs`'s `handleNotify` must
// consult for `--kind ingestion-request` BEFORE minting any role-notify
// action. Accepts EXACTLY:
//   (a) request-phase: a canonical requests/ingestion/<request_id>.json
//       whose canonical, CURRENT approvals/<request_id>.json passes
//       checkIngestionApprovalAuthority above -- targets the FIXED role
//       'doc-updater' (the sole canonical ingestion consumer; the
//       requests/ingestion/ + results/doc-updater/ directory convention IS
//       that binding by construction -- never derived from any artifact
//       field. Confirmed against this file's own runtime-consultation-
//       protocol.bats fixtures before relying on this: both the request AND
//       approval default `to` field is "orchestrator", never "doc-updater",
//       so "targeting doc-updater" cannot mean a `to` field check without
//       breaking RCP-D1/RCP-D2); or
//   (b) result-phase: a canonical results/doc-updater/<canonical-name>.json
//       whose OWN, UNTRUSTED request_id (sanitized via isSafeSegment before
//       it ever touches a path.join) locates the canonical request+approval,
//       and whose complete triple passes the REAL, load-bearing
//       validateIngestionResultFor -- targets request.from, already proven
//       by validateIngestionResultFor's own checkIngestionResultFields
//       (`obj.to === reqObj.from`) internally; never re-derived shallowly
//       here.
// Anything else -- wrong path shape, non-canonical/symlinked entry, missing/
// denied/stale/mismatched approval, unsafe locator, malformed triple -- is
// invalid and mints no action.
//
// `artifactPath`'s own containing wave-<slug> path segment is read
// TEXTUALLY only as a CANDIDATE (never trusted) -- every subsequent step
// re-proves genuine canonicality via realpath-based isCanonicalRegularWaveChild/
// validate()/validateIngestionResultFor, exactly like this file's own
// pre-existing requestBasename/resultBasename pre-extraction (above) already
// does. There is no `--wave-slug` flag on the frozen `notify` CLI ABI, so the
// slug MUST be derived this way -- from the already-caller-supplied
// `--artifact` path -- rather than accepted as a second, redundant input.
// @param {string} artifactPath
// @param {{projectRoot:string}} ctx
// @returns {{valid:true,phase:'request'|'result',targetRole:string}|{valid:false,reason:string}}
function classifyIngestionNotifyArtifact(artifactPath, ctx) {
  if (!ctx || typeof ctx.projectRoot !== 'string' || ctx.projectRoot === '') {
    return { valid: false, reason: 'missing-ctx' };
  }
  if (typeof artifactPath !== 'string' || artifactPath === '') {
    return { valid: false, reason: 'artifact-not-canonical' };
  }
  const projectRoot = ctx.projectRoot;
  let resolvedArtifact;
  let rel;
  try {
    resolvedArtifact = path.resolve(artifactPath);
    rel = path.relative(projectRoot, resolvedArtifact);
  } catch {
    return { valid: false, reason: 'artifact-not-canonical' };
  }
  if (rel === '' || isOutside(rel)) return { valid: false, reason: 'artifact-not-canonical' };
  const segments = rel.split(path.sep);
  if (segments.length !== 5 || segments[0] !== '.planning' || !segments[1].startsWith('wave-')) {
    return { valid: false, reason: 'artifact-not-canonical' };
  }
  const slug = segments[1].slice('wave-'.length);
  if (!isSafeSegment(slug)) return { valid: false, reason: 'artifact-not-canonical' };
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + slug);
  const basename = path.basename(resolvedArtifact);
  const artifactCtx = { slug, projectRoot };

  if (segments[2] === 'requests' && segments[3] === 'ingestion') {
    if (!isSafeSegment(basename) || !basename.endsWith('.json')) {
      return { valid: false, reason: 'artifact-not-canonical' };
    }
    if (!isCanonicalRegularWaveChild(resolvedArtifact, waveDir, ['requests', 'ingestion'], basename)) {
      return { valid: false, reason: 'artifact-not-canonical' };
    }
    if (!validate('request', resolvedArtifact, artifactCtx)) return { valid: false, reason: 'request-base-invalid' };
    const reqObj = readConfinedJson(resolvedArtifact, waveDir);
    if (!reqObj) return { valid: false, reason: 'request-unreadable' };
    const requestId = basename.slice(0, -'.json'.length);
    if (!isSafeSegment(reqObj.request_id) || reqObj.request_id !== requestId) {
      return { valid: false, reason: 'request-id-mismatch' };
    }
    if (reqObj.kind !== 'ingestion') return { valid: false, reason: 'request-kind-not-ingestion' };

    const canonicalApprovalPath = path.join(waveDir, 'approvals', reqObj.request_id + '.json');
    const approvalCheck = checkIngestionApprovalAuthority(canonicalApprovalPath, reqObj, waveDir, artifactCtx);
    if (!approvalCheck.valid) return { valid: false, reason: approvalCheck.reason };

    return { valid: true, phase: 'request', targetRole: 'doc-updater' };
  }

  if (segments[2] === 'results' && segments[3] === 'doc-updater') {
    if (!isSafeSegment(basename) || !INGESTION_RESULT_BASENAME_RE.test(basename)) {
      return { valid: false, reason: 'artifact-not-canonical' };
    }
    if (!isCanonicalRegularWaveChild(resolvedArtifact, waveDir, ['results', 'doc-updater'], basename)) {
      return { valid: false, reason: 'artifact-not-canonical' };
    }
    // Untrusted read: request_id is sanitized via isSafeSegment BEFORE it
    // ever touches a path.join -- the only thing trusted from this
    // not-yet-validated result body at this point.
    const untrustedObj = readConfinedJson(resolvedArtifact, waveDir);
    if (!untrustedObj || !isSafeSegment(untrustedObj.request_id)) {
      return { valid: false, reason: 'result-request-id-unsafe' };
    }
    const requestId = untrustedObj.request_id;
    const requestPath = path.join(waveDir, 'requests', 'ingestion', requestId + '.json');
    const approvalPath = path.join(waveDir, 'approvals', requestId + '.json');
    // Load-bearing: the REAL validateIngestionResultFor validates the
    // complete triple (never a shallow reproduction of a subset of its
    // checks) -- this also already proves obj.to === reqObj.from
    // (checkIngestionResultFields), so that equality is never re-derived
    // shallowly below.
    const outcome = validateIngestionResultFor(requestPath, approvalPath, resolvedArtifact, artifactCtx);
    if (!outcome.valid) return { valid: false, reason: outcome.reason };

    const resultObj = readConfinedJson(resolvedArtifact, waveDir);
    if (!resultObj || typeof resultObj.to !== 'string' || resultObj.to === '') {
      return { valid: false, reason: 'result-unreadable' };
    }
    return { valid: true, phase: 'result', targetRole: resultObj.to };
  }

  return { valid: false, reason: 'artifact-not-canonical' };
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
  // Codex hardening: a crafted slug (e.g. 'x/../../evil') would otherwise redirect every
  // .planning/wave-<slug>/ path built below BEFORE any realpath confinement check runs.
  if (!isSafeSegment(ctx.slug)) return false;
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
  // Codex hardening: same guard as validate() — a crafted slug must not redirect the confinement
  // root before any path.join happens.
  if (!isSafeSegment(ctx.slug)) return false;

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

// ── inbox-ref/v1 (v2 protocol) per-candidate validation — delegates schema/correlation/
// durability checks to runtime-consultation.cjs over a process boundary (spawnSync; that
// file exports nothing require()-able for this — see header note above), then applies
// this file's own consult-style freshness window on top (validateInboxRefV1 itself
// enforces no TTL bound). ctx: {coordRoot, projectRoot, now, runtimeConsultationPath?,
// expectedDir} — expectedDir lets hasValidV2InboxRef pass the already-known scan dir,
// mirroring isConsultFileValid's own expectedDir convention.
function isV2InboxRefCandidateValid(filePath, ctx) {
  try {
    const realFile = fs.realpathSync(filePath);
    const realDir = fs.realpathSync(ctx.expectedDir);
    const rel = path.relative(realDir, realFile);
    // Non-recursive: candidate must be a DIRECT child of the inbox dir (same "never
    // descend" contract as isConsultFileValid).
    if (rel === '' || isOutside(rel) || rel.includes(path.sep)) return false;

    const st = fs.statSync(realFile);
    if (!st.isFile()) return false;
    if (st.size > MAX_CONSULT_BYTES) return false; // oversized -> skip, never read

    const cliPath = ctx.runtimeConsultationPath
      || path.join(ctx.projectRoot, 'scripts', 'lib', 'runtime-consultation.cjs');
    // NOTE: --artifact uses the ORIGINAL filePath (not realFile) so its relationship to
    // --coordination-root stays textually consistent for the CLI's own
    // planRootFromArtifact path-relative math (both sides share the same caller-supplied,
    // possibly-symlinked prefix — e.g. macOS /tmp -> /private/tmp).
    const r = spawnSync(process.execPath, [
      cliPath, 'validate',
      '--coordination-root', ctx.coordRoot,
      '--kind', 'inbox-ref-v1',
      '--artifact', filePath,
    ], { cwd: ctx.projectRoot, timeout: 3000, encoding: 'utf8' });
    if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return false;

    let parsed;
    try {
      parsed = JSON.parse(r.stdout.trim());
    } catch {
      return false;
    }
    if (!parsed || parsed.schema !== 'coordination/cli-result/v1' || parsed.status !== 'SUCCESS') {
      return false;
    }

    // validateInboxRefV1 checks schema/correlation/durability only — no freshness bound —
    // so re-read the candidate's own created_at directly here (the cli-result envelope
    // does not echo artifact fields) and apply the SAME directional-TTL window
    // isConsultFileValid already uses.
    const raw = fs.readFileSync(realFile, 'utf8'); // bounded by the size check above
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || typeof obj.created_at !== 'string') return false;
    const createdMs = Date.parse(obj.created_at);
    if (Number.isNaN(createdMs)) return false;
    const now = (typeof ctx.now === 'number') ? ctx.now : Date.now();
    if (now - createdMs > CONSULT_TTL_SECONDS * 1000) return false; // too old (stale)
    if (createdMs - now > MAX_CONSULT_FUTURE_SKEW_SECONDS * 1000) return false; // too far future

    return true;
  } catch {
    return false;
  }
}

// ── Public API: hasValidV2InboxRef(dir, ctx) — bounded scan for the newest valid
// coordination/inbox-ref/v1 candidate (additive, NOT YET WIRED into any call site — see
// the WP1 cross-verify note under .planning/wave-portable-runtime-messaging-adapters/ for
// the full contract). ctx = {coordRoot, projectRoot, now?, runtimeConsultationPath?}.
function hasValidV2InboxRef(dir, ctx) {
  if (!ctx || !ctx.coordRoot || !ctx.projectRoot) return false;

  let dirHandle;
  try {
    dirHandle = fs.opendirSync(dir);
  } catch {
    return false; // dir absent/unreadable — routine "no inbox-ref yet", not a genuine error
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
      if (entry.isFile() && /^[a-f0-9]{32,128}\.json$/.test(entry.name)) {
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
    if (isV2InboxRefCandidateValid(candidatePath, {
      coordRoot: ctx.coordRoot,
      projectRoot: ctx.projectRoot,
      now,
      runtimeConsultationPath: ctx.runtimeConsultationPath,
      expectedDir: dir,
    })) {
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
  hasValidV2InboxRef,
  validateIngestionResultFor,
  classifyIngestionNotifyArtifact,
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
