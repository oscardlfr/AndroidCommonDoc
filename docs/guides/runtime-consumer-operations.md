---
title: "Runtime consumer operations"
slug: runtime-consumer-operations
scope: [guides, runtime, consumers]
sources: [androidcommondoc]
targets: [all]
status: active
layer: L0
parent: getting-started
category: guides
last_updated: "2026-09-28"
description: "Exact installation, launch, recovery, worktree, and Claude host compatibility procedure for L1/L2 consumers."
---

# Runtime consumer operations

## Install or refresh a consumer

Build the toolkit first. Preflight and apply ordinary sync before preflighting
and applying the source-referenced runtime install:

```bash
cd "$ANDROID_COMMON_DOC/mcp-server"
npm ci && npm run build
node build/sync/sync-l0-cli.js --project-root /absolute/path/to/consumer --dry-run
node build/sync/sync-l0-cli.js --project-root /absolute/path/to/consumer
node build/sync/sync-l0-cli.js --project-root /absolute/path/to/consumer --runtime --dry-run
node build/sync/sync-l0-cli.js --project-root /absolute/path/to/consumer --runtime
```

An L1 must own `skills/registry.json`; generate it with `npm run generate-registry -- /absolute/path/to/L1`
from the toolkit `mcp-server`. Without that marker the portable layer contract intentionally classifies it as L2.

`--runtime` installs the consumer-owned wave topology, the standalone `.claude/runtime/l0-entrypoint-launcher.cjs`,
and a toolkit runtime-closure digest. Every runtime skill invokes that local launcher; L0 self-hosts the same path.
Hooks that import L0 modules are not copied partially. Instead,
the consumer also receives `.claude/hooks/l0-source-hook-launcher.js`; registrations call that stable local hook
launcher. Both launchers resolve the one local L0 tooling source from `l0-manifest.json` at execution time. The
runtime entrypoint launcher verifies the installed pin and content before forwarding; the source-hook launcher
confines source resolution and delegates the hook without certifying the runtime installation. No Node installation
path, user home, or toolkit checkout is serialized into consumer `settings.json` or generated skill commands. The
runtime installer materializes and checksums every consumer-local hook target registered in `settings.json`, including
the context-bundle write gate and tool-use logger, together with the context provider's sanctioned
`scripts/sh/write-bundle.sh` closure. Installation fails closed on missing, customized, or incomplete local targets.
Standalone hooks remain copyable.
Remote, missing, ambiguous, or symlinked source targets fail closed. Re-run both
commands after changing toolkit revisions. A managed topology from an older sync is updated automatically only
when its current bytes still match the checksum recorded by that sync. Local
topology drift or a customized role remains a conflict and is never overwritten.

The shell hook installer also verifies executable mode. An identical Detekt hook that lost its executable bit is
repaired without `--force` and reported as an executable repair; the mode-only repair does not rewrite the manifest.
Differing bytes fail and require review. A repeated ordinary or runtime sync with no manifest-tracked change and no
pending mode repair preserves `l0-manifest.json` byte-for-byte, including `last_synced`, so verification stays clean.

### Runtime skill invocation and failure behavior

`/init-session` has a deliberately small public surface so the model never has
to discover paths or construct an encoded intent:

```bash
node .claude/runtime/l0-entrypoint-launcher.cjs init-session
node .claude/runtime/l0-entrypoint-launcher.cjs init-session --orchestrate <slug>
```

Its PreToolUse hook derives the trusted Node path, exact consumer root, and
canonical base64url intent, then verifies and rewrites the request to the
internal command. Missing or extra arguments, unsafe slugs, shell operators,
foreign cwd, and an invalid installation fail closed. `/resume-work`, `/work`, `/ingest-content`, and `/monitor-docs`
retain the internal closed form documented in their skill files.

