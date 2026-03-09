<!-- L0 Generic Command -->
<!-- Usage: /git-flow <command> [args] -->
# /git-flow - Git Flow Branch Management

Generic Git Flow operations: start branches, merge features, create releases, apply hotfixes.

## Usage
```
/git-flow start feature/my-feature
/git-flow start feature/my-feature --from develop
/git-flow merge feature/my-feature
/git-flow release v1.2.0
/git-flow hotfix fix-critical-bug
/git-flow status
```

## Arguments
- `start <branch>` - Create branch + worktree from appropriate base.
- `merge <branch>` - Squash-merge feature into develop (runs /pre-pr first).
- `release <version>` - Create release branch, merge to master, tag, back-merge to develop.
- `hotfix <name>` - Create hotfix from master, merge to master + develop.
- `status` - Show branch topology and pending merges.
- `--from <base>` - Override base branch for start.
- `--no-worktree` - Create branch without worktree.
- `--dry-run` - Preview without executing.

## Instructions

Load and follow `skills/git-flow/SKILL.md`.
