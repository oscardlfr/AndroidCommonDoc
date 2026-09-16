#!/usr/bin/env node
'use strict';

// Observation-only host adapter.  Its brands and handles are deliberately
// process-local capabilities; persisted admission records contain only
// correlation digests and a verifier tag, never host identity or authority.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalJSONStringify, publishNoClobber } = require('./runtime-consultation.cjs');
const runtimeProjectContext = require('./runtime-project-context.cjs');

const CAPABILITY_ENV_VAR = 'RUNTIME_HOST_OBSERVATION_TEST_CAPABILITY';
const CAPABILITY_VALUE = 'p1i-observation-red-fixture-capability';
const BRAND_RECORDS = new WeakMap();
const HANDLE_RECORDS = new WeakMap();
const ANCHOR_SCHEMA = 'runtime/host-observation-trust-anchor/v1';
const TICKET_SCHEMA = 'runtime/host-observation-admission/v1';
const COMPOSITION_SCHEMA = 'runtime/claude-host-composition/v2';
const COMPOSITION_TTL_SECONDS = 120;
const SESSION_EVIDENCE_SCHEMA = 'runtime/claude-session-evidence/v2';
const SESSION_EVIDENCE_TTL_SECONDS = 12 * 60 * 60;
const INTERACTIVE_PIN_EVIDENCE_SCHEMA = 'runtime/claude-interactive-pin-evidence/v1';
const INTERACTIVE_PIN_EVIDENCE_KEYS = Object.freeze([
  'executable_digest', 'expires_at', 'host_contract_digest', 'key_id', 'observed_at',
  'observation_source', 'pin_digest', 'plan_digest', 'process_birth_digest',
  'process_id', 'schema', 'session_digest', 'signature_ed25519_base64', 'worktree_id',
].sort());
const SESSION_EVIDENCE_KEYS = Object.freeze([
  'actual_host', 'actual_model', 'actual_role_engine', 'continuity', 'expires_at',
  'host_contract_digest', 'key_id', 'observation_source', 'pin_digest', 'plan_digest',
  'project_root_digest', 'requested_profile_digest', 'requested_profile_name', 'schema',
  'session_digest', 'signature_ed25519_base64', 'started_at', 'worktree_id',
].sort());
const DIRECT_ROLE_HOST_SCHEMA = 'runtime/claude-direct-role-host/v1';
const DIRECT_ROLE_HOST_KEYS = Object.freeze([
  'action_digest', 'action_id', 'actual_host', 'actual_model', 'bootstrap_digest',
  'continuity', 'definition_digest', 'expires_at', 'host_contract_digest', 'key_id',
  'launch_argv_digest', 'observation_source', 'parent_session_digest', 'pin_digest',
  'plan_digest', 'process_birth_digest', 'process_id', 'project_root_digest',
  'requested_profile_digest', 'requested_profile_name', 'role', 'schema',
  'session_digest', 'signature_ed25519_base64', 'started_at', 'worktree_id',
].sort());
const COMPOSITION_OPERATIONS = Object.freeze(['Agent', 'Bash', 'SendMessage', 'TaskOutput']);
const COMPOSITION_RE = /^[0-9a-f]{32}$/;
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REQUESTED_MODEL_ALIASES = new Set(['haiku', 'sonnet', 'opus']);
const NATIVE_TOOL_OUTCOME_SCHEMA = 'runtime/native-tool-outcome/v1';
const NATIVE_TOOL_OUTCOME_KEYS = Object.freeze([
  'action_digest', 'action_id', 'canonical_input_digest', 'evidence_method',
  'execution_input_exact', 'model_deviation', 'observed_at', 'observed_input_digest',
  'original_input_digest', 'outcome', 'reservation_digest', 'schema',
  'session_digest', 'tool_use_digest',
].sort());
const PRODUCTION_NATIVE_EVIDENCE_METHOD = 'POST_TOOL_INPUT';
const HOST_CONTRACT_PACKAGE_SCHEMA = 'runtime/claude-host-contract-package/v1';
const HOST_CONTRACT_CERTIFICATE_SCHEMA = 'runtime/claude-id01-host-contract/v1';
const HOST_CONTRACT_PROBE_EVENT_SCHEMA = 'runtime/claude-host-contract-probe-event/v1';
const HOST_CONTRACT_QUALIFICATION_SCHEMA = 'androidcommondoc/p1-native-host-contract-qualification/v1';
const HOST_CONTRACT_PROBE_VERSION = HOST_CONTRACT_PROBE_EVENT_SCHEMA;
const HOST_CONTRACT_PACKAGE_KEYS = Object.freeze(['anchor', 'certificate', 'schema']);
const HOST_CONTRACT_CERTIFICATE_KEYS = Object.freeze([
  'bundle_digest', 'cli_version', 'distinct_same_type_peers', 'evidence_method',
  'executable_digest', 'extra_tools_mcp_compatible', 'key_id', 'observations_digest',
  'observed_at', 'observer_digest', 'os', 'pin_digest', 'probe_contract_version',
  'required_hooks_observed', 'schema', 'signature_ed25519_base64',
  'stable_actor_resume', 'transport_profile',
].sort());

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

function runtimeToolkitRootFor(projectRoot) {
  const context = runtimeProjectContext.resolveRuntimeProjectContext(projectRoot);
  if (context.ok) return context.toolkitRoot;
  // Hermetic legacy/unit fixtures without a manifest remain self-contained.
  // Once a manifest exists, an invalid runtime source must fail closed.
  if (!fs.existsSync(path.join(projectRoot, 'l0-manifest.json'))) return projectRoot;
  return null;
}

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

