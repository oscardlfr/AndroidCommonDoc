# runtime-consultation.ps1 -- thin argv->node forwarder for the portable
# runtime-consultation core (Wave 1, portable-runtime-messaging-adapters).
#
# Frozen Production CLI ABI note (PLAN.md ~L750-755): this wrapper is a
# byte-for-byte argv forwarder to `node scripts/lib/runtime-consultation.cjs`
# with zero embedded protocol/state/security logic of its own -- no argument
# parsing, no flag interpretation, no output transformation. It resolves its
# own directory via $PSScriptRoot and invokes node against the sibling lib
# implementation, splatting every remaining argument through unchanged via
# the automatic $args variable (deliberately no param() block -- a formal
# parameter would risk reshaping/re-ordering argv instead of forwarding it
# verbatim). stdin/stdout/stderr pass through natively via the call operator;
# the exit code is propagated explicitly via $LASTEXITCODE.
#
# Bash counterpart: scripts/sh/runtime-consultation.sh (same contract, same
# sibling lib target).
#
# Structural-parity note: on this repo's non-Windows hosts, this file is
# proven only STRUCTURALLY (a static text check, no live pwsh interpreter) by
# scripts/tests/runtime-consultation-windows.bats. The real W01-W12
# EXECUTABLE leg runs on windows-latest CI via
# scripts/tests/runtime-consultation-windows.ps1 (PLAN.md ~L1555-1567).
#
# Usage:
#   scripts/ps1/runtime-consultation.ps1 <subcommand> [args...]

$ErrorActionPreference = 'Stop'

$ImplPath = Join-Path -Path $PSScriptRoot -ChildPath '..\lib\runtime-consultation.cjs'

& node $ImplPath @args
exit $LASTEXITCODE
