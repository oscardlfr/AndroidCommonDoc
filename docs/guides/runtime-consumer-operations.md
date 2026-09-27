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
last_updated: "2026-09-26"
description: "Exact installation, launch, recovery, worktree, and Claude host recertification procedure for L1/L2 consumers."
---

# Runtime consumer operations

## Install or refresh a consumer

Build the toolkit first, then run ordinary sync and the source-referenced runtime install:

```bash
cd "$ANDROID_COMMON_DOC/mcp-server"
npm ci && npm run build
node build/sync/sync-l0-cli.js --project-root /absolute/path/to/consumer
node build/sync/sync-l0-cli.js --project-root /absolute/path/to/consumer --runtime
```

`--runtime` installs the consumer-owned wave topology and records a digest of the
toolkit runtime closure. Hooks that import L0 modules are not copied partially;
their `settings.json` registrations point to the absolute, pinned toolkit checkout.
Standalone hooks remain copyable. Re-run both commands after changing toolkit
revisions. A managed topology from an older sync is updated automatically only
when its current bytes still match the checksum recorded by that sync. Local
topology drift or a customized role remains a conflict and is never overwritten.

The shell hook installer also verifies executable mode. An identical Detekt hook
that lost its executable bit is repaired without `--force`; differing bytes fail
and require review.

## Launch Claude from a consumer

The toolkit is a sibling of the consumer, so every normal Claude session must add
it to the host's readable roots:

```bash
cd /absolute/path/to/consumer
claude --add-dir "$ANDROID_COMMON_DOC"
```

PowerShell:

```powershell
Set-Location C:\absolute\path\to\consumer
claude --add-dir $env:ANDROID_COMMON_DOC
```

`--add-dir` grants host filesystem reachability. It does not replace
`l0-manifest.json`, runtime digests, certificate pins, or the Git hooks. Linked Git
worktrees may retain the manifest path authored relative to the main checkout; the
resolver uses Git's common directory rather than an ambient fallback.

Run Gradle serially within one worktree. Concurrent Gradle invocations that share
the same checkout/build directories can produce transient unresolved-reference
cascades that disappear on an isolated rerun. If parallel validation is required,
use distinct worktrees and isolated Gradle/build directories. Before selecting a
platform compilation target, enumerate the checkout's actual tasks (for example,
`./gradlew tasks --all`); do not infer `macosX64` from the presence of
`macosArm64` or from a different consumer's target matrix.

Authenticated entrypoint commands use the renderer's canonical POSIX form: every
token is single-quoted. Do not rewrite those commands with POSIX double quotes;
the boundary intentionally sends non-canonical forms through ordinary approval.

## Recovery when startup customizations interfere

`--safe-mode` keeps normal OAuth/keychain authentication but disables project/user
customizations such as CLAUDE.md, auto-memory, hooks, plugins, MCP, and agents.
Use it to inspect or repair the consumer, then exit and relaunch normally:

```bash
cd /absolute/path/to/consumer
claude --safe-mode --add-dir "$ANDROID_COMMON_DOC"
```

For a single non-persistent diagnostic or tightly reviewed repair:

```bash
claude --safe-mode -p --no-session-persistence \
  --add-dir "$ANDROID_COMMON_DOC" \
  --dangerously-skip-permissions --permission-prompts none \
  --tools 'Read,Edit,Write,Bash' \
  'Inspect only the named files, make the stated repair, run the stated check, and stop.'
```

`--dangerously-skip-permissions` is required only when the one-shot repair must run
tools without an approval surface; it removes an important safety barrier. Restrict
the tools and prompt, name exact paths, inspect the resulting diff, and never treat
this as the persistent collaboration runtime. Claude 2.1.283 may still enumerate
global plugin/skill/agent metadata in `system/init` while safe mode is active; that
metadata is not operational authority.

Mode distinctions:

- `--safe-mode`: normal authentication; customizations disabled.
- `--bare`: also disables OAuth/keychain and therefore needs `ANTHROPIC_API_KEY` or
  an explicit `apiKeyHelper`. It is not the normal recovery mode.
- `-p` / `--print`: one non-interactive turn. With `--no-session-persistence` it
  is suitable for diagnostics/certification, not a retained monitor or work session.
- A prompt saying “run this first” cannot prevent host startup from loading memory.
  Use `--safe-mode` when startup ordering is the problem.

## Claude minor/patch updates and recertification

The runtime does not trust a semantic-version range in place of evidence. It pins
the exact executable digest, observer digest, platform, transport, and observed
host contract. A new Claude minor/patch therefore needs recertification, but never
manual certificate editing or deletion.

For a normal Claude update, run the end-to-end recertification workflow from the
toolkit checkout:

```bash
cd "$ANDROID_COMMON_DOC"
node scripts/tools/recertify-claude-host-contract.cjs \
  --project-root "$ANDROID_COMMON_DOC" \
  --claude-executable "$(command -v claude)"
```

The tool captures and pins `claude --version`, runs the genuine no-persistence
host-contract probe with a 60-second init deadline, a 120-second deadline for the
first assistant/result activity after init, and bounded continuation deadlines, derives
`qualification.json` only from completed evidence, atomically replaces a previously
verified same-platform package, and verifies the new package after publication.
Malformed or foreign existing packages are never overwritten. The probe evidence
path is retained in the JSON result for audit. Commit the updated platform package
through normal review.

### Promote an already completed probe

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

Prefer `recertify-claude-host-contract.cjs` for every new Claude binary: it performs
capture, live probe, qualification, publication, and verification as one workflow.
Use `promote-claude-host-contract.cjs` only to finish publication from retained,
unchanged evidence; it is not a shortcut around the live probe.

Effective effort is not inferred from `--effort`, latency, or token use. The run
record keeps `requested`, `observed`, and `effective` separate; `effective` remains
null unless host telemetry proves it. `per_turn_effort_active:false` is recorded
as an incompatibility signal and fails effort-controlled entrypoint certification;
the base host-contract probe may still certify unrelated transport capabilities.
