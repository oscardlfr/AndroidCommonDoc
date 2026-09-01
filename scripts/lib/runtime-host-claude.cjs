#!/usr/bin/env node
'use strict';

// Observation-only host adapter.  Its brands and handles are deliberately
// process-local capabilities; persisted admission records contain only
// correlation digests and a verifier tag, never host identity or authority.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CAPABILITY_ENV_VAR = 'RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY';
const CAPABILITY_VALUE = 'p1i-observation-red-fixture-capability';
const BRAND_RECORDS = new WeakMap();
const HANDLE_RECORDS = new WeakMap();
const ANCHOR_SCHEMA = 'runtime/host-observation-trust-anchor/v1';
const TICKET_SCHEMA = 'runtime/host-observation-admission/v1';
const COMPOSITION_SCHEMA = 'runtime/claude-host-composition/v1';
const COMPOSITION_TTL_SECONDS = 120;
const COMPOSITION_OPERATIONS = Object.freeze(['Agent', 'Bash', 'SendMessage', 'TaskOutput']);
const COMPOSITION_RE = /^[0-9a-f]{32}$/;

// P1-I/A I-BIND dual-channel evidence admission (Block A). Fixed literals for
// the one supported denial shape this observation-only slice ever admits:
// registry/matcher Task, displayed/payload tool Agent.
const IBIND_DENY_LITERAL = 'IBIND_DENY_TASK_V1';
const IBIND_RECORD_SCHEMA = 'sequence1-ibind-deny-hook-record-v2';
const IBIND_FORBIDDEN_SYSTEM_SUBTYPES = new Set([
  'task_started', 'task_progress', 'background_tasks_changed', 'task_output_reference',
]);
const IBIND_FIXTURE_KEYS = ['automaticHookRecords', 'observationRoot', 'ownerStreamRows'];
const IBIND_RECORD_KEYS = ['authority', 'denyLiteral', 'hookEventName', 'matcherToolName', 'payloadToolName', 'schema', 'sessionIdSha256', 'toolUseIdSha256'];
const DIGEST_RE = /^[0-9a-f]{64}$/;

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function digestBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isTestCapability() {
  return process.env.NODE_ENV === 'test' && process.env[CAPABILITY_ENV_VAR] === CAPABILITY_VALUE;
}

function isUsableRoot(root) {
  return typeof root === 'string' && root.length > 0 && path.isAbsolute(root);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeysSorted) {
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeysSorted.length && keys.every((key, index) => key === expectedKeysSorted[index]);
}

function identityFor(event) {
  if (!event || typeof event !== 'object' || typeof event.session_id !== 'string' || typeof event.tool_use_id !== 'string' ||
      event.session_id.length === 0 || event.tool_use_id.length === 0) {
    throw new TypeError('A non-empty session_id and tool_use_id are required for observation correlation.');
  }
  return { sessionDigest: digest(event.session_id), toolUseDigest: digest(event.tool_use_id) };
}

function ticketPath(root, sessionDigest, toolUseDigest) {
  return path.join(root, 'admission', sessionDigest + '__' + toolUseDigest + '.json');
}

function trustAnchorPath(root) {
  return path.join(root, 'trust', 'host-observer-key.json');
}

function canonicalTicketPayload(sessionDigest, toolUseDigest, admissionProof, keyId) {
  return Buffer.from(JSON.stringify([TICKET_SCHEMA, sessionDigest, toolUseDigest, admissionProof, keyId]), 'utf8');
}

function exactAnchor(record) {
  return {
    schema: ANCHOR_SCHEMA,
    key_id: record.keyId,
    public_key_spki_der_base64: record.spkiDer.toString('base64'),
  };
}

