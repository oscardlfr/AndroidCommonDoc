---
mode: agent
description: Generate a quality audit report with trend data — coverage, Detekt, tests, CVEs.
tools:
  - mcp0_audit-report
---

Generate a quality audit report for this project.

Steps:
1. Use `mcp0_audit-report` with `project_root` set to the current workspace root, `weeks_lookback: 6`, `format: "both"`
2. Present the markdown table directly — do not reformulate the data
3. If any metric shows 🔴, add one concrete suggestion below the table
4. If no log exists, show setup instructions

Arguments: {{input}}
