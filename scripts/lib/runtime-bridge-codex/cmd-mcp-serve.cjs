'use strict';

// `mcp-serve` CLI command controller: validates the launch descriptor (never following a symlink or reading credentials) and runs the deterministic MCP facade over stdio.

function createCmdMcpServe({
  RC,
  fs,
  path,
  usageError,
  writeJsonlFrame,
}) {
// ── mcp-serve (PLAN.md ~L878, ~L950-954) ──

const MCP_SERVE_SPEC = Object.freeze({
  '--launch-descriptor': { required: true, repeatable: false },
});
const MCP_FACADE_PROTOCOL_VERSION = '2025-11-25';
const MCP_FACADE_SERVER_INFO = Object.freeze({ name: 'portable-runtime-consultation', version: '1.0.0' });
const MCP_FACADE_TOOL_INPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['request_id', 'attempt_id'],
  properties: {
    request_id: { type: 'string', pattern: '^[0-9a-f]{32,}$' },
    attempt_id: { type: 'string', pattern: '^[0-9a-f]{32,}$' },
  },
});

/** @param {string[]} rawArgv @returns {{ok:true,value:{launchDescriptor:string}}|{ok:false,reason:string}} */
function parseMcpServeArgv(rawArgv) {
  const out = { launchDescriptor: null };
  const seen = {};
  let i = 0;
  while (i < rawArgv.length) {
    const flag = rawArgv[i];
    const spec = MCP_SERVE_SPEC[flag];
    if (!spec) return { ok: false, reason: 'unknown-flag: ' + flag };
    if (i + 1 >= rawArgv.length) return { ok: false, reason: 'missing-value-for: ' + flag };
    const value = rawArgv[i + 1];
    if (seen[flag] && !spec.repeatable) return { ok: false, reason: 'duplicate-flag: ' + flag };
    seen[flag] = true;
    out.launchDescriptor = value;
    i += 2;
  }
  const missing = Object.keys(MCP_SERVE_SPEC).filter((flag) => MCP_SERVE_SPEC[flag].required && !seen[flag]);
  if (missing.length > 0) return { ok: false, reason: 'missing-required-flag: ' + missing[0] };
  return { ok: true, value: out };
}

/**
 * PLAN.md ~L940: lstat/owner/mode/type/nlink-validates the launch
 * descriptor, never follows a symlink, and never reads credentials.
 * @param {string} descriptorPath
 * @returns {{ok:true,descriptor:object}|{ok:false,reason:string}}
 */
function validateMcpLaunchDescriptor(descriptorPath) {
  if (typeof descriptorPath !== 'string' || !path.isAbsolute(descriptorPath)) {
    return { ok: false, reason: 'launch-descriptor-not-absolute' };
  }
  let st;
  try {
    st = fs.lstatSync(descriptorPath);
  } catch (err) {
    return { ok: false, reason: 'launch-descriptor-not-found' };
  }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (
    !st.isFile() || st.isSymbolicLink() || st.nlink !== 1
    || (currentUid !== null && st.uid !== currentUid)
    || (process.platform !== 'win32' && (st.mode & 0o077) !== 0)
  ) return { ok: false, reason: 'launch-descriptor-insecure' };
  let text;
  try {
    text = fs.readFileSync(descriptorPath, 'utf8');
  } catch (err) {
    return { ok: false, reason: 'launch-descriptor-read-failed' };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: 'launch-descriptor-not-valid-json' };
  }
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 'coordination/mcp-launch-descriptor/v1'
    || typeof value.instance_id !== 'string' || value.instance_id.length === 0
  ) return { ok: false, reason: 'launch-descriptor-schema-invalid' };
  return { ok: true, descriptor: value };
}