function ensureTrustAnchor(record) {
  const destination = trustAnchorPath(record.observationRoot);
  const anchor = exactAnchor(record);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(destination, JSON.stringify(anchor), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    let existing;
    try { existing = JSON.parse(fs.readFileSync(destination, 'utf8')); } catch { throw new Error('Existing observation trust anchor is invalid.'); }
    if (!existing || existing.schema !== anchor.schema || existing.key_id !== anchor.key_id ||
        existing.public_key_spki_der_base64 !== anchor.public_key_spki_der_base64) {
      throw new Error('Observation trust anchor belongs to a different host identity.');
    }
  }
}

function verifyTicket(ticket, record, sessionDigest, toolUseDigest) {
  return Boolean(ticket && ticket.schema === TICKET_SCHEMA && ticket.session_digest === sessionDigest &&
    ticket.tool_use_digest === toolUseDigest && ticket.key_id === record.keyId &&
    typeof ticket.admission_proof === 'string' && /^[0-9a-f]{64}$/.test(ticket.admission_proof) &&
    typeof ticket.signature_ed25519_base64 === 'string' &&
    crypto.verify(null, canonicalTicketPayload(sessionDigest, toolUseDigest, ticket.admission_proof, record.keyId),
      record.publicKey, Buffer.from(ticket.signature_ed25519_base64, 'base64')));
}

function writeAdmissionTicket(record, sessionDigest, toolUseDigest) {
  const { observationRoot } = record;
  const destination = ticketPath(observationRoot, sessionDigest, toolUseDigest);
  const admissionProof = crypto.randomBytes(32).toString('hex');
  const ticket = {
    schema: TICKET_SCHEMA,
    session_digest: sessionDigest,
    tool_use_digest: toolUseDigest,
    admission_proof: admissionProof,
    key_id: record.keyId,
    signature_ed25519_base64: crypto.sign(null,
      canonicalTicketPayload(sessionDigest, toolUseDigest, admissionProof, record.keyId), record.privateKey).toString('base64'),
  };
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(destination, JSON.stringify(ticket), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    let existing;
    try { existing = JSON.parse(fs.readFileSync(destination, 'utf8')); } catch { throw new Error('Existing admission ticket is invalid.'); }
    if (!verifyTicket(existing, record, sessionDigest, toolUseDigest)) {
      throw new Error('Existing admission ticket is not authenticated for this host identity.');
    }
  }
}

function mintBrandRecord(root) {
  if (!isUsableRoot(root)) throw new TypeError('observationRoot must be an absolute non-empty path.');
  const keyPair = crypto.generateKeyPairSync('ed25519');
  const spkiDer = keyPair.publicKey.export({ type: 'spki', format: 'der' });
  const record = {
    observationRoot: root,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    spkiDer,
    keyId: digestBytes(spkiDer),
  };
  ensureTrustAnchor(record);
  const brand = Object.freeze({});
  BRAND_RECORDS.set(brand, record);
  return brand;
}

function mintHostAdapterBrand(options) {
  if (!isTestCapability()) return null;
  const root = options && options.observationRoot;
  return mintBrandRecord(root);
}

/**
 * P1-I/A Block A: admits an authentic dual-channel I-BIND deny-evidence
 * fixture -- an owner-held stream (`ownerStreamRows`) plus exactly one
 * independently-correlated automatic v2 hook record (`automaticHookRecords`)
 * -- and, ONLY when every required shape/literal/digest matches exactly,
 * mints the SAME opaque process-local brand `__TEST_ONLY__mintHostAdapterBrand`
 * produces (never a distinct, weaker brand type). Nothing supplied by env,
 * JSON, PID/argv/name, carrier or operator -- nor any extra top-level field on
 * the fixture itself -- ever contributes to admission or authority.
 */
