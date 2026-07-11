---
scope: [workflow, ai-agents, quality, verification]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: quality-gate-protocol
status: active
layer: L0
parent: agents-hub
category: agents
description: "Quality gate protocol: sequential verification (frontmatter → tests → coverage → benchmarks → pre-pr) after architect APPROVE, before commit"
version: 4
last_updated: "2026-07-11"
assumes_read: autonomous-multi-agent-workflow, context-rotation-guide
token_budget: 1500
---

# Quality Gate Protocol

Sequential verification that runs AFTER all 3 architects APPROVE and BEFORE commit. Starts with architect deliberation for Phase 2 context, then automated gates. Each step blocks -- failures must be investigated, not bypassed.

---

## When This Runs

```
Architects detect → team-lead dispatches devs → devs implement → architects verify
  ↓
All 3 architects: APPROVE
  ↓
Quality Gate (this protocol)
  Step 0: Architect Deliberation (consult persistent architects)
  Steps 1-8: Automated checks (informed by deliberation)
  ↓
All pass → commit
Any fail → investigate → fix → re-run
```

---

## Step 0: Architect Deliberation

**Before any automated check**, the quality-gater consults all 3 persistent architects who participated in Phase 2. They hold execution context that no automated tool can infer.

| Architect | quality-gater asks | Example insight |
|-----------|-------------------|-----------------|
| arch-testing | What was tested? Known coverage gaps? Deferred tests? | "Module X has a new use case but the test is a stub -- flag it" |
| arch-platform | Source set changes? Platform boundary risks? Gradle config changes? | "We added an androidMain expect/actual -- verify no jvmMain duplicate" |
| arch-integration | Cross-module impacts? DI wiring? API contract changes? | "New repo interface -- confirm Koin module registered in all targets" |

The quality-gater records deliberation findings and uses them to:
- **Prioritize** which automated steps need extra scrutiny
- **Avoid false positives** (e.g., coverage drop is expected because code moved between modules)
- **Catch gaps** that pass automated checks but fail in practice (e.g., shallow tests, missing DI wiring)

Deliberation is **mandatory**. Skipping it voids the gate.

---

## Gate Steps (dynamic -- quality-gater discovers rules at runtime)

The quality-gater does NOT use a hardcoded checklist. It discovers each project's rules by reading CLAUDE.md, asking context-provider, and running `/pre-pr` (the project's own validation pipeline). Architect deliberation from Step 0 informs which areas need extra attention.

### Step 1: Project Rule Discovery
- Read CLAUDE.md -- extract hard rules, constraints, patterns
- Ask context-provider for active Detekt rules and enforcement patterns
- Cross-reference with architect deliberation findings from Step 0
- Build project-specific verification checklist

### Step 2: Full Validation Pipeline (`/pre-pr`)
- **PRIMARY enforcement step** — runs Detekt, lint-resources, commit-lint, architecture guards
- All checks are project-configured, not hardcoded
- **BLOCK** on any failure

### Step 2.5: Warning Enforcement
- Verify `NoSuppressAnnotationsRule` is active — `@Suppress` annotations are banned
- Warnings must be fixed at the root cause, not suppressed
- **BLOCK** if any `@Suppress` annotations found in changed files

