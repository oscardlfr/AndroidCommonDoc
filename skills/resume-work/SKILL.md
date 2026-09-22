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
"<resolved-node>" "<toolkit-root>/scripts/lib/runtime-collaboration-entrypoints.cjs" execute --entrypoint resume-work --project-root <consumer-root> --intent <base64url canonical JSON>
```

The Bash call must be one standalone direct Node command. For L0, both roots are the current repository. For a runtime consumer, derive `toolkit-root` only from the single local `layer=L0, role=tooling` manifest source and keep `consumer-root` as the literal absolute application repository. Use the resolved Node executable; do not use environment fallbacks, command substitution, wrappers, pipes, redirects, or command separators.

The decoded intent is exactly `{"checkpoint_ref":"checkpoint:<sha256>"}` when no wave is active, or canonical `{"checkpoint_ref":"checkpoint:<sha256>","wave_slug":"<slug>"}` for an active wave. The entrypoint validates the persisted control-plane state and derives only its class-aware lifecycle roles. Reuse `READY` bindings, execute only returned `ACTION_REQUIRED` actions, and surface `BLOCKED|UNAVAILABLE|FAILED` without treating historical memory as live authority.

## Steps

1. **Discover the active wave and runtime presence**: Resolve the active wave slug and include it in the canonical runtime intent. The shared entrypoint rejects missing, stale, illegal or PLAN/HEAD-drifted phase state, then probes/reuses/rehydrates only the class-aware roles returned by the control plane through the existing Wave-1 lifecycle manager. Reading historical Claude memory alone is never treated as runtime resume.
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

- Phase and role selection use the shared wave control plane; runtime presence uses the existing role-lifecycle manager. Neither path embeds vendor-specific dispatch or messaging knowledge.
- Memory files inform "pending" items and decisions, but are never treated as proof of a live runtime binding — only a `probe` result confirms that
- This skill is primarily read-only — it gathers context and presents it
- The dashboard sections adapt to what exists: skip Marketing if no business docs, skip Product if no spec
- Git log provides the "last activity" context
- Branch status (clean/dirty) comes from `git status --porcelain`
- After the dashboard, the skill transitions into `/work` routing mode for the user's next task