function admitIbindEvidence(fixture) {
  if (!isTestCapability()) return null;
  if (!isPlainObject(fixture) || !hasExactKeys(fixture, IBIND_FIXTURE_KEYS)) {
    throw new TypeError('I-BIND evidence fixture must contain exactly observationRoot, ownerStreamRows, automaticHookRecords -- no manual/env/JSON authority claims.');
  }

  const { observationRoot, ownerStreamRows, automaticHookRecords } = fixture;
  if (!isUsableRoot(observationRoot)) throw new TypeError('observationRoot must be an absolute non-empty path.');
  if (!Array.isArray(ownerStreamRows) || !Array.isArray(automaticHookRecords)) {
    throw new TypeError('ownerStreamRows and automaticHookRecords must be arrays.');
  }

  // Exactly one automatic v2 hook record, matching the frozen deny shape --
  // and EXACTLY the eight contracted keys, never an extra raw-ID/role/grant/
  // manual field riding along with genuine evidence.
  if (automaticHookRecords.length !== 1) throw new TypeError('exactly one automatic hook record is required.');
  const [record] = automaticHookRecords;
  if (!isPlainObject(record) || !hasExactKeys(record, IBIND_RECORD_KEYS) ||
      record.schema !== IBIND_RECORD_SCHEMA ||
      record.hookEventName !== 'PreToolUse' ||
      record.matcherToolName !== 'Task' ||
      record.payloadToolName !== 'Agent' ||
      record.denyLiteral !== IBIND_DENY_LITERAL ||
      record.authority !== false ||
      typeof record.sessionIdSha256 !== 'string' || !DIGEST_RE.test(record.sessionIdSha256) ||
      typeof record.toolUseIdSha256 !== 'string' || !DIGEST_RE.test(record.toolUseIdSha256)) {
    throw new TypeError('automatic hook record does not match the exact I-BIND v2 schema.');
  }

  // No dispatch/child/task/output/handle/survivor artifacts anywhere in the stream.
  for (const row of ownerStreamRows) {
    if (isPlainObject(row) && row.type === 'system' && IBIND_FORBIDDEN_SYSTEM_SUBTYPES.has(row.subtype)) {
      throw new TypeError('forbidden dispatch/child/task/output artifact present in owner stream: ' + row.subtype);
    }
  }

  // Exactly one owner registry (init) row; the matcher registry is Task only.
  const initRows = ownerStreamRows.filter((row) => isPlainObject(row) && row.type === 'system' && row.subtype === 'init');
  if (initRows.length !== 1) throw new TypeError('exactly one owner tool-registry (init) row is required.');
  const [initRow] = initRows;
  if (typeof initRow.session_id !== 'string' || initRow.session_id.length === 0) {
    throw new TypeError('the registry row must carry a session_id.');
  }
  if (!Array.isArray(initRow.tools) || initRow.tools.length !== 1 || initRow.tools[0] !== 'Task') {
    throw new TypeError('the owner tool registry must expose exactly the plain string "Task" -- no object-shaped registry entries.');
  }
  const sessionId = initRow.session_id;

  // No owner-stream row may carry a different, nonempty session_id -- a
  // foreign-session row is never merely ignored.
  for (const row of ownerStreamRows) {
    if (isPlainObject(row) && typeof row.session_id === 'string' && row.session_id.length > 0 && row.session_id !== sessionId) {
      throw new TypeError('an owner-stream row carries a session_id different from the init session.');
    }
  }

  // Exactly one displayed proposal, and it must be the Agent tool_use.
  const toolUseProposals = [];
  for (const row of ownerStreamRows) {
    const content = isPlainObject(row) && row.message && Array.isArray(row.message.content) ? row.message.content : [];
    for (const entry of content) {
      if (isPlainObject(entry) && entry.type === 'tool_use') toolUseProposals.push({ row, entry });
    }
  }
  if (toolUseProposals.length !== 1) throw new TypeError('exactly one displayed tool_use proposal is required.');
  const { row: proposalRow, entry: proposal } = toolUseProposals[0];
  if (proposal.name !== 'Agent' || typeof proposal.id !== 'string' || proposal.id.length === 0 || proposalRow.session_id !== sessionId) {
    throw new TypeError('the displayed proposal must be an Agent tool_use for the owner session.');
  }
  const toolUseId = proposal.id;

  // Exactly one hook_started and exactly one hook_response -- never "one good
  // plus one contradictory/extra" evidence -- showing a matched exit-2 Agent denial.
  const hookStartedRows = ownerStreamRows.filter((row) => isPlainObject(row) && row.type === 'system' && row.subtype === 'hook_started');
  const hookResponseRows = ownerStreamRows.filter((row) => isPlainObject(row) && row.type === 'system' && row.subtype === 'hook_response');
  if (hookStartedRows.length !== 1) throw new TypeError('exactly one hook_started row is required.');
  if (hookResponseRows.length !== 1) throw new TypeError('exactly one hook_response row is required.');
  const [hookStarted] = hookStartedRows;
  const [hookResponse] = hookResponseRows;
  if (hookStarted.session_id !== sessionId || hookResponse.session_id !== sessionId ||
      hookStarted.hook_event !== 'PreToolUse' || hookResponse.hook_event !== 'PreToolUse' ||
      hookStarted.hook_name !== 'PreToolUse:Agent' || hookResponse.hook_name !== 'PreToolUse:Agent' ||
      !hookStarted.hook_id || hookStarted.hook_id !== hookResponse.hook_id ||
      hookResponse.exit_code !== 2 || hookResponse.stderr !== IBIND_DENY_LITERAL) {
    throw new TypeError('the automatic PreToolUse hook_started/hook_response pair must show a matched exit-2 Agent denial.');
  }

  // Exactly one owner-stream tool_result -- and that sole result must BE the
  // correlated denied Agent result, never "one good plus one contradictory/extra".
  const toolResultEntries = [];
  for (const row of ownerStreamRows) {
    if (!isPlainObject(row) || row.type !== 'user') continue;
    const content = row.message && Array.isArray(row.message.content) ? row.message.content : [];
    for (const entry of content) {
      if (isPlainObject(entry) && entry.type === 'tool_result') toolResultEntries.push(entry);
    }
  }
  if (toolResultEntries.length !== 1) throw new TypeError('exactly one owner-stream tool_result is required.');
  const [soleToolResult] = toolResultEntries;
  if (soleToolResult.tool_use_id !== toolUseId || soleToolResult.is_error !== true || soleToolResult.content !== IBIND_DENY_LITERAL) {
    throw new TypeError('the sole tool_result must be the correlated denied Agent result.');
  }

  // Exactly one native result row, belonging to the same session, whose
  // permission_denials contains EXACTLY one entry: the Task denial correlated
  // to the exact Agent tool-use id.
  const resultRows = ownerStreamRows.filter((row) => isPlainObject(row) && row.type === 'result');
  if (resultRows.length !== 1) throw new TypeError('exactly one native result row is required.');
  const [resultRow] = resultRows;
  if (resultRow.session_id !== sessionId) {
    throw new TypeError('the native result row must belong to the same owner session.');
  }
  const denials = Array.isArray(resultRow.permission_denials) ? resultRow.permission_denials : [];
  if (denials.length !== 1) {
    throw new TypeError('permission_denials must contain exactly one entry.');
  }
  const [soleDenial] = denials;
  if (!isPlainObject(soleDenial) || soleDenial.tool_name !== 'Task' || soleDenial.tool_use_id !== toolUseId) {
    throw new TypeError('the sole permission_denials entry must correlate Task to the exact Agent tool-use id.');
  }

  // The automatic record's digests must independently match the owner stream's
  // own identity -- never merely trusted because the record claims them.
  if (record.sessionIdSha256 !== digest(sessionId) || record.toolUseIdSha256 !== digest(toolUseId)) {
    throw new TypeError('the automatic hook record digests must independently match the owner-stream session/tool-use identity.');
  }

  return mintBrandRecord(observationRoot);
}

