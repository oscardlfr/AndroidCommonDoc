#!/usr/bin/env node
// PostToolUse warning: reminds devs to rehash registry after editing agent template files.

const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));

try {
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