The model must not discover the sibling toolkit, call `scripts/lib/runtime-collaboration-entrypoints.cjs` directly, or substitute
`$PWD`, `$(pwd)`, `ANDROID_COMMON_DOC`, or another ambient path. A missing local
launcher, missing/ambiguous/remote/symlinked L0 tooling source, commit or digest
drift, or missing executable closure is a closed failure. Do not fall back to a
dashboard-only imitation. Refresh the toolkit checkout deliberately, then rerun
ordinary sync followed by runtime sync and restart the host.

## Launch Claude from a consumer

The toolkit is a sibling of the consumer, so every normal Claude session must add
it to the host's readable roots:

```bash
cd /absolute/path/to/consumer
claude --add-dir "$ANDROID_COMMON_DOC" --effort high
```

PowerShell:

```powershell
Set-Location C:\absolute\path\to\consumer
claude --add-dir $env:ANDROID_COMMON_DOC --effort high
```

`--add-dir` grants host filesystem reachability; `--effort high` is verified from the native PreToolUse event. Neither replaces
`l0-manifest.json`, runtime digests, certificate pins, or the Git hooks. Linked Git
worktrees may retain the manifest path authored relative to the main checkout; both
the installer and hook launcher use Git's common directory rather than an ambient
fallback. If the same manifest-relative source resolves to different toolkits from
the linked and main checkouts, activation fails closed as ambiguous.

Run Gradle serially within one worktree. Concurrent Gradle invocations that share
the same checkout/build directories can produce transient unresolved-reference
cascades that disappear on an isolated rerun. If parallel validation is required,
use distinct worktrees and isolated Gradle/build directories. Before selecting a
platform compilation target, enumerate the checkout's actual tasks (for example,
`./gradlew tasks --all`); do not infer `macosX64` from the presence of
`macosArm64` or from a different consumer's target matrix.

Authenticated entrypoint commands use canonical POSIX form with every token single-quoted. Double-quoted commands
are non-canonical and intentionally pass through ordinary approval.

### Interactive terminal input

Treat terminal control input and prompt submission as separate operations. When
clearing a prompt, send `Ctrl+U`, wait, send the new prompt, then send `Enter`.
Combining those actions in one PTY write can truncate or concatenate input; this
is a terminal boundary, not an L0 hook repair. Use `-p` / `--print` only for a
bounded, non-persistent one-turn invocation.

## Full quality-gate ownership

The `quality-gater` owns one canonical local full Bats execution. Focused tests are
the development loop; after the PLAN, path manifest, clean HEAD, architect verdict
bindings, and QG session are current, it invokes `run-bats-sharded.cjs` once with
six shards at max parallelism six and explicit `--wave-slug` plus `--plan`. Only
the verified full aggregate authorizes the feature-branch push; individual shard
handoffs do not.

The local aggregate validates the exact branch HEAD and authorizes publishing it.
Under strict branch protection, required GitHub `CI Gate` validates the PR merge
candidate updated with `develop` and authorizes merge; it is not a claim that CI
tested the byte-identical local SHA. Do not run a second local full suite to
manufacture agreement, and never merge while `CI Gate` is absent, pending,
cancelled, or red. The former two-local-run contract is
superseded; freshness, exact HEAD/PLAN binding, full-roster completeness, and
fail-closed evidence validation remain unchanged.

## Recovery when startup customizations interfere

`--safe-mode` keeps normal OAuth/keychain authentication and disables project/user
customizations such as CLAUDE.md, auto-memory, hooks, plugins, and MCP. It is not a
tool-capability boundary: built-in agents or tools may still be advertised or usable
unless `--tools` removes them.
Use it to inspect or repair the consumer, then exit normally. It disables plugins and MCP; Context7 tasks use the [bounded research profile](runtime-consumer-research-mode.md):

```bash
cd /absolute/path/to/consumer
claude --safe-mode --add-dir "$ANDROID_COMMON_DOC"
```

For a single non-persistent diagnostic or tightly reviewed repair, put the
bounded instruction in a regular, non-symlink prompt file and use the supervised
launcher:

```bash
node "$ANDROID_COMMON_DOC/scripts/tools/claude-safe-one-shot.cjs" \
  --project-root "$(pwd)" \
  --l0-root "$ANDROID_COMMON_DOC" \
  --claude-executable "$(command -v claude)" \
  --prompt-file /absolute/path/to/recovery-prompt.txt \
  --model sonnet
```

