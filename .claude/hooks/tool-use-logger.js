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
    const success = (data.tool_response?.error == null);

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
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const gzPath = logPath.replace('.jsonl', '-' + stamp + '.jsonl.gz');
        try {
          const raw = fs.readFileSync(logPath);
          const compressed = zlib.gzipSync(raw);
          fs.writeFileSync(gzPath, compressed);
          fs.unlinkSync(logPath); // remove uncompressed after gz written
        } catch {
          // rotation failed (race or permissions) — fall through, keep appending
        }
      }
    } catch {}

    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');

  } catch (e) {
    // Fail open — never block on errors
  }
  process.exit(0);
});
