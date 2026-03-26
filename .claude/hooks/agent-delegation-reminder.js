#!/usr/bin/env node
// Agent Delegation Reminder — PostToolUse hook
// When Claude writes/edits a Compose file (.kt with @Composable) without
// having invoked ui-specialist, emits a reminder as additionalContext.
// Debounced: only reminds once per session.

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
    const toolName = data.tool_name;
    const sessionId = data.session_id || 'unknown';

    // Only check Write and Edit
    if (toolName !== 'Write' && toolName !== 'Edit') {
      process.exit(0);
    }

    const filePath = data.tool_input?.file_path || '';
    if (!filePath.endsWith('.kt')) {
      process.exit(0);
    }

    // Check if content contains Compose indicators
    const content = data.tool_input?.new_string || data.tool_input?.content || '';
    const isCompose = content.includes('@Composable') ||
                      content.includes('Modifier') ||
                      content.includes('remember') ||
                      content.includes('LaunchedEffect');

    if (!isCompose) {
      process.exit(0);
    }

    // Debounce: check if we already reminded this session
    const flagFile = path.join(os.tmpdir(), `claude-delegation-${sessionId}.flag`);
    if (fs.existsSync(flagFile)) {
      process.exit(0);
    }

    // Write debounce flag
    fs.writeFileSync(flagFile, Date.now().toString());

    const output = {
      additionalContext: 'Compose code detected. Consider delegating to `ui-specialist` for accessibility, Material3, and design system review — see CLAUDE.md Agent Delegation table.'
    };
    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    // Silent failure
  }
  process.exit(0);
});
