---
name: resume-work
description: "Resume session with a CEO/CTO dashboard — shows status by department from last session."
intent: [resume, session, dashboard, status, department]
copilot: false
---

# Resume Work Skill

Resume session with a CEO/CTO dashboard — shows status by department from last session.

## Usage

```
/resume-work
```

## Canonical Runtime Entrypoint

Resume through the shared product flow using the validated checkpoint reference:

```bash
node scripts/lib/runtime-collaboration-entrypoints.cjs execute --entrypoint resume-work --project-root <absolute> --intent <base64url canonical JSON>
```

The Bash call must be one standalone direct Node command. Replace `<absolute>` with the literal absolute project path before invoking it. Never use `$(pwd)`, `$PWD`, `cd`, shell variables, command substitution, pipes, redirects, or command separators in this authenticated entrypoint call.

The decoded intent is exactly `{"checkpoint_ref":"checkpoint:<sha256>"}`. Reuse `READY` bindings, execute only returned `ACTION_REQUIRED` actions, and surface `BLOCKED|UNAVAILABLE|FAILED` without treating historical memory as live authority.

## Steps

1. **Discover the active wave and runtime presence**: Resolve the active wave slug (`CLAUDE_WAVE_SLUG` env, else the git branch's last segment, else a single `.planning/wave-*/PLAN.md` match). If a wave is active, read its `PLAN.md`, checkpoint state, and artifacts (`arch-*-verdict.md`, `quality-gate-report.json`). Then `probe` the role-lifecycle manager for current presence of the support-plane roles (`arch-platform`, `arch-testing`, `arch-integration`, `context-provider`, `doc-updater`). A healthy canonical binding is reused as-is; a dead, ambiguous, or restart-invalidated binding triggers canonical respawn/reconnect and rehydration from the validated disk context bundle (`context-bundles/<role>.md`). Reading historical Claude memory alone is never treated as runtime resume.
2. **Read memory**: Load project Memory files (`.claude/projects/*/memory/`) to extract recent decisions, pending items, and project state.
3. **Read recent git activity**: Run `git log --oneline -10` to see what happened recently.
4. **Read module map**: Load `MODULE_MAP.md` if it exists for module context.
5. **Check business docs**: Scan `docs/business/` for business documentation files.
6. **Present dashboard by department**:

```
## Session Resume: {project_name}

### Runtime Presence
  Active wave: {slug, or "none"}
  Support plane: {role: READY|WAITING|respawned|none, ...}
  Checkpoint: {PLAN phase, or "no active wave"}

### Development
  Last activity: {from git log}
  Branch: {current branch} | Status: {clean/dirty}
  Pending: {from memory notes}

### Product
  Spec: {PRODUCT_SPEC.md status if exists}
  Decisions pending: {from memory}

### Marketing
  Content: {docs/business/MARKETING.md status if exists}
  Landing: {docs/business/LANDING_PAGES.md status if exists}

### Cross-Department Queue
  {scan memory for notes prefixed with "cross-dept:"}
  - [Source -> Target] {description}
  {if none: "No pending cross-department requests."}

### Quick Actions
  /work <task>     — route to right agent
  /debug <bug>     — systematic debugging
  /pre-pr          — validate before merge
  /verify <goal>   — check spec compliance
  /work dev + marketing <task>  — parallel departments
```

7. **Wait for instructions**: After presenting the dashboard, wait for the user to give direction. If the user provides a task, route it using `/work` logic (Level 1 keyword match, then Level 2 frontmatter discovery).

## Notes

- Runtime presence discovery uses the shared role-lifecycle manager (`probe`), never a direct `Agent()`/`SendMessage()` call — reuse-or-respawn+rehydrate semantics, matching `init-session`'s `--orchestrate` path
- Memory files inform "pending" items and decisions, but are never treated as proof of a live runtime binding — only a `probe` result confirms that
- This skill is primarily read-only — it gathers context and presents it
- The dashboard sections adapt to what exists: skip Marketing if no business docs, skip Product if no spec
- Git log provides the "last activity" context
- Branch status (clean/dirty) comes from `git status --porcelain`
- After the dashboard, the skill transitions into `/work` routing mode for the user's next task
