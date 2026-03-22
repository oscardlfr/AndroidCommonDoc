---
scope: [guides, workflows, ci, automation, multi-agent]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: autonomous-workflow
status: active
layer: L0
category: guides
description: "Autonomous AI agent workflow: Git Flow, auto-merge PRs, CI validation, multi-agent branch patterns"
version: 1
last_updated: "2026-03"
---

# Autonomous Agent Workflow

How AI agents work autonomously on L0 using Git Flow, CI validation, and auto-merge.

## Branch Model

```
master   ← production, protected, triggers dispatch to L1/L2
develop  ← integration, protected, default branch
feature/* → PR → develop (auto-merge when CI passes)
release/* → PR → master (manual merge)
hotfix/*  → PR → master + develop
```

Both `master` and `develop` are protected:
- Require PR (no direct push)
- Required CI checks: README Audit, Agent Parity, MCP Server Tests
- `develop`: `strict: false` (auto-merge works without rebase)
- `master`: `strict: true` (branch must be up to date before merge)

## Agent Workflow (single agent)

An AI agent working on L0 follows this pattern:

```bash
# 1. Create feature branch from develop
git checkout develop && git pull
git checkout -b feature/my-change

# 2. Make changes, commit
git add -A && git commit -m "feat(skills): add dependency analysis skill"

# 3. Push + create PR + set auto-merge
git push -u origin feature/my-change
gh pr create --base develop --title "feat(skills): ..." --body "..."
gh pr merge --auto --squash

# 4. Continue working — GitHub merges when CI passes
# No waiting, no polling. Move to next task.
```

The agent doesn't wait for CI. `--auto` tells GitHub to merge as soon as all checks pass. If CI fails, the PR stays open and the agent can fix it later.

## Multi-Agent Workflow (parallel branches)

Multiple agents can work simultaneously on independent feature branches:

```
Agent A: feature/new-skill       → PR #3 → develop (auto-merge)
Agent B: feature/fix-coverage    → PR #4 → develop (auto-merge)
Agent C: feature/update-docs     → PR #5 → develop (auto-merge)
```

**No conflicts if branches touch different files.** GitHub merges each PR independently as its CI passes. `strict: false` on develop means Agent B's PR doesn't need to rebase after Agent A's merges.

**If branches conflict:** the second PR to merge will show a conflict. The agent rebases and force-pushes:

```bash
git fetch origin develop
git rebase origin/develop
# resolve conflicts
git push --force-with-lease
# CI re-runs, auto-merge activates again
```

## CI Checks (what must pass)

| Check | What it verifies | Time |
|-------|-----------------|------|
| Commit Lint | Conventional Commits format | ~5s |
| README Audit | Counts match filesystem reality | ~30s |
| Agent Parity | `.claude/agents/` ↔ GSD subagents in sync | ~10s |
| Shell Tests (bats) | All SH scripts pass | ~40s |
| MCP Server (ubuntu) | vitest unit + integration | ~30s |
| MCP Server (windows) | vitest cross-platform | ~90s |
| Detekt Rules | JUnit tests for all 17 rules | ~35s |
| Skill Registry | SHA-256 hashes current | ~15s |

Total: ~2 min. Most PRs merge within 3 minutes of push.

## Release Flow (develop → master)

When develop is stable and ready for release:

```bash
# Create release PR
gh pr create --base master --head develop \
  --title "release: v1.x.x" \
  --body "Release notes..."

# This one is manual merge (master has strict: true)
# CI must pass, branch must be up to date
gh pr merge --squash --admin  # or wait for review
```

Push to master triggers:
1. **L0 CI** — full validation
2. **Dispatch to L1/L2** — auto-sync PRs in downstream repos
3. **Release assets** — tarball published (if tagged)

## Auto-Merge Configuration

### Repository settings

```bash
# Enable auto-merge feature
gh repo edit <owner>/<repo> --enable-auto-merge
```

### Branch protection

```bash
# develop: relaxed strict (allows auto-merge without rebase)
gh api --method PUT "repos/<owner>/<repo>/branches/develop/protection" --input - << 'EOF'
{
  "required_status_checks": { "strict": false, "contexts": ["README Audit", "Agent Parity", "MCP Server Tests"] },
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "enforce_admins": false,
  "restrictions": null,
  "allow_force_pushes": false
}
EOF

# master: strict (branch must be up to date)
gh api --method PUT "repos/<owner>/<repo>/branches/master/protection" --input - << 'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["README Audit", "Agent Parity", "MCP Server Tests"] },
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "enforce_admins": false,
  "restrictions": null,
  "allow_force_pushes": false
}
EOF
```

### Why strict: false on develop?

With `strict: true`, every PR must be rebased against the latest develop before merging. This means:

- Agent A's PR merges → develop changes
- Agent B's PR is now "out of date" → blocked
- Agent B must rebase → re-push → re-run CI → then merge

With `strict: false`, Agent B's PR merges as-is (if no conflicts). CI ran on B's branch and passed — that's sufficient for develop. Master keeps `strict: true` as the final gate.

## Downstream Propagation

After changes land on master:

```
master push
  → l0-sync-dispatch.yml
  → repository_dispatch to L1
  → L1 l0-auto-sync.yml: clone L0, sync, open PR
  → (if chain) L1 cascades to L2
```

This is fully automatic. The agent doesn't need to notify downstream — the dispatch workflow handles it.

## Quick Reference

```bash
# Full autonomous cycle:
git checkout -b feature/x && git push -u origin feature/x
# ... make changes, commit ...
gh pr create --base develop --title "type(scope): description"
gh pr merge --auto --squash
# Done. GitHub handles the rest.

# Check PR status later:
gh pr checks <number>
gh pr view <number> --json state -q '.state'

# If CI fails:
gh pr checks <number>         # see which check failed
# fix, commit, push — CI re-runs, auto-merge re-activates

# Release to master:
gh pr create --base master --head develop --title "release: v1.x.x"
gh pr merge --squash --admin
```

## Cross-references

- Branch protection setup: this guide (Auto-Merge Configuration section)
- CI workflow: `.github/workflows/l0-ci.yml`
- Auto-sync: [layer-topology.md](../architecture/layer-topology.md#auto-sync)
- Git Flow skill: `skills/git-flow/SKILL.md`
- Contributing guide: `CONTRIBUTING.md`
