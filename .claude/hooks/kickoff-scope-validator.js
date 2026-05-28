#!/usr/bin/env node
// Kickoff scope listing validator — PostToolUse/Write hook.
// When a *-kickoff.md file is written, checks any "commitlint scopes" or
// "scopes válidos" listing against the canonical scopes in .commitlintrc.json.
// Emits a WARN advisory if invalid scopes are listed — never blocks (exit 0 always).
// Fail-open: missing .commitlintrc.json, no scope line, or parse errors are silently ignored.

'use strict';

const fs = require('fs');
const path = require('path');

const SCOPE_LINE_RE = /(?:commitlint\s+scopes|scopes\s+v[aá]lidos)\s*[:\-]\s*(.+)/i;

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const filePath = data.tool_input?.file_path || '';

    if (!filePath.endsWith('-kickoff.md')) {
      process.exit(0);
    }

    const content = data.tool_input?.content;
    if (!content) {
      process.exit(0);
    }

    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const commitlintPath = path.join(projectDir, '.commitlintrc.json');

    let canonicalScopes;
    try {
      const rc = JSON.parse(fs.readFileSync(commitlintPath, 'utf8'));
      canonicalScopes = rc.valid_scopes;
      if (!Array.isArray(canonicalScopes) || canonicalScopes.length === 0) {
        process.exit(0);
      }
    } catch (_) {
      process.exit(0);
    }

    const canonicalSet = new Set(canonicalScopes);
    const invalidScopes = [];

    const normalizedContent = content.replace(/\\n/g, '\n').replace(/\\r/g, '');
    for (const line of normalizedContent.split('\n')) {
      const match = SCOPE_LINE_RE.exec(line);
      if (!match) continue;
      const listed = match[1]
        .split(/[,\s]+/)
        .map(s => s.trim().replace(/[`'"]/g, ''))
        .filter(Boolean);
      for (const scope of listed) {
        if (!canonicalSet.has(scope)) {
          invalidScopes.push(scope);
        }
      }
    }

    if (invalidScopes.length === 0) {
      process.exit(0);
    }

    const filename = path.basename(filePath);
    const warnMsg = `[kickoff-scope-validator] WARN: invalid commitlint scopes in ${filename}: ${invalidScopes.join(', ')}. Canonical scopes: ${canonicalScopes.join(', ')}.`;
    process.stderr.write(warnMsg + '\n');

    process.stdout.write(JSON.stringify({ additionalContext: warnMsg }));
  } catch (_) {
    // fail-open on any parse or IO error
  }
  process.exit(0);
});
