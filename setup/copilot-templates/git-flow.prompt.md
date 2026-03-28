<!-- GENERATED from skills/git-flow/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Git Flow branch management — start feature/release/hotfix branches, merge tracks, and manage releases. Generic implementation of the Git Flow model (feature/* → develop, release/* → master). Use when setting up branches, merging completed work, or creating releases."
---

Git Flow branch management — start feature/release/hotfix branches, merge tracks, and manage releases. Generic implementation of the Git Flow model (feature/* → develop, release/* → master). Use when setting up branches, merging completed work, or creating releases.

## Instructions

## Usage Examples

```
/git-flow start feature/my-feature
/git-flow start feature/my-feature --from develop
/git-flow merge feature/my-feature
/git-flow release v1.2.0
/git-flow hotfix fix-critical-bug
/git-flow status
```

## Parameters

- `start <branch>` -- Create branch + worktree. Auto-detects type from prefix.
- `merge <branch>` -- Squash-merge feature into develop after pre-PR checks.
- `release <version>` -- Create release branch, merge to master, tag, back-merge.
- `hotfix <name>` -- Create hotfix from master, merge to master + develop.
- `status` -- Show current branch topology and pending merges.
- `--from <base>` -- Override base branch for `start` (default: `develop` for features, `master` for hotfix).
- `--no-worktree` -- Create branch without a git worktree (default: worktree created).
- `--dry-run` -- Preview what would happen without executing.

## Git Flow Model

```
master   ← production, protected, tagged releases only
develop  ← integration, all feature PRs target here
  └── feature/*  ← branch from develop, PR → develop
  └── release/*  ← branch from develop, PR → master + back-merge to develop
hotfix/* ← branch from master, PR → master + back-merge to develop
```

---

## Command: start

### Step 1 — Parse branch name and type

Detect type from prefix:
- `feature/*` → base: `develop`
- `hotfix/*`  → base: `master`
- `release/*` → base: `develop`
- Other       → base: `develop` (warn that non-standard prefix detected)

Override with `--from <base>` if provided.

### Step 2 — Pre-flight

```bash
# Verify we're in a git repo
git rev-parse --git-dir

# Verify base branch exists
git rev-parse --verify {base}

# Check for existing branch/worktree
git branch --list {branch}
git worktree list | grep {branch-slug}
```

If branch already exists, offer:
- Add worktree to existing branch (if no worktree yet)
- Or abort with guidance

### Step 3 — Create branch + worktree

```bash
# Default worktree path: .git-worktrees/{branch-slug}
WORKTREE_PATH=".git-worktrees/$(echo {branch} | tr '/' '-')"

mkdir -p .git-worktrees

# New branch from base
git worktree add "$WORKTREE_PATH" -b {branch} {base}
```

With `--no-worktree`:
```bash
git checkout -b {branch} {base}
```

### Step 4 — Print orientation

```
Branch ready!

  Branch:   {branch}
  Base:     {base}
  Worktree: {worktree-path}   (or "none" if --no-worktree)

  Git Flow:
    PR target:  {pr-target}
    Run /pre-pr before opening PR
    {if hotfix: "Back-merge to develop after merging to master"}

  Next: work in {worktree-path}, then /pre-pr, then open PR
```

---

## Command: merge

Squash-merge a feature branch into develop. **Lead / integrator use only.**

### Step 1 — Validate

1. Branch exists: `git branch --list {branch}`
2. Worktree clean: `git -C {worktree} status --porcelain` (if worktree exists)
3. Not already merged: `git log develop..{branch} --oneline | wc -l` > 0

### Step 2 — Run pre-PR checks

```
Read skills/pre-pr/SKILL.md
```
Run in the worktree directory. Abort if any check fails.

### Step 3 — Preview and confirm

```
Merge Preview

  Branch: {branch} → develop
  Commits ({count}):
  {git log develop..{branch} --oneline}
```

Ask: "Squash-merge {branch} into develop?"

### Step 4 — Execute

```bash
git checkout develop
git merge --squash {branch}
git commit -m "feat({scope}): {description}

Squash merge of {branch}.
All /pre-pr checks passed before merge."
```

### Step 5 — Cleanup

```bash
git worktree remove {worktree-path} --force  # if worktree exists
git branch -d {branch}
```

---

## Command: release

Create and ship a release. Generates a release branch, merges to master, tags, and back-merges.

### Steps

1. Confirm develop is clean and CI green
2. Create release branch from develop:
   ```bash
   git checkout -b release/{version} develop
   ```
3. Bump version in project files (ask user which files to update)
4. Commit: `git commit -m "chore(release): bump version to {version}"`
5. Merge to master:
   ```bash
   git checkout master
   git merge --no-ff release/{version} -m "chore(release): {version}"
   git tag -a "v{version}" -m "Release v{version}"
   git push origin master --tags
   ```
6. Back-merge to develop:
   ```bash
   git checkout develop
   git merge --no-ff master -m "chore: back-merge v{version} into develop"
   ```
7. Delete release branch: `git branch -d release/{version}`

---

## Command: hotfix

Emergency fix from master. **Use only for production-critical issues.**

### Steps

1. Branch from master:
   ```bash
   git checkout -b hotfix/{name} master
   ```
2. Fix the issue and commit: `git commit -m "fix({scope}): {description}"`
3. Run `/pre-pr` — hotfixes must also pass all checks
4. Merge to master:
   ```bash
   git checkout master
   git merge --no-ff hotfix/{name} -m "fix({scope}): {description} (hotfix)"
   git tag -a "v{patch-bump}" -m "Hotfix v{patch-bump}"
   ```
5. Back-merge to develop:
   ```bash
   git checkout develop
   git merge --no-ff hotfix/{name} -m "fix({scope}): back-merge hotfix/{name} into develop"
   ```
6. Delete: `git branch -d hotfix/{name}`

---

## Command: status

Show branch topology:
```bash
echo "=== Git Flow Status ==="
git log --oneline --graph --decorate master develop $(git branch | grep -E 'feature/|hotfix/|release/' | tr -d ' ') | head -20
echo ""
echo "Feature branches ahead of develop:"
git branch | grep 'feature/' | while read -r b; do
  COUNT=$(git log develop.."$b" --oneline 2>/dev/null | wc -l)
  echo "  $b ($COUNT commits ahead)"
done
```

---

## Important Rules

1. **Never force-push** to `develop` or `master`
2. **Always squash feature merges** — one clean commit per feature into develop
3. **No-ff for release/hotfix merges** — preserve topology on master
4. **Tag every master commit** — `v{major}.{minor}.{patch}`
5. **Always back-merge hotfixes** — develop must never diverge from master
6. **Run `/pre-pr` before any merge** — CI is not a substitute
7. **Use `-d` not `-D`** — force-delete only if you're certain the branch is fully merged

## Cross-References

- Skill: `/pre-pr` — pre-merge validation suite
- Skill: `/commit-lint` — commit message validation
- Workflow: `setup/github-workflows/ci-template.yml`
- Template: `setup/github-workflows/pull_request_template.md`
