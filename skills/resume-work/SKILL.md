---
name: resume-work
description: "Resume session with a CEO/CTO dashboard — shows status by department from last session."
copilot: false
---

# Resume Work Skill

Resume session with a CEO/CTO dashboard — shows status by department from last session.

## Usage

```
/resume-work
```

## Steps

1. **Read memory**: Load project Memory files (`.claude/projects/*/memory/`) to extract recent decisions, pending items, and project state.
2. **Read recent git activity**: Run `git log --oneline -10` to see what happened recently.
3. **Read module map**: Load `MODULE_MAP.md` if it exists for module context.
4. **Check business docs**: Scan `docs/business/` for business documentation files.
5. **Present dashboard by department**:

```
## Session Resume: {project_name}

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

6. **Wait for instructions**: After presenting the dashboard, wait for the user to give direction. If the user provides a task, route it using `/work` logic (Level 1 keyword match, then Level 2 frontmatter discovery).

## Notes

- This skill is primarily read-only — it gathers context and presents it
- The dashboard sections adapt to what exists: skip Marketing if no business docs, skip Product if no spec
- Memory files are the primary source for "pending" items and decisions
- Git log provides the "last activity" context
- Branch status (clean/dirty) comes from `git status --porcelain`
- After the dashboard, the skill transitions into `/work` routing mode for the user's next task
