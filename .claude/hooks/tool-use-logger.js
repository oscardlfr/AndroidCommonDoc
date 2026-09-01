#!/usr/bin/env node
// tool-use-logger.js — PostToolUse hook
// Appends one JSONL line to .androidcommondoc/tool-use-log.jsonl for every tool call.
// At 20MB, renames the log to tool-use-log-<YYYYMMDD>.jsonl.gz (gzip compressed)
// and starts a fresh log. Race-tolerant: rotate-then-append.
// Fail open: exits 0 always, never blocks tool execution.

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

const DIGEST_RE = /^[0-9a-f]{64}$/;
const ADMISSION_SCHEMA = 'runtime/host-observation-admission/v1';
const TRUST_ANCHOR_SCHEMA = 'runtime/host-observation-trust-anchor/v1';
const PENDING_SCHEMA = 'runtime/raw-observation-pending/v1';
const PROJECTION_SCHEMA = 'runtime/tool-use-observation-projection/v1';

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function readJsonObject(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { raw, parsed } : null;
  } catch {
    return null;
  }
}

function exactKeySet(value, expectedKeys) {
  return Object.keys(value).sort().join('\u0000') === expectedKeys.slice().sort().join('\u0000');
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0 && decoded.toString('base64') === value ? decoded : null;
  } catch {
    return null;
  }
}

function verifiedAdmission(root, key, sessionDigest, toolUseDigest) {
  const anchorRecord = readJsonObject(path.join(root, 'trust', 'host-observer-key.json'));
  const ticketRecord = readJsonObject(path.join(root, 'admission', `${key}.json`));
  if (!anchorRecord || !ticketRecord) return null;

  const anchor = anchorRecord.parsed;
  const ticket = ticketRecord.parsed;
  if (
    !exactKeySet(anchor, ['schema', 'key_id', 'public_key_spki_der_base64']) ||
    anchor.schema !== TRUST_ANCHOR_SCHEMA ||
    typeof anchor.key_id !== 'string' || !DIGEST_RE.test(anchor.key_id) ||
    !exactKeySet(ticket, ['schema', 'session_digest', 'tool_use_digest', 'admission_proof', 'key_id', 'signature_ed25519_base64']) ||
    ticket.schema !== ADMISSION_SCHEMA ||
    ticket.session_digest !== sessionDigest ||
    ticket.tool_use_digest !== toolUseDigest ||
    typeof ticket.admission_proof !== 'string' || !DIGEST_RE.test(ticket.admission_proof) ||
    ticket.key_id !== anchor.key_id
  ) return null;

  const spki = decodeCanonicalBase64(anchor.public_key_spki_der_base64);
  const signature = decodeCanonicalBase64(ticket.signature_ed25519_base64);
  if (!spki || !signature || crypto.createHash('sha256').update(spki).digest('hex') !== anchor.key_id) return null;

  try {
    const publicKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    if (publicKey.asymmetricKeyType !== 'ed25519') return null;
    const signedPayload = JSON.stringify([
      ADMISSION_SCHEMA,
      sessionDigest,
      toolUseDigest,
      ticket.admission_proof,
      anchor.key_id,
    ]);
    return crypto.verify(null, Buffer.from(signedPayload, 'utf8'), publicKey, signature) ? ticket : null;
  } catch {
    return null;
  }
}

/**
 * Project only evidence that the host admitted and the boundary authenticated.
 * The receipt is random host-origin evidence, not a public or reusable action
 * credential. Missing, malformed, or hand-written records remain untrusted.
 */
