#!/usr/bin/env node
// tool-use-logger.js — PostToolUse hook
// Appends one JSONL line to .androidcommondoc/tool-use-log.jsonl for every tool call.
// Fail open: exits 0 always, never blocks tool execution.

const fs = require('fs');
const path = require('path');
const os = require('os');

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
    let cpBypassBlocked = false;
    const markerPath = path.join(os.tmpdir(), `claude-cp-blocked-${sessionId}.flag`);
    if (fs.existsSync(markerPath)) {
      cpBypassBlocked = true;
      try { fs.unlinkSync(markerPath); } catch {}
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
      agent_name: process.env.CLAUDE_AGENT_NAME || null,
      agent_id: data.agent_id || null,
      agent_type: data.agent_type || null,
      cp_bypass_blocked: cpBypassBlocked,
    };

    // ── Write to log ─────────────────────────────────────────────────────────
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const logPath = path.join(projectDir, '.androidcommondoc', 'tool-use-log.jsonl');

    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');

    // ── 10MB warn ────────────────────────────────────────────────────────────
    try {
      const size = fs.statSync(logPath).size;
      if (size > 10_485_760) {
        process.stderr.write('[tool-use-logger] log exceeds 10MB — rotate with: mv tool-use-log.jsonl tool-use-log-YYYYMMDD.jsonl\n');
      }
    } catch {}
  } catch (e) {
    // Fail open — never block on errors
  }
  process.exit(0);
});
