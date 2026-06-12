# BL-W47 Verdict Channel — Rationale

> **Status**: CANONICAL — tracked via `.gitignore` exception
> **Decision date**: 2026-06-13
> **Scope**: arch-* verdict write path for all waves from BL-W47 onward

## Decision

The canonical verdict write path for arch-* agents is `write-verdict.sh` (a shell
script located at `scripts/sh/write-verdict.sh`). All three alternatives considered
below were evaluated and rejected.

## Alternatives Considered

### (a) Write-allowlist in architect-bash-write-gate.js — REJECTED

Adding a verdict-path allowlist directly to the bash-write gate would conflate two
concerns: the gate's job is to block unsafe redirects; verdict authorization is a
separate ceremony concern. Allowlist entries in the gate are hard to audit and easy
to accidentally widen. Any allowlist entry broad enough to cover all wave paths
(`.planning/wave-*/arch-*-verdict.md`) would also allow traversal attempts that
happen to match the glob.

### (b-MCP) MCP tool for verdict writing — REJECTED

An MCP tool would require schema wiring, tool registration, and a running MCP server.
The verdict ceremony happens during Claude sessions where MCP availability is not
guaranteed. The write path must be available even without a running server. An MCP
tool also adds latency and a non-local dependency for what is a simple, auditable file
write.

### (b-script) Shell script — CHOSEN

`write-verdict.sh` is a self-contained bash script that:
- Runs anywhere bash is available (Git Bash on Windows, bash on Linux/macOS)
- Has no external dependencies beyond standard POSIX utilities
- Can be audited line-by-line
- Enforces anti-traversal, role validation, and two-phase integrity in one place
- Produces a legible audit trail on stderr
- Exits 2 on all integrity violations (fail-closed)

The script is the write path used by all arch-* agents via their template `write-verdict.sh` command. The architect-verdict-presence-gate.js hook validates the resulting file on every APPROVE send.

## Two-Phase Protocol

```
Phase 1 (PREP):    write-verdict.sh --role arch-<role> --phase prep
Phase 2 (FINAL):   write-verdict.sh --role arch-<role> --phase verify-final
```

The prep phase creates the file with `APPROVED-PREP`. The verify-final phase appends
`APPROVED-FINAL`. Both tokens must be present for the gate to allow the final APPROVE
send. This enforces the two-checkpoint ceremony without relying on agent memory.

## Gitignore Exception

`.planning/wave-bl-w47-hook-surgery/BL-W47-verdict-channel.md` is the exception that
tracks this rationale file. Wave-scoped planning files are normally ignored
(`.planning/wave*/`), but this document is a long-lived design record that should
travel with the repo. The pattern `.planning/BL-W47-verdict-channel.md` (depth-1)
is also tracked for convenience.
