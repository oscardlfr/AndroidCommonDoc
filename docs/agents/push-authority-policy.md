---
scope: [workflow, security, git]
sources: [.claude/hooks/push-authorization-gate.js, scripts/lib/shell-command-intent.cjs, scripts/lib/push-peer-policy.cjs, scripts/sh/pre-push-hook.sh]
targets: [all]
slug: push-authority-policy
status: active
layer: L0
parent: agents-hub
category: agents
description: "Portable git push authority and honest runtime peer-authorization boundaries."
version: 1
last_updated: "2026-09-22"
---

# Push Authority Policy

The installed Git `pre-push` hook is the sole portable push authority. It evaluates the refs Git will send and validates the current quality-gate stamp and push proof. A runtime hook cannot replace it.

## Advisory command intent

`scripts/lib/shell-command-intent.cjs` parses executable shell segments, wrappers, Git global options, nested substitutions, and shell `-c` payloads. It detects `git push` and `gh pr create` without scanning quoted prose for keywords. Its result decides whether an additional runtime policy applies; it never authorizes transport.

## Peer policy

`scripts/lib/push-peer-policy.cjs` distinguishes requesting a push from performing it. Portable environments may allow a peer to request an operation, but performance is allowed only to the main actor unless a runtime supplies a non-spoofable, runtime-bound capability. A claimed role or agent name is not such a capability.

If the rich adapter is absent or identity cannot be proven, the actor check fails closed while the Git hook remains effective for every direct push attempt. Disk evidence proves quality conditions; it does not prove who authored a request.

## Consumer contract

`pre-pr`, `commit-lint`, `git-flow`, and release commands produce or consume evidence but do not bypass the Git hook. Alternate Git invocation spellings and wrapper commands remain subject to `pre-push` because Git invokes that hook after intent has become a real transport operation.