/**
 * PLAN.md ~L878/~L950-954: launcher-only stdio MCP server. stdout is
 * EXCLUSIVELY MCP JSON-RPC framing; every diagnostic goes to stderr. Reuses
 * the exact fixed `initialize`/`tools/list`/`ping`/`notifications/*` wire
 * contract; never reads Codex credentials and never becomes a second result
 * writer. `tools/call`'s host loopback forward (PLAN.md "Portable
 * facade->host transport") has no listener composed anywhere in this module
 * yet -- session-run owns the host side and this wave's dispatch forbids
 * inventing a second one here -- so it fails closed with the exact
 * metadata-only rejected receipt shape rather than fabricate an answer.
 */
function cmdMcpServe(rawArgv) {
  const parsed = parseMcpServeArgv(rawArgv);
  if (!parsed.ok) return usageError(parsed.reason);
  const descriptorResult = validateMcpLaunchDescriptor(parsed.value.launchDescriptor);
  if (!descriptorResult.ok) {
    process.stderr.write('[mcp-serve] rejected: ' + descriptorResult.reason + '\n');
    process.exit(RC.AUTH_ISOLATION);
  }
  // One-shot capability, atomically consumed before the facade ever serves a
  // request (PLAN.md "Session-scoped MCP registration"). Best-effort --
  // a failure here is diagnostic only and never skips the fail-closed
  // handshake below.
  try { fs.unlinkSync(parsed.value.launchDescriptor); } catch (err) { /* best-effort */ }

  let initialized = false;
  function respond(frame) { writeJsonlFrame(process.stdout, frame, () => {}); }
  function handleLine(line) {
    if (line.length === 0) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch (err) {
      respond({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.method !== 'string') {
      respond({ jsonrpc: '2.0', id: (request && request.id) || null, error: { code: -32600, message: 'invalid request' } });
      return;
    }
    const id = Object.prototype.hasOwnProperty.call(request, 'id') ? request.id : null;
    const method = request.method;
    if (method === 'initialize') {
      if (request.params && request.params.protocolVersion !== MCP_FACADE_PROTOCOL_VERSION) {
        respond({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unsupported protocol version' } });
        return;
      }
      initialized = true;
      respond({
        jsonrpc: '2.0', id,
        result: { protocolVersion: MCP_FACADE_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: MCP_FACADE_SERVER_INFO },
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return; // notifications -- no reply; cancellation triggers bounded cleanup only, never the authoritative disk transaction.
    if (method === 'ping') { respond({ jsonrpc: '2.0', id, result: {} }); return; }
    if (method === 'tools/list' || method === 'tools/call') {
      if (!initialized) {
        respond({ jsonrpc: '2.0', id, error: { code: -32600, message: 'not initialized' } });
        return;
      }
      if (method === 'tools/list') {
        respond({
          jsonrpc: '2.0', id,
          result: { tools: [{ name: 'consult', description: 'Portable runtime consultation facade.', inputSchema: MCP_FACADE_TOOL_INPUT_SCHEMA }] },
        });
        return;
      }
      const args = request.params && request.params.arguments;
      if (!request.params || request.params.name !== 'consult' || !args || typeof args.request_id !== 'string' || typeof args.attempt_id !== 'string') {
        respond({ jsonrpc: '2.0', id, error: { code: -32602, message: 'invalid params' } });
        return;
      }
      respond({
        jsonrpc: '2.0', id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({ schema: 'coordination/mcp-receipt/v1', request_id: args.request_id, attempt_id: args.attempt_id, disposition: 'rejected' }),
          }],
          isError: true,
        },
      });
      return;
    }
    respond({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown method' } });
  }
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      handleLine(line);
    }
  });
  process.stdin.on('end', () => process.exit(RC.OK));
  process.on('SIGTERM', () => process.exit(RC.OK));
  process.on('SIGINT', () => process.exit(RC.OK));
}

  return Object.freeze({
    MCP_FACADE_PROTOCOL_VERSION,
    MCP_FACADE_SERVER_INFO,
    MCP_FACADE_TOOL_INPUT_SCHEMA,
    MCP_SERVE_SPEC,
    cmdMcpServe,
    parseMcpServeArgv,
    validateMcpLaunchDescriptor,
  });
}

module.exports = Object.freeze({ createCmdMcpServe });
