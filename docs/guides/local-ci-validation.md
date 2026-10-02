---
title: "Local CI validation"
slug: local-ci-validation
scope: [guides, ci, testing]
sources: [androidcommondoc]
targets: [all]
status: active
layer: L0
parent: guides-hub
category: guides
last_updated: "2026-10-01"
description: "Run the shell and hook tests of the GitHub CI on your own machine before pushing, with act on Docker or natively."
---
# Local CI validation

Run what CI runs before you push, without spending CI minutes. `.github/workflows/reusable-shell-tests.yml` stays the only definition of the jobs: `local-ci` runs it, it does not copy it.

```bash
bash scripts/sh/local-ci.sh                       # engine from the config, default native
bash scripts/sh/local-ci.sh --job hooks           # only the hook job (bats | hooks | all)
bash scripts/sh/local-ci.sh --engine act --shards "0 3"   # re-run two shards with act
bash scripts/sh/local-ci.sh --dry-run             # print the commands, run nothing
```

```powershell
pwsh scripts/ps1/local-ci.ps1 --job hooks         # same flags; forwards to the bash script (Git for Windows)
```

Exit codes: `0` passed, `1` a test job failed, `2` usage, configuration or precondition error.

## Choose the engine

Optional per-machine setting in `.androidcommondoc/local-ci.json` (git-ignored). Without it the engine is `native`; `--engine` overrides it.

```json
{ "engine": "act" }
```

| Engine | What runs | Covers |
|---|---|---|
| `act` | Every `bats` shard of the workflow matrix (`act workflow_call -W .github/workflows/reusable-shell-tests.yml -j bats --matrix shard:N`, up to `--max-parallel`, default 4, at once) and the `bats-post` hook job, in `catthehacker/ubuntu:act-latest` (Ubuntu 24.04, as `ubuntu-latest`). | Linux, as CI. |
| `native` | `scripts/tools/run-bats-sharded.cjs` with the workflow's shard count (on Windows `scripts/sh/run-bats.sh`), then the Node hook roster minus the workflow's skip list. Hermetic: temporary `HOME` and `TMPDIR`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`. | Your OS only. |
| `none` | Nothing. | - |

`act` runs a fresh clone of the **committed `HEAD`** (on a local branch named `local-ci`, so the clone survives `docker cp` even when you start from a detached HEAD; run one `local-ci` at a time, parallel act runs compete for ports and the action cache) (uncommitted changes are reported and not validated), so it works from linked worktrees and tests exactly what you push. Logs: `.androidcommondoc/local-ci/shard-N.log` and `hooks.log`.

`native` needs the built mcp-server, as the CI jobs build it: `(cd mcp-server && npm ci && npm run build)`.

## Install

### macOS

```bash
brew install colima docker act
colima start --cpu 6 --memory 12
docker version          # must show a Server section
```

OrbStack is an alternative to Colima. Apple Silicon runs `aarch64` Linux containers while CI is `x86_64`. Add `--container-architecture linux/amd64` to `~/.config/act/actrc` only if a job needs it (emulated, several times slower).

### Windows

1. Install Docker Desktop, or Podman Desktop, on the WSL2 backend.
2. `winget install nektos.act`
3. Run from Git Bash, or `pwsh scripts/ps1/local-ci.ps1`.

### Linux

Install Docker Engine (<https://docs.docker.com/engine/install/>) and act (<https://nektosact.com/installation/>).

## How act matches the runner

- `--input androidcommondoc_path=.`: the toolkit scripts come from the commit under test.
- `--container-options "--user 1001:1001 --init"` plus a writable `HOME` and npm prefix: a GitHub runner is a non-root user with an init; as root, permission and process-reaping tests fail for reasons CI never sees.
- `--container-daemon-socket -`: no job uses Docker, and the host socket path does not exist inside the Colima or Podman VM.
- Each parallel shard gets its own action cache and artifact port, so concurrent `act` runs do not race.

Known limits: `act` covers the Linux jobs only (the Windows and macOS workflows still need GitHub), and `actions/checkout` is replaced by the local clone (full history instead of a depth-1 merge commit).

## For agents

- Run `local-ci` before any push and report the engine with the result.
- With `engine=native`, state that the run does not cover Linux or Windows differences.
- If `engine=act` exits `2`, follow the printed install command; do not silently switch to `native`.

## Hermetic tests

A test must not rely on the developer machine. Each test creates its own git identity (`git config user.email` inside its fixture repository), its own certificates and its own platform files, or skips with a precondition that says why. The `native` engine and the CI runner both start without a global git config, so a missing identity fails in both.

See also [quality-gate local CI reproduction](../agents/quality-gate-local-ci-reproduction.md) for the evidence-grade reproduction used by the quality gate.
