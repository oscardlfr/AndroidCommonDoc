#!/usr/bin/env node
// context-provider-gate.js — PreToolUse hook
// Blocks Grep/Glob/Bash-search unless ANY agent has consulted CP this session.
//
// Session-scoped flag: one CP consultation unblocks all peers in that session.
// The harness assigns a new agent_id per tool invocation for peer agents, so
// per-agent flags (old behavior) never matched between PostToolUse (SendMessage)
// and PreToolUse (Bash/Grep). Session-scoped flag restores dev autonomy.
//
// BL-W35-06 fix tag: per-agent arch-response flag for specialists.
// Specialists require per-agent arch-responded flag (written by consulted.js on arch→specialist).
// Non-specialist non-exempt agents use global session flag as before.
//
// Exempt via agent_type prefix match: context-provider, project-manager, team-lead.
//
// Fail open on any error (never block due to script failure).
// Emergency escape:
//   rm "$(node -e "console.log(require('os').tmpdir())")/claude-cp-consulted-*.flag"
//   rm "$(node -e "console.log(require('os').tmpdir())")/claude-arch-responded-*.flag"
// Or: CLAUDE_CP_GATE_DISABLED=1 (fail-open).

const fs = require('fs');
const os = require('os');
const path = require('path');
const coordinationArtifact = require('./coordination-artifact.js');
const { getWaveSlug } = require('./hook-control-plane-utils.js');

function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
}