function createHostComposition(brand) {
  const brandRecord = BRAND_RECORDS.get(brand);
  if (!brandRecord) throw new TypeError('A genuine host adapter brand is required.');

  const handles = new WeakSet();
  const observationRoot = brandRecord.observationRoot;

  function beginObservation(preEvent) {
    const identity = identityFor(preEvent);
    writeAdmissionTicket(brandRecord, identity.sessionDigest, identity.toolUseDigest);
    const handle = Object.freeze({});
    const record = {
      sessionDigest: identity.sessionDigest,
      toolUseDigest: identity.toolUseDigest,
      toolName: typeof preEvent.tool_name === 'string' ? preEvent.tool_name : '',
    };
    HANDLE_RECORDS.set(handle, record);
    handles.add(handle);
    return handle;
  }

  function correlateToolResult(handle, postEvent) {
    if (!handles.has(handle)) throw new TypeError('The observation handle was not created by this composition.');
    const record = HANDLE_RECORDS.get(handle);
    const identity = identityFor(postEvent);
    if (!record || record.sessionDigest !== identity.sessionDigest || record.toolUseDigest !== identity.toolUseDigest ||
        (record.toolName && postEvent.tool_name !== record.toolName)) {
      throw new TypeError('The result does not match the observed tool use.');
    }
    return {
      schema: 'runtime/host-observation-result/v1',
      correlated: true,
      success: postEvent.hook_event_name === 'PostToolUse',
      session_digest: record.sessionDigest,
      tool_use_digest: record.toolUseDigest,
      observed_at: new Date().toISOString(),
    };
  }

  return { beginObservation, correlateToolResult };
}

