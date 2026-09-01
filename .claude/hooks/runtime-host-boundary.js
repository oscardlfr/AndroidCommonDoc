#!/usr/bin/env node
'use strict';

// Fail-open observation boundary. It writes only under the explicitly owned
// observation root and never creates or mutates authority records.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CAPABILITY_ENV_VAR = 'RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY';
const CAPABILITY_VALUE = 'p1i-observation-red-fixture-capability';
const MAX_CAPTURE_BYTES = 65536;
const MAX_PENDING_AGE_MS = 5 * 60 * 1000;
const writerJobs = new Map();
let clockOverride = null;
const ANCHOR_SCHEMA = 'runtime/host-observation-trust-anchor/v1';
const TICKET_SCHEMA = 'runtime/host-observation-admission/v1';

// P1-I/A Block A/B1: gated test-only producer for the exact I-BIND Task/Agent
// v2 automatic hook record. Digest-only, zero-authority, no-clobber per
// identity -- never a dispatch/spawn/grant/brand-producing surface.
const IBIND_DENY_LITERAL = 'IBIND_DENY_TASK_V1';
const IBIND_RECORD_SCHEMA = 'sequence1-ibind-deny-hook-record-v2';
const IBIND_RECORD_KEYS = ['authority', 'denyLiteral', 'hookEventName', 'matcherToolName', 'payloadToolName', 'schema', 'sessionIdSha256', 'toolUseIdSha256'];
const IBIND_DIGEST_RE = /^[0-9a-f]{64}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeysSorted) {
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeysSorted.length && keys.every((key, index) => key === expectedKeysSorted[index]);
}

/**
 * True only for a structurally exact, fixed-literal I-BIND v2 record -- this
 * producer's only ever-variable fields are the digest pair itself, so a
 * same-digest row that passes this check is necessarily byte/value-equivalent
 * to what this producer would write; anything else is malformed/non-v2.
 */