The launcher invokes `--safe-mode --restricted -p --no-session-persistence`,
asks the host to restrict native file tools to the project plus `--add-dir`, uses
the exact `Read,Glob,Grep` profile by default, and never enables the
`--dangerously-skip-permissions` bypass. Use `--tools ""` for a rubber-duck turn
with no tools, retain the default for read-only inspection, or pass exactly
`--tools "Read,Glob,Grep,Bash"` for a reviewed repair. `--allowedTools` is not a
restriction mechanism; it only preauthorizes tools and must not be used as the
boundary. The launcher checks that `system/init.tools` matches the requested set
before waiting for model activity, so advertised `Agent`, `Task`, `SendMessage`, or
an unrequested `Bash` fails closed. This is not a claim that arbitrary Bash traversal
is path-confined: `Bash` can mutate state and enforceable shell scope remains
`BL-CONS-P1-03`.

Treat effort as one authority, not two. Claude Code 2.1.x gives an inherited
`CLAUDE_CODE_EFFORT_LEVEL` precedence over `--effort`; a user setting such as
`env.CLAUDE_CODE_EFFORT_LEVEL: max` can therefore override `--effort low` or
`--effort high`, even after the settings file is edited if the parent process
still carries the old environment. The launcher refuses an inherited effort
without an explicit matching `--effort`, and refuses mismatches before Claude
starts. To request an effort deterministically, align both for that invocation:

```bash
CLAUDE_CODE_EFFORT_LEVEL=high \
  node "$ANDROID_COMMON_DOC/scripts/tools/claude-safe-one-shot.cjs" \
  --project-root "$(pwd)" --l0-root "$ANDROID_COMMON_DOC" \
  --claude-executable "$(command -v claude)" \
  --prompt-file /absolute/path/to/recovery-prompt.txt \
  --tools "Read,Glob,Grep" --effort high
```

Do not persist contradictory values in `effortLevel` and
`env.CLAUDE_CODE_EFFORT_LEVEL`. Restart a long-lived parent after removing a
global environment override, or override it explicitly as above.

Output uses `stream-json --include-partial-messages --verbose`. The launcher requires a valid `system/init` within
60 seconds, assistant/partial/result activity within another 120 seconds, and completion within 15 minutes. A zero
exit is insufficient: exactly one successful terminal `result` must report usage, total cost, and
`subagent_stats.spawned: 0`. Budget errors and any other error result fail even when Claude exits zero. Optional
`--max-budget-usd <amount>` is a bounded decimal. Startup silence, init-then-silence, spawn failure, or total timeout
terminates only the child and returns non-zero. Every run prints `CLAUDE_ONE_SHOT_EVIDENCE=<path>` and retains
`run-state.json`, `stdout.jsonl`, and `stderr.log`. After `SIGTERM`, the wrapper waits briefly for a terminal receipt;
otherwise it preserves the last usage but records `terminal_receipt_observed:false` and `accounting_complete:false`.
It never invents missing cost or usage. Name exact paths, inspect any resulting diff, and never treat this as the
persistent collaboration runtime.

Claude 2.1.x may still enumerate global plugin/skill/agent metadata in
`system/init` while safe mode is active. Metadata in `agents` is not itself
operational authority; the enforced boundary is the exact `tools` projection and
the terminal zero-subagent receipt.

Mode distinctions:

- `--safe-mode`: normal authentication; customizations disabled.
- `--restricted`: the host confines native file tools to the working roots,
  ignores user/project settings, and refuses bypass permissions. It does not by
  itself prove confinement of arbitrary paths reached through Bash. The supervised
  recovery launcher uses it in addition to safe mode.
- `--bare`: also disables OAuth/keychain and therefore needs `ANTHROPIC_API_KEY` or
  an explicit `apiKeyHelper`. It is not the normal recovery mode.
- `-p` / `--print`: one non-interactive turn. With `--no-session-persistence` it
  is suitable for diagnostics/certification, not a retained monitor or work session.
