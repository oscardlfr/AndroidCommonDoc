---
name: init-session
description: "Show the canonical runtime readiness dashboard. Optionally ensures the persistent support plane with --orchestrate <slug>."
intent: [session, init, context, agents, skills, modules]
copilot: false
---

# Init-Session Skill

Show canonical runtime readiness and, when requested, ensure the support plane.

## Usage

```
/init-session                              # dashboard-only (read-only, default)
/init-session --orchestrate <slug>         # ensure core support plane, then dashboard
```

The `<slug>` is required when `--orchestrate` is passed. Example: `/init-session --orchestrate bl-w32-07`.

## Canonical Runtime Entrypoint

Your first action after reading this skill MUST be exactly one standalone Bash
call from the two forms below:

```bash
node .claude/runtime/l0-entrypoint-launcher.cjs init-session
node .claude/runtime/l0-entrypoint-launcher.cjs init-session --orchestrate <slug>
```

Do not run `ls`, `find`, `which`, `pwd`, `node -e`, Read, Glob, Grep, or any
other discovery/encoding step first. Do not quote, expand, reconstruct, or
translate the command. The installed PreToolUse hook derives the absolute
consumer root, trusted Node executable, and canonical base64url intent, verifies
the manifest-pinned L0 runtime, and rewrites this shorthand to the internal
entrypoint command. It rejects missing/extra arguments, unsafe slugs, shell
operators, a foreign cwd, or an invalid runtime installation. If rejected, use
the documented ordinary sync plus runtime refresh; never guess a toolkit path.

The shared entrypoint initializes/validates the control-plane state and derives
the lifecycle role set itself. Treat `READY` as a proven runtime dashboard
result, execute only returned `ACTION_REQUIRED` actions through the runtime
adapter, and report `BLOCKED|UNAVAILABLE|FAILED` or a non-zero exit without
inventing readiness. A failed or non-ready launcher result is terminal for this
invocation: do not continue with manual context gathering; run
ad-hoc discovery, or ask approval for a replacement command.

## Step 0 — Core Support-Plane Dispatch (when --orchestrate <slug> is passed)

Skip this step if `--orchestrate` flag is absent. Default behavior is read-only dashboard.

When `--orchestrate <slug>` is passed:

1. Validate slug is present: if `--orchestrate` is passed without a slug, emit error: "Usage: /init-session --orchestrate <slug>" and exit.
2. Submit the slug through the canonical shorthand above. The hook alone constructs the internal runtime intent. The entrypoint initializes or reads the shared phase state and obtains class-aware lifecycle work from the control plane; never run a second orchestration path, use a hard-coded roster, or embed vendor-specific dispatch/messaging calls:
   - `probe(profile)` reads the active `runtime-collaboration-policy.json` profile (`auto|persistent|ephemeral|disk-only`) and connector capabilities.
   - Execute each returned `ensure` action through the existing Wave-1 role-lifecycle manager. HARNESS, DOC and FAST-PATH role floors come only from `wave-topology.yaml` plus the active PLAN; `quality-gater` stays phase-scoped and is never parked in the persistent plane.
   - `waitReady` for the resulting bindings, bounded by the policy's `ready_timeout_seconds`.
   - This is idempotent: a second `--orchestrate` call in the same session reuses the existing healthy bindings instead of respawning. `auto|persistent` launches at most one retained connector (Claude Agent Teams peer or Codex supervisor) per role; `ephemeral`/`disk-only` fall back per policy without a false READY claim.
3. Once the support plane is READY, context-provider is addressable for the rest of the session — no separate mandatory "consult and wait" step is required here.
4. Summarize only the canonical envelope returned by the entrypoint.

> **Note**: The `<slug>` determines the wave artifact directory and its persisted phase state. The load-bearing contract is validated disk artifacts and legal control-plane transitions — not named-team membership or a live message.

## Result handling

- `READY`: summarize the returned status, selection, actions, and role state.
- `ACTION_REQUIRED`: execute only the exact runtime-adapter actions in the
  envelope, then report the resulting canonical status.
- `BLOCKED`, `UNAVAILABLE`, `FAILED`, non-zero exit, or approval prompt: report
  it and stop.
- Never issue `ls`, `find`, `git`, Python, Read, Glob, Grep, or a hand-built
  dashboard as a fallback. Missing presentation data is a runtime-contract gap,
  not permission to inspect the checkout ad hoc.

When the canonical envelope reports layer identity, interpret only the fields
it supplies. `l0-manifest.json.consumer_layer` is the L1/L2 architectural
authority; publishing a skills registry is an independent capability. Legacy
manifests without that field may use the old registry marker only until the next
runtime refresh persists the inferred role. A `runtime-consumer/v1` block must
agree with the explicit declaration; flag disagreement instead of silently
choosing one. These are result interpretation rules, not permission to read the
manifest or scan markers after the launcher returns.

## Notes

- Dashboard mode is read-only; orchestration may perform only the actions admitted by the runtime envelope.
- Run this at the start of a new session to orient yourself
- Session naming: the wave slug names the wave artifact directory (`.planning/wave-<slug>/`). Pick descriptive slugs (e.g., `feature-auth`) — they serve as wave identifiers. The load-bearing contract is the disk artifacts in that directory, not named-team membership.
