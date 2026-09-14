'use strict';

// Deterministic MCP loopback (test-only frontend): frame encode/decode, the per-worker descriptor registry publish, the loopback TCP server, and the client-side frame exchange + rendezvous completion.

function createDeterministicMcpLoopback({
  PID_IDENTITY_KEYS,
  REGISTRY_RECORD_MAX_BYTES,
  asyncSleep,
  canonicalJSONStringify,
  classifyDurableRead,
  crypto,
  ensureSecureRegistryDir,
  fs,
  hasExactKeys,
  isHexActionId,
  isHexDigest64,
  isTestCapability,
  net,
  path,
  publishBridgeRegistryRecord,
  publishNoClobber,
  rc,
  readCanonicalRequestArtifact,
  readDurableRegistryRecordFd,
  registryRepoDir,
}) {
const DETERMINISTIC_MCP_FRAME_MAX_BYTES = 1024 * 1024;
const DETERMINISTIC_MCP_TIMEOUT_MS = 15 * 1000;
const DETERMINISTIC_MCP_DESCRIPTOR_SCHEMA = 'coordination/deterministic-mcp-loopback/v1';
const DETERMINISTIC_MCP_DESCRIPTOR_KEYS = Object.freeze([
  'capability', 'child_instance_id', 'child_pid_identity', 'expires_at', 'host',
  'port', 'role', 'schema', 'supervisor_instance_id', 'worker_session_id',
]);

function deterministicMcpDescriptorPath(worker) {
  return path.join(registryRepoDir({ repoId: worker.repoId }), 'workers', worker.role,
    worker.workerSessionId, 'deterministic-mcp-loopback.json');
}

function encodeDeterministicMcpFrame(value) {
  const body = Buffer.from(canonicalJSONStringify(value), 'utf8');
  if (body.length === 0 || body.length > DETERMINISTIC_MCP_FRAME_MAX_BYTES) {
    throw new Error('deterministic-mcp-frame-size-invalid');
  }
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function createDeterministicMcpFrameDecoder(onFrame, onError) {
  let buffered = Buffer.alloc(0);
  let expected = null;
  let terminal = false;
  return Object.freeze({
    feed(chunk) {
      if (terminal) return;
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      if (expected === null && buffered.length >= 4) {
        expected = buffered.readUInt32BE(0);
        if (expected === 0 || expected > DETERMINISTIC_MCP_FRAME_MAX_BYTES) {
          terminal = true;
          onError('deterministic-mcp-frame-size-invalid');
          return;
        }
      }
      if (expected === null || buffered.length < 4 + expected) return;
      if (buffered.length !== 4 + expected) {
        terminal = true;
        onError('deterministic-mcp-frame-trailing-bytes');
        return;
      }
      const body = buffered.subarray(4);
      let value;
      try { value = JSON.parse(body.toString('utf8')); }
      catch (err) {
        terminal = true;
        onError('deterministic-mcp-frame-json-invalid');
        return;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)
          || canonicalJSONStringify(value) !== body.toString('utf8')) {
        terminal = true;
        onError('deterministic-mcp-frame-not-canonical-object');
        return;
      }
      terminal = true;
      onFrame(value);
    },
    end() {
      if (!terminal) {
        terminal = true;
        onError('deterministic-mcp-frame-partial');
      }
    },
  });
}

function timingSafeHexEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let a;
  let b;
  try { a = Buffer.from(left, 'hex'); b = Buffer.from(right, 'hex'); } catch (err) { return false; }
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function childIdentityFromBornRecord(bornRecord) {
  return Object.freeze({
    pid: bornRecord.pid,
    executable: bornRecord.executable_path,
    birth_observed_at: bornRecord.os_birth_token,
  });
}

function startDeterministicMcpLoopbackServer({ workers, coordinationRootReal, sessionExpiry, onFatal }) {
  return new Promise((resolve) => {
    if (!isTestCapability() || !Array.isArray(workers) || workers.length === 0) {
      resolve({ ok: false, reason: 'deterministic-mcp-server-not-permitted' });
      return;
    }
    const capabilities = new Map();
    const descriptorPaths = [];
    const sockets = new Set();
    let closed = false;
    let closing = false;
    let closePromise = null;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.setNoDelay(true);
      let responded = false;
      const reject = (reason) => {
        if (responded) return;
        responded = true;
        try { socket.end(encodeDeterministicMcpFrame({ schema: 'coordination/deterministic-mcp-loopback-response/v1', ok: false, reason })); }
        catch (err) { socket.destroy(); }
      };
      const decoder = createDeterministicMcpFrameDecoder((message) => {
        if (closing || responded) { reject('deterministic-mcp-server-stopping'); return; }
        const exactKeys = ['capability', 'nonce', 'request_path', 'request_sha256', 'schema', 'target_role', 'worker_session_id'];
        if (!hasExactKeys(message, exactKeys)
            || message.schema !== 'coordination/deterministic-mcp-loopback-request/v1'
            || !isHexActionId(message.nonce) || !isHexDigest64(message.request_sha256)) {
          reject('deterministic-mcp-request-schema-invalid');
          return;
        }
        const entry = capabilities.get(message.worker_session_id);
        if (!entry || message.target_role !== entry.worker.role
            || !timingSafeHexEqual(message.capability, entry.capability)) {
          reject('deterministic-mcp-capability-invalid');
          return;
        }
        const requestRead = readCanonicalRequestArtifact(coordinationRootReal, message.request_path);
        if (!requestRead.ok || requestRead.targetRole !== entry.worker.role
            || requestRead.requestDigest !== message.request_sha256) {
          reject('deterministic-mcp-request-correlation-invalid');
          return;
        }
        const consumedPath = requestRead.requestReal + '.deterministic-mcp-consumed.json';
        try {
          const consumedState = classifyDurableRead(consumedPath, {});
          if (consumedState.state !== 'ABSENT') { reject('deterministic-mcp-rendezvous-replay'); return; }
          rc.classifyCanonicalResultForRequest(coordinationRootReal, requestRead.requestReal);
          rc.dispatchCanonical({ 'coordination-root': coordinationRootReal, request: requestRead.requestReal }, { requiredDriver: 'codex-app-server' });
        } catch (err) { reject('deterministic-mcp-request-dispatch-failed'); return; }
        const consumed = {
          schema: 'coordination/deterministic-mcp-consumed/v1',
          request_id: requestRead.request.request_id,
          request_sha256: requestRead.requestDigest,
          target_role: entry.worker.role,
          worker_session_id: entry.worker.workerSessionId,
          supervisor_instance_id: entry.worker.supervisorInstanceId,
          child_instance_id: entry.worker.bornRecord.instance_id,
          child_pid_identity: childIdentityFromBornRecord(entry.worker.bornRecord),
          nonce: message.nonce,
          consumed_at: new Date().toISOString(),
        };
        try { publishNoClobber(consumedPath, Buffer.from(canonicalJSONStringify(consumed), 'utf8')); }
        catch (err) {
          reject(err && err.code === 'EEXIST' ? 'deterministic-mcp-rendezvous-replay' : 'deterministic-mcp-consumed-publish-failed');
          return;
        }
        responded = true;
        socket.end(encodeDeterministicMcpFrame({
          schema: 'coordination/deterministic-mcp-loopback-response/v1', ok: true,
          reason: 'attached-to-retained-worker', nonce: message.nonce,
          request_id: requestRead.request.request_id, request_sha256: requestRead.requestDigest,
          worker_session_id: entry.worker.workerSessionId,
          supervisor_instance_id: entry.worker.supervisorInstanceId,
          child_instance_id: entry.worker.bornRecord.instance_id,
          child_pid_identity: childIdentityFromBornRecord(entry.worker.bornRecord),
        }));
      }, reject);
      socket.on('data', (chunk) => decoder.feed(chunk));
      socket.on('end', () => decoder.end());
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
    });
    server.once('error', () => {
      if (!closing && typeof onFatal === 'function') onFatal('DETERMINISTIC_MCP_LISTENER_FAILED');
      if (!server.listening) resolve({ ok: false, reason: 'deterministic-mcp-listen-failed' });
    });
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      try {
        for (const worker of workers) {
          if (!worker.bornRecord || worker.bornRecord.instance_id !== worker.workerSessionId) throw new Error('child-identity-invalid');
          const capability = crypto.randomBytes(32).toString('hex');
          const descriptorPath = deterministicMcpDescriptorPath(worker);
          const ensured = ensureSecureRegistryDir(path.dirname(descriptorPath));
          if (!ensured.ok) throw new Error(ensured.reason);
          const descriptor = {
            schema: DETERMINISTIC_MCP_DESCRIPTOR_SCHEMA, host: '127.0.0.1', port: address.port,
            capability, role: worker.role, worker_session_id: worker.workerSessionId,
            supervisor_instance_id: worker.supervisorInstanceId,
            child_instance_id: worker.bornRecord.instance_id,
            child_pid_identity: childIdentityFromBornRecord(worker.bornRecord), expires_at: sessionExpiry,
          };
          publishBridgeRegistryRecord(descriptorPath, Buffer.from(canonicalJSONStringify(descriptor), 'utf8'));
          descriptorPaths.push(descriptorPath);
          capabilities.set(worker.workerSessionId, { capability, worker });
        }
      } catch (err) {
        closing = true;
        for (const descriptorPath of descriptorPaths) { try { fs.unlinkSync(descriptorPath); } catch (e) {} }
        server.close(() => resolve({ ok: false, reason: 'deterministic-mcp-descriptor-publish-failed' }));
        return;
      }
      resolve({
        ok: true,
        beginClose() {
          if (closePromise) return closePromise;
          closing = true;
          closePromise = new Promise((closeResolve) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => {
              let cleanupOk = true;
              for (const descriptorPath of descriptorPaths) {
                try { fs.unlinkSync(descriptorPath); }
                catch (err) { if (!err || err.code !== 'ENOENT') cleanupOk = false; }
              }
              closed = cleanupOk;
              closeResolve({ ok: cleanupOk });
            });
          });
          return closePromise;
        },
        isClosed() { return closed; },
      });
    });
  });
}

