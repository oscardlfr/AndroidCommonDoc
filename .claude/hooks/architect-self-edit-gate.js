#!/usr/bin/env node
// Blocks arch-* agents from using Write/Edit on any file except verdict files.
// Architects detect and spec — all code changes go through dev dispatch.

let input = '';
const t = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  clearTimeout(t);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;
    const agentType = (data.agent_type ?? '').toLowerCase();
    const filePath = data.tool_input?.file_path ?? data.tool_input?.path ?? '';

    if (!['Write', 'Edit'].includes(toolName)) process.exit(0);
    if (!agentType.startsWith('arch-')) process.exit(0);

    // Exempt: verdict + cross-verify files (.planning/wave{slug}/[pr\d+-]arch-*-{verdict,cross-verify}.md)
    // NOT exempt (intentional): arch-*-verdict-prep.json / arch-*-verdict-verify-final.json
    // (wave structured-verdict-evidence-contract, PLAN.md sec 3.1/3.6) — the regex below is
    // .md-only by construction, so Write/Edit against the new JSON verdict paths is already
    // blocked, unchanged; write-verdict.sh is the only sanctioned writer. No logic change.
    if (/[\\/]\.planning[\\/]wave[\w.-]+[\\/](?:pr\d+-)?arch-[^/\\]+-(?:verdict|cross-verify)\.md$/.test(filePath)) {
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
});