### Step 3: Test Suite
- `/test-full-parallel --fresh-daemon` — all modules must pass
- **BLOCK** on any failure
- **Lean execution**: suite output MUST go to `.androidcommondoc/suite-*.log`, NOT agent context. Use `run-bats.sh`; `^not ok` count is authoritative — `npx bats` exits 0 even when tests fail, so grep the log. Empty or absent log → treat as not-pass.
- **Full-suite completeness required**: see [§ Bats Evidence Contract](#bats-evidence-contract) below. A partial run (truncated, interrupted, or stale re-read) with 0 `not ok` is NOT a pass.

### Step 4: Coverage Baseline
- `/coverage` on touched modules — drop >1% → INVESTIGATE → **BLOCK**

### Step 5: KDoc Coverage (if .kt files changed)
- `kdoc-coverage` CLI on changed files
- **BLOCK** if new public APIs lack KDoc

### Step 6: Production File Verification
- `git diff --stat` — **BLOCK** if only test files modified on code tasks (test gaming)

### Step 7: Project Rule Cross-Check
- For EACH hard rule from Step 1: verify it was checked by an automated step or manual grep
- **BLOCK** if any rule not verified
- Report: which rules verified, how, result

### Step 8: Compose UI Tests (if UI code changed)
- Verify correct shared components used (not just "something renders")
- Verify no hardcoded strings (must use Compose multiplatform string resources)
- TDD enforced: RED test first, then GREEN
- **BLOCK** if tests missing, failing, or FALSE GREEN

### Step 10: Proof Emission

After Steps 0-9 pass, the quality-gater calls `emit-push-proof.sh --subcommand run-qg`. This mints `push-proof.json` in `.androidcommondoc/` by:
- Re-validating `quality-gate-manifest.json` protocol_digest (manifest-drift check)
- Verifying verdict→HEAD binding: each `arch-*-verdict.md` must carry `APPROVED-VERIFY-FINAL` and a `**HEAD**:` field matching the current HEAD
- Recording `steps_executed`, `report_digest` (sha256 of `quality-gate-report.json`), and `artifact_digests`
- Persisting `bats_evidence` (9 keys as of wave `qg-artifact-binding`, W7 — adds `complete`/`total` to the original 7) so the three equal-rigor push-time verifiers re-derive the same bats completeness predicate, not just presence + HEAD match

The pre-push hook (`pre-push-hook.sh`), once installed (`install-git-hooks.sh`/`make install-git-hooks` — a fresh clone has none until then), verifies this proof before allowing any push. See [qg-proof-push-gate](qg-proof-push-gate.md) for the full subsystem reference.

### Step 11: Emit qg-result.json (final)

After Step 10 completes, `emit-qg-result.sh` writes the final `qg-result.json` to `.planning/wave-<slug>/` with `status: pass|fail` and `head` matching current HEAD. This is the orchestrator-layer verdict signal (NOT a push gate artifact). See [qg-proof-push-gate § qg-result.json Schema](qg-proof-push-gate.md#qg-resultjson-schema) for field definitions and boundary list.

---

## Coverage Investigation Protocol

When coverage drops >1% on any module:

1. **DO NOT add tests to fill the gap** — that's gaming
2. **INVESTIGATE root cause**:
   - New code not covered → Is it testable? If not, WHY? (coupling? side effects?)
   - Deleted tests → Were they valid? Why deleted?
   - Code moved → Coverage moved, not dropped (false alarm)
3. **If code is not testable → not SOLID**:
   - Too many dependencies → Extract interface
   - Side effects in constructor → Dependency injection
   - God class → Single Responsibility violation
4. **Fix root cause** (refactor), THEN write quality tests
5. **Document** investigation in commit message

---

## Test Gaming Detection

Anti-patterns that indicate test gaming (quantity over quality):

| Pattern | Why it's gaming |
|---------|----------------|
| `assertEquals(X, X)` | Trivial — always passes |
| `assertTrue(true)` | No-op — tests nothing |
| `assertNotNull(...)` alone | Existence check, not behavior |
| 1 assertion per test class | Minimum effort coverage |
| Mock-only verification | Tests the test, not the code |
| `@Ignore` with no ticket | Silenced failure |

arch-testing detects these via grep on new/modified test files.

---

## Agent Template

The `quality-gater` agent template (`setup/agent-templates/quality-gater.md`) implements this protocol. It consults the 3 persistent architects (Step 0) and context-provider before running automated gates (Steps 1-8).

Distinct from `quality-gate-orchestrator` (L0 internal validator for toolkit consistency -- script-parity, template-sync).

---

## Bats Evidence Contract

Documented here per wave `qg-suite-completeness` (2026-06-21). Mechanism lives in
`scripts/sh/run-bats.sh` + `scripts/sh/emit-qg-result.sh` + CI inline guard; the
`quality-gater.md` template is NOT edited (auto-discovery preserves the no-5-pata scope).

### Canonical Full-Run Metric

A bats run is COMPLETE-and-GREEN iff ALL four conditions hold (content-authoritative;
never rely on `npx bats` exit code alone):

| # | Check | Guards against |
|---|-------|---------------|
| (a) | `ok_ct > 0` | Empty run / `1..0` plan |
| (b) | `not_ok == 0` (`grep -c "^not ok"`) | Any test failure |
| (c) | Exactly one `1..N` plan line AND `(ok_ct + not_ok) == N` | Truncated / partial / raced run |
| (d) | No `# bats warning: Executed X instead of expected Y tests` line | teardown_file inflation |

**None of these checks subsumes another.** A file that fails to LOAD collapses to `1..1` +
`not ok` — caught by (b), not (c). A partial run with 0 failures passes (b) but fails (c).

**Expected N** is parsed from the single `^1\.[.][0-9]+` plan line in the evaluated TAP log
(anchor-free, CRLF-safe via `tr -d '\r'`). Self-contained; zero TOCTOU.

**Optional cross-check** (`--cross-check-count`, execution/CI only): on a clean run,
`grep -c "^ok "` == `npx bats --count scripts/tests` == plan `N`
(the authoritative count emitted by `run-bats.sh`; not pinned here — it changes as tests are added).
Guard with `command -v npx`; skip silently if npx absent, never hard-fail.

**EXACT equality** (`== N`), never `>= N`: `teardown_file` failures can make
`(ok + not_ok) > N`, inflating the total.

### Run-ID-Bound Handoff (run-bats.sh → emit-qg-result.sh)

**Problem**: `suite-bats.log` is a shared overwritable file. If bats runs more than once
during a QG session (e.g., `/pre-pr` Step 2 + Step 3 `run-bats.sh`), `emit-qg-result.sh`
re-reading the shared log may capture an intermediate, not the authoritative single run.

**Solution**: `run-bats.sh` (full-run mode) writes a **unique-per-run handoff** file:
`.androidcommondoc/bats-result.<BATS_RUN_ID>.env` (gitignored scratch; atomic temp+mv).

**Handoff fields:**

| Field | Description |
|-------|-------------|
| `BATS_OK` | Count of `^ok ` lines |
| `BATS_NOT_OK` | Count of `^not ok` lines |
| `BATS_EXPECTED` | Plan N from `1..N` line |
| `BATS_TOTAL` | `BATS_OK + BATS_NOT_OK` |
| `BATS_COMPLETE` | `true`\|`false` (4-part check) |
| `BATS_VERDICT` | `pass`\|`fail` |
| `BATS_LOG` | Absolute path of TAP log evaluated |
| `BATS_HEAD` | `git rev-parse HEAD` at run time |
| `BATS_RUN_ID` | Unique per invocation (timestamp+pid+rand) |
| `BATS_GENERATED_AT` | Sortable UTC timestamp (same format as `qg-result.json` `started_at`) |

**emit-qg-result.sh discovery algorithm** (final mode):

1. Read `started_at` from `qg-result.json` (written at `--init`). If absent → skip handoff,
   use fallback.
2. Among `.androidcommondoc/bats-result.*.env`, a candidate is VALID iff ALL of:
   - `BATS_HEAD == current HEAD`
   - `BATS_RUN_ID` non-empty
   - `BATS_GENERATED_AT >= started_at` (produced during THIS QG run, not a leftover)
   - All completeness fields present and well-formed
3. If ≥1 valid: select MAX `BATS_GENERATED_AT` (deterministic, not a bare cross-time
   "latest"); source `suite_summary` from it; bats verdict = `BATS_COMPLETE==true AND
   BATS_VERDICT==pass AND BATS_NOT_OK==0`, else `status: fail`.
4. If 0 valid: fallback — re-grep the TAP log with the same 4-part completeness assertion.
   Incomplete / empty log → `status: fail`.

**Key invariant**: a handoff from a PREVIOUS QG on the same HEAD is REJECTED by the
`BATS_GENERATED_AT >= started_at` guard. `started_at` and `BATS_GENERATED_AT` MUST share
one sortable UTC format (lexicographic compare) — no fragile `date -d` parsing.

`--init` / `--phase` heartbeat modes are **untouched** (run before bats; no bats logic
in those modes). No `--bats-result` flag; no `quality-gater.md` edit.

### CI-Parity Invariant

The CI inline bats guard (`.github/workflows/reusable-shell-tests.yml`) is **self-contained**
— it does NOT call `run-bats.sh` (consumer-portability / `session-coverage.bats`
L0-clone-fallback invariant; a prior wave reverted `bash run-bats.sh` here).

**Parity requirement**: the CI inline guard MUST implement the same 4-part completeness
check as `run-bats.sh`:
- plan-parse (`^1\.[.][0-9]+` grep, same anchor-free pattern)
- `total = ok + not_ok`
- fail if `total != expected`
- fail if `Executed … instead of expected` warning line present
- same target glob as `run-bats.sh`

This invariant is enforced by `scripts/tests/ci-bats-parity.bats` (C4, this wave), which
asserts the yml contains all four logic patterns. Reciprocal comments in both files
document the keep-in-parity requirement.

**Local-green ⇒ CI-green** by construction when this invariant holds.

---

---

## Committed Manifest SHA Parity (Fix 3 — composition note)

Committed `agents.manifest.yaml` `template_frontmatter_sha256` parity is enforced by construction:

- `scripts/tests/manifest-sha-parity.bats` (in the bats suite run by the QG `test-suite` required step) verifies working-tree template-frontmatter SHA vs working-tree manifest SHA.
- `emit-push-proof.sh`'s clean-tree assertion (worktree == HEAD at mint) means that if bats PASS + clean-tree PASS, then committed template frontmatter SHA == committed manifest SHA.

No dedicated gate is needed; parity is guaranteed by composition of these two existing checks.

## `/pre-pr` Scanner Semantics (distinct from QG Step S)

The MCP `scan-secrets` tool and `scripts/sh/scan-secrets.sh` (used by `/pre-pr` Step 5.6) are now hardened:

- **absent scanner** → `status: SKIPPED` (non-blocking INFO — does not assert "no secrets")
- **present but erroring** → `status: FAIL` + `reason_code: SCANNER_ERROR` (blocks)
- **CRITICAL or HIGH findings detected** → `status: FAIL` + `reason_code: SECRETS_FOUND` (blocks)
- **clean scan** → `status: PASS` + `reason_code: OK`

This is distinct from the QG Step S path (`secret-scan-report.sh`), where absent/erroring scanner → FAIL (never SKIPPED). Both paths agree: present-but-erroring = FAIL; findings = FAIL.

## Related Docs

- [Team Topology](team-topology.md) — 3-phase model where Quality Gate is Phase 3
- [Multi-Agent Patterns](multi-agent-patterns.md) — orchestration and architect gates
- [Context Rotation Guide](context-rotation-guide.md) — context management for long sessions
- [Claude Code Workflow](claude-code-workflow.md) — single-agent patterns