function lifecycleOwner() {
  // Lazy to preserve runtime-role-lifecycle -> runtime-host-claude callers.
  return require('./runtime-role-lifecycle.cjs');
}

function compositionDir(projectRoot) {
  return path.join(lifecycleOwner().registryRepoDir(projectRoot), 'host-compositions');
}

function compositionRecordPath(projectRoot, compositionId) {
  return path.join(compositionDir(projectRoot), compositionId + '.json');
}

function compositionConsumedPath(projectRoot, compositionId) {
  return path.join(compositionDir(projectRoot), compositionId + '.consumed.json');
}

function compositionKeyPaths(projectRoot) {
  const root = path.join(compositionDir(projectRoot), 'trust');
  return {
    privateKey: path.join(root, 'host-observer-private-key.pem'),
    anchor: path.join(root, 'host-observer-key.json'),
  };
}

function loadOrCreateProductionKey(projectRoot) {
  const files = compositionKeyPaths(projectRoot);
  fs.mkdirSync(path.dirname(files.privateKey), { recursive: true, mode: 0o700 });
  let privateKey;
  if (fs.existsSync(files.privateKey)) {
    privateKey = crypto.createPrivateKey(fs.readFileSync(files.privateKey, 'utf8'));
  } else {
    const pair = crypto.generateKeyPairSync('ed25519');
    const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    try {
      fs.writeFileSync(files.privateKey, pem, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      privateKey = pair.privateKey;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      privateKey = crypto.createPrivateKey(fs.readFileSync(files.privateKey, 'utf8'));
    }
  }
  const publicKey = crypto.createPublicKey(privateKey);
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const keyId = digestBytes(spkiDer);
  const anchor = { schema: ANCHOR_SCHEMA, key_id: keyId, public_key_spki_der_base64: spkiDer.toString('base64') };
  try {
    fs.writeFileSync(files.anchor, JSON.stringify(anchor), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    const existing = readJsonFile(files.anchor);
    if (!existing || existing.schema !== anchor.schema || existing.key_id !== anchor.key_id ||
        existing.public_key_spki_der_base64 !== anchor.public_key_spki_der_base64) {
      throw new Error('production-host-anchor-mismatch');
    }
  }
  return { privateKey, publicKey, keyId };
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function compositionPayload(record) {
  return Buffer.from(JSON.stringify([
    record.schema, record.composition_id, record.project_root_digest,
    record.worktree_id, record.plan_digest, record.entrypoint,
    record.argv_digest, record.role_scope_digest, record.actual_host,
    record.actual_model, record.actual_role_engine, record.continuity,
    record.supported_operations, record.created_at, record.expires_at,
    record.key_id,
  ]), 'utf8');
}

function transcriptModel(event) {
  if (event && event.model === 'claude-sonnet-5') return event.model;
  const transcript = event && event.transcript_path;
  if (typeof transcript !== 'string' || !path.isAbsolute(transcript)) return null;
  let raw;
  try { raw = fs.readFileSync(transcript, 'utf8'); } catch { return null; }
  const lines = raw.trim().split('\n').slice(-256).reverse();
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const model = row && row.message && row.message.model;
    if (model === 'claude-sonnet-5') return model;
  }
  return null;
}

function verifyProductionRecord(projectRoot, record, expected) {
  if (!record || record.schema !== COMPOSITION_SCHEMA || !COMPOSITION_RE.test(record.composition_id) ||
      record.project_root_digest !== digest(path.resolve(projectRoot)) ||
      typeof record.worktree_id !== 'string' || typeof record.plan_digest !== 'string' ||
      record.actual_host !== 'claude' || record.actual_model !== 'claude-sonnet-5' ||
      record.actual_role_engine !== 'claude' || record.continuity !== 'session-persistent' ||
      JSON.stringify(record.supported_operations) !== JSON.stringify(COMPOSITION_OPERATIONS) ||
      typeof record.key_id !== 'string' || !DIGEST_RE.test(record.key_id) ||
      typeof record.signature_ed25519_base64 !== 'string') return false;
  const created = Date.parse(record.created_at);
  const expires = Date.parse(record.expires_at);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > Date.now() || expires <= Date.now() ||
      expires - created > COMPOSITION_TTL_SECONDS * 1000) return false;
  const scope = lifecycleOwner();
  let worktreeId;
  try { worktreeId = scope.computeWorktreeId(projectRoot); } catch { return false; }
  const plan = scope.discoverPlan(projectRoot);
  if (!plan.ok || record.worktree_id !== worktreeId || record.plan_digest !== plan.planDigest) return false;
  if (expected && (record.entrypoint !== expected.entrypoint || record.argv_digest !== expected.argvDigest ||
      record.role_scope_digest !== digest(JSON.stringify(expected.roleScope)))) return false;
  const anchor = readJsonFile(compositionKeyPaths(projectRoot).anchor);
  if (!anchor || anchor.schema !== ANCHOR_SCHEMA || anchor.key_id !== record.key_id) return false;
  let publicKey;
  try {
    const der = Buffer.from(anchor.public_key_spki_der_base64, 'base64');
    if (digestBytes(der) !== anchor.key_id) return false;
    publicKey = crypto.createPublicKey({ key: der, type: 'spki', format: 'der' });
  } catch { return false; }
  return crypto.verify(null, compositionPayload(record), publicKey,
    Buffer.from(record.signature_ed25519_base64, 'base64'));
}

function mintProductionHostComposition(options) {
  const projectRoot = options && options.projectRoot;
  if (!isUsableRoot(projectRoot) || !options.event || options.event.hook_event_name !== 'PreToolUse' ||
      options.event.tool_name !== 'Bash' || !ENTRYPOINT_NAME_RE.test(options.entrypoint) ||
      typeof options.argvDigest !== 'string' || !DIGEST_RE.test(options.argvDigest)) return { ok: false };
  const actualModel = transcriptModel(options.event);
  if (actualModel !== 'claude-sonnet-5') return { ok: false };
  const owner = lifecycleOwner();
  const pair = owner.resolvePolicyPair(projectRoot);
  if (!pair.ok || pair.policy.schema !== 'runtime-collaboration-policy/v2' || pair.policy.version !== 2 ||
      pair.policy.selection.requested_host !== 'claude' ||
      pair.policy.selection.requested_role_engine !== 'claude' ||
      pair.policy.selection.required_continuity !== 'session-persistent' ||
      pair.policy.selection.fallback.mode !== 'deny' || pair.policy.selection.fallback.allowed.length !== 0) {
    return { ok: false };
  }
  let worktreeId;
  try { worktreeId = owner.computeWorktreeId(projectRoot); } catch { return { ok: false }; }
  const plan = owner.discoverPlan(projectRoot);
  if (!plan.ok) return { ok: false };
  const keys = loadOrCreateProductionKey(projectRoot);
  const compositionId = crypto.randomBytes(16).toString('hex');
  const createdAt = new Date();
  const record = {
    schema: COMPOSITION_SCHEMA,
    composition_id: compositionId,
    project_root_digest: digest(path.resolve(projectRoot)),
    worktree_id: worktreeId,
    plan_digest: plan.planDigest,
    entrypoint: options.entrypoint,
    argv_digest: options.argvDigest,
    role_scope_digest: digest(JSON.stringify(options.roleScope)),
    actual_host: 'claude',
    actual_model: actualModel,
    actual_role_engine: 'claude',
    continuity: 'session-persistent',
    supported_operations: [...COMPOSITION_OPERATIONS],
    created_at: createdAt.toISOString(),
    expires_at: new Date(createdAt.getTime() + COMPOSITION_TTL_SECONDS * 1000).toISOString(),
    key_id: keys.keyId,
  };
  record.signature_ed25519_base64 = crypto.sign(null, compositionPayload(record), keys.privateKey).toString('base64');
  fs.mkdirSync(compositionDir(projectRoot), { recursive: true, mode: 0o700 });
  fs.writeFileSync(compositionRecordPath(projectRoot, compositionId), JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { ok: true, compositionId, record };
}

const ENTRYPOINT_NAME_RE = /^(init-session|resume-work|work|ingest-content|monitor-docs)$/;

function consumeProductionHostComposition(projectRoot, compositionId, expected) {
  if (!COMPOSITION_RE.test(compositionId)) return { ok: false };
  const record = readJsonFile(compositionRecordPath(projectRoot, compositionId));
  if (!verifyProductionRecord(projectRoot, record, expected)) return { ok: false };
  try {
    fs.writeFileSync(compositionConsumedPath(projectRoot, compositionId), JSON.stringify({
      schema: 'runtime/claude-host-composition-consumed/v1', composition_id: compositionId,
      consumed_at: new Date().toISOString(),
    }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error && error.code === 'EEXIST') return { ok: false };
    throw error;
  }
  return { ok: true, record };
}

function validateProductionHostComposition(projectRoot, compositionId, expected) {
  if (!COMPOSITION_RE.test(compositionId) || fs.existsSync(compositionConsumedPath(projectRoot, compositionId))) return { ok: false };
  const record = readJsonFile(compositionRecordPath(projectRoot, compositionId));
  return verifyProductionRecord(projectRoot, record, expected) ? { ok: true, record } : { ok: false };
}

function findCurrentProductionAdmission(projectRoot) {
  let names;
  try { names = fs.readdirSync(compositionDir(projectRoot)); } catch { return null; }
  const records = [];
  for (const name of names) {
    if (!/^[0-9a-f]{32}\.json$/.test(name)) continue;
    const record = readJsonFile(path.join(compositionDir(projectRoot), name));
    if (verifyProductionRecord(projectRoot, record, null)) records.push(record);
  }
  records.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return records[0] || null;
}

function operationForAction(action) {
  if (!action || action.runtime !== 'claude-native') return null;
  if (action.kind === 'role-spawn' || action.kind === 'root-source-spawn') return 'Agent';
  if (action.kind === 'role-rebind' || action.kind === 'role-notify') return 'SendMessage';
  if (action.kind === 'role-stop-owned') return 'SendMessage';
  return null;
}

module.exports = {
  createHostComposition,
  mintProductionHostComposition,
  consumeProductionHostComposition,
  validateProductionHostComposition,
  findCurrentProductionAdmission,
  operationForAction,
  COMPOSITION_OPERATIONS,
  __TEST_ONLY__mintHostAdapterBrand: mintHostAdapterBrand,
  __TEST_ONLY__admitIbindEvidence: admitIbindEvidence,
};
