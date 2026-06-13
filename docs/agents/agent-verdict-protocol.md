---
scope: L0
sources: [setup/agent-templates/arch-testing.md, setup/agent-templates/arch-platform.md, setup/agent-templates/arch-integration.md]
targets: [.planning/wave{N}/]
slug: agent-verdict-protocol
category: agents
parent: agents-hub
status: active
layer: L0
description: "Architect verdict format + disk-write + 1-liner DM protocol. Keeps team-lead context narrow while preserving full audit trail."
version: 2
last_updated: "2026-06"
---

# Agent Verdict Protocol

Architects write a full verdict block to disk and send a 1-liner DM to team-lead. This keeps the team-lead's context window narrow (~1-liner) while preserving a full audit trail on disk.

## Disk-Write + 1-Liner DM Pattern (MANDATORY for all arch-* agents)

After completing review for wave `{N}`:

1. **Write verdict to** `.planning/wave-{slug}/arch-{role}-verdict.md` using `write-verdict.sh` — this is the canonical mechanism. Write/Edit are denied by `architect-self-edit-gate.js`; Bash is the only path, and `write-verdict.sh` is the required tool.

   **PREP phase** (after completing analysis, before EXECUTE):
   ```bash
   bash scripts/sh/write-verdict.sh --role arch-{role} --phase prep
   ```

   **VERIFY-FINAL phase** (after all specialist work is confirmed done):
   ```bash
   bash scripts/sh/write-verdict.sh --role arch-{role} --phase verify-final
   ```

   - `{role}` = `arch-platform`, `arch-testing`, or `arch-integration` (full name, with `arch-` prefix)
   - Wave slug is resolved automatically from the git branch name (`feature/<slug>` → slug). Override with `--slug <value>` if needed.
   - The script enforces two-phase integrity: PREP creates the file (fails if already exists), VERIFY-FINAL appends (fails if no PREP file found, fails if both tokens already present).
   - Anti-traversal confinement: verdict path is always confined to `.planning/<wave-slug>/arch-{role}-verdict.md` within repo root.

   team-lead MUST verify file presence before TaskUpdate (see `tl-verification-gates.md`).

   **Legacy heredoc path**: the old `cat <<'EOF' >` heredoc route to verdict files emits a WARN on stderr (detected by `architect-bash-write-gate.js` dual-token detector). It will BLOCK with `VERDICT_CHANNEL_ENFORCE=1` in the next wave. Use `write-verdict.sh` exclusively.

   **Why the heredoc was replaced**: on Windows, Bash interprets `\<octal-digits>` inside absolute paths as octal escape characters, corrupting the destination filename. `write-verdict.sh` handles path construction internally and is path-safe on all platforms.

2. **SendMessage** to `team-lead`:
   - `"APPROVE"` — clean pass
   - `"ESCALATE: <1-sentence reason>"` — team-lead must decide
   - NEVER include the full verdict block in the DM — team-lead reads the file if needed.

## arch-platform Verdict Block

```
## Architect Verdict: Platform

**Verdict: APPROVE / ESCALATE**

### MCP Tool Results
- verify-kmp-packages: {PASS/FAIL — details}
- dependency-graph: {cycles: none/found}
- gradle-config-lint: {PASS/FAIL}

### Issues Found & Resolved
| # | Violation | Action Taken | Result |
|---|-----------|-------------|--------|
| 1 | android.* import in commonMain | Moved to androidMain | Fixed |

### Escalated (if any)
- {violation}: {why it's beyond scope}

### Cross-Architect Checks
- arch-testing: {PASS/FAIL} — tests after fixes
- arch-integration: {PASS/FAIL} — build after fixes
```

## arch-testing Verdict Block

```
## Architect Verdict: Testing

**Verdict: APPROVE / ESCALATE**

### Modules Tested
- {module}: {PASS/FAIL} — {test count} tests

### Issues Found & Resolved
| # | Issue | Action Taken | Result |
|---|-------|-------------|--------|
| 1 | Missing regression test for {fix} | Delegated to test-specialist | Test written + passes |

### Escalated (if any)
- {issue}: {why it's beyond scope}

### Cross-Architect Checks
- arch-platform: {called/not needed} — {result}
- arch-integration: {called/not needed} — {result}

### Evidence
- Test output: {summary}
- MCP code-metrics: {if used}
```

## arch-integration Verdict Block

```
## Architect Verdict: Integration

**Verdict: APPROVE / ESCALATE**

### Build Status
- Compilation: {PASS/FAIL}
- Platform: {desktopMain/androidMain/commonMain}

### Wiring Verification
| Component | Type | DI Registered | Nav Wired | Called from UI |
|-----------|------|---------------|-----------|----------------|
| FooVM     | ViewModel | appModule:42 | App.kt:89 | FooScreen:12 |

### Issues Found & Resolved
| # | Issue | Action Taken | Result |
|---|-------|-------------|--------|
| 1 | BarUseCase not in Koin | Added to appModule | Build passes |

### Escalated (if any)
- {issue}: {why it's beyond scope}

### Cross-Architect Checks
- arch-testing: {PASS/FAIL} — tests after fixes
- arch-platform: {PASS/FAIL} — patterns after fixes
```