// ADDITIVE (Wave 2 / ADR-001 portable disk-consult fallback) — non-specialist ONLY. OR'd in
// alongside the existing SendMessage session-flag at both non-specialist enforcement sites
// (never at the specialist arch-responded branches). slug null -> false immediately, no disk
// attempt (never fail open on a missing/unresolvable wave). Fail-closed: hasValidConsult already
// returns false on malformed/stale/wrong-wave/wrong-role/out-of-confinement — this helper adds no
// additional leniency, it only decides WHETHER to ask.
function diskConsultUnblocks(sessionId, toolName) {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const slug = getWaveSlug(projectRoot);
  let diskAllowed = false;
  if (slug) {
    // Local try/catch (defense-in-depth, on top of hasValidConsult's own null-slug/invalid
    // fail-closed returns): an unexpected throw here must degrade to session-flag-only
    // behavior, NEVER bubble to the outer handler and fail the WHOLE gate open.
    try {
      diskAllowed = coordinationArtifact.hasValidConsult(
        path.join(projectRoot, '.planning', 'wave-' + slug, 'inbox', 'context-provider'),
        { slug, projectRoot }
      );
    } catch {
      diskAllowed = false;
    }
  }
  if (diskAllowed) {
    process.stderr.write(`[CP-GATE] session=${sessionId} flag_writer=disk-consult wave_slug=${slug} tool=${toolName}\n`);
  }
  return diskAllowed;
}

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const sessionId = data.session_id || 'unknown';
    const agentType = data.agent_type || '';
    const agentId = sanitizeId(data.agent_id || 'unknown');
    if (process.env.CLAUDE_CP_GATE_DISABLED === '1') process.exit(0);
    // Empty agent_type means main orchestrator — always exempt (main has no agent_type)
    if (agentType === '') process.exit(0);
    const SPECIALIST_NAMES = [
      'test-specialist', 'toolkit-specialist', 'ui-specialist',
      'domain-model-specialist', 'data-layer-specialist'
    ];
    const isSpecialist = SPECIALIST_NAMES.some(s => agentType === s || agentType.startsWith(s));
    const tmpDir = process.env.TMPDIR || process.env.TMP || os.tmpdir();
    // team-lead exemption removed: main is now caught by empty agent_type check above
    const EXEMPT_TYPES = ['context-provider', 'project-manager'];
    if (EXEMPT_TYPES.some(e => agentType === e || agentType.startsWith(e))) process.exit(0);

    // 2a. Read on pattern-discovery paths requires CP consultation (T-BUG-015)
    try {
      if (toolName === 'Read') {
        const filePath = data.tool_input?.file_path ?? '';
        const isExemptPath =
          filePath.includes('/.planning/') ||
          filePath.includes('\\.planning\\') ||
          filePath.includes('/.claude/teams/') ||
          filePath.includes('\\.claude\\teams\\') ||
          filePath.endsWith('team.json') ||
          filePath.endsWith('config.json');
        if (!isExemptPath) {
          // Boundary-anchored path classifier (P1a fix: repo-relative paths like
          // 'docs/guides/foo.md' have no leading sep — regex approach missed them).
          // dir: 'docs' | 'setup/agent-templates' | '.claude/agents'
          // Covers repo-relative (startsWith) and absolute (includes).
          // '.' stays literal — no dynamic regex escape needed.
          function underDir(fp, dir) {
            const p = String(fp).replace(/\\/g, '/');
            return p.startsWith(dir + '/') || p.includes('/' + dir + '/');
          }

          // BL-W35-06 C2: self-template/agent-template read unconditionally blocked for specialists
          // (belt-and-suspenders for template prose ban; A2 unified isPatternDiscovery with flag check
          // so own-template would otherwise be allowed when arch-response flag is set).
          const isSelfTemplatePath =
            (underDir(filePath, 'setup/agent-templates') ||
             underDir(filePath, '.claude/agents')) && filePath.endsWith('.md');
          if (isSpecialist && isSelfTemplatePath) {
            process.stdout.write(JSON.stringify({
              decision: 'block',
              reason: '[C2/BL-W35-06] Reading agent templates is FORBIDDEN for specialists regardless of arch-response flag. Use task dispatch context from your architect.'
            }));
            process.exit(2);
          }
          const isPatternDiscovery =
            (underDir(filePath, 'docs') && filePath.endsWith('.md')) ||
            (underDir(filePath, 'setup/agent-templates') && filePath.endsWith('.md')) ||
            (underDir(filePath, '.claude/agents') && filePath.endsWith('.md')) ||
            /skills[/\\][^/\\]+[/\\]SKILL\.md$/.test(filePath);
          if (isPatternDiscovery) {
            let allowed = false;
            if (isSpecialist) {
              // BL-W35-06: specialists require per-agent arch-response flag
              const agentFlag = path.join(tmpDir,
                'claude-arch-responded-' + sessionId + '-' + sanitizeId(agentType) + '.flag');
              allowed = fs.existsSync(agentFlag);
              if (allowed) {
                try {
                  const raw = fs.readFileSync(agentFlag, 'utf8');
                  const meta = JSON.parse(raw);
                  process.stderr.write(
                    `[CP-GATE] session=${sessionId} flag_writer=${meta.written_by} flag_ts=${meta.ts} tool=${toolName}\n`
                  );
                } catch { /* legacy ISO string — ignore */ }
              }
            } else {
              const flagPath = path.join(tmpDir, 'claude-cp-consulted-' + sessionId + '.flag');
              allowed = fs.existsSync(flagPath);
              if (allowed) {
                try {
                  const raw = fs.readFileSync(flagPath, 'utf8');
                  const meta = JSON.parse(raw);
                  process.stderr.write(
                    `[CP-GATE] session=${sessionId} flag_writer=${meta.written_by} flag_ts=${meta.ts} tool=${toolName}\n`
                  );
                } catch { /* legacy ISO string — ignore */ }
              }
              // ADDITIVE (Wave 2): SendMessage session-flag checked FIRST, unchanged above —
              // OR in the fail-closed disk-consult fallback (ADR-001 portable path) only if it didn't unblock.
              if (!allowed) allowed = diskConsultUnblocks(sessionId, toolName);
            }
            if (!allowed) {
              process.stdout.write(JSON.stringify({
                decision: 'block',
                reason: '[T-BUG-015/BL-W35-06] CP gate: Read on pattern/doc/template path requires CP consultation first (specialists: requires arch-responded flag).'
              }));
              process.exit(2);
            }
          }
        }
        process.exit(0); // Read not blocked — allow
      }
    } catch { process.exit(0); }

    // 2c. Block Grep/Glob tool on docs/** or agent-template paths
    if (toolName === 'Grep' || toolName === 'Glob') {
      const queryPath = data.tool_input?.path ?? data.tool_input?.pattern ?? '';
      // Boundary-anchored: matches docs/ at start, after separator, or as full segment.
      // Prevents bypass via repo-relative paths like "docs" or "docs/guides/..." without leading sep.
      const isDocPath = /(?:^|[/\\])docs(?:[/\\]|$)/.test(queryPath) || /(?:^|[/\\])setup[/\\]agent-templates(?:[/\\]|$)/.test(queryPath);
      if (!isDocPath) process.exit(0); // non-docs Grep/Glob allowed
      // doc-path Grep/Glob: fall through to session-flag check
    }

    // 2b. Bash allow-list: non-search bash commands pass through
    if (toolName === 'Bash') {
      const cmd = data.tool_input?.command || '';
      // Block only if command contains search patterns
      if (!/grep\b|rg\b|find\b|cat\s+.*\.(kt|ts|md)/.test(cmd)) {
        process.exit(0); // build/git/gradlew bash commands — allow
      }
    }

    // 3. Check consultation flag — specialists use per-agent arch-response flag (BL-W35-06)
    if (isSpecialist) {
      const agentFlag = path.join(tmpDir,
        'claude-arch-responded-' + sessionId + '-' + sanitizeId(agentType) + '.flag');
      if (fs.existsSync(agentFlag)) {
        try {
          const raw = fs.readFileSync(agentFlag, 'utf8');
          const meta = JSON.parse(raw);
          process.stderr.write(
            `[CP-GATE] session=${sessionId} flag_writer=${meta.written_by} flag_ts=${meta.ts} tool=${toolName}\n`
          );
        } catch { /* legacy ISO string — ignore */ }
        process.exit(0); // arch has responded — allow
      }
      // No arch-response flag: fall through to block
    } else {
      // Non-specialist, non-exempt: use global session flag
      const flagPath = path.join(tmpDir, 'claude-cp-consulted-' + sessionId + '.flag');
      if (fs.existsSync(flagPath)) {
        try {
          const raw = fs.readFileSync(flagPath, 'utf8');
          const meta = JSON.parse(raw);
          process.stderr.write(
            `[CP-GATE] session=${sessionId} flag_writer=${meta.written_by} flag_ts=${meta.ts} tool=${toolName}\n`
          );
        } catch { /* legacy ISO string — ignore */ }
        process.exit(0);
      }
      // ADDITIVE (Wave 2): SendMessage session-flag checked FIRST, unchanged above — OR in the
      // fail-closed disk-consult fallback (ADR-001 portable path) only if the flag didn't unblock.
      if (diskConsultUnblocks(sessionId, toolName)) process.exit(0);
    }

    // 4. Block — write per-agent block marker for logger and emit decision
    const blockMarker = path.join(tmpDir, `claude-cp-blocked-${sessionId}-${agentId}.flag`);
    try { fs.writeFileSync(blockMarker, new Date().toISOString()); } catch {}

    const out = JSON.stringify({
      decision: 'block',
      reason: 'No agent in this session has consulted context-provider yet. SendMessage to context-provider first to validate pattern assumptions, then retry.'
    });
    process.stdout.write(out);
    process.exit(2);

  } catch (e) {
    // Fail open — never block due to script error
    process.exit(0);
  }
});