function exchangeDeterministicMcpFrame(descriptor, message, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const socket = net.createConnection({ host: descriptor.host, port: descriptor.port });
    const finish = (result) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(result); } };
    timer = setTimeout(() => { socket.destroy(); finish({ ok: false, reason: 'deterministic-mcp-loopback-timeout' }); }, timeoutMs);
    const decoder = createDeterministicMcpFrameDecoder(
      (value) => { socket.end(); finish({ ok: true, value }); },
      (reason) => { socket.destroy(); finish({ ok: false, reason }); },
    );
    socket.once('connect', () => {
      try { socket.write(encodeDeterministicMcpFrame(message)); }
      catch (err) { socket.destroy(); finish({ ok: false, reason: 'deterministic-mcp-loopback-write-failed' }); }
    });
    socket.on('data', (chunk) => decoder.feed(chunk));
    socket.on('end', () => { if (!settled) decoder.end(); });
    socket.on('error', () => finish({ ok: false, reason: 'deterministic-mcp-loopback-connect-failed' }));
  });
}

/**
 * Completes the private W07b frontend rendezvous against a worker already
 * proven live by resolveLiveCodexAppServerWorker.  The marker is one-shot so
 * replay is rejected, and it records the existing worker/session/supervisor/
 * scheduler identity verbatim.  It never launches a process.
 * @param {string} requestPath
 * @param {object} worker
 * @returns {{ok:true,record:object,artifactPath:string,spawned:false}|{ok:false,reason:string}}
 */
