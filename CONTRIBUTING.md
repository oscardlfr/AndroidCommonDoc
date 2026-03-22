# Contributing to AndroidCommonDoc

Thank you for your interest in contributing to AndroidCommonDoc! This toolkit powers multiple Android/KMP projects, so changes here have downstream impact.

## Getting Started

```bash
git clone git@github.com:oscardlfr/AndroidCommonDoc.git
cd AndroidCommonDoc
export ANDROID_COMMON_DOC="$(pwd)"

# Install MCP server dependencies
cd mcp-server && npm ci && npm run build && cd ..

# Verify everything works
npx bats scripts/tests/*.bats          # 539 shell tests
cd mcp-server && npx vitest run && cd ..  # 1056 vitest tests
```

## Branch Model

We use **Git Flow**:

| Branch | Purpose |
|--------|---------|
| `master` | Production — all pushes trigger auto-sync to downstream repos |
| `develop` | Integration — PRs target here |
| `feature/*` | New features → merge to develop |
| `hotfix/*` | Urgent fixes → merge to master + develop |

## Making Changes

### 1. Create a branch

```bash
git checkout develop
git pull origin develop
git checkout -b feature/my-change
```

### 2. Make your changes

Follow the conventions in [AGENTS.md](AGENTS.md):

- **UiState**: always `sealed interface`
- **CancellationException**: always rethrow
- **Result type**: use `com.example.shared.core.result.Result<T>`
- **No platform deps in ViewModels**

### 3. Run checks

```bash
# Quick validation
bash scripts/sh/rehash-registry.sh --project-root . --check  # registry hashes
npx bats scripts/tests/*.bats                                  # shell tests
cd mcp-server && npx vitest run && cd ..                       # vitest

# If you changed skills, agents, or commands:
bash scripts/sh/rehash-registry.sh --project-root .            # update hashes
```

### 4. Commit with Conventional Commits

```
feat(skills): add new skill for dependency analysis
fix(scripts): coverage detection misses build-logic plugins
docs(readme): update agent counts
test(bats): add regression test for glob expansion
chore(ci): update Node.js version in workflow
```

Scopes: `core`, `data`, `ui`, `feature`, `ci`, `deps`, `release`, `docs`, `detekt`, `mcp`, `skills`, `scripts`, `agents`.

### 5. Open a PR

Target `develop`. The CI runs automatically:
- Commit lint (Conventional Commits)
- README audit (counts match reality)
- Shell tests (bats)
- MCP tests (vitest)
- Agent parity check

## What Can You Contribute?

| Area | Examples | Test Required |
|------|----------|---------------|
| **Skills** | New SKILL.md + registry entry | bats structural tests |
| **Agents** | New agent .md + registry entry | agent parity check |
| **Detekt rules** | New rule in detekt-rules/ | JUnit test + vitest |
| **Scripts** | New SH + PS1 pair | bats tests (SH+PS1 parity) |
| **MCP tools** | New tool in mcp-server/src/tools/ | vitest |
| **Docs** | Pattern docs, guides | doc-structure test (line limits, frontmatter) |
| **Bug fixes** | Any area | Regression test for the bug |

### Key Rules

1. **Every change needs tests.** No exceptions.
2. **SH and PS1 must stay in parity.** If you change a bash script, update the PowerShell equivalent.
3. **Registry hashes must be current.** Run `rehash-registry.sh` after changing skills/agents/commands.
4. **README counts must be accurate.** The CI verifies this — run `/readme-audit --fix` if counts drift.
5. **Docs have line limits.** Hub docs ≤100 lines, sub-docs ≤300 lines (500 absolute max).
6. **No `local` keyword outside bash functions.** Causes syntax errors on strict Linux bash.
7. **No `console.log` in MCP server code.** Use the `logger` utility (stderr only).

## Downstream Impact

Changes to `skills/`, `agents/`, `.claude/commands/`, and `scripts/` are automatically synced to downstream projects via the auto-sync system. Be mindful:

- **Additive changes** (new skills, new agents) are safe — consumers get them automatically.
- **Breaking changes** (renaming skills, changing script flags) need a migration note in the PR.
- **Detekt rule changes** affect all consuming projects at build time.

## Questions?

Open an issue or check the [documentation](docs/).

For the autonomous AI agent workflow (auto-merge, multi-agent branches), see [docs/guides/autonomous-workflow.md](docs/guides/autonomous-workflow.md).
