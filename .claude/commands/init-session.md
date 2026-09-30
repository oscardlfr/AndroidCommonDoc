---
description: Show canonical runtime readiness and optionally ensure the support plane.
---

Initialize session context through the qualified runtime adapter.

The command adapter owns bootstrap. Do not locate or read another skill file,
and do not run any discovery command before the launcher.

If `Arguments` is empty, your first action MUST be exactly this standalone Bash
call:

```bash
node .claude/runtime/l0-entrypoint-launcher.cjs init-session
```

If `Arguments` is exactly `--orchestrate <slug>`, your first action MUST be
exactly this standalone Bash call with the supplied slug:

```bash
node .claude/runtime/l0-entrypoint-launcher.cjs init-session --orchestrate <slug>
```

The slug must name an existing `.planning/wave-<slug>/PLAN.md`. The launcher
may initialize that wave's control-plane state, but it never creates or infers
a PLAN. Do not invent a diagnostic or one-off slug.

Do not run `ls`, `find`, `pwd`, Read, Glob, Grep, `git status`, Python, or any
other discovery/rendering step before or after a failed launcher call. The
PreToolUse hook rewrites the public shorthand into the qualified runtime
entrypoint. Report `BLOCKED`, `UNAVAILABLE`, `FAILED`, a non-zero exit, or an
approval request exactly as returned and stop. For `ACTION_REQUIRED`, execute
only the actions returned by the runtime adapter. Treat only `READY` as ready;
never construct a replacement dashboard or support plane manually.

Arguments: $ARGUMENTS
