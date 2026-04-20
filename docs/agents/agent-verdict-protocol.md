---
scope: L0
sources: [setup/agent-templates/arch-testing.md, setup/agent-templates/arch-platform.md, setup/agent-templates/arch-integration.md]
targets: [.planning/wave{N}/]
slug: agent-verdict-protocol
category: agents
parent: agents-hub
status: active
layer: L0
description: "Architect verdict format + disk-write + 1-liner DM protocol. Keeps PM context narrow while preserving full audit trail."
version: 1
last_updated: "2026-04"
---

# Agent Verdict Protocol

Architects write a full verdict block to disk and send a 1-liner DM to PM. This keeps the PM's context window narrow (~1-liner) while preserving a full audit trail on disk.

## Disk-Write + 1-Liner DM Pattern (MANDATORY for all arch-* agents)

After completing review for wave `{N}`:

1. **Write verdict to** `.planning/wave{N}/arch-{role}-verdict.md`
   - `{N}` = wave number from PM dispatch (e.g., `wave22`)
   - `{role}` = `platform`, `testing`, or `integration`
2. **SendMessage** to `project-manager`:
   - `"APPROVE"` — clean pass
   - `"ESCALATE: <1-sentence reason>"` — PM must decide
   - NEVER include the full verdict block in the DM — PM reads the file if needed.

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