async function completeDeterministicMcpRendezvous(coordRootReal, requestRead, worker) {
  if (!isTestCapability()) return { ok: false, reason: 'deterministic-mcp-rendezvous-not-permitted' };
  const descriptorPath = deterministicMcpDescriptorPath(worker);
  const descriptorRead = readDurableRegistryRecordFd(descriptorPath, REGISTRY_RECORD_MAX_BYTES);
  let descriptor;
  try { descriptor = descriptorRead.ok && descriptorRead.exists ? JSON.parse(descriptorRead.text) : null; }
  catch (err) { descriptor = null; }
  if (!descriptorRead.ok) return { ok: false, reason: 'deterministic-mcp-descriptor-read-failed:' + (descriptorRead.reason || 'unknown') };
  if (!descriptorRead.exists) return { ok: false, reason: 'deterministic-mcp-descriptor-absent' };
  if (!descriptor || !hasExactKeys(descriptor, DETERMINISTIC_MCP_DESCRIPTOR_KEYS)) return { ok: false, reason: 'deterministic-mcp-descriptor-shape-invalid:' + (descriptor ? Object.keys(descriptor).sort().join(',') : 'not-object') };
  if (descriptor.schema !== DETERMINISTIC_MCP_DESCRIPTOR_SCHEMA || descriptor.host !== '127.0.0.1') return { ok: false, reason: 'deterministic-mcp-descriptor-protocol-invalid' };
  if (!Number.isInteger(descriptor.port) || descriptor.port <= 0 || descriptor.port > 65535) return { ok: false, reason: 'deterministic-mcp-descriptor-port-invalid' };
  if (!isHexDigest64(descriptor.capability)) return { ok: false, reason: 'deterministic-mcp-descriptor-capability-invalid' };
  if (descriptor.role !== worker.role || descriptor.worker_session_id !== worker.workerSessionId
      || descriptor.supervisor_instance_id !== worker.supervisorInstanceId
      || descriptor.child_instance_id !== worker.workerSessionId) return { ok: false, reason: 'deterministic-mcp-descriptor-identity-invalid' }
  if (!descriptor.child_pid_identity || !hasExactKeys(descriptor.child_pid_identity, PID_IDENTITY_KEYS)) return { ok: false, reason: 'deterministic-mcp-descriptor-child-invalid' };
  if (!Number.isFinite(Date.parse(descriptor.expires_at)) || Date.now() >= Date.parse(descriptor.expires_at)) return { ok: false, reason: 'deterministic-mcp-descriptor-expired' };
  const nonce = crypto.randomBytes(16).toString('hex');
  const exchanged = await exchangeDeterministicMcpFrame(descriptor, {
    schema: 'coordination/deterministic-mcp-loopback-request/v1', capability: descriptor.capability, nonce,
    request_path: requestRead.requestReal, request_sha256: requestRead.requestDigest,
    target_role: requestRead.targetRole, worker_session_id: worker.workerSessionId,
  }, Math.min(DETERMINISTIC_MCP_TIMEOUT_MS, Math.max(1, Date.parse(descriptor.expires_at) - Date.now())));
  if (!exchanged.ok) return exchanged;
  const response = exchanged.value;
  if (!response || response.ok !== true || response.nonce !== nonce
      || response.request_id !== requestRead.request.request_id || response.request_sha256 !== requestRead.requestDigest
      || response.worker_session_id !== worker.workerSessionId
      || response.supervisor_instance_id !== worker.supervisorInstanceId
      || response.child_instance_id !== descriptor.child_instance_id
      || canonicalJSONStringify(response.child_pid_identity) !== canonicalJSONStringify(descriptor.child_pid_identity)) {
    return { ok: false, reason: (response && response.reason) || 'deterministic-mcp-response-correlation-invalid' };
  }
  const deadline = Math.min(Date.now() + DETERMINISTIC_MCP_TIMEOUT_MS, Date.parse(requestRead.request.expiry));
  let observed;
  while (Date.now() < deadline) {
    try { observed = rc.classifyCanonicalResultForRequest(coordRootReal, requestRead.requestReal); }
    catch (err) { return { ok: false, reason: 'deterministic-mcp-result-validation-failed' }; }
    if (observed.status === 'present') break;
    await asyncSleep(50);
  }
  if (!observed || observed.status !== 'present') return { ok: false, reason: 'deterministic-mcp-result-timeout' };
  const expectedContent = 'deterministic-answer:' + requestRead.request.expected_result_kind;
  if (observed.result.status !== 'ANSWERED' || observed.result.content !== expectedContent) {
    return { ok: false, reason: 'deterministic-mcp-result-content-invalid' };
  }
  const childRecordPath = path.join(registryRepoDir({ repoId: worker.repoId }), 'instances', descriptor.child_instance_id + '.json');
  const childRecordRead = readDurableRegistryRecordFd(childRecordPath, REGISTRY_RECORD_MAX_BYTES);
  if (!childRecordRead.ok || !childRecordRead.exists) return { ok: false, reason: 'deterministic-mcp-child-record-unavailable' };
  const evidence = Object.freeze({
    schema: 'coordination/deterministic-mcp-rendezvous/v2',
    request_id: requestRead.request.request_id, request_sha256: requestRead.requestDigest,
    expected_result_kind: requestRead.request.expected_result_kind,
    worker_session_id: worker.workerSessionId, supervisor_instance_id: worker.supervisorInstanceId,
    child_instance_id: descriptor.child_instance_id, child_pid_identity: descriptor.child_pid_identity,
    child_record_sha256: crypto.createHash('sha256').update(Buffer.from(childRecordRead.text, 'utf8')).digest('hex'),
    result_attempt_id: observed.attemptId, result_sha256: observed.resultDigest,
    result_content: observed.result.content, loopback_host: descriptor.host,
    loopback_port: descriptor.port, nonce, completed_at: new Date().toISOString(),
  });
  const artifactPath = requestRead.requestReal + '.deterministic-mcp-rendezvous.json';
  try { publishNoClobber(artifactPath, Buffer.from(canonicalJSONStringify(evidence), 'utf8')); }
  catch (err) {
    return { ok: false, reason: err && err.code === 'EEXIST' ? 'deterministic-mcp-rendezvous-replay' : 'deterministic-mcp-rendezvous-publish-failed' };
  }
  return { ok: true, record: evidence, artifactPath };
}

  return Object.freeze({
    DETERMINISTIC_MCP_DESCRIPTOR_KEYS,
    DETERMINISTIC_MCP_DESCRIPTOR_SCHEMA,
    DETERMINISTIC_MCP_FRAME_MAX_BYTES,
    DETERMINISTIC_MCP_TIMEOUT_MS,
    childIdentityFromBornRecord,
    completeDeterministicMcpRendezvous,
    createDeterministicMcpFrameDecoder,
    deterministicMcpDescriptorPath,
    encodeDeterministicMcpFrame,
    exchangeDeterministicMcpFrame,
    startDeterministicMcpLoopbackServer,
    timingSafeHexEqual,
  });
}

module.exports = Object.freeze({ createDeterministicMcpLoopback });