function projectTrustedObservation(data, success) {
  try {
    if (data.hook_event_name !== 'PostToolUse' && data.hook_event_name !== 'PostToolUseFailure') return;
    if (typeof data.session_id !== 'string' || data.session_id.length === 0) return;
    if (typeof data.tool_use_id !== 'string' || data.tool_use_id.length === 0) return;
    if (typeof data.tool_name !== 'string' || data.tool_name.length === 0) return;

    // Projection is confined to an explicitly owned observation root. Never
    // infer it from the ordinary project/log directory.
    const observationRoot = process.env.RUNTIME_HOST_OBSERVATION_ROOT;
    if (typeof observationRoot !== 'string' || observationRoot.length === 0) return;

    const sessionDigest = sha256hex(data.session_id);
    const toolUseDigest = sha256hex(data.tool_use_id);
    const key = `${sessionDigest}__${toolUseDigest}`;
    const pending = readJsonObject(path.join(observationRoot, 'pending', `${key}.pre.json`));
    const admission = verifiedAdmission(observationRoot, key, sessionDigest, toolUseDigest);
    if (!admission || !pending) return;

    const capture = pending.parsed;
    if (
      capture.schema !== PENDING_SCHEMA ||
      capture.session_digest !== sessionDigest ||
      capture.tool_use_digest !== toolUseDigest ||
      capture.tool_name !== data.tool_name ||
      typeof capture.payload_digest !== 'string' ||
      !DIGEST_RE.test(capture.payload_digest) ||
      capture.admission_receipt !== admission.admission_proof
    ) return;

    const projectionDir = path.join(observationRoot, 'projections');
    const projection = {
      schema: PROJECTION_SCHEMA,
      correlated: true,
      success,
      session_digest: sessionDigest,
      tool_use_digest: toolUseDigest,
      observed_at: new Date().toISOString(),
    };
    fs.mkdirSync(projectionDir, { recursive: true });
    // First authenticated projection wins; replay must not recompute evidence.
    fs.writeFileSync(
      path.join(projectionDir, `${key}.json`),
      JSON.stringify(projection),
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch {
    // Observation projection is best-effort and never changes logger fail-open semantics.
  }
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id || 'unknown';
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};

    // ── mcp_server / mcp_tool ────────────────────────────────────────────────
    let mcpServer = null;
    let mcpTool = null;
    if (toolName.startsWith('mcp__')) {
      const parts = toolName.split('__');
      mcpServer = parts[1] || null;
      mcpTool = parts[2] || null;
    }

    // ── skill_name ───────────────────────────────────────────────────────────
    let skillName = null;
    if (toolName === 'Skill') {
      skillName = toolInput.name || toolInput.skill_name || null;
    }

    // ── input_summary ────────────────────────────────────────────────────────
    let inputSummary = '';
    if (toolName === 'Bash') {
      inputSummary = (toolInput.command || '').slice(0, 80);
    } else if (toolName === 'Grep') {
      inputSummary = (toolInput.pattern || '').slice(0, 80);
    } else if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
      inputSummary = (toolInput.file_path || '').slice(0, 80);
    } else if (toolName === 'SendMessage') {
      inputSummary = ((toolInput.to || '') + ':' + (toolInput.summary || '').slice(0, 20)).slice(0, 80);
    } else if (toolName === 'Skill') {
      inputSummary = (toolInput.name || toolInput.skill_name || '').slice(0, 80);
    } else {
      inputSummary = JSON.stringify(toolInput).slice(0, 80);
    }

    // ── success ──────────────────────────────────────────────────────────────
    const success = data.hook_event_name === 'PostToolUseFailure'
      ? false
      : (data.tool_response?.error == null);

    // ── cp_bypass_blocked ────────────────────────────────────────────────────
    const BLOCKABLE_TOOLS = new Set(['Bash', 'Grep', 'Glob', 'Read']);
    let cpBypassBlocked = false;
    if (BLOCKABLE_TOOLS.has(toolName)) {
      const tmpDir = process.env.TMPDIR || process.env.TMP || os.tmpdir();
      const agentId = String(data.agent_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
      const markerPath = path.join(tmpDir, `claude-cp-blocked-${sessionId}-${agentId}.flag`);
      if (fs.existsSync(markerPath)) {
        cpBypassBlocked = true;
        try { fs.unlinkSync(markerPath); } catch {}
      }
    }

    // ── agent_name + agent_class resolution ─────────────────────────────────
    // peer  = TeamCreate peer → use agent_type as canonical name (OQ3: key on NAME not agent_id)
    // main  = orchestrator with empty agent_type → "main"
    // subagent = spawned subagent (non-empty agent_type, not a known peer pattern) → agent_type
    const rawAgentType = data.agent_type || '';
    let agentClass;
    let agentName;
    if (rawAgentType === '') {
      agentClass = 'main';
      agentName = 'main';
    } else {
      // Peers and subagents both have non-empty agent_type.
      // Peers are distinguished by having a known session-team name (agent_type).
      // Without live session state we can't distinguish, so use agent_type for both.
      agentClass = 'peer';
      agentName = rawAgentType;
    }

    // ── Build entry ──────────────────────────────────────────────────────────
    const entry = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      tool_name: toolName,
      mcp_server: mcpServer,
      mcp_tool: mcpTool,
      skill_name: skillName,
      input_summary: inputSummary,
      duration_ms: data.duration_ms ?? null,
      success,
      agent_name: agentName,
      agent_class: agentClass,
      agent_id: data.agent_id || null,
      agent_type: rawAgentType || null,
      cp_bypass_blocked: cpBypassBlocked,
    };

    // ── Write to log (with 20MB rotation) ───────────────────────────────────
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const logPath = path.join(projectDir, '.androidcommondoc', 'tool-use-log.jsonl');

    // Race-tolerant rotation: rename first, then append to fresh file.
    // If rename fails (another process beat us), just append to whatever is there.
    try {
      const size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      if (size > 20_971_520) { // 20MB
        // Atomic cut-over: rename the live log first so concurrent appends go to a
        // new file. Then gzip the renamed snapshot. Uses full ISO timestamp (ms) so
        // same-day rotations produce unique filenames and never overwrite each other (CR-4).
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'z');
        const rotatedPath = logPath.replace('.jsonl', '-' + stamp + '.jsonl');
        const gzPath = rotatedPath + '.gz';
        try {
          fs.renameSync(logPath, rotatedPath); // atomic hand-off; new entries go to fresh logPath
          const raw = fs.readFileSync(rotatedPath);
          const compressed = zlib.gzipSync(raw);
          fs.writeFileSync(gzPath, compressed);
          fs.unlinkSync(rotatedPath); // remove uncompressed snapshot after gz written
        } catch {
          // rotation failed (race or permissions) — fall through, keep appending
        }
      }
    } catch {}

    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');

    // Keep the established fourteen-key log entry untouched. A separate,
    // digest-only projection is emitted only from boundary-authenticated
    // evidence, never from ordinary or caller-created hook payloads.
    projectTrustedObservation(data, success);

  } catch (e) {
    // Fail open — never block on errors
  }
  process.exit(0);
});