function isWellFormedIbindRow(value) {
  return isPlainObject(value) && hasExactKeys(value, IBIND_RECORD_KEYS) &&
    value.schema === IBIND_RECORD_SCHEMA &&
    value.hookEventName === 'PreToolUse' &&
    value.matcherToolName === 'Task' &&
    value.payloadToolName === 'Agent' &&
    typeof value.sessionIdSha256 === 'string' && IBIND_DIGEST_RE.test(value.sessionIdSha256) &&
    typeof value.toolUseIdSha256 === 'string' && IBIND_DIGEST_RE.test(value.toolUseIdSha256) &&
    value.denyLiteral === IBIND_DENY_LITERAL &&
    value.authority === false;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function digestBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function now() {
  return clockOverride ? clockOverride() : new Date();
}

function isTestCapability() {
  return process.env.NODE_ENV === 'test' && process.env[CAPABILITY_ENV_VAR] === CAPABILITY_VALUE;
}

function identityFor(event) {
  if (!event || typeof event !== 'object' || typeof event.session_id !== 'string' || typeof event.tool_use_id !== 'string' ||
      event.session_id.length === 0 || event.tool_use_id.length === 0) return null;
  return { sessionDigest: digest(event.session_id), toolUseDigest: digest(event.tool_use_id) };
}

function rootFor(context) {
  const root = context && context.observationRoot !== undefined
    ? context.observationRoot
    : process.env.RUNTIME_HOST_OBSERVATION_ROOT;
  return typeof root === 'string' && root.length > 0 && path.isAbsolute(root) ? root : null;
}

function keyFor(root, sessionDigest, toolUseDigest) {
  return root + '\u0000' + sessionDigest + '\u0000' + toolUseDigest;
}

function pathsFor(root, sessionDigest, toolUseDigest) {
  const key = sessionDigest + '__' + toolUseDigest;
  return {
    anchor: path.join(root, 'trust', 'host-observer-key.json'),
    admission: path.join(root, 'admission', key + '.json'),
    pre: path.join(root, 'pending', key + '.pre.json'),
    post: path.join(root, 'pending', key + '.post.json'),
    closure: path.join(root, 'closure', key + '.json'),
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function canonicalTicketPayload(sessionDigest, toolUseDigest, admissionProof, keyId) {
  return Buffer.from(JSON.stringify([TICKET_SCHEMA, sessionDigest, toolUseDigest, admissionProof, keyId]), 'utf8');
}

function admissionFor(root, identity) {
  const files = pathsFor(root, identity.sessionDigest, identity.toolUseDigest);
  const anchor = readJson(files.anchor);
  const ticket = readJson(files.admission);
  if (!anchor || anchor.schema !== ANCHOR_SCHEMA || typeof anchor.key_id !== 'string' || !/^[0-9a-f]{64}$/.test(anchor.key_id) ||
      typeof anchor.public_key_spki_der_base64 !== 'string' || !ticket || ticket.schema !== TICKET_SCHEMA ||
      ticket.session_digest !== identity.sessionDigest || ticket.tool_use_digest !== identity.toolUseDigest || ticket.key_id !== anchor.key_id ||
      typeof ticket.admission_proof !== 'string' || !/^[0-9a-f]{64}$/.test(ticket.admission_proof) ||
      typeof ticket.signature_ed25519_base64 !== 'string') return null;
  let publicKey;
  let signature;
  try {
    const spkiDer = Buffer.from(anchor.public_key_spki_der_base64, 'base64');
    if (spkiDer.length === 0 || digestBytes(spkiDer) !== anchor.key_id) return null;
    publicKey = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
    signature = Buffer.from(ticket.signature_ed25519_base64, 'base64');
  } catch { return null; }
  return crypto.verify(null,
    canonicalTicketPayload(identity.sessionDigest, identity.toolUseDigest, ticket.admission_proof, anchor.key_id),
    publicKey, signature) ? ticket : null;
}

function writeNoClobber(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, JSON.stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error && error.code === 'EEXIST') return false;
    throw error;
  }
}

function boundedCapture(event, identity, admissionReceipt) {
  const candidate = {
    schema: 'runtime/raw-observation-pending/v1',
    session_digest: identity.sessionDigest,
    tool_use_digest: identity.toolUseDigest,
    tool_name: typeof event.tool_name === 'string' ? event.tool_name : '',
    captured_at: now().toISOString(),
    payload_digest: digest(JSON.stringify({
      hook_event_name: event.hook_event_name,
      tool_name: event.tool_name,
      tool_input: event.tool_input,
      tool_response: event.tool_response,
      error: event.error,
    })),
    admission_receipt: admissionReceipt,
  };
  // The capture is deliberately digest-only. Its serialized size stays well
  // below the frozen 64KiB bound even for huge tool payloads.
  const serialized = JSON.stringify(candidate);
  return Buffer.byteLength(serialized, 'utf8') <= MAX_CAPTURE_BYTES ? candidate : {
    schema: candidate.schema,
    session_digest: candidate.session_digest,
    tool_use_digest: candidate.tool_use_digest,
    tool_name: candidate.tool_name,
    captured_at: candidate.captured_at,
    payload_digest: candidate.payload_digest,
  };
}

function processPreToolUse(event, context) {
  const root = rootFor(context);
  const identity = identityFor(event);
  if (!root || !identity || event.hook_event_name !== 'PreToolUse') return { admitted: false };
  const files = pathsFor(root, identity.sessionDigest, identity.toolUseDigest);
  const ticket = admissionFor(root, identity);
  if (!ticket) return { admitted: false };
  writeNoClobber(files.pre, boundedCapture(event, identity, ticket.admission_proof));
  return { admitted: true };
}

function allWritersSettled(root, identity) {
  const jobs = writerJobs.get(keyFor(root, identity.sessionDigest, identity.toolUseDigest));
  return !jobs || Array.from(jobs).every((job) => job.fulfilled === true);
}

function closureFor(identity) {
  const setDigest = digest(identity.sessionDigest + ':' + identity.toolUseDigest);
  return {
    schema: 'runtime/raw-observation-closure/v1',
    launch_digest: digest('launch:' + identity.sessionDigest),
    observation_set_digest: setDigest,
    owned_capture_manifest_digest: digest('capture:' + setDigest),
    all_identified_writers_settled: true,
    raw_observations_removed: true,
    authority_records_preserved: true,
    closed_at: now().toISOString(),
  };
}

function processPostToolUse(event, context) {
  const root = rootFor(context);
  const identity = identityFor(event);
  if (!root || !identity || (event.hook_event_name !== 'PostToolUse' && event.hook_event_name !== 'PostToolUseFailure')) return { closed: false };
  const files = pathsFor(root, identity.sessionDigest, identity.toolUseDigest);
  if (fs.existsSync(files.closure)) return { closed: true };
  const ticket = admissionFor(root, identity);
  if (!ticket || !fs.existsSync(files.pre) || !allWritersSettled(root, identity)) return { closed: false };

  const pre = readJson(files.pre);
  if (!pre || pre.schema !== 'runtime/raw-observation-pending/v1' || pre.session_digest !== identity.sessionDigest ||
      pre.tool_use_digest !== identity.toolUseDigest || pre.tool_name !== (typeof event.tool_name === 'string' ? event.tool_name : '') ||
      typeof pre.admission_receipt !== 'string' || !/^[0-9a-f]{64}$/.test(pre.admission_receipt) ||
      pre.admission_receipt !== ticket.admission_proof || typeof pre.payload_digest !== 'string' || !/^[0-9a-f]{64}$/.test(pre.payload_digest)) {
    return { closed: false };
  }
  const capturedAt = Date.parse(pre.captured_at);
  const currentTime = now().getTime();
  if (!Number.isFinite(capturedAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(pre.captured_at) ||
      capturedAt > currentTime || currentTime - capturedAt > MAX_PENDING_AGE_MS) return { closed: false };

  if (!writeNoClobber(files.post, boundedCapture(event, identity, ticket.admission_proof))) return { closed: false };
  // Only an actually removed owned set can justify raw_observations_removed.
  try {
    fs.unlinkSync(files.pre);
    fs.unlinkSync(files.post);
  } catch {
    return { closed: false };
  }
  if (!writeNoClobber(files.closure, closureFor(identity))) return { closed: false };
  writerJobs.delete(keyFor(root, identity.sessionDigest, identity.toolUseDigest));
  return { closed: true };
}

function actionIdFromNativeEvent(event) {
  const input = event && event.tool_input;
  if (!input || typeof input !== 'object') return null;
  const text = [input.prompt, input.message, input.description].filter((value) => typeof value === 'string').join('\n');
  const match = text.match(/(?:ready --action |runtime-action:)([0-9a-f]{32})/);
  return match ? match[1] : null;
}

function admitNativeActionEvent(event) {
  if (!event || event.hook_event_name !== 'PreToolUse' || !['Agent', 'SendMessage'].includes(event.tool_name)) {
    return { admitted: false };
  }
  const projectRoot = typeof event.cwd === 'string' && path.isAbsolute(event.cwd) ? event.cwd : null;
  const actionId = actionIdFromNativeEvent(event);
  if (!projectRoot || !actionId) return { admitted: false };
  let owner;
  let found;
  try {
    owner = require('../../scripts/lib/runtime-role-lifecycle.cjs');
    found = owner.findActionAcrossRepos(actionId);
  } catch {
    return { admitted: false };
  }
  if (!found || !found.ok || found.absent || found.action.repo_id !== owner.computeRepoId(projectRoot)) return { admitted: false };
  const operation = owner.resolveHostOperationForAction(found.action.kind, found.action.runtime);
  if (operation !== event.tool_name) return { admitted: false };
  if (operation === 'Agent') {
    const input = event.tool_input;
    const agentType = input.subagent_type || input.agent_type;
    if (agentType !== found.action.payload.agent_type ||
        !String(input.prompt || '').includes(found.action.payload.bootstrap_message)) return { admitted: false };
  }
  return { admitted: true, actionId, operation };
}

function admitEntrypointPreToolUse(event) {
  if (!event || event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash' ||
      !event.tool_input || typeof event.tool_input.command !== 'string') return { admitted: false };
  let owner;
  let entrypoints;
  let host;
  try {
    owner = require('../../scripts/lib/runtime-role-lifecycle.cjs');
    entrypoints = require('../../scripts/lib/runtime-collaboration-entrypoints.cjs');
    host = require('../../scripts/lib/runtime-host-claude.cjs');
  } catch { return { admitted: false }; }
  const tokens = owner.parsePosixDirect(event.tool_input.command);
  const canonical = path.resolve(__dirname, '../../scripts/lib/runtime-collaboration-entrypoints.cjs').replace(/\\/g, '/');
  if (!tokens || tokens.length < 9 || String(tokens[1]).replace(/\\/g, '/') !== canonical || tokens[2] !== 'execute') return { admitted: false };
  const values = {};
  for (let index = 3; index < tokens.length; index += 2) {
    if (index + 1 >= tokens.length || Object.prototype.hasOwnProperty.call(values, tokens[index])) return { admitted: false };
    values[tokens[index]] = tokens[index + 1];
  }
  if (typeof values['--project-root'] !== 'string' || values['--project-root'] !== event.cwd ||
      typeof values['--host-composition'] !== 'string') return { admitted: false };
  let intent;
  let plan;
  try {
    const bytes = Buffer.from(values['--intent'], 'base64url');
    if (bytes.toString('base64url') !== values['--intent']) return { admitted: false };
    intent = JSON.parse(bytes.toString('utf8'));
    plan = entrypoints.planEntrypointStep(values['--entrypoint'], intent, values['--project-root']);
  } catch { return { admitted: false }; }
  if ((plan.command === null) !== (values['--lifecycle-binding'] === undefined)) return { admitted: false };
  const validated = host.validateProductionHostComposition(values['--project-root'], values['--host-composition'], {
    entrypoint: values['--entrypoint'], argvDigest: plan.argv_digest, roleScope: plan.role_scope,
  });
  return validated.ok ? { admitted: true, compositionId: values['--host-composition'] } : { admitted: false };
}

function admitFinalWriterJob(context, sessionDigest, toolUseDigest, jobPromise) {
  if (!isTestCapability() || !rootFor(context) || !/^[0-9a-f]{64}$/.test(sessionDigest) || !/^[0-9a-f]{64}$/.test(toolUseDigest) || !jobPromise || typeof jobPromise.then !== 'function') {
    return { ok: false };
  }
  const key = keyFor(rootFor(context), sessionDigest, toolUseDigest);
  const jobs = writerJobs.get(key) || new Set();
  writerJobs.set(key, jobs);
  const state = { fulfilled: false };
  jobs.add(state);
  Promise.resolve(jobPromise).then(
    () => { state.fulfilled = true; },
    () => { state.fulfilled = false; },
  );
  return { ok: true };
}

function setClockOverride(value) {
  if (!isTestCapability() || (value !== null && typeof value !== 'function')) return { ok: false };
  clockOverride = value;
  return { ok: true };
}

/**
 * P1-I/A Block A/B1: gated test-only producer of the exact I-BIND Task/Agent
 * v2 automatic hook record. Writes exactly one no-clobber, digest-only,
 * zero-authority record per session/tool-use identity to options.destination
 * (an append-only JSONL file); a replay for the same identity never appends a
 * duplicate. Never reads/echoes manual, env, role, PID, argv or operator
 * claims from event/options into the record or the returned result --
 * only the fixed literals and independently-derived digests ever appear.
 */
function produceIbindDenyRecord(event, options) {
  if (!isTestCapability()) return { denied: false };
  const opts = options && typeof options === 'object' ? options : {};
  const destination = opts.destination;
  if (typeof destination !== 'string' || destination.length === 0 || !path.isAbsolute(destination)) return { denied: false };
  if (opts.matcherToolName !== 'Task') return { denied: false };
  if (!event || event.tool_name !== 'Agent') return { denied: false };
  const identity = identityFor(event);
  if (!identity) return { denied: false };

  const record = {
    schema: IBIND_RECORD_SCHEMA,
    hookEventName: 'PreToolUse',
    matcherToolName: 'Task',
    payloadToolName: 'Agent',
    sessionIdSha256: identity.sessionDigest,
    toolUseIdSha256: identity.toolUseDigest,
    denyLiteral: IBIND_DENY_LITERAL,
    authority: false,
  };

  // Fail closed on an existing symlink/non-file destination -- lstat never
  // follows the link, so a symlink is caught regardless of its target.
  let stat = null;
  try {
    stat = fs.lstatSync(destination);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') return { denied: false }; // unreadable for a reason other than "does not exist yet" -- never silently treat as empty
    stat = null;
  }
  if (stat && !stat.isFile()) return { denied: false };

  // Every existing row must be valid JSONL and a well-formed v2 record --
  // malformed/non-v2 content is never silently skipped or treated as empty.
  const existingRows = [];
  if (stat) {
    let raw;
    try {
      raw = fs.readFileSync(destination, 'utf8');
    } catch {
      return { denied: false };
    }
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      for (const line of trimmed.split('\n')) {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          return { denied: false }; // malformed JSONL -- fail closed, never silently skip the line
        }
        if (!isWellFormedIbindRow(parsed)) return { denied: false }; // malformed/non-v2 row -- fail closed
        existingRows.push(parsed);
      }
    }
  }

  // A same-digest row already passed isWellFormedIbindRow above, so it is
  // necessarily value-equivalent to `record` (the only ever-variable fields
  // are the digest pair itself) -- idempotent replay, never a duplicate
  // append. A different-identity valid v2 row simply coexists.
  const sameDigestRows = existingRows.filter((row) =>
    row.sessionIdSha256 === record.sessionIdSha256 && row.toolUseIdSha256 === record.toolUseIdSha256);
  if (sameDigestRows.length === 0) {
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.appendFileSync(destination, JSON.stringify(record) + '\n', { mode: 0o600 });
  }
  return { denied: true, exitCode: 2, denyLiteral: IBIND_DENY_LITERAL };
}

module.exports = {
  processPreToolUse,
  processPostToolUse,
  admitEntrypointPreToolUse,
  admitNativeActionEvent,
  __TEST_ONLY__admitFinalWriterJob: admitFinalWriterJob,
  __TEST_ONLY__setClockOverride: setClockOverride,
  __TEST_ONLY__produceIbindDenyRecord: produceIbindDenyRecord,
};

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const event = JSON.parse(input);
      if (event && event.hook_event_name === 'PreToolUse') {
        admitEntrypointPreToolUse(event);
        admitNativeActionEvent(event);
        processPreToolUse(event, {});
      }
      else if (event && (event.hook_event_name === 'PostToolUse' || event.hook_event_name === 'PostToolUseFailure')) processPostToolUse(event, {});
    } catch {
      // Hooks must never block the host tool call because observation failed.
    }
  });
}
