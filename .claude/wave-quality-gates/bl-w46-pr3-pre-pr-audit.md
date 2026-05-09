---
wave: BL-W46
pr: PR3
type: pre-pr-audit
swept_at: 2026-05-09
---

# PR3 Pre-PR Audit — architect-bash-write-gate node -e Fix

## Scope
1 finding: **Deferred-2** (BL-W45 deferred item)

## Root Cause Analysis
- Symptom: `architect-bash-write-gate.js` fired on architect attempts to write verdict files via `node -e 'fs.writeFileSync(...)'` patterns even when target was an exempt `.planning/wave-*/arch-*-verdict.md` path
- Initial hypothesis (planner): `collectRedirectTargets()` tokenizer extracts redirect targets from inside `node -e` string literals
- CP-corrected analysis: Actually a PATTERN MATCH — `PYTHON_WRITE_RE` (e.g., `\bopen\(`, `\bwrite\(`) matches the BODY content of `node -e '...'` args
- True fix: `NODE_EVAL_RE` exemption in `detectViolation()` — strip `node -e` quoted arg content BEFORE applying PYTHON_WRITE_RE scan

## Implementation
File: `.claude/hooks/architect-bash-write-gate.js`
- Added `NODE_EVAL_RE = /node\s+-e\s+(['"])(.*?)\1/g` (matches matching-quote pairs, non-greedy)
- In `detectViolation()`: derive `cmdNoPythonEval = cmd.replace(NODE_EVAL_RE, '')`
- Apply `PYTHON_WRITE_RE` and `PYTHON_HEREDOC_WRITE_RE` to `cmdNoPythonEval` instead of `cmd`
- Apply `PATHLIB_WRITE_RE` and redirect-scanner to original `cmd` (real shell writes still detected)

## Tests
File: `scripts/tests/architect-bash-write-gate.bats`
- +2 new tests asserting `node -e` patterns with `open(`/`write(` in body don't false-fire
- All 78 existing tests still PASS

## README Update
- bats count: 1079 → 1081 (+2 from PR3 tests, base 1079 includes PR2's +1)

## Security Verification
Per arch-platform analysis:
- NODE_EVAL_RE narrow: requires matching quote backreference; UNQUOTED `node -e <expr>` NOT exempted (real write attempts still fire)
- Chained command bypass attempt: `node -e '...'; python3 -c 'open(...)'` → stripped node portion only, python3 still fires PYTHON_WRITE_RE
- Real shell redirects (`>`, `>>`) untouched — still fire gate
- Python heredoc writes untouched — still fire gate
- Pathlib write patterns untouched

## Architect Verdicts
| Architect | Verdict | File |
|-----------|---------|------|
| arch-platform | APPROVE | `.planning/wave-bl-w46/arch-platform-verify-bl-w46-pr3.md` |
| arch-integration | APPROVE | `.planning/wave-bl-w46/arch-integration-verdict-bl-w46-pr3.md` |
| arch-testing | APPROVE | `.planning/wave-bl-w46/arch-testing-verdict-bl-w46-pr3.md` |

## Branch Lineage
- Branched off develop @882d29f (PR1 merged)
- PR2 #158 merged after PR3 work started
- Rebased onto develop @1c702e8 (PR2 merged) before push
- README conflict (PR2's 1079 vs PR3's pre-rebase 1080) resolved to 1081

## Deviations
- toolkit-specialist did not write sentinel/audit artifacts during initial PR3 work; orchestrator created on push as part of clean-git-flow-squash workflow.
- Original PR3 branch had 0 commits ahead of develop at rebase time (work was unstaged); changes consolidated into single squash commit.
