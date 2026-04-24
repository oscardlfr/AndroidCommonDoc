#!/usr/bin/env node
// Blocks arch-* agents from using Write/Edit on any file except verdict files.
// Architects detect and spec — all code changes go through dev dispatch.

const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));

try {
  const toolName = data.tool_name;
  const agentType = (data.agent_type ?? '').toLowerCase();
  const filePath = data.tool_input?.file_path ?? data.tool_input?.path ?? '';

  if (!['Write', 'Edit'].includes(toolName)) process.exit(0);
  if (!agentType.startsWith('arch-')) process.exit(0);

  // Exempt: verdict files only (.planning/wave{N}/arch-*-verdict.md)
  if (/[\\/]\.planning[\\/]wave\d+[\\/]arch-[^/\\]+-verdict\.md$/.test(filePath)) {
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `[arch-self-edit-gate] Architect "${agentType}" attempted to ${toolName} "${filePath}". Architects NEVER edit source/template/test files. Delegate via SendMessage(to="team-lead", summary="need {dev}", message="...").`
  }));
  process.exit(2);
} catch {
  process.exit(0); // fail-open
}
