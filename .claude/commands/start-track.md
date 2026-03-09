<!-- L0 Generic Command -->
<!-- Usage: /start-track <track-id> -->
<!-- Note: Projects should customize track-to-branch mappings -->
# /start-track - Set Up Worktree for a Parallel Track

Create a git worktree and feature branch for a specific parallel development track.

## Usage
```
/start-track <track-id>
```

## Arguments
- `<track-id>` - Track identifier (letter or name). Project-specific mapping.

## Instructions

### Step 1 -- Validate Input

Parse the track identifier. If invalid, show available tracks and ask which one.

### Step 2 -- Resolve Track Details

Map the identifier to phase, slug, and branch name. Projects should define this mapping in CLAUDE.md or a configuration file.

### Step 3 -- Pre-flight Checks

1. Verify we're in the project root
2. Check if worktree already exists: `git worktree list`
3. Check if branch already exists: `git branch --list`

If worktree exists, ask if user wants to re-enter it.

### Step 4 -- Create Worktree + Branch

```bash
mkdir -p .claude/worktrees
git worktree add .claude/worktrees/track-{id} -b {branch} main
```

If branch exists, attach worktree to existing branch instead.

### Step 5 -- Verify

```bash
git worktree list
git -C .claude/worktrees/track-{id} branch --show-current
```

### Step 6 -- Print Orientation

Output: worktree path, branch, phase, module scope, ownership rules.

### Important Rules

1. **Never force-create** -- ask first if worktree/branch exists
2. **Always branch from main** -- not develop or other feature branches
3. **.claude/worktrees/ is gitignored** -- worktrees don't pollute the main tree
4. **One track per worktree**
