#!/usr/bin/env node
// PostToolUse warning: reminds devs to rehash registry after editing agent template files.

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;
    const filePath = data.tool_input?.file_path ?? data.tool_input?.path ?? '';

    if (!['Write', 'Edit'].includes(toolName)) process.exit(0);

    const isTemplatePath =
      /[\\/]\.claude[\\/]agents[\\/][^/\\]+\.md$/.test(filePath) ||
      /[\\/]setup[\\/]agent-templates[\\/][^/\\]+\.md$/.test(filePath);

    if (isTemplatePath) {
      process.stderr.write(
        `[registry-rehash-reminder] Template edited: ${filePath}\n` +
        `  Run: bash scripts/sh/rehash-registry.sh\n` +
        `  Skills registry (skills/registry.json) may be stale until rehashed.\n`
      );
    }
  } catch {
    // fail-open — PostToolUse always exits 0
  }
  process.exit(0);
});
