<!-- L0 Generic Command -->
<!-- Usage: /merge-track <branch-or-track-id> -->
<!-- Note: Projects should customize track mappings for their specific workflow -->
# /merge-track - Squash-Merge a Completed Track into Main Branch

Lead-only workflow to merge a completed parallel track branch back into the main branch.

## Usage
```
/merge-track <branch-name-or-track-id>
```

## Arguments
- `<branch-name-or-track-id>` - Branch name or track identifier to merge

## Instructions

**This is a lead-only operation. Only the project lead should run this.**

### Step 1 -- Resolve Branch

Map the input to a feature branch. If the project uses track letters (A, B, C...), look up the mapping in project docs or CLAUDE.md.

### Step 2 -- Pre-merge Checklist

Verify all of these (report each as pass/fail):
1. **Branch exists**: `git branch --list {branch}`
2. **Phase plans complete**: Check `.gsd/phases/` for completion
3. **Tests pass**: Suggest running validation if not done
4. **No uncommitted changes**: `git status --porcelain`
5. **Commits to merge**: `git log main..{branch} --oneline`

If any check fails, report and stop.

### Step 3 -- Show Merge Preview

Display branch name, commit count, and commit log. Ask for confirmation.

### Step 4 -- Execute Merge

```bash
git checkout main
git merge --squash {branch}
git commit -m "feat({scope}): {description} (squash merge)"
```

### Step 5 -- Cleanup

Remove worktree (if used) and delete the feature branch with `-d`.

### Step 6 -- Post-merge

Suggest running tests and updating STATE.md.

### Important Rules

1. **Lead-only** -- not for track agents
2. **Always squash merge** -- one clean commit per track
3. **Never force-delete branches** -- use `-d` not `-D`
4. **Verify before merge**
5. **Ask before every destructive action**
