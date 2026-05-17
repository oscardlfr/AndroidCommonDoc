---
scope: l0
sources: BL-W47p-friction-log
targets: l0
category: agents
slug: arch-review-depth-mandate
description: Mandate for architect line-by-line file review before issuing APPROVE verdict. Surfaced from BL-W47p L1 session findings #29/#30.
---

# Review Depth Mandate

## Rule

Deep review MUST Read each modified file (use Read tool — not diff stat) and scan line-by-line for:

- Unused imports
- Framework mismatch (e.g., JUnit4 vs kotlin.test in Kotlin tests)
- Source set placement errors (e.g., wrong directory for AGP plugin)
- Hardcoded test values (vs UI fixtures, vs constants)
- Missing test patterns (vs canonical pattern doc references)
- Boundary violations (vs L0 architecture doc references)
- Stale references (vs latest version in template_version manifest)

Verdict APPROVE requires line-level audit, not just stat overview. If you skip Read on a diff file, you MUST NOT issue APPROVE for that file.

## Rationale

This mandate surfaced from BL-W47p L1 session where 3 architects APPROVED but 3 specialists immediately found HIGH issues (JUnit4 imports, source set errors, etc.). Architects did shallow gate reviews; specialists caught what architects missed. This mandate prevents recurrence. See BL-W47p friction signals #29/#30.