- `--permission-mode acceptEdits`: selects the initial permission mode; it is not
  a promise that the whole session will remain prompt-free. Write/Edit operations
  covered by that mode may be accepted while Bash or another operation outside
  its approval surface can still require explicit approval. After leaving Plan
  mode, verify the selected permission choice instead of assuming the initial mode
  persisted. Do not weaken hooks or enable a global bypass to suppress a legitimate
  host prompt.
- A prompt saying “run this first” cannot prevent host startup from loading memory.
  Use `--safe-mode` when startup ordering is the problem.

## Claude 2.1.x compatibility

The runtime supports the Claude Code `2.1.x` protocol family as one compatibility
contract. Updating between `2.1` patches does not require editing,
deleting, regenerating, or committing a certificate; restart and launch normally.
The runtime binds host-owned version/model evidence to the live session and worktree
and requires the running executable to carry Anthropic's valid platform signature
(Developer ID on macOS or Authenticode on Windows). An executable SHA-256 may be
retained as diagnostic evidence, but it is not a per-patch compatibility gate.

`SessionStart.model` is optional in Claude Code 2.1.x. When omitted, PreToolUse
returns a signed pending composition bound to the exact session, tool, input and
transcript. The launcher finalizes only from the matching host-owned `tool_use`;
absent, duplicate, mismatched or unsupported model evidence fails closed.

Versions outside `2.1.x`, including `2.2.x` and `3.x`, fail closed until the host
adapter is reviewed. The genuine host-contract workflow qualifies that new
adapter family, not each developer machine or patch release.

To qualify a future protocol family on a reviewed L0 branch, run:

```bash
cd "$ANDROID_COMMON_DOC"
node scripts/tools/recertify-claude-host-contract.cjs \
  --project-root "$ANDROID_COMMON_DOC" \
  --claude-executable "$(command -v claude)"
```

The tool captures `claude --version`, runs the genuine no-persistence
host-contract probe with a 60-second init deadline, a 120-second deadline for the
first assistant/result activity after init, and bounded continuation deadlines, derives
`qualification.json` only from completed evidence, atomically replaces a previously
verified same-platform package, and verifies the new package after publication.
Malformed or foreign existing packages are never overwritten. The probe evidence
path is retained in the JSON result for audit. Commit the updated platform package
through normal review.

### Promote an already completed family-qualification probe

Use promotion only when a genuine pinned probe has already completed and its
evidence directory was retained, for example after inspecting or transferring a
certification run. Promotion does not launch Claude or recertify the executable:

```bash
cd "$ANDROID_COMMON_DOC"
node scripts/tools/promote-claude-host-contract.cjs \
  --project-root "$ANDROID_COMMON_DOC" \
  --evidence-root /absolute/path/to/completed-probe-evidence
```

The evidence root must contain the completed `run-state.json`, matching
`run-record.json`, `claude-stream.jsonl`, and `observer/events.jsonl`. The currently
installed executable must still match the recorded realpath and digest. The command
derives `qualification.json`, independently validates the raw observations, publishes
the signed same-platform package atomically, and post-verifies it. Use
`--observer-path /absolute/path/to/claude-host-contract-probe.cjs` only when the
probe used a reviewed observer outside the toolkit's canonical fixture path.

Use `recertify-claude-host-contract.cjs` only for a new protocol family: it captures, probes, qualifies, publishes,
and verifies. `promote-claude-host-contract.cjs` only finishes that reviewed publication from retained evidence;
it is neither a normal `2.1.x` update step nor a shortcut around the live probe.

Effective effort is not inferred from `--effort`, latency, token use, or legacy `system/init.per_turn_effort_active`.
`effective` remains null unless native `PreToolUse.effort.level` equals the request; absent or mismatched evidence fails
closed. Certification rejects conflicting inherited `CLAUDE_CODE_EFFORT_LEVEL`
and aligns the child environment with canonical `--effort high`, preventing a
hidden global `max` from masquerading as the requested profile.
