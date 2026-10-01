---
title: "Local CI validation"
slug: local-ci-validation
scope: [guides, ci, testing]
sources: [androidcommondoc]
targets: [all]
status: active
layer: L0
parent: getting-started
category: guides
last_updated: "2026-10-01"
description: "Run the shell and hook tests of the GitHub CI on your own machine before pushing, with act on Docker or natively."
---
# Local CI validation

Run what CI runs before you push. `.github/workflows/reusable-shell-tests.yml` stays the only definition of the jobs; `local-ci` runs it, it does not copy it.

```bash
bash scripts/sh/local-ci.sh              # engine from the config, default native
bash scripts/sh/local-ci.sh --dry-run    # print the commands without running them
bash scripts/sh/local-ci.sh --job hooks  # only the hook tests (bats | hooks | all)
```

```powershell
pwsh scripts/ps1/local-ci.ps1            # same flags, forwards to the bash script (needs Git for Windows)
```

Exit codes: `0` passed, `1` a test job failed, `2` configuration or precondition error.

## Choose the engine

Create `.androidcommondoc/local-ci.json` (git-ignored, per machine):

```json
{ "engine": "act" }
```

| Engine | What runs | When |
|---|---|---|
| `act` | The Linux jobs of the workflow in `catthehacker/ubuntu:act-latest`, one container per Bats shard in parallel (`--max-parallel`, default 4), plus the hooks job. Needs Docker. | Before a push. Covers Linux differences. |
| `native` | The sharded runner and the Node hook tests on your OS, with a temporary `HOME` and `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`. | Default when there is no config. Does not cover Linux or Windows differences. |
| `none` | Nothing. | You run CI some other way. |

`--engine` overrides the file. Logs of the act engine are in `.androidcommondoc/local-ci/`.

## Install

macOS:

```bash
brew install colima docker act
colima start --cpu 6 --memory 12
```

OrbStack is an alternative to Colima. On Apple Silicon the containers are `linux/arm64`, CI is `x86_64`; add `--container-architecture linux/amd64` to `~/.config/act/actrc` if a job needs it.

Windows: install Docker Desktop or Podman Desktop on WSL2, then `winget install nektos.act`. Run the script from Git Bash or through `local-ci.ps1`.

Linux: install Docker Engine and act (<https://nektosact.com/installation/>).

## For agents

- Run `local-ci` before any push. Report its result with the engine that produced it.
- With `engine=native`, say that the run does not cover Linux or Windows differences. Git identity, host certificates and platform files can pass on a laptop and fail on a runner.
- If `engine=act` fails with exit `2`, follow the printed install instruction; do not switch to `native` silently.

## Hermetic tests

A test must not rely on anything the CI runner lacks. Each test creates its own git identity (`git config user.email` inside its fixture repository), its own certificates and its own platform files, or skips with a precondition that says why. The `native` engine and the CI runner both start without a global git config, so a missing identity fails in both.

See also [quality-gate local CI reproduction](../agents/quality-gate-local-ci-reproduction.md) for the evidence-grade reproduction used by the quality gate.