function boundedLiteral(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function boundedArgvToken(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function boundedMultilineLiteral(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(value);
}

function resolveRequestedModelProfile(projectRoot, role) {
  if (!isUsableRoot(projectRoot) || (role !== undefined && role !== null && !PROFILE_NAME_RE.test(role))) {
    return { ok: false, reason: 'requested-profile-input-invalid' };
  }
  const toolkitRoot = runtimeToolkitRootFor(projectRoot);
  if (!toolkitRoot) return { ok: false, reason: 'requested-profile-runtime-context-invalid' };
  const document = readJsonFile(path.join(toolkitRoot, '.claude', 'model-profiles.json'));
  if (!isPlainObject(document) || !hasExactKeys(document, ['current', 'profiles']) ||
      !PROFILE_NAME_RE.test(document.current) || !isPlainObject(document.profiles)) {
    return { ok: false, reason: 'requested-profile-document-invalid' };
  }
  const profile = document.profiles[document.current];
  if (!isPlainObject(profile) || !hasExactKeys(profile, ['default_model', 'description', 'overrides']) ||
      !boundedLiteral(profile.description, 1024) || !REQUESTED_MODEL_ALIASES.has(profile.default_model) ||
      !isPlainObject(profile.overrides) || Object.keys(profile.overrides).length > 128) {
    return { ok: false, reason: 'requested-profile-selected-invalid' };
  }
  for (const [profileRole, model] of Object.entries(profile.overrides)) {
    if (!PROFILE_NAME_RE.test(profileRole) || !REQUESTED_MODEL_ALIASES.has(model)) {
      return { ok: false, reason: 'requested-profile-override-invalid' };
    }
  }
  const canonical = canonicalJSONStringify({ name: document.current, profile });
  return {
    ok: true,
    name: document.current,
    digest: digest(canonical),
    requestedModel: role && Object.prototype.hasOwnProperty.call(profile.overrides, role)
      ? profile.overrides[role]
      : profile.default_model,
  };
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

function hostContractPackagePath(projectRoot) {
  const toolkitRoot = runtimeToolkitRootFor(projectRoot);
  return toolkitRoot ? path.join(toolkitRoot, 'setup', 'claude-host-contract.json') : null;
}

function hostContractCertificatePayload(record) {
  return Buffer.from(JSON.stringify([
    record.schema, record.pin_digest, record.cli_version, record.executable_digest,
    record.bundle_digest, record.os, record.probe_contract_version, record.observer_digest,
    record.transport_profile, record.evidence_method, record.stable_actor_resume,
    record.distinct_same_type_peers, record.required_hooks_observed,
    record.extra_tools_mcp_compatible, record.observations_digest,
    record.observed_at, record.key_id,
  ]), 'utf8');
}

function verifiedAnchor(anchor) {
  if (!isPlainObject(anchor) || !hasExactKeys(anchor, ['key_id', 'public_key_spki_der_base64', 'schema']) ||
      anchor.schema !== ANCHOR_SCHEMA || !DIGEST_RE.test(anchor.key_id) ||
      typeof anchor.public_key_spki_der_base64 !== 'string') return null;
  try {
    const der = Buffer.from(anchor.public_key_spki_der_base64, 'base64');
    if (der.length === 0 || digestBytes(der) !== anchor.key_id) return null;
    return crypto.createPublicKey({ key: der, type: 'spki', format: 'der' });
  } catch {
    return null;
  }
}

function selectedHostPin(options) {
  if (!options || !isUsableRoot(options.executablePath) || !isUsableRoot(options.observerPath) ||
      !boundedLiteral(options.cliVersion, 128) || !boundedLiteral(options.os, 64) ||
      !boundedLiteral(options.transportProfile, 128)) return { ok: false, reason: 'HOST_PIN_INPUT_INVALID' };
  let executableRealpath;
  let observerRealpath;
  let executableStat;
  let observerStat;
  let executableBytes;
  let observerBytes;
  try {
    executableRealpath = fs.realpathSync(options.executablePath);
    observerRealpath = fs.realpathSync(options.observerPath);
    executableStat = fs.statSync(executableRealpath);
    observerStat = fs.statSync(observerRealpath);
    if (!executableStat.isFile() || !observerStat.isFile()) return { ok: false, reason: 'HOST_PIN_FILE_INVALID' };
    executableBytes = fs.readFileSync(executableRealpath);
    observerBytes = fs.readFileSync(observerRealpath);
  } catch {
    return { ok: false, reason: 'HOST_PIN_UNAVAILABLE' };
  }
  const pin = {
    executable_digest: digestBytes(executableBytes),
    bundle_digest: null,
    cli_version: options.cliVersion,
    os: options.os,
    observer_digest: digestBytes(observerBytes),
    probe_contract_version: HOST_CONTRACT_PROBE_VERSION,
    transport_profile: options.transportProfile,
  };
  return {
    ok: true,
    pin,
    pinDigest: digest(canonicalJSONStringify(pin)),
    executableRealpath,
    observerRealpath,
  };
}

function parseJsonLines(bytes) {
  const text = bytes.toString('utf8');
  if (text.length === 0 || !text.endsWith('\n')) return null;
  const lines = text.split(/\r?\n/);
  lines.pop();
  if (lines.length === 0 || lines.length > 10000) return null;
  try { return lines.map((line) => JSON.parse(line)); } catch { return null; }
}

function eventSummaryMatchesRaw(row) {
  const raw = row && row.raw_event;
  if (!isPlainObject(row) || !isPlainObject(raw) ||
      row.schema !== HOST_CONTRACT_PROBE_EVENT_SCHEMA || row.evidence_mode !== 'genuine-pinned' ||
      row.producer !== 'claude-host-contract-probe' || raw.hook_event_name !== row.hook_event_name ||
      !boundedLiteral(raw.session_id, 4096) || row.session_digest !== digest(raw.session_id)) return false;
  const expectedToolUse = typeof raw.tool_use_id === 'string' ? digest(raw.tool_use_id) : null;
  const expectedAgent = typeof raw.agent_id === 'string' ? digest(raw.agent_id) : null;
  const expectedInput = raw.tool_input === undefined ? null : digest(canonicalJSONStringify(raw.tool_input));
  return row.tool_use_digest === expectedToolUse && row.agent_id_digest === expectedAgent &&
    row.agent_type === (typeof raw.agent_type === 'string' ? raw.agent_type : null) &&
    row.tool_name === (typeof raw.tool_name === 'string' ? raw.tool_name : null) &&
    row.tool_input_digest === expectedInput;
}

function verifyHostProbeObservations(observerBytes, streamBytes, qualification) {
  const rows = parseJsonLines(observerBytes);
  const stream = parseJsonLines(streamBytes);
  if (!rows || !stream || !rows.every(eventSummaryMatchesRaw)) return { ok: false, reason: 'HOST_PROBE_EVENT_INVALID' };
  const sessionStarts = rows.filter((row) => row.hook_event_name === 'SessionStart');
  const agentPre = rows.filter((row) => row.hook_event_name === 'PreToolUse' && row.tool_name === 'Agent');
  const agentPost = rows.filter((row) => row.hook_event_name === 'PostToolUse' && row.tool_name === 'Agent');
  const starts = rows.filter((row) => row.hook_event_name === 'SubagentStart');
  const stops = rows.filter((row) => row.hook_event_name === 'SubagentStop');
  const sendPre = rows.filter((row) => row.hook_event_name === 'PreToolUse' && row.tool_name === 'SendMessage');
  const sendPost = rows.filter((row) => row.hook_event_name === 'PostToolUse' && row.tool_name === 'SendMessage');
  if (sessionStarts.length !== 1 || agentPre.length !== 2 || agentPost.length !== 2 || starts.length !== 3 ||
      stops.length !== 3 || sendPre.length !== 1 || sendPost.length !== 1) {
    return { ok: false, reason: 'HOST_PROBE_HOOK_TOPOLOGY_INVALID' };
  }
  const sessionDigest = sessionStarts[0].session_digest;
  if (!rows.every((row) => row.session_digest === sessionDigest) ||
      qualification.session_id !== sessionStarts[0].raw_event.session_id) {
    return { ok: false, reason: 'HOST_PROBE_SESSION_MISMATCH' };
  }
  const exactAgentKeys = ['description', 'name', 'prompt', 'run_in_background', 'subagent_type'].sort();
  const expectedAgentProfiles = new Map([
    ['probe-peer-a', { runInBackground: true, status: 'async_launched' }],
    ['probe-peer-b', { runInBackground: false, status: 'completed' }],
  ]);
  for (const pre of agentPre) {
    const post = agentPost.find((candidate) => candidate.tool_use_digest === pre.tool_use_digest);
    const input = pre.raw_event.tool_input;
    const expectedProfile = isPlainObject(input) ? expectedAgentProfiles.get(input.name) : null;
    const response = post && post.raw_event.tool_response;
    if (!post || !isPlainObject(pre.raw_event.tool_input) ||
        !hasExactKeys(pre.raw_event.tool_input, exactAgentKeys) ||
        !expectedProfile || pre.raw_event.tool_input.run_in_background !== expectedProfile.runInBackground ||
        pre.raw_event.tool_input.subagent_type !== 'probe-peer' ||
        pre.updated_input_digest !== pre.tool_input_digest ||
        post.tool_input_digest !== pre.tool_input_digest ||
        !isPlainObject(response) || response.status !== expectedProfile.status ||
        (expectedProfile.runInBackground && response.isAsync !== true)) {
      return { ok: false, reason: 'HOST_PROBE_AGENT_INPUT_INVALID' };
    }
  }
  const [startA, resumedA, startB] = starts.map((row) => row.raw_event);
  if (!boundedLiteral(startA.agent_id, 256) || startA.agent_id !== resumedA.agent_id ||
      startA.agent_id === startB.agent_id || startA.agent_type !== 'probe-peer' ||
      resumedA.agent_type !== 'probe-peer' || startB.agent_type !== 'probe-peer') {
    return { ok: false, reason: 'HOST_PROBE_ACTOR_TOPOLOGY_INVALID' };
  }
  const postA = agentPost.find((row) => row.tool_use_digest === agentPre[0].tool_use_digest);
  const postB = agentPost.find((row) => row.tool_use_digest === agentPre[1].tool_use_digest);
  if (postA.raw_event.tool_response.agentId !== startA.agent_id ||
      postB.raw_event.tool_response.agentId !== startB.agent_id) {
    return { ok: false, reason: 'HOST_PROBE_ACTOR_TOPOLOGY_INVALID' };
  }
  const wakePre = sendPre[0];
  const wakePost = sendPost[0];
  if (wakePre.tool_use_digest !== wakePost.tool_use_digest || !isPlainObject(wakePost.raw_event.tool_response) ||
      wakePost.raw_event.tool_response.success !== true || wakePost.raw_event.tool_response.resumedAgentId !== startA.agent_id) {
    return { ok: false, reason: 'HOST_PROBE_RESUME_INVALID' };
  }
  const indexOf = (row) => rows.indexOf(row);
  const firstStartIndex = indexOf(starts[0]);
  const firstStopIndex = indexOf(stops[0]);
  const resumeStartIndex = indexOf(starts[1]);
  const resumeStopIndex = indexOf(stops[1]);
  const bStartIndex = indexOf(starts[2]);
  const bStopIndex = indexOf(stops[2]);
  const actorPreTools = (actorDigest, from, to) => rows.filter((row, index) => index > from && index < to &&
    row.hook_event_name === 'PreToolUse' && row.agent_id_digest === actorDigest && boundedLiteral(row.tool_name, 128));
  const aInitialTools = actorPreTools(starts[0].agent_id_digest, firstStartIndex, firstStopIndex);
  const aResumedTools = actorPreTools(starts[1].agent_id_digest, resumeStartIndex, resumeStopIndex);
  const bTools = actorPreTools(starts[2].agent_id_digest, bStartIndex, bStopIndex);
  if (new Set(aInitialTools.map((row) => row.tool_use_digest)).size < 2 || aResumedTools.length < 1 || bTools.length < 1 ||
      // The resume is caused by the wake REQUEST, not by its completion event: a
      // host may start the resumed actor while the wake call is still in flight,
      // so SubagentStart can legitimately precede PostToolUse(SendMessage).
      // Observed live on darwin in BOTH orders across runs. Nothing is weakened --
      // actor A must still have stopped before the wake, wakePost must still exist
      // and carry success:true with resumedAgentId === startA.agent_id (checked
      // above), and the remaining order is still asserted.
      !(firstStartIndex < firstStopIndex && firstStopIndex < indexOf(wakePre) && indexOf(wakePre) < resumeStartIndex &&
        resumeStartIndex < resumeStopIndex && resumeStopIndex < indexOf(agentPre[1]) && indexOf(agentPre[1]) < bStartIndex && bStartIndex < bStopIndex)) {
    return { ok: false, reason: 'HOST_PROBE_SEQUENCE_INVALID' };
  }
  const initRows = stream.filter((row) => row && row.type === 'system' && row.subtype === 'init');
  if (initRows.length !== 1 || initRows[0].session_id !== qualification.session_id ||
      initRows[0].claude_code_version !== qualification.cli.version || initRows[0].model !== qualification.cli.actual_model ||
      !Array.isArray(initRows[0].tools) || !['Task', 'Bash', 'Read', 'SendMessage'].every((tool) => initRows[0].tools.includes(tool)) ||
      !initRows[0].tools.every((tool) => boundedLiteral(tool, 128)) ||
      !Array.isArray(initRows[0].mcp_servers) || !initRows[0].mcp_servers.every((server) => isPlainObject(server) && boundedLiteral(server.name, 128))) {
    return { ok: false, reason: 'HOST_PROBE_SYSTEM_INIT_INVALID' };
  }
  return {
    ok: true,
    stableActorResume: true,
    distinctSameTypePeers: true,
    requiredHooksObserved: true,
    extraToolsMcpCompatible: true,
  };
}

function resolveEvidencePath(evidenceRoot, relativeName) {
  if (!isUsableRoot(evidenceRoot) || !boundedLiteral(relativeName, 1024) || path.isAbsolute(relativeName)) return null;
  const root = path.resolve(evidenceRoot);
  const candidate = path.resolve(root, relativeName);
  if (candidate === root || !candidate.startsWith(root + path.sep)) return null;
  try {
    const real = fs.realpathSync(candidate);
    if (real === root || !real.startsWith(fs.realpathSync(root) + path.sep) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

function publishClaudeHostContractPackage(options) {
  const projectRoot = options && options.projectRoot;
  const evidenceRoot = options && options.evidenceRoot;
  const qualificationPath = options && options.qualificationPath;
  const observerPath = options && options.observerPath;
  if (!isUsableRoot(projectRoot) || !isUsableRoot(evidenceRoot) || !isUsableRoot(qualificationPath) || !isUsableRoot(observerPath)) {
    return { ok: false, reason: 'HOST_CONTRACT_INPUT_INVALID' };
  }
  const qualification = readJsonFile(qualificationPath);
  if (!isPlainObject(qualification) || qualification.schema !== HOST_CONTRACT_QUALIFICATION_SCHEMA ||
      qualification.status !== 'HOST_CONTRACT_OBSERVED' || !boundedLiteral(qualification.session_id, 4096) ||
      !boundedLiteral(qualification.qualified_at, 128) || !Number.isFinite(Date.parse(qualification.qualified_at)) ||
      qualification.transport_profile !== 'native-claude-cli' || !isPlainObject(qualification.cli) ||
      !boundedLiteral(qualification.cli.version, 128) || !isUsableRoot(qualification.cli.executable_realpath) ||
      !DIGEST_RE.test(qualification.cli.executable_sha256) || !boundedLiteral(qualification.cli.actual_model, 128) ||
      !isPlainObject(qualification.evidence_sha256) || !isPlainObject(qualification.observed_contract)) {
    return { ok: false, reason: 'HOST_CONTRACT_QUALIFICATION_INVALID' };
  }
  const declaredRequirements = [
    'same_actor_resume', 'different_same_type_peer', 'required_tools_present',
    'additional_tools_allowed', 'post_tool_use_exposes_executed_input', 'canonical_five_key_input_executed',
  ];
  if (!declaredRequirements.every((key) => qualification.observed_contract[key] === true)) {
    return { ok: false, reason: 'HOST_CONTRACT_QUALIFICATION_NOT_POSITIVE' };
  }
  const evidence = new Map();
  const evidenceEntries = Object.entries(qualification.evidence_sha256);
  if (evidenceEntries.length === 0 || evidenceEntries.length > 256) return { ok: false, reason: 'HOST_CONTRACT_EVIDENCE_INVALID' };
  for (const [name, expectedDigest] of evidenceEntries) {
    const resolved = resolveEvidencePath(evidenceRoot, name);
    if (!resolved || !DIGEST_RE.test(expectedDigest)) return { ok: false, reason: 'HOST_CONTRACT_EVIDENCE_PATH_INVALID' };
    let bytes;
    try { bytes = fs.readFileSync(resolved); } catch { return { ok: false, reason: 'HOST_CONTRACT_EVIDENCE_UNREADABLE' }; }
    if (digestBytes(bytes) !== expectedDigest) return { ok: false, reason: 'HOST_CONTRACT_EVIDENCE_DIGEST_MISMATCH' };
    evidence.set(name, bytes);
  }
  const observerBytes = evidence.get('observer/events.jsonl');
  const streamBytes = evidence.get('claude-stream.jsonl');
  if (!observerBytes || !streamBytes) return { ok: false, reason: 'HOST_CONTRACT_REQUIRED_EVIDENCE_MISSING' };
  const observed = verifyHostProbeObservations(observerBytes, streamBytes, qualification);
  if (!observed.ok) return observed;
  const pin = selectedHostPin({
    executablePath: qualification.cli.executable_realpath,
    observerPath,
    cliVersion: qualification.cli.version,
    os: process.platform,
    transportProfile: qualification.transport_profile,
  });
  if (!pin.ok || pin.pin.executable_digest !== qualification.cli.executable_sha256) {
    return { ok: false, reason: 'HOST_CONTRACT_EXECUTABLE_PIN_MISMATCH' };
  }
  const keys = loadOrCreateProductionKey(projectRoot);
  const certificate = {
    schema: HOST_CONTRACT_CERTIFICATE_SCHEMA,
    pin_digest: pin.pinDigest,
    cli_version: pin.pin.cli_version,
    executable_digest: pin.pin.executable_digest,
    bundle_digest: null,
    os: pin.pin.os,
    probe_contract_version: pin.pin.probe_contract_version,
    observer_digest: pin.pin.observer_digest,
    transport_profile: pin.pin.transport_profile,
    evidence_method: PRODUCTION_NATIVE_EVIDENCE_METHOD,
    stable_actor_resume: observed.stableActorResume,
    distinct_same_type_peers: observed.distinctSameTypePeers,
    required_hooks_observed: observed.requiredHooksObserved,
    extra_tools_mcp_compatible: observed.extraToolsMcpCompatible,
    observations_digest: digestBytes(observerBytes),
    observed_at: new Date(qualification.qualified_at).toISOString(),
    key_id: keys.keyId,
  };
  certificate.signature_ed25519_base64 = crypto.sign(null, hostContractCertificatePayload(certificate), keys.privateKey).toString('base64');
  const anchor = readJsonFile(compositionKeyPaths(projectRoot).anchor);
  if (!verifiedAnchor(anchor) || anchor.key_id !== keys.keyId || !hasExactKeys(certificate, HOST_CONTRACT_CERTIFICATE_KEYS)) {
    return { ok: false, reason: 'HOST_CONTRACT_INTERNAL_SHAPE' };
  }
  const pkg = { schema: HOST_CONTRACT_PACKAGE_SCHEMA, certificate, anchor };
  // Qualification publishes only from the toolkit/self root. Consumers read
  // this immutable package through their source reference and never publish it.
  const packagePath = path.join(projectRoot, 'setup', 'claude-host-contract.json');
  const packageBytes = Buffer.from(canonicalJSONStringify(pkg), 'utf8');
  try {
    fs.mkdirSync(path.dirname(packagePath), { recursive: true, mode: 0o700 });
    publishNoClobber(packagePath, packageBytes, {});
  } catch {
    let existing;
    try { existing = fs.readFileSync(packagePath); } catch { return { ok: false, reason: 'HOST_CONTRACT_PUBLISH_FAILED' }; }
    if (!existing.equals(packageBytes)) return { ok: false, reason: 'HOST_CONTRACT_PACKAGE_CONFLICT' };
  }
  return { ok: true, packagePath, package: pkg, pinDigest: certificate.pin_digest,
    hostContractDigest: digest(canonicalJSONStringify(certificate)) };
}

function readVerifiedHostContractPackage(projectRoot) {
  if (!isUsableRoot(projectRoot)) return { ok: false, reason: 'HOST_CONTRACT_ROOT_INVALID' };
  const packagePath = hostContractPackagePath(projectRoot);
  if (!packagePath) return { ok: false, reason: 'HOST_CONTRACT_RUNTIME_CONTEXT_INVALID' };
  const pkg = readJsonFile(packagePath);
  if (!isPlainObject(pkg) || !hasExactKeys(pkg, HOST_CONTRACT_PACKAGE_KEYS) ||
      pkg.schema !== HOST_CONTRACT_PACKAGE_SCHEMA || !isPlainObject(pkg.certificate) ||
      !hasExactKeys(pkg.certificate, HOST_CONTRACT_CERTIFICATE_KEYS)) {
    return { ok: false, reason: 'HOST_CONTRACT_PACKAGE_INVALID' };
  }
  const certificate = pkg.certificate;
  if (certificate.schema !== HOST_CONTRACT_CERTIFICATE_SCHEMA || certificate.bundle_digest !== null ||
      !DIGEST_RE.test(certificate.pin_digest) || !DIGEST_RE.test(certificate.executable_digest) ||
      !DIGEST_RE.test(certificate.observer_digest) || !DIGEST_RE.test(certificate.observations_digest) ||
      certificate.probe_contract_version !== HOST_CONTRACT_PROBE_VERSION ||
      certificate.evidence_method !== PRODUCTION_NATIVE_EVIDENCE_METHOD ||
      certificate.stable_actor_resume !== true || certificate.distinct_same_type_peers !== true ||
      certificate.required_hooks_observed !== true || certificate.extra_tools_mcp_compatible !== true ||
      !boundedLiteral(certificate.cli_version, 128) || !boundedLiteral(certificate.os, 64) ||
      !boundedLiteral(certificate.transport_profile, 128) || !boundedLiteral(certificate.observed_at, 128) ||
      !Number.isFinite(Date.parse(certificate.observed_at)) || !DIGEST_RE.test(certificate.key_id) ||
      typeof certificate.signature_ed25519_base64 !== 'string') {
    return { ok: false, reason: 'HOST_CONTRACT_CERTIFICATE_INVALID' };
  }
  const publicKey = verifiedAnchor(pkg.anchor);
  if (!publicKey || pkg.anchor.key_id !== certificate.key_id ||
      !crypto.verify(null, hostContractCertificatePayload(certificate), publicKey,
        Buffer.from(certificate.signature_ed25519_base64, 'base64'))) {
    return { ok: false, reason: 'HOST_CONTRACT_SIGNATURE_INVALID' };
  }
  return { ok: true, certificate, anchor: pkg.anchor, pinDigest: certificate.pin_digest,
    hostContractDigest: digest(canonicalJSONStringify(certificate)) };
}

function verifyClaudeHostContractPackage(projectRoot, options) {
  const verified = readVerifiedHostContractPackage(projectRoot);
  if (!verified.ok) return verified;
  const certificate = verified.certificate;
  const pin = selectedHostPin(options);
  if (!pin.ok || pin.pinDigest !== certificate.pin_digest ||
      pin.pin.executable_digest !== certificate.executable_digest ||
      pin.pin.observer_digest !== certificate.observer_digest ||
      pin.pin.cli_version !== certificate.cli_version || pin.pin.os !== certificate.os ||
      pin.pin.transport_profile !== certificate.transport_profile) {
    return { ok: false, reason: 'HOST_CONTRACT_PIN_DRIFT' };
  }
  return verified;
}

function sessionEvidenceDir(projectRoot) {
  return path.join(lifecycleOwner().registryRepoDir(projectRoot), 'host-sessions');
}

function sessionEvidencePath(projectRoot, sessionId) {
  return path.join(sessionEvidenceDir(projectRoot), digest(sessionId) + '.json');
}

function interactivePinEvidencePath(projectRoot, sessionId) {
  return path.join(sessionEvidenceDir(projectRoot), 'interactive-' + digest(sessionId) + '.json');
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

function queryWindowsParentChain(powerShellPath, startingPid, timeoutMs) {
  const command = [
    '$ErrorActionPreference = "Stop"',
    '$current = ' + String(startingPid),
    '$rows = @()',
    'for ($i = 0; $i -lt 8 -and $current -gt 0; $i++) {',
    '  $p = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $current)',
    '  if ($null -eq $p) { break }',
    '  $rows += [PSCustomObject]@{ process_id = [int]$p.ProcessId; parent_process_id = [int]$p.ParentProcessId; executable_path = [string]$p.ExecutablePath; creation_time = $p.CreationDate.ToUniversalTime().ToString("o") }',
    '  $current = [int]$p.ParentProcessId',
    '}',
    '$rows | ConvertTo-Json -Compress',
  ].join('\n');
  const result = spawnSync(powerShellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: timeoutMs,
  });
  if (result.status !== 0 || result.error || typeof result.stdout !== 'string' || result.stdout.trim().length === 0) return null;
  let rows;
  try { rows = JSON.parse(result.stdout); } catch { return null; }
  if (!Array.isArray(rows)) rows = [rows];
  if (rows.length === 0 || rows.length > 8) return null;
  for (const row of rows) {
    if (!isPlainObject(row) || !Number.isInteger(row.process_id) || row.process_id <= 0 ||
        !Number.isInteger(row.parent_process_id) || typeof row.executable_path !== 'string' ||
        row.executable_path.length === 0 || !Number.isFinite(Date.parse(row.creation_time))) return null;
  }
  return rows;
}

// Darwin counterpart of the Windows parent-chain walk. One `ps` snapshot is
// taken and the ppid chain is followed from the starting process, so every row
// comes from a single consistent view of the process table rather than from a
// sequence of races. `comm` on darwin is the executable path of the running
// image, which is the only thing this observation is allowed to trust: never a
// version string, never PATH, never configuration, never a SessionStart claim.
// Proven necessary on this host -- the executing binary was
// .../Claude/claude-code/2.1.260/claude.app/Contents/MacOS/claude while the
// `claude` on PATH was an entirely different 2.1.272 image.
const DARWIN_PS_ROW_RE = /^\s*(\d+)\s+(\d+)\s+(\S{3}\s+\S{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S.*?)\s*$/;

function queryDarwinParentChain(startingPid, timeoutMs) {
  const result = spawnSync('/bin/ps', ['-Awwo', 'pid=,ppid=,lstart=,comm='], {
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 24,
  });
  if (result.status !== 0 || result.error || typeof result.stdout !== 'string' || result.stdout.trim().length === 0) return null;
  const byPid = new Map();
  for (const line of result.stdout.split('\n')) {
    const match = DARWIN_PS_ROW_RE.exec(line);
    if (!match) continue;
    const processId = Number(match[1]);
    const creationTime = match[3];
    if (!Number.isInteger(processId) || processId <= 0 || !Number.isFinite(Date.parse(creationTime))) continue;
    byPid.set(processId, {
      process_id: processId,
      parent_process_id: Number(match[2]),
      creation_time: creationTime,
      executable_path: match[4],
    });
  }
  const rows = [];
  const seen = new Set();
  let current = startingPid;
  // Same bound as the Windows walk: at most 8 ancestors, and a cycle stops it.
  while (Number.isInteger(current) && current > 0 && byPid.has(current) && !seen.has(current) && rows.length < 8) {
    seen.add(current);
    const row = byPid.get(current);
    rows.push(row);
    current = row.parent_process_id;
  }
  if (rows.length === 0) return null;
  for (const row of rows) {
    if (typeof row.executable_path !== 'string' || row.executable_path.length === 0) return null;
  }
  return rows;
}

// The observation source is bound to the platform that produced it, so a record
// can never claim a chain it did not walk.
const PIN_OBSERVATION_SOURCES = Object.freeze({
  win32: 'interactive-windows-parent-chain',
  darwin: 'interactive-darwin-parent-chain',
});

function pinObservationSourceFor(platform) {
  return Object.prototype.hasOwnProperty.call(PIN_OBSERVATION_SOURCES, platform)
    ? PIN_OBSERVATION_SOURCES[platform]
    : null;
}

function queryHostParentChain(startingPid, timeoutMs) {
  if (process.platform === 'win32') {
    let powerShellPath;
    try { powerShellPath = require('./runtime-bridge-codex.cjs').resolvedWindowsPowerShellPath(); } catch { powerShellPath = null; }
    if (!powerShellPath) return null;
    return queryWindowsParentChain(powerShellPath, startingPid, timeoutMs);
  }
  if (process.platform === 'darwin') return queryDarwinParentChain(startingPid, timeoutMs);
  return null;
}

function observeClaudeExecutablePin(options) {
  const projectRoot = options && options.projectRoot;
  const startingPid = options && options.startingPid !== undefined ? options.startingPid : process.pid;
  const observationSource = pinObservationSourceFor(process.platform);
  if (observationSource === null || !isUsableRoot(projectRoot) || !Number.isInteger(startingPid) || startingPid <= 0) {
    return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  }
  const startedMs = Date.now();
  const contract = readVerifiedHostContractPackage(projectRoot);
  // The certificate must have been issued for the platform doing the observing.
  // A Windows-issued certificate can never be discharged by a darwin chain, and
  // vice versa.
  if (!contract.ok || contract.certificate.os !== process.platform) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  const before = queryHostParentChain(startingPid, 10000);
  if (!before || Date.now() - startedMs >= 15000) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  const matches = [];
  for (const row of before) {
    // A non-absolute image name (darwin `comm` reports a bare name for a process
    // launched through a PATH lookup) identifies nothing: resolving it would be
    // resolved against the CURRENT working directory and could match an
    // unrelated file of the same name. Such an ancestor is never provable.
    if (!path.isAbsolute(row.executable_path)) continue;
    try {
      const resolved = fs.realpathSync(row.executable_path);
      const stat = fs.statSync(resolved);
      if (stat.isFile() && digestBytes(fs.readFileSync(resolved)) === contract.certificate.executable_digest) {
        matches.push({ row, resolved });
      }
    } catch { /* this ancestor is not a provable selected Claude binary */ }
    if (Date.now() - startedMs >= 15000) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  }
  if (matches.length !== 1) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  const remainingMs = 15000 - (Date.now() - startedMs);
  if (remainingMs <= 0) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  const after = queryHostParentChain(startingPid, Math.min(10000, remainingMs));
  if (!after || Date.now() - startedMs > 15000) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  const match = matches[0];
  // Same identity test on both platforms: the pid, its birth time, and the image
  // path must all still agree. Windows keeps its case-insensitive comparison;
  // darwin compares canonical paths exactly rather than lowercasing, which would
  // be a weakening rather than a portability fix.
  const samePath = (candidate) => {
    let resolvedCandidate;
    try { resolvedCandidate = fs.realpathSync(candidate); } catch { return false; }
    const left = path.resolve(resolvedCandidate);
    const right = path.resolve(match.resolved);
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
  };
  const stable = after.filter((row) => row.process_id === match.row.process_id &&
    row.creation_time === match.row.creation_time && samePath(row.executable_path));
  if (stable.length !== 1) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  return {
    ok: true,
    observationSource,
    processId: match.row.process_id,
    processBirth: match.row.creation_time,
    executablePath: match.resolved,
    executableDigest: contract.certificate.executable_digest,
    pinDigest: contract.pinDigest,
    hostContractDigest: contract.hostContractDigest,
  };
}

function interactivePinEvidencePayload(record) {
  return Buffer.from(JSON.stringify([
    record.schema, record.session_digest, record.worktree_id, record.plan_digest,
    record.pin_digest, record.host_contract_digest, record.executable_digest,
    record.process_id, record.process_birth_digest, record.observation_source,
    record.observed_at, record.expires_at, record.key_id,
  ]), 'utf8');
}

function verifyInteractivePinEvidence(projectRoot, record, sessionId) {
  if (!record || !hasExactKeys(record, INTERACTIVE_PIN_EVIDENCE_KEYS) ||
      record.schema !== INTERACTIVE_PIN_EVIDENCE_SCHEMA || record.session_digest !== digest(sessionId) ||
      !DIGEST_RE.test(record.worktree_id) || !DIGEST_RE.test(record.plan_digest) ||
      !DIGEST_RE.test(record.pin_digest) || !DIGEST_RE.test(record.host_contract_digest) ||
      !DIGEST_RE.test(record.executable_digest) || !DIGEST_RE.test(record.process_birth_digest) ||
      !Number.isInteger(record.process_id) || record.process_id <= 0 ||
      record.observation_source !== pinObservationSourceFor(process.platform) ||
      !boundedLiteral(record.observed_at, 128) || !boundedLiteral(record.expires_at, 128) ||
      !DIGEST_RE.test(record.key_id) || typeof record.signature_ed25519_base64 !== 'string') return false;
  const observed = Date.parse(record.observed_at);
  const expires = Date.parse(record.expires_at);
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || observed > Date.now() || expires <= Date.now() ||
      expires - observed > SESSION_EVIDENCE_TTL_SECONDS * 1000) return false;
  const contract = readVerifiedHostContractPackage(projectRoot);
  if (!contract.ok || contract.pinDigest !== record.pin_digest || contract.hostContractDigest !== record.host_contract_digest ||
      contract.certificate.executable_digest !== record.executable_digest) return false;
  const anchor = readJsonFile(compositionKeyPaths(projectRoot).anchor);
  const publicKey = verifiedAnchor(anchor);
  if (!publicKey || anchor.key_id !== record.key_id) return false;
  return crypto.verify(null, interactivePinEvidencePayload(record), publicKey,
    Buffer.from(record.signature_ed25519_base64, 'base64'));
}

function recordInteractiveSessionPin(options) {
  const projectRoot = options && options.projectRoot;
  const event = options && options.event;
  if (!isUsableRoot(projectRoot) || !event || event.hook_event_name !== 'SessionStart' ||
      !boundedLiteral(event.session_id, 4096) || typeof event.cwd !== 'string' ||
      path.resolve(event.cwd) !== path.resolve(projectRoot)) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  const observed = observeClaudeExecutablePin({ projectRoot, startingPid: process.pid });
  if (!observed.ok) return observed;
  const owner = lifecycleOwner();
  let worktreeId;
  try { worktreeId = owner.computeWorktreeId(projectRoot); } catch { return { ok: false, reason: 'HOST_PIN_UNPROVEN' }; }
  const plan = owner.discoverPlan(projectRoot);
  if (!plan.ok) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
  const keys = loadOrCreateProductionKey(projectRoot);
  const now = new Date();
  const record = {
    schema: INTERACTIVE_PIN_EVIDENCE_SCHEMA,
    session_digest: digest(event.session_id), worktree_id: worktreeId, plan_digest: plan.planDigest,
    pin_digest: observed.pinDigest, host_contract_digest: observed.hostContractDigest,
    executable_digest: observed.executableDigest, process_id: observed.processId,
    process_birth_digest: digest(observed.processBirth),
    observation_source: observed.observationSource, observed_at: now.toISOString(),
    expires_at: new Date(now.getTime() + SESSION_EVIDENCE_TTL_SECONDS * 1000).toISOString(), key_id: keys.keyId,
  };
  record.signature_ed25519_base64 = crypto.sign(null, interactivePinEvidencePayload(record), keys.privateKey).toString('base64');
  const destination = interactivePinEvidencePath(projectRoot, event.session_id);
  try { publishNoClobber(destination, Buffer.from(canonicalJSONStringify(record), 'utf8'), {}); }
  catch {
    const existing = readJsonFile(destination);
    if (!verifyInteractivePinEvidence(projectRoot, existing, event.session_id)) return { ok: false, reason: 'HOST_PIN_UNPROVEN' };
    return { ok: true, record: existing, idempotent: true };
  }
  return { ok: true, record, idempotent: false };
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function sessionEvidencePayload(record) {
  return Buffer.from(JSON.stringify([
    record.schema, record.session_digest, record.project_root_digest,
    record.worktree_id, record.plan_digest, record.actual_host,
    record.actual_model, record.actual_role_engine, record.continuity,
    record.requested_profile_name, record.requested_profile_digest,
    record.observation_source, record.pin_digest, record.host_contract_digest,
    record.started_at, record.expires_at, record.key_id,
  ]), 'utf8');
}

function verifyProductionSessionRecord(projectRoot, record, sessionId) {
  if (!record || !hasExactKeys(record, SESSION_EVIDENCE_KEYS) || record.schema !== SESSION_EVIDENCE_SCHEMA ||
      record.session_digest !== digest(sessionId) ||
      record.project_root_digest !== digest(path.resolve(projectRoot)) ||
      typeof record.worktree_id !== 'string' || typeof record.plan_digest !== 'string' ||
      record.actual_host !== 'claude' || !boundedLiteral(record.actual_model, 128) ||
      record.actual_role_engine !== 'claude' || record.continuity !== 'session-persistent' ||
      record.observation_source !== 'managed-system-init-stream' ||
      !PROFILE_NAME_RE.test(record.requested_profile_name) || !DIGEST_RE.test(record.requested_profile_digest) ||
      !DIGEST_RE.test(record.pin_digest) || !DIGEST_RE.test(record.host_contract_digest) ||
      typeof record.key_id !== 'string' || !DIGEST_RE.test(record.key_id) ||
      typeof record.signature_ed25519_base64 !== 'string') return false;
  const started = Date.parse(record.started_at);
  const expires = Date.parse(record.expires_at);
  if (!Number.isFinite(started) || !Number.isFinite(expires) || started > Date.now() ||
      expires <= Date.now() || expires - started > SESSION_EVIDENCE_TTL_SECONDS * 1000) return false;
  const owner = lifecycleOwner();
  let worktreeId;
  try { worktreeId = owner.computeWorktreeId(projectRoot); } catch { return false; }
  const plan = owner.discoverPlan(projectRoot);
  if (!plan.ok || record.worktree_id !== worktreeId || record.plan_digest !== plan.planDigest) return false;
  const profile = resolveRequestedModelProfile(projectRoot, null);
  if (!profile.ok || profile.name !== record.requested_profile_name || profile.digest !== record.requested_profile_digest) return false;
  const hostContract = readVerifiedHostContractPackage(projectRoot);
  if (!hostContract.ok || hostContract.pinDigest !== record.pin_digest ||
      hostContract.hostContractDigest !== record.host_contract_digest) return false;
  const anchor = readJsonFile(compositionKeyPaths(projectRoot).anchor);
  if (!anchor || anchor.schema !== ANCHOR_SCHEMA || anchor.key_id !== record.key_id) return false;
  let publicKey;
  try {
    const der = Buffer.from(anchor.public_key_spki_der_base64, 'base64');
    if (digestBytes(der) !== anchor.key_id) return false;
    publicKey = crypto.createPublicKey({ key: der, type: 'spki', format: 'der' });
  } catch { return false; }
  return crypto.verify(null, sessionEvidencePayload(record), publicKey,
    Buffer.from(record.signature_ed25519_base64, 'base64'));
}

function recordProductionSessionIdentity(options) {
  const projectRoot = options && options.projectRoot;
  const event = options && options.event;
  if (!isUsableRoot(projectRoot) || !event || typeof event.session_id !== 'string' ||
      event.session_id.length === 0 || !boundedLiteral(event.model, 128) ||
      typeof event.cwd !== 'string' || path.resolve(event.cwd) !== path.resolve(projectRoot)) return { ok: false };
  const fromSystemInit = event.type === 'system' && event.subtype === 'init';
  if (!fromSystemInit || !Array.isArray(event.tools) || event.tools.length === 0 || event.tools.length > 256 ||
      !event.tools.every((tool) => boundedLiteral(tool, 128)) || new Set(event.tools).size !== event.tools.length ||
      !event.tools.includes('Bash') || !event.tools.includes('SendMessage') ||
      (!event.tools.includes('Agent') && !event.tools.includes('Task')) ||
      !Array.isArray(event.mcp_servers) || event.mcp_servers.length > 128 ||
      !event.mcp_servers.every((server) => isPlainObject(server) && boundedLiteral(server.name, 128))) {
    return { ok: false, reason: 'INVALID_SYSTEM_INIT_EVIDENCE' };
  }
  const profile = resolveRequestedModelProfile(projectRoot, null);
  if (!profile.ok) return profile;
  const hostContract = verifyClaudeHostContractPackage(projectRoot, options && options.hostPin);
  if (!hostContract.ok) return { ok: false, reason: hostContract.reason || 'HOST_PIN_UNPROVEN' };
  const owner = lifecycleOwner();
  let worktreeId;
  try { worktreeId = owner.computeWorktreeId(projectRoot); } catch { return { ok: false }; }
  const plan = owner.discoverPlan(projectRoot);
  if (!plan.ok) return { ok: false };
  const keys = loadOrCreateProductionKey(projectRoot);
  const startedAt = new Date();
  const record = {
    schema: SESSION_EVIDENCE_SCHEMA,
    session_digest: digest(event.session_id),
    project_root_digest: digest(path.resolve(projectRoot)),
    worktree_id: worktreeId,
    plan_digest: plan.planDigest,
    actual_host: 'claude',
    actual_model: event.model,
    actual_role_engine: 'claude',
    continuity: 'session-persistent',
    requested_profile_name: profile.name,
    requested_profile_digest: profile.digest,
    observation_source: 'managed-system-init-stream',
    pin_digest: hostContract.pinDigest,
    host_contract_digest: hostContract.hostContractDigest,
    started_at: startedAt.toISOString(),
    expires_at: new Date(startedAt.getTime() + SESSION_EVIDENCE_TTL_SECONDS * 1000).toISOString(),
    key_id: keys.keyId,
  };
  record.signature_ed25519_base64 = crypto.sign(null, sessionEvidencePayload(record), keys.privateKey).toString('base64');
  fs.mkdirSync(sessionEvidenceDir(projectRoot), { recursive: true, mode: 0o700 });
  const destination = sessionEvidencePath(projectRoot, event.session_id);
  try {
    fs.writeFileSync(destination, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    const existing = readJsonFile(destination);
    if (existing && (existing.actual_model !== event.model || existing.pin_digest !== hostContract.pinDigest ||
        existing.host_contract_digest !== hostContract.hostContractDigest ||
        existing.requested_profile_name !== profile.name || existing.requested_profile_digest !== profile.digest)) {
      return { ok: false, reason: 'STALE_OBSERVATION' };
    }
    if (!verifyProductionSessionRecord(projectRoot, existing, event.session_id)) return { ok: false, reason: 'INVALID_EXISTING_OBSERVATION' };
    return { ok: true, record: existing };
  }
  return { ok: true, record };
}

function productionSessionObservation(projectRoot, event) {
  if (!event || typeof event.session_id !== 'string' || event.session_id.length === 0) return null;
  const record = readJsonFile(sessionEvidencePath(projectRoot, event.session_id));
  return verifyProductionSessionRecord(projectRoot, record, event.session_id) ? record : null;
}

function getProductionSessionIdentity(projectRoot, sessionId) {
  if (!isUsableRoot(projectRoot) || !boundedLiteral(sessionId, 4096)) return { ok: false };
  const record = productionSessionObservation(projectRoot, { session_id: sessionId });
  if (record) return { ok: true, record };
  const interactive = readJsonFile(interactivePinEvidencePath(projectRoot, sessionId));
  return verifyInteractivePinEvidence(projectRoot, interactive, sessionId)
    ? { ok: true, record: interactive }
    : { ok: false };
}

function directRoleHostDir(projectRoot) {
  return path.join(compositionDir(projectRoot), 'direct-role-hosts');
}

function directRoleHostPath(projectRoot, sessionId) {
  return path.join(directRoleHostDir(projectRoot), digest(sessionId) + '.json');
}

function directRoleHostPayload(record) {
  return Buffer.from(JSON.stringify([
    record.schema, record.session_digest, record.parent_session_digest, record.role,
    record.action_id, record.action_digest, record.launch_argv_digest,
    record.definition_digest, record.bootstrap_digest, record.project_root_digest,
    record.worktree_id, record.plan_digest, record.actual_host, record.actual_model,
    record.continuity, record.requested_profile_name, record.requested_profile_digest,
    record.observation_source, record.pin_digest, record.host_contract_digest,
    record.process_id, record.process_birth_digest, record.started_at, record.expires_at,
    record.key_id,
  ]), 'utf8');
}

function verifyDirectRoleHostRecord(projectRoot, record, roleSessionId) {
  if (!isUsableRoot(projectRoot) || !boundedLiteral(roleSessionId, 4096) ||
      !record || !hasExactKeys(record, DIRECT_ROLE_HOST_KEYS) ||
      record.schema !== DIRECT_ROLE_HOST_SCHEMA || record.session_digest !== digest(roleSessionId) ||
      !DIGEST_RE.test(record.parent_session_digest) || !PROFILE_NAME_RE.test(record.role) ||
      !COMPOSITION_RE.test(record.action_id) || !DIGEST_RE.test(record.action_digest) ||
      !DIGEST_RE.test(record.launch_argv_digest) || !DIGEST_RE.test(record.definition_digest) ||
      !DIGEST_RE.test(record.bootstrap_digest) || record.project_root_digest !== digest(path.resolve(projectRoot)) ||
      !DIGEST_RE.test(record.worktree_id) || !DIGEST_RE.test(record.plan_digest) ||
      record.actual_host !== 'claude' || !boundedLiteral(record.actual_model, 128) ||
      record.continuity !== 'session-persistent' || !PROFILE_NAME_RE.test(record.requested_profile_name) ||
      !DIGEST_RE.test(record.requested_profile_digest) ||
      record.observation_source !== 'managed-role-system-init-stream' ||
      !DIGEST_RE.test(record.pin_digest) || !DIGEST_RE.test(record.host_contract_digest) ||
      !Number.isInteger(record.process_id) || record.process_id <= 0 ||
      !DIGEST_RE.test(record.process_birth_digest) || !DIGEST_RE.test(record.key_id) ||
      typeof record.signature_ed25519_base64 !== 'string') return false;
  const started = Date.parse(record.started_at);
  const expires = Date.parse(record.expires_at);
  if (!Number.isFinite(started) || !Number.isFinite(expires) || started > Date.now() || expires <= Date.now() ||
      expires - started > SESSION_EVIDENCE_TTL_SECONDS * 1000) return false;
  const owner = lifecycleOwner();
  let worktreeId;
  try { worktreeId = owner.computeWorktreeId(projectRoot); } catch { return false; }
  const plan = owner.discoverPlan(projectRoot);
  const profile = resolveRequestedModelProfile(projectRoot, record.role);
  const contract = readVerifiedHostContractPackage(projectRoot);
  if (!plan.ok || record.worktree_id !== worktreeId || record.plan_digest !== plan.planDigest ||
      !profile.ok || record.requested_profile_name !== profile.name ||
      record.requested_profile_digest !== profile.digest || !contract.ok ||
      record.pin_digest !== contract.pinDigest || record.host_contract_digest !== contract.hostContractDigest) return false;
  const anchor = readJsonFile(compositionKeyPaths(projectRoot).anchor);
  const publicKey = verifiedAnchor(anchor);
  if (!publicKey || anchor.key_id !== record.key_id) return false;
  try {
    return crypto.verify(null, directRoleHostPayload(record), publicKey,
      Buffer.from(record.signature_ed25519_base64, 'base64'));
  } catch {
    return false;
  }
}

function canonicalDirectRoleAction(projectRoot, presentedAction, requireStored) {
  if (!isUsableRoot(projectRoot) || !isPlainObject(presentedAction) ||
      (presentedAction.operation !== undefined && presentedAction.operation !== 'Agent')) return null;
  const normalized = { ...presentedAction };
  delete normalized.operation;
  const owner = lifecycleOwner();
  const read = owner.readRegistryRecord(owner.actionPathFor(projectRoot, normalized.action_id));
  if (!read.ok || read.absent) {
    return !requireStored && presentedAction.operation === undefined ? normalized : null;
  }
  return canonicalJSONStringify(read.obj) === canonicalJSONStringify(normalized) ? read.obj : null;
}

function recordDirectRoleHostIdentity(options) {
  const projectRoot = options && options.projectRoot;
  const event = options && options.event;
  const parentSessionId = options && options.parentSessionId;
  const role = options && options.role;
  const action = canonicalDirectRoleAction(projectRoot, options && options.action, false);
  const launchArgv = options && options.launchArgv;
  const actionRole = action && action.payload && action.payload.agent_type;
  const supportedAction = action && action.runtime === 'claude-native' &&
    (action.kind === 'role-spawn' || action.kind === 'root-source-spawn');
  if (!isUsableRoot(projectRoot) || !event || event.type !== 'system' || event.subtype !== 'init' ||
      !boundedLiteral(event.session_id, 4096) || !boundedLiteral(parentSessionId, 4096) ||
      !PROFILE_NAME_RE.test(role || '') || !boundedLiteral(event.model, 128) ||
      typeof event.cwd !== 'string' || path.resolve(event.cwd) !== path.resolve(projectRoot) ||
      !Array.isArray(event.tools) || event.tools.length === 0 || event.tools.length > 256 ||
      !event.tools.every((tool) => boundedLiteral(tool, 128)) || new Set(event.tools).size !== event.tools.length ||
      !event.tools.includes('Bash') || event.tools.includes('Agent') || event.tools.includes('Task') ||
      (action && action.kind === 'role-spawn' && event.tools.includes('SendMessage')) ||
      !Array.isArray(event.mcp_servers) ||
      event.mcp_servers.length > 128 || !event.mcp_servers.every((server) => isPlainObject(server) && boundedLiteral(server.name, 128)) ||
      !Array.isArray(event.agents) || !event.agents.includes(role) ||
      !supportedAction || actionRole !== role ||
      (action.kind === 'role-spawn' && action.role !== role) ||
      !COMPOSITION_RE.test(action.action_id || '') ||
      !action.payload || !boundedMultilineLiteral(action.payload.bootstrap_message, 65536) ||
      !Array.isArray(launchArgv) || launchArgv.length === 0 || launchArgv.length > 256 ||
      !launchArgv.every((token) => boundedArgvToken(token, 65536)) ||
      !DIGEST_RE.test(options.definitionDigest || '') ||
      !Number.isInteger(options.processId) || options.processId <= 0 ||
      !boundedLiteral(options.processBirth, 4096)) {
    return { ok: false, reason: 'INVALID_DIRECT_ROLE_HOST_EVIDENCE' };
  }
  const parent = getProductionSessionIdentity(projectRoot, parentSessionId);
  if (!parent.ok || parent.record.schema !== SESSION_EVIDENCE_SCHEMA ||
      parent.record.session_digest !== digest(parentSessionId)) {
    return { ok: false, reason: 'DIRECT_ROLE_PARENT_UNPROVEN' };
  }
  const owner = lifecycleOwner();
  let worktreeId;
  try { worktreeId = owner.computeWorktreeId(projectRoot); } catch { return { ok: false, reason: 'DIRECT_ROLE_SCOPE_INVALID' }; }
  const plan = owner.discoverPlan(projectRoot);
  const profile = resolveRequestedModelProfile(projectRoot, role);
  const contract = readVerifiedHostContractPackage(projectRoot);
  if (!plan.ok || !profile.ok || !contract.ok || parent.record.worktree_id !== worktreeId ||
      parent.record.plan_digest !== plan.planDigest || parent.record.pin_digest !== contract.pinDigest ||
      parent.record.host_contract_digest !== contract.hostContractDigest) {
    return { ok: false, reason: 'DIRECT_ROLE_SCOPE_INVALID' };
  }
  const now = new Date();
  const parentExpiry = Date.parse(parent.record.expires_at);
  if (!Number.isFinite(parentExpiry) || parentExpiry <= now.getTime()) {
    return { ok: false, reason: 'DIRECT_ROLE_PARENT_EXPIRED' };
  }
  const keys = loadOrCreateProductionKey(projectRoot);
  const record = {
    schema: DIRECT_ROLE_HOST_SCHEMA,
    session_digest: digest(event.session_id),
    parent_session_digest: digest(parentSessionId),
    role,
    action_id: action.action_id,
    action_digest: digest(canonicalJSONStringify(action)),
    launch_argv_digest: digest(canonicalJSONStringify(launchArgv)),
    definition_digest: options.definitionDigest,
    bootstrap_digest: digest(action.payload.bootstrap_message),
    project_root_digest: digest(path.resolve(projectRoot)),
    worktree_id: worktreeId,
    plan_digest: plan.planDigest,
    actual_host: 'claude',
    actual_model: event.model,
    continuity: 'session-persistent',
    requested_profile_name: profile.name,
    requested_profile_digest: profile.digest,
    observation_source: 'managed-role-system-init-stream',
    pin_digest: contract.pinDigest,
    host_contract_digest: contract.hostContractDigest,
    process_id: options.processId,
    process_birth_digest: digest(options.processBirth),
    started_at: now.toISOString(),
    expires_at: new Date(Math.min(parentExpiry, now.getTime() + SESSION_EVIDENCE_TTL_SECONDS * 1000)).toISOString(),
    key_id: keys.keyId,
  };
  record.signature_ed25519_base64 = crypto.sign(null, directRoleHostPayload(record), keys.privateKey).toString('base64');
  const destination = directRoleHostPath(projectRoot, event.session_id);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(destination, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    const existing = readJsonFile(destination);
    if (!verifyDirectRoleHostRecord(projectRoot, existing, event.session_id) ||
        existing.action_digest !== record.action_digest || existing.parent_session_digest !== record.parent_session_digest ||
        existing.process_id !== record.process_id || existing.process_birth_digest !== record.process_birth_digest) {
      return { ok: false, reason: 'STALE_OBSERVATION' };
    }
    return { ok: true, record: existing, idempotent: true };
  }
  return { ok: true, record, idempotent: false };
}

function getDirectRoleHostIdentity(projectRoot, roleSessionId) {
  if (!isUsableRoot(projectRoot) || !boundedLiteral(roleSessionId, 4096)) return { ok: false };
  const record = readJsonFile(directRoleHostPath(projectRoot, roleSessionId));
  return verifyDirectRoleHostRecord(projectRoot, record, roleSessionId)
    ? { ok: true, record }
    : { ok: false };
}

function resolveObservedClaudeActor(projectRoot, event, options) {
  if (!isUsableRoot(projectRoot) || !event || !boundedLiteral(event.session_id, 4096)) {
    return { ok: false, reason: 'CLAUDE_ACTOR_UNPROVEN' };
  }
  if (boundedLiteral(event.agent_id, 4096) && PROFILE_NAME_RE.test(event.agent_type || '')) {
    return {
      ok: true, family: 'native-subagent', sessionId: event.session_id,
      agentId: event.agent_id, agentType: event.agent_type, actionId: null,
    };
  }
  const direct = getDirectRoleHostIdentity(projectRoot, event.session_id);
  const parentSessionId = options && options.parentSessionId;
  if (!direct.ok || !boundedLiteral(parentSessionId, 4096) ||
      direct.record.parent_session_digest !== digest(parentSessionId)) {
    return { ok: false, reason: 'CLAUDE_ACTOR_UNPROVEN' };
  }
  return {
    ok: true, family: 'direct-role-host', sessionId: parentSessionId,
    agentId: event.session_id, agentType: direct.record.role,
    actionId: direct.record.action_id, record: direct.record,
  };
}

function reserveDirectRoleHostLaunch(options) {
  const projectRoot = options && options.projectRoot;
  const parentSessionId = options && options.parentSessionId;
  const roleSessionId = options && options.roleSessionId;
  const action = canonicalDirectRoleAction(projectRoot, options && options.action, true);
  const role = action && action.payload && action.payload.agent_type;
  const supportedAction = action && action.runtime === 'claude-native' &&
    (action.kind === 'role-spawn' || action.kind === 'root-source-spawn');
  if (!isUsableRoot(projectRoot) || !boundedLiteral(parentSessionId, 4096) ||
      !boundedLiteral(roleSessionId, 4096) || !supportedAction ||
      !PROFILE_NAME_RE.test(role || '') ||
      (action.kind === 'role-spawn' && action.role !== role)) {
    return { ok: false, reason: 'DIRECT_ROLE_LAUNCH_INVALID' };
  }
  const parent = getProductionSessionIdentity(projectRoot, parentSessionId);
  if (!parent.ok || parent.record.schema !== SESSION_EVIDENCE_SCHEMA ||
      parent.record.worktree_id !== action.worktree_id || parent.record.plan_digest !== action.plan_digest) {
    return { ok: false, reason: 'DIRECT_ROLE_PARENT_UNPROVEN' };
  }
  const owner = lifecycleOwner();
  const binding = owner.findLiveMainOrchestratorBindingForScope(
    projectRoot, action.worktree_id, action.plan_digest,
  );
  if (!binding.ok) return { ok: false, reason: binding.reason || 'DIRECT_ROLE_MAIN_BINDING_UNAVAILABLE' };
  const canonicalInput = owner.canonicalNativeAgentInputForAction(action);
  if (!canonicalInput) return { ok: false, reason: 'DIRECT_ROLE_CANONICAL_INPUT_INVALID' };
  const canonicalInputDigest = digest(canonicalJSONStringify(canonicalInput));
  const remainingSeconds = Math.floor((Date.parse(action.expires_at) - Date.now()) / 1000);
  if (!Number.isInteger(remainingSeconds) || remainingSeconds < 1) {
    return { ok: false, reason: 'DIRECT_ROLE_ACTION_EXPIRED' };
  }
  if (action.kind === 'root-source-spawn') {
    const reservation = owner.mintRootSourceReservation(projectRoot, action, {
      mainBindingId: binding.binding.binding_id,
      sessionGenerationId: action.session_generation_id,
      runtimeSessionKey: parentSessionId,
      toolUseId: `direct-role-host:${roleSessionId}`,
      toolInputDigest: canonicalInputDigest,
      canonicalInputDigest,
      proposedInputDigest: canonicalInputDigest,
      modelDeviation: false,
    });
    return reservation.ok
      ? { ok: true, reservation: reservation.reservation, canonicalInput, canonicalInputDigest }
      : { ok: false, reason: reservation.reason || 'DIRECT_ROLE_RESERVATION_FAILED' };
  }
  const claim = owner.mintRoleSpawnExecutionClaim(projectRoot, action, binding.binding.binding_id, {
    runtimeSessionId: parentSessionId,
    sourceToolUseId: `direct-role-host:${roleSessionId}`,
    canonicalInputDigest,
    proposedInputDigest: canonicalInputDigest,
    modelDeviation: false,
  }, remainingSeconds);
  return claim.ok
    ? { ok: true, claim: claim.record, claimPath: claim.claimPath, canonicalInput, canonicalInputDigest }
    : { ok: false, reason: claim.reason || 'DIRECT_ROLE_CLAIM_FAILED' };
}

function nativeObservationDir(projectRoot) {
  return path.join(compositionDir(projectRoot), 'native-observations');
}

function nativeObservationPath(projectRoot, sessionId, toolUseId) {
  return path.join(nativeObservationDir(projectRoot), digest(sessionId + '\0' + toolUseId) + '.json');
}

function boundedRegistryNames(directory, matcher) {
  let names;
  try { names = fs.readdirSync(directory); } catch { return []; }
  if (names.length > 4096) return null;
  return names.filter((name) => matcher.test(name));
}

function actionForOwnedRecord(owner, projectRoot, actionId) {
  const read = owner.readRegistryRecord(owner.actionPathFor(projectRoot, actionId));
  return read.ok && !read.absent ? read.obj : null;
}

function resolveNativeOutcomeOwner(projectRoot, event) {
  const owner = lifecycleOwner();
  const repoDir = owner.registryRepoDir(projectRoot);
  const sessionDigest = digest(event.session_id);
  const toolUseDigest = digest(event.tool_use_id);
  const candidates = [];

  const claimNames = boundedRegistryNames(path.join(repoDir, 'role-spawn-execution-claims'), /^[0-9a-f]{32,}\.json$/);
  if (claimNames === null) return { ok: false, reason: 'NATIVE_OWNER_SCAN_LIMIT' };
  for (const name of claimNames) {
    const claim = readJsonFile(path.join(repoDir, 'role-spawn-execution-claims', name));
    if (!claim || claim.schema !== owner.ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA ||
        !hasExactKeys(claim, [...owner.ROLE_SPAWN_EXECUTION_CLAIM_KEYS].sort()) ||
        claim.runtime_session_digest !== sessionDigest || claim.source_tool_use_id_digest !== toolUseDigest) continue;
    const action = actionForOwnedRecord(owner, projectRoot, claim.action_id);
    if (!action || action.kind !== 'role-spawn' || action.runtime !== 'claude-native' ||
        claim.action_digest !== digest(canonicalJSONStringify(action))) continue;
    const canonicalInput = owner.canonicalNativeAgentInputForAction(action);
    if (!canonicalInput || claim.canonical_input_digest !== digest(canonicalJSONStringify(canonicalInput))) continue;
    candidates.push({ action, reservation: claim, originalInputDigest: claim.proposed_input_digest,
      canonicalInputDigest: claim.canonical_input_digest, modelDeviation: claim.model_deviation });
  }

  const reservationNames = boundedRegistryNames(path.join(repoDir, 'root-source-actions'), /^[0-9a-f]{32,}\.reservation\.json$/);
  if (reservationNames === null) return { ok: false, reason: 'NATIVE_OWNER_SCAN_LIMIT' };
  for (const name of reservationNames) {
    const reservation = readJsonFile(path.join(repoDir, 'root-source-actions', name));
    if (!reservation || reservation.schema !== 'runtime/root-source-reservation/v2' ||
        reservation.runtime_session_key !== event.session_id || reservation.tool_use_id !== event.tool_use_id) continue;
    const action = actionForOwnedRecord(owner, projectRoot, reservation.action_id);
    const checked = action ? owner.validateRootSourceReservationRecord(reservation, action) : { ok: false };
    if (!checked.ok || reservation.action_digest !== digest(canonicalJSONStringify(action))) continue;
    candidates.push({ action, reservation, originalInputDigest: reservation.proposed_input_digest,
      canonicalInputDigest: reservation.canonical_input_digest, modelDeviation: reservation.model_deviation });
  }

  if (candidates.length !== 1) {
    return { ok: false, reason: candidates.length === 0 ? 'NATIVE_OWNER_ABSENT' : 'NATIVE_OWNER_AMBIGUOUS' };
  }
  return { ok: true, candidate: candidates[0], sessionDigest, toolUseDigest };
}

function recordsEquivalentIgnoringObservedAt(left, right) {
  if (!left || !right) return false;
  const a = Object.assign({}, left);
  const b = Object.assign({}, right);
  delete a.observed_at;
  delete b.observed_at;
  return canonicalJSONStringify(a) === canonicalJSONStringify(b);
}

function recordProductionNativeToolOutcome(options) {
  const projectRoot = options && options.projectRoot;
  const event = options && options.event;
  if (!isUsableRoot(projectRoot) || !event || !['PostToolUse', 'PostToolUseFailure'].includes(event.hook_event_name) ||
      event.tool_name !== 'Agent' || !boundedLiteral(event.session_id, 4096) || !boundedLiteral(event.tool_use_id, 4096)) {
    return { ok: false, reason: 'NATIVE_OUTCOME_INPUT_INVALID' };
  }
  const resolved = resolveNativeOutcomeOwner(projectRoot, event);
  if (!resolved.ok) return resolved;
  const { action, reservation, originalInputDigest, canonicalInputDigest, modelDeviation } = resolved.candidate;
  const observedInputDigest = isPlainObject(event.tool_input)
    ? digest(canonicalJSONStringify(event.tool_input))
    : null;
  const record = {
    schema: NATIVE_TOOL_OUTCOME_SCHEMA,
    session_digest: resolved.sessionDigest,
    tool_use_digest: resolved.toolUseDigest,
    action_id: action.action_id,
    action_digest: digest(canonicalJSONStringify(action)),
    reservation_digest: digest(canonicalJSONStringify(reservation)),
    original_input_digest: originalInputDigest,
    canonical_input_digest: canonicalInputDigest,
    observed_input_digest: observedInputDigest,
    model_deviation: modelDeviation,
    execution_input_exact: observedInputDigest === null ? null : observedInputDigest === canonicalInputDigest,
    evidence_method: PRODUCTION_NATIVE_EVIDENCE_METHOD,
    outcome: event.hook_event_name === 'PostToolUse' ? 'SUCCEEDED' : 'FAILED',
    observed_at: new Date().toISOString(),
  };
  if (!hasExactKeys(record, NATIVE_TOOL_OUTCOME_KEYS)) return { ok: false, reason: 'NATIVE_OUTCOME_INTERNAL_SHAPE' };
  const destination = nativeObservationPath(projectRoot, event.session_id, event.tool_use_id);
  const secureDir = lifecycleOwner().ensureSecureRegistryDir(path.dirname(destination));
  if (!secureDir.ok) return { ok: false, reason: secureDir.reason };
  const existing = readJsonFile(destination);
  if (existing) {
    if (!hasExactKeys(existing, NATIVE_TOOL_OUTCOME_KEYS) || existing.schema !== NATIVE_TOOL_OUTCOME_SCHEMA ||
        !recordsEquivalentIgnoringObservedAt(existing, record)) return { ok: false, reason: 'NATIVE_OUTCOME_CONFLICT' };
    return { ok: true, idempotent: true, record: existing, recordPath: destination };
  }
  try {
    publishNoClobber(destination, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch {
    const raced = readJsonFile(destination);
    if (raced && hasExactKeys(raced, NATIVE_TOOL_OUTCOME_KEYS) && recordsEquivalentIgnoringObservedAt(raced, record)) {
      return { ok: true, idempotent: true, record: raced, recordPath: destination };
    }
    return { ok: false, reason: 'NATIVE_OUTCOME_CONFLICT' };
  }
  return { ok: true, idempotent: false, record, recordPath: destination };
}

function compositionPayload(record) {
  return Buffer.from(JSON.stringify([
    record.schema, record.composition_id, record.project_root_digest,
    record.worktree_id, record.plan_digest, record.entrypoint,
    record.argv_digest, record.role_scope_digest, record.actual_host,
    record.actual_model, record.actual_role_engine, record.continuity,
    record.requested_profile_name, record.requested_profile_digest,
    record.supported_operations, record.created_at, record.expires_at,
    record.key_id,
  ]), 'utf8');
}

function verifyProductionRecord(projectRoot, record, expected) {
  if (!record || record.schema !== COMPOSITION_SCHEMA || !COMPOSITION_RE.test(record.composition_id) ||
      record.project_root_digest !== digest(path.resolve(projectRoot)) ||
      typeof record.worktree_id !== 'string' || typeof record.plan_digest !== 'string' ||
      record.actual_host !== 'claude' || !boundedLiteral(record.actual_model, 128) ||
      record.actual_role_engine !== 'claude' || record.continuity !== 'session-persistent' ||
      !PROFILE_NAME_RE.test(record.requested_profile_name) || !DIGEST_RE.test(record.requested_profile_digest) ||
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
  const profile = resolveRequestedModelProfile(projectRoot, null);
  if (!profile.ok || profile.name !== record.requested_profile_name || profile.digest !== record.requested_profile_digest) return false;
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

function mintHostCompositionFromSessionObservation(options, sessionObservation) {
  const projectRoot = options && options.projectRoot;
  if (!isUsableRoot(projectRoot) || !sessionObservation || !ENTRYPOINT_NAME_RE.test(options.entrypoint) ||
      typeof options.argvDigest !== 'string' || !DIGEST_RE.test(options.argvDigest)) return { ok: false };
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
    actual_model: sessionObservation.actual_model,
    actual_role_engine: 'claude',
    continuity: 'session-persistent',
    requested_profile_name: sessionObservation.requested_profile_name,
    requested_profile_digest: sessionObservation.requested_profile_digest,
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

function mintProductionHostComposition(options) {
  const projectRoot = options && options.projectRoot;
  if (!isUsableRoot(projectRoot) || !options.event || options.event.hook_event_name !== 'PreToolUse' ||
      options.event.tool_name !== 'Bash') return { ok: false };
  return mintHostCompositionFromSessionObservation(
    options, productionSessionObservation(projectRoot, options.event),
  );
}

function managedSessionObservation(options) {
  const projectRoot = options && options.projectRoot;
  const sessionId = options && options.sessionId;
  if (!isUsableRoot(projectRoot) || !boundedLiteral(sessionId, 4096)) return null;
  return productionSessionObservation(projectRoot, { session_id: sessionId });
}

function mintManagedHostComposition(options) {
  const observation = managedSessionObservation(options);
  if (!observation) return { ok: false, reason: 'MANAGED_SESSION_IDENTITY_UNPROVEN' };
  const result = mintHostCompositionFromSessionObservation(options, observation);
  return result.ok ? { ...result, evidenceMethod: 'CONDUCTOR_DIRECT_EXECUTION' } : result;
}

function mintManagedLifecycleCommandAuthority(options) {
  if (!managedSessionObservation(options)) return { ok: false, reason: 'MANAGED_SESSION_IDENTITY_UNPROVEN' };
  const owner = lifecycleOwner();
  return owner.resolveOrMintManagedLifecycleGrant({
    projectRootDescriptor: options.projectRoot,
    sessionId: options.sessionId,
    subcommand: options.subcommand,
    argvDigest: options.argvDigest,
    role: options.role,
    actionId: options.actionId === undefined ? null : options.actionId,
    worktreeId: options.worktreeId,
    planDigest: options.planDigest,
  });
}

function mintManagedSupervisorStartAuthority(options) {
  if (!managedSessionObservation(options)) return { ok: false, reason: 'MANAGED_SESSION_IDENTITY_UNPROVEN' };
  const owner = lifecycleOwner();
  return owner.mintSupervisorExecutionClaimForSession(
    options.projectRoot, options.action, options.projectRoot, options.sessionId,
  );
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
  publishClaudeHostContractPackage,
  verifyClaudeHostContractPackage,
  observeClaudeExecutablePin,
  recordInteractiveSessionPin,
  mintProductionHostComposition,
  mintManagedHostComposition,
  mintManagedLifecycleCommandAuthority,
  mintManagedSupervisorStartAuthority,
  recordProductionSessionIdentity,
  getProductionSessionIdentity,
  recordDirectRoleHostIdentity,
  getDirectRoleHostIdentity,
  resolveObservedClaudeActor,
  reserveDirectRoleHostLaunch,
  recordProductionNativeToolOutcome,
  resolveRequestedModelProfile,
  consumeProductionHostComposition,
  validateProductionHostComposition,
  findCurrentProductionAdmission,
  operationForAction,
  COMPOSITION_OPERATIONS,
  __TEST_ONLY__queryHostParentChain: queryHostParentChain,
  __TEST_ONLY__pinObservationSourceFor: pinObservationSourceFor,
  __TEST_ONLY__mintHostAdapterBrand: mintHostAdapterBrand,
  __TEST_ONLY__admitIbindEvidence: admitIbindEvidence,
};
