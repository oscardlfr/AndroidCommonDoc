#!/usr/bin/env node
// Plan Context Injector — PostToolUse hook
// When Claude enters plan mode (EnterPlanMode tool), injects MODULE_MAP.md
// and a summary of available agents/skills as additionalContext.
// This ensures Claude knows what exists BEFORE planning.

const fs = require('fs');
const path = require('path');

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;

    // Only trigger on EnterPlanMode
    if (toolName !== 'EnterPlanMode') {
      process.exit(0);
    }

    const cwd = data.cwd || process.cwd();
    const parts = [];

    // 1. Read MODULE_MAP.md if it exists
    const moduleMapPath = path.join(cwd, 'MODULE_MAP.md');
    if (fs.existsSync(moduleMapPath)) {
      const content = fs.readFileSync(moduleMapPath, 'utf8');
      // Truncate to first 80 lines to avoid context bloat
      const lines = content.split('\n').slice(0, 80).join('\n');
      parts.push(`## Available Modules (from MODULE_MAP.md)\n${lines}`);
    }

    // 2. List available agents
    const agentsDir = path.join(cwd, '.claude', 'agents');
    if (fs.existsSync(agentsDir)) {
      const agents = fs.readdirSync(agentsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const content = fs.readFileSync(path.join(agentsDir, f), 'utf8');
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          const descMatch = content.match(/^description:\s*"?(.+?)"?\s*$/m);
          const name = nameMatch ? nameMatch[1].trim() : f.replace('.md', '');
          const desc = descMatch ? descMatch[1].trim().slice(0, 80) : '';
          return `- **${name}**: ${desc}`;
        });
      if (agents.length > 0) {
        parts.push(`## Available Agents (${agents.length})\n${agents.join('\n')}`);
      }
    }

    // 3. List key skills (from .claude/commands/)
    const commandsDir = path.join(cwd, '.claude', 'commands');
    if (fs.existsSync(commandsDir)) {
      const commands = fs.readdirSync(commandsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const content = fs.readFileSync(path.join(commandsDir, f), 'utf8');
          const descMatch = content.match(/^description:\s*(.+)$/m);
          const desc = descMatch ? descMatch[1].trim() : '';
          return `/${f.replace('.md', '')}` + (desc ? ` — ${desc}` : '');
        });
      if (commands.length > 0) {
        parts.push(`## Available Skills (${commands.length})\n${commands.join('\n')}`);
      }
    }

    if (parts.length > 0) {
      const output = {
        additionalContext: `# Plan Mode Context\n\n${parts.join('\n\n')}`
      };
      process.stdout.write(JSON.stringify(output));
    }
  } catch (e) {
    // Silent failure — don't break plan mode
  }
  process.exit(0);
});
