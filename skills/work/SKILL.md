---
name: work
description: "Smart task routing through the canonical runtime collaboration entrypoint."
copilot: false
intent: [route, delegate, orchestrate, debug, research, verify, audit, implement, review]
---

# Work Skill

Route one validated task through the shared runtime collaboration owner. This skill does not select a provider API or create a second lifecycle path.

## Usage

```
/work <task description>
```

## Canonical Runtime Entrypoint

1. Resolve one role supported by the production work router. Repository task execution uses `toolkit-specialist`; support-plane consultations use one of the five persistent support roles.
2. For a read-only repository task, use the core-authored empty-scope manifest bytes `{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}` and their exact reference `subject:090b9779a46f94e328cb61bf5e78d5a64a15337a6e9279090837647a87f2ff7a`. The runtime core materializes this manifest; do not search for or hand-write a bundle file.
3. Encode a canonical JSON object with exactly `role`, `subject_ref`, and `task`. The `task` value is the complete, non-empty text supplied after `/work`, preserved verbatim; never replace it with an example or a fixed sentence.
4. Invoke:

```bash
node scripts/lib/runtime-collaboration-entrypoints.cjs execute --entrypoint work --project-root <absolute> --intent <base64url canonical JSON>
```

The Bash call must be one standalone direct Node command. Replace `<absolute>` with the literal absolute project path before invoking it. Never use `$(pwd)`, `$PWD`, `cd`, shell variables, command substitution, pipes, redirects, or command separators in this authenticated entrypoint call.

The decoded intent must contain `role:"toolkit-specialist"`, the exact fixed `subject_ref` above, and `task` byte-for-byte equal to the current `/work` task description. A repeated task resumes its existing transaction; a genuinely different task creates a distinct intent and must not reuse a prior terminal action.

## Status Handling

- `ACTION_REQUIRED`: execute only the returned canonical action references through the runtime adapter, then resume the same operation.
- `COMPLETED`: accept only when the result carries correlated canonical result, accepted-result, and acknowledgement references plus their exact SHA-256 digests.
- `READY`: the requested runtime state is proven; do not reinterpret it as task completion.
- `BLOCKED`, `UNAVAILABLE`, or `FAILED`: report the exact status and detail; never fall back silently or infer success from message text.

## Deterministic Role Routing

Use first-match routing without changing authority:

| Signal | Canonical role or skill |
|---|---|
| bug, error, fix, broken, crash | `debugger` via `/debug` |
| repository test execution requested through `/work` | `toolkit-specialist` |
| review, pull request | `/review-pr` |
| research, investigate, explore | `/research` |
| decide, choose, compare | `/decide` |
| verify, check spec explicitly requested through `/work` | `toolkit-specialist` |
| map, architecture, modules | `/map-codebase` |
| pre-pr, validate | `/pre-pr` |
| UI, Compose, screen | `ui-specialist` |
| docs, documentation | `doc-updater` |
| context, pattern, lookup | `context-provider` |
| domain, model | `domain-model-specialist` |
| data layer, repository | `data-layer-specialist` |
| repository implementation, feature, build | `toolkit-specialist` |

Named skill overrides still take precedence when the user explicitly names a registered skill. Multi-domain work is represented as separate validated work intents while preserving the same shared entrypoint and evidence rules.

Business classifiers remain opt-in discovery hints: roadmap/prioritization may name `product-strategist`, marketing/content may name `content-creator`, and landing/conversion work may name `landing-page-strategist`. Verify the named agent exists and has an accredited runtime route; otherwise fall through to the canonical repository route. These hints never authorize a direct native spawn or bypass this entrypoint.

For multi-domain implementation, the main conversation acts as `team-lead` and submits the required validated intents in dependency order. `team-lead` is an orchestration responsibility here, not a persistent role, alternate provider API, or authority inferred from prose.

### Level 2 — Frontmatter Discovery

When no deterministic row matches, frontmatter discovery may identify a registered intent-compatible agent, but availability and authority must still be proven by the shared runtime entrypoint before execution.

## Invariants

- The persistent support plane is exactly `arch-platform`, `arch-testing`, `arch-integration`, `context-provider`, and `doc-updater`; `quality-gater` remains phase-scoped.
- Lifecycle reuse, recovery, action execution, and completion evidence are owned by the shared runtime modules.
- No direct host-native dispatch exists in this skill.
- No message or action-success text is completion evidence.
- Do not invent phases, authority identifiers, provider branches, or alternate schemas.
