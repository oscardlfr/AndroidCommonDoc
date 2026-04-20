---
name: audit
description: "Generate a quality audit report from .androidcommondoc/audit-log.jsonl. Produces a manager-friendly trend table (coverage, Detekt, tests, CVEs) with traffic lights and period deltas. Zero extra Gradle runs — reads from data already written by scripts."
intent: [audit, report, quality, coverage, detekt, cve, trend]
allowed-tools: [mcp__androidcommondoc__audit-report]
disable-model-invocation: false
copilot: true
copilot-template-type: behavioral
---

## Usage

```
/audit
/audit --weeks 8
/audit --format markdown
/audit --project-root /path/to/project
```

## Parameters

- `--weeks N` — Weeks of history to show (default: 6)
- `--format json|markdown|both` — Output format (default: both)
- `--project-root PATH` — Project root (default: current directory)

## Behavior

### 1. Locate audit log

Resolve `project_root` from `--project-root` or the current working directory.

### 2. Call MCP tool

```
mcp__androidcommondoc__audit-report({
  project_root: <resolved_path>,
  weeks_lookback: <weeks>,
  format: <format>
})
```

### 3. Present output

- If `format` includes `markdown`: present the table directly — no reformatting needed
- If `format` includes `json`: present raw JSON for debugging or piping
- If log not found: show setup instructions

### 4. Interpret and surface insights (optional)

If `format` is `markdown` or `both`, append a brief plain-language summary:

- Flag any 🔴 metrics with a concrete suggestion ("Detekt violations increased 40% — run `/validate-patterns` to identify regressions")
- Note strongest improvement ("Coverage improved +26pp over the period")
- If `health` is `CRITICAL`, make it the first line

## Output contract

The agent reads **only the MCP tool response** — it never reads `audit-log.jsonl` directly.
The JSONL file is written exclusively by scripts and consumed exclusively by the MCP tool.
This keeps the agent context minimal regardless of log size.

## No-data handling

If the log does not exist yet, output:

```
No audit data yet for this project.

To start collecting:
1. Run /test-full or /test-full-parallel — instruments coverage + Detekt
2. Run /sbom-scan — instruments CVE tracking
3. Run /android-test — instruments test pass rate (Android-only + KMP)
4. Run /verify-kmp — instruments KMP source set health (KMP only)

Data accumulates in .androidcommondoc/audit-log.jsonl
Add to .gitattributes:  .androidcommondoc/audit-log.jsonl merge=union
```
