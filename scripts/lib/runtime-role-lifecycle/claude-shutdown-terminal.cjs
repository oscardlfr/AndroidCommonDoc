'use strict';

const SCHEMA_PENDING = 'runtime/claude-shutdown-terminal-pending/v1';
const SCHEMA_CONFIRMED = 'runtime/claude-shutdown-terminal-confirmed/v1';
const SCHEMA_FAILED = 'runtime/claude-shutdown-terminal-failed/v1';
const SCHEMA_CONSUMED = 'runtime/claude-shutdown-terminal-consumed/v1';
const TTL_SECONDS = 300;
const SCAN_CAP = 64;

function createClaudeShutdownTerminal(deps) {
  const {
    CANONICAL_ROLES, canonicalJSONStringify, CLAUDE_STARTUP_ACTOR_KEYS, CLAUDE_STARTUP_ACTOR_SCHEMA,
    claudeStartupActorPathFor, computeWorktreeId, currentClockMsForRegistry, ensureSecureRegistryDir,
    findUniqueClaudePeerRoleActorBinding, hasExactKeys, isHexActionId, isHexDigest64,
    isCanonicalIsoUtc, isoPlusSecondsForRegistry, isoToMsForRegistry, nowIsoForRegistry,
    path, peekSessionGeneration, publishNoClobber, readRegistryRecord, registryRepoDir, sha256String,
  } = deps;

  const pendingKeys = [
    'actor_binding_id', 'agent_digest', 'created_at', 'expiry', 'plan_digest', 'recipient',
    'schema', 'session_digest', 'session_generation_id', 'tool_use_digest', 'worktree_id',
  ];
  const confirmedKeys = [...pendingKeys, 'request_id'].sort();
  const failedKeys = [...pendingKeys, 'reason'].sort();

  function validIdentity(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 512;
  }

  function validRole(value) {
    return typeof value === 'string' && CANONICAL_ROLES.includes(value);
  }

  function currentTarget(projectRoot, sessionId, role) {
    const generation = peekSessionGeneration(projectRoot, {
      provider: 'claude-hook', runtime_session_key: sessionId,
    });
    if (!generation.ok) return { ok: false, reason: 'INVALID' };
    const worktreeId = computeWorktreeId(projectRoot);
    const traceDir = path.join(registryRepoDir(projectRoot), 'claude-id01-traces');
    let entries;
    try { entries = deps.fs.readdirSync(traceDir, { withFileTypes: true }); }
    catch { return { ok: false, reason: 'INVALID' }; }
    if (entries.length > 1024) return { ok: false, reason: 'INVALID' };
    const matches = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const read = readRegistryRecord(path.join(traceDir, entry.name));
      if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'INVALID' };
      const record = read.obj;
      if (record.schema !== CLAUDE_STARTUP_ACTOR_SCHEMA
          || record.session_generation_digest !== sha256String(generation.generationId)
          || record.worktree_id !== worktreeId || record.role !== role
          || record.session_digest !== sha256String(sessionId)) continue;
      if (!hasExactKeys(record, CLAUDE_STARTUP_ACTOR_KEYS)
          || !isHexActionId(record.actor_binding_id) || !isHexDigest64(record.agent_digest)
          || !isHexDigest64(record.plan_digest) || !isCanonicalIsoUtc(record.created_at)
          || !isCanonicalIsoUtc(record.expiry)
          || isoToMsForRegistry(record.created_at) > currentClockMsForRegistry()
          || isoToMsForRegistry(record.expiry) <= currentClockMsForRegistry()) {
        return { ok: false, reason: 'INVALID' };
      }
      matches.push(record);
    }
    if (matches.length !== 1) return { ok: false, reason: matches.length === 0 ? 'UNAVAILABLE' : 'INVALID' };
    const startup = matches[0];
    const actor = findUniqueClaudePeerRoleActorBinding(projectRoot, {
      generationId: generation.generationId, planDigest: startup.plan_digest, role, worktreeId,
    });
    if (!actor.ok || actor.binding.binding_id !== startup.actor_binding_id) return { ok: false, reason: 'INVALID' };
    return { ok: true, generationId: generation.generationId, startup, worktreeId };
  }

  function scope(projectRoot, event) {
    if (!validIdentity(projectRoot) || !path.isAbsolute(projectRoot) || !event
        || !validIdentity(event.sessionId) || !validIdentity(event.toolUseId)
        || !validRole(event.recipient)) return null;
    const sessionDigest = sha256String(event.sessionId);
    const toolUseDigest = sha256String(event.toolUseId);
    const dir = path.join(registryRepoDir(projectRoot), 'claude-shutdown-terminal', sessionDigest, event.recipient);
    const stem = path.join(dir, toolUseDigest);
    return { dir, sessionDigest, toolUseDigest, stem };
  }

  function readExact(file, schema, keys, expected) {
    const read = readRegistryRecord(file);
    if (!read.ok) return { ok: false, reason: 'INVALID' };
    if (read.absent) return { ok: true, absent: true };
    const value = read.obj;
    if (!value || !hasExactKeys(value, keys) || value.schema !== schema
        || value.session_digest !== expected.sessionDigest
        || value.tool_use_digest !== expected.toolUseDigest
        || value.recipient !== expected.recipient
        || !isHexActionId(value.actor_binding_id) || !isHexDigest64(value.agent_digest)
        || !isHexDigest64(value.plan_digest) || !isHexDigest64(value.worktree_id)
        || typeof value.session_generation_id !== 'string'
        || !isCanonicalIsoUtc(value.created_at) || !isCanonicalIsoUtc(value.expiry)
        || isoToMsForRegistry(value.expiry) <= isoToMsForRegistry(value.created_at)) {
      return { ok: false, reason: 'INVALID' };
    }
    return { ok: true, record: value };
  }

  function publishExact(file, record) {
    const secured = ensureSecureRegistryDir(path.dirname(file));
    if (!secured.ok) return { ok: false, reason: 'INVALID' };
    try {
      publishNoClobber(file, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
      return { ok: true, record };
    } catch {
      const read = readRegistryRecord(file);
      return read.ok && !read.absent && canonicalJSONStringify(read.obj) === canonicalJSONStringify(record)
        ? { ok: true, record: read.obj, replay: true }
        : { ok: false, reason: 'INVALID' };
    }
  }

  function reserveClaudeShutdownTerminal(projectRoot, event) {
    const resolved = scope(projectRoot, event);
    if (!resolved) return { ok: false, reason: 'INVALID' };
    const target = currentTarget(projectRoot, event.sessionId, event.recipient);
    if (!target.ok) return target;
    const existing = readExact(resolved.stem + '.pending.json', SCHEMA_PENDING, pendingKeys, {
      ...resolved, recipient: event.recipient,
    });
    if (!existing.ok) return existing;
    if (existing.record) {
      return existing.record.actor_binding_id === target.startup.actor_binding_id
        && existing.record.agent_digest === target.startup.agent_digest
        ? { ok: true, record: existing.record, replay: true }
        : { ok: false, reason: 'INVALID' };
    }
    const createdAt = nowIsoForRegistry();
    const record = {
      actor_binding_id: target.startup.actor_binding_id,
      agent_digest: target.startup.agent_digest,
      created_at: createdAt,
      expiry: isoPlusSecondsForRegistry(createdAt, TTL_SECONDS),
      plan_digest: target.startup.plan_digest,
      recipient: event.recipient,
      schema: SCHEMA_PENDING,
      session_digest: resolved.sessionDigest,
      session_generation_id: target.generationId,
      tool_use_digest: resolved.toolUseDigest,
      worktree_id: target.worktreeId,
    };
    return publishExact(resolved.stem + '.pending.json', record);
  }

  function settleClaudeShutdownTerminal(projectRoot, event) {
    const resolved = scope(projectRoot, event);
    if (!resolved || !['confirmed', 'failed'].includes(event.outcome)) return { ok: false, reason: 'INVALID' };
    const expected = { ...resolved, recipient: event.recipient };
    const pending = readExact(resolved.stem + '.pending.json', SCHEMA_PENDING, pendingKeys, expected);
    if (!pending.ok || pending.absent || currentClockMsForRegistry() >= isoToMsForRegistry(pending.record.expiry)) {
      return { ok: false, reason: 'INVALID' };
    }
    if (event.outcome === 'confirmed') {
      if (typeof event.requestId !== 'string' || event.requestId.length === 0 || event.requestId.length > 256) {
        return { ok: false, reason: 'INVALID' };
      }
      return publishExact(resolved.stem + '.confirmed.json', {
        ...pending.record, schema: SCHEMA_CONFIRMED, request_id: event.requestId,
      });
    }
    return publishExact(resolved.stem + '.failed.json', {
      ...pending.record, schema: SCHEMA_FAILED, reason: 'host-sendmessage-failed',
    });
  }

  function findClaudeShutdownTerminalForRole(projectRoot, event) {
    if (!validIdentity(projectRoot) || !path.isAbsolute(projectRoot) || !event
        || !validIdentity(event.sessionId) || !validIdentity(event.agentId)
        || !validRole(event.agentType)) return { ok: false, reason: 'INVALID' };
    const target = currentTarget(projectRoot, event.sessionId, event.agentType);
    if (!target.ok) return target;
    const sessionDigest = sha256String(event.sessionId);
    const dir = path.join(registryRepoDir(projectRoot), 'claude-shutdown-terminal', sessionDigest, event.agentType);
    let entries;
    try { entries = deps.fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) {
      return error && error.code === 'ENOENT' ? { ok: true, status: 'NONE' } : { ok: false, reason: 'INVALID' };
    }
    if (entries.length > SCAN_CAP * 4) return { ok: false, reason: 'INVALID' };
    const stems = new Set();
    for (const entry of entries) {
      const match = /^([0-9a-f]{64})\.(pending|confirmed|failed|consumed)\.json$/.exec(entry.name);
      if (!entry.isFile() || !match) return { ok: false, reason: 'INVALID' };
      stems.add(match[1]);
    }
    if (stems.size > SCAN_CAP) return { ok: false, reason: 'INVALID' };
    const candidates = [];
    let pendingOnly = false;
    for (const toolUseDigest of stems) {
      const stem = path.join(dir, toolUseDigest);
      const expected = { recipient: event.agentType, sessionDigest, toolUseDigest };
      const pending = readExact(stem + '.pending.json', SCHEMA_PENDING, pendingKeys, expected);
      const confirmed = readExact(stem + '.confirmed.json', SCHEMA_CONFIRMED, confirmedKeys, expected);
      const failed = readExact(stem + '.failed.json', SCHEMA_FAILED, failedKeys, expected);
      const consumed = readRegistryRecord(stem + '.consumed.json');
      if (!pending.ok) return { ok: false, reason: 'INVALID_PENDING' };
      if (!confirmed.ok) return { ok: false, reason: 'INVALID_CONFIRMED' };
      if (!failed.ok) return { ok: false, reason: 'INVALID_FAILED' };
      if (!consumed.ok) return { ok: false, reason: 'INVALID_CONSUMED_READ' };
      if (!consumed.absent && (!consumed.obj
          || !hasExactKeys(consumed.obj, ['consumed_at', 'request_id', 'schema'])
          || consumed.obj.schema !== SCHEMA_CONSUMED
          || !isCanonicalIsoUtc(consumed.obj.consumed_at)
          || typeof consumed.obj.request_id !== 'string')) return { ok: false, reason: 'INVALID' };
      if (confirmed.record && failed.record) return { ok: false, reason: 'INVALID' };
      if (!pending.record || consumed.obj || currentClockMsForRegistry() >= isoToMsForRegistry(pending.record.expiry)) continue;
      if (pending.record.actor_binding_id !== target.startup.actor_binding_id
          || pending.record.agent_digest !== sha256String(event.agentId)
          || pending.record.agent_digest !== target.startup.agent_digest
          || pending.record.session_generation_id !== target.generationId
          || pending.record.plan_digest !== target.startup.plan_digest
          || pending.record.worktree_id !== target.worktreeId) {
        return { ok: false, reason: 'INVALID' };
      }
      if (confirmed.record) candidates.push({ record: confirmed.record, stem });
      else if (!failed.record) pendingOnly = true;
    }
    if (candidates.length > 1) return { ok: false, reason: 'INVALID' };
    if (candidates.length === 1) return { ok: true, status: 'CONFIRMED', ...candidates[0] };
    return { ok: true, status: pendingOnly ? 'PENDING' : 'NONE' };
  }

  function consumeClaudeShutdownTerminal(projectRoot, candidate) {
    if (!candidate || candidate.status !== 'CONFIRMED' || typeof candidate.stem !== 'string'
        || !candidate.record) return { ok: false, reason: 'INVALID' };
    const consumedAt = nowIsoForRegistry();
    return publishExact(candidate.stem + '.consumed.json', {
      consumed_at: consumedAt,
      request_id: candidate.record.request_id,
      schema: SCHEMA_CONSUMED,
    });
  }

  return Object.freeze({
    reserveClaudeShutdownTerminal,
    settleClaudeShutdownTerminal,
    findClaudeShutdownTerminalForRole,
    consumeClaudeShutdownTerminal,
  });
}

module.exports = Object.freeze({ createClaudeShutdownTerminal });
