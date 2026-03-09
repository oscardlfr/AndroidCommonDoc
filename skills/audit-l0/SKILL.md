---
name: audit-l0
description: "Run coherence audit on any L0/L1/L2 layer root. Checks hub doc presence, line limits, frontmatter completeness, .planning/ references, monitor_urls coverage, and detekt_rules coverage. Use when validating ecosystem-wide doc health."
allowed-tools: [Read, Grep, Glob, Write, Bash]
---

## Usage Examples

```
/audit-l0
/audit-l0 --target ../AndroidCommonDoc
/audit-l0 --target ../your-shared-libs --layer L1
/audit-l0 --target ../your-app --layer L2a
```

## Parameters

- `target` -- Absolute or relative path to the layer root to audit. Default: `.` (current directory).
- `layer` -- Layer label for the report: `L0`, `L1`, or `L2a`. Default: auto-detect from directory name.

## Behavior

1. Resolve the `target` path to absolute form.
2. Determine the `layer` label (use parameter if provided; otherwise infer from directory name: `AndroidCommonDoc`→L0, infer L1/L2 from project structure or prompt user).
3. Invoke the `l0-coherence-auditor` agent, passing it the resolved `target_root` and `layer`.
4. The auditor returns a structured JSON report.
5. Save the report to `{target_root}/.gsd/audits/audit-{YYYY-MM-DD}.json` (create the directory if needed).
6. Print a human-readable summary:
   - Total violations / critical violations
   - Hub doc coverage: X/Y (Z%)
   - monitor_urls coverage: X/Y (Z%)
   - detekt_rules coverage: X/Y (Z%) — L0 only
   - List of critical violations (filepath + detail)
   - List of warnings (count only, not full list unless violations > 0)
7. Exit with a clear statement: **PASS** (0 critical violations) or **FAIL** (N critical violations).

## Implementation

Use the `l0-coherence-auditor` agent for all inspection logic. Do not re-implement the checks inline.

Steps:
1. Resolve path: use `Bash` to `realpath {target}` (or `cd {target} && pwd` on Windows).
2. Create output directory: `Bash` → `mkdir -p {target_root}/.gsd/audits/`
3. Delegate to agent: instruct the `l0-coherence-auditor` agent with `target_root` and `layer` as inputs.
4. Parse the JSON output returned by the agent.
5. Write the report file using `Write`.
6. Print the summary to the console.

## Expected Output

```
=== L0 Coherence Audit: /path/to/AndroidCommonDoc ===
Captured: 2026-03-17T12:00:00Z

Hub docs:       0/13  (0%)   ← CRITICAL: 13 missing
monitor_urls:  26/59  (44%)
detekt_rules:   0/59  (0%)
.planning/ refs: 3 violations

VIOLATIONS (16 critical, 3 warnings):
  [critical] docs/architecture/      — no hub doc
  [critical] docs/testing/           — no hub doc
  [critical] .claude/commands/doc-check.md — .planning/ reference
  ...

Result: FAIL — 16 critical violations
```

## Cross-References

- Agent: `.claude/agents/l0-coherence-auditor.md`
- MCP tool: `validate-doc-structure` (complementary, validates category-subdir alignment)
- Related skills: `/monitor-docs`, `/generate-rules`
