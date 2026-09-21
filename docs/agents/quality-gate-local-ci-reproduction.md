---
scope: [workflow, quality, verification, ci]
sources: [androidcommondoc, github-actions]
targets: [all]
slug: quality-gate-local-ci-reproduction
status: active
layer: L0
parent: quality-gater-hub
category: agents
description: "Normative local CI reproduction profiles for Linux CI, canonical QG evidence, and native Windows validation"
version: 1
last_updated: "2026-09-21"
assumes_read: quality-gate-protocol
token_budget: 900
---

# Local CI Reproduction

Every local result MUST name one of these profiles. An unlabeled "Bats is green"
claim is not acceptance evidence.

## `ci-linux-equivalent`

Use this profile when predicting `.github/workflows/reusable-shell-tests.yml`:

1. Start from a clean checkout or bundle at the exact candidate HEAD. Do not mount
   host `node_modules` or reuse host-generated `mcp-server/build` output.
2. Run as a non-root Linux user. The container preflight MUST reject UID 0:
   `test "$(id -u)" -ne 0`. Root invalidates permission/EACCES tests even when the
   suite happens to be green.
3. Use Node major 24, install Bats inside the container with the same workflow
   operation (`npm install bats`), and record `node --version` plus
   `npx bats --version` in the evidence.
4. Reproduce the workflow's four-shard plan with
   `scripts/tools/plan-bats-shards.cjs --suite-root scripts/tests --shard-count 4`.
   For each shard, consume that one plan object for both its NUL-delimited file list
   and `needsMcpServer`. When the flag is true, run `npm ci` and `npm run build`
   inside `mcp-server` before Bats. Then execute the shard with `npx bats` and apply
   the same four-part completeness predicate as the workflow.
5. Reproduce `bats-post` separately: build `mcp-server`, install Bats in that job's
   clean filesystem, and execute the same `.test.js` roster and explicit R33 skip
   list. Matrix-shard state MUST NOT be assumed to exist in this phase.
6. Record candidate HEAD, container image digest, effective UID/GID, Node/Bats
   versions, per-shard manifests, TAP logs, counts, and exit codes.

This profile reproduces the repository's relevant userspace and command contract;
it does not claim to reproduce GitHub's hosted kernel or service layer byte for
byte. Required GitHub checks remain authoritative for runner-specific behavior.

## `qg-linux-canonical`

The six-shard `scripts/tools/run-bats-sharded.cjs` run plus selection through
`scripts/sh/lib/bats-handoff.sh` is the canonical local quality-gate evidence path.
It MUST obey the same clean-checkout, non-root, Node 24, in-container dependency,
and `mcp-server` build requirements above. It proves full-roster completeness and
handoff selection, but MUST NOT be described as an exact replay of the four-shard
GitHub workflow.

## `windows-native`

Windows runner claims require the same shell named by the workflows. In particular,
Windows PowerShell 5.1 is not a substitute for PowerShell 7 (`pwsh`):

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File scripts/tests/runtime-bridge-codex-windows.ps1
node scripts/tests/codex-pin-freeze.test.js
pwsh -NoLogo -NoProfile -NonInteractive -File scripts/tests/runtime-consultation-windows.ps1
```

Git Bash and WSL runs may provide diagnostics, but they do not qualify native
Windows ACL or PowerShell behavior. Conversely, native-Windows Python invoked from
Git Bash is not a Linux substitute: POSIX paths passed through environment variables
are not automatically canonicalized for that interpreter.

## Invalid evidence

Reject the result rather than reclassifying a red run when any of these applies:

- WSL/MSYS is presented as Linux-CI acceptance;
- Docker ran as root;
- dependencies or `mcp-server` build output came from the host or were omitted;
- an isolation `PATH` removed a declared prerequisite such as `python3`;
- a six-shard QG run is described as the exact four-shard CI invocation;
- `powershell.exe`/Windows PowerShell 5.1 is used for a workflow that names `pwsh`.

## Related Docs

- [Quality Gate Protocol](quality-gate-protocol.md)
- [quality-gater Hub](quality-gater-hub.md)
- [QG Proof Push Gate](qg-proof-push-gate.md)
