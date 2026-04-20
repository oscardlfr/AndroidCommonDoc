---
name: set-model-profile
description: "> Switch the model tier used by all AndroidCommonDoc agents."
intent: [model, profile, tier, agents, switch]
copilot: false
---

# set-model-profile

> Switch the model tier used by all AndroidCommonDoc agents.

## Usage

```
/set-model-profile              # Show current profile and available options
/set-model-profile budget       # All agents → haiku
/set-model-profile balanced     # Haiku + Sonnet mix (default)
/set-model-profile advanced     # Opus for orchestrators + deep analysis, Sonnet for rest
/set-model-profile quality      # All agents → opus
/set-model-profile --show       # Show which model each agent currently uses
/set-model-profile --update     # Re-import profile definitions from L0 (keeps current selection)
```

## Profiles

| Profile | Strategy | When to use |
|---------|----------|-------------|
| `budget` | All haiku | Quick checks, cost-conscious iterations |
| `balanced` | Haiku for grep-like, Sonnet for reasoning | Day-to-day development (default) |
| `advanced` | Opus for orchestration + deep analysis, Sonnet for rest | Serious work needing high-quality planning |
| `quality` | All opus | Critical audits, pre-release, production issues |

## Execution

### Step 1: Read or Bootstrap Configuration

Read `.claude/model-profiles.json` from the project root.

**If the file does not exist** (new project, worktree, missing from sync):
1. Resolve L0 root: check `l0-manifest.json` → `l0_source`, then `ANDROID_COMMON_DOC` env var, then `../AndroidCommonDoc`
2. Read `.claude/model-profiles.json` from the L0 root
3. Copy it to the project root at `.claude/model-profiles.json`
4. Set `"current": "balanced"` (safe default for new projects)
5. Print: `Bootstrapped model-profiles.json from L0 (current: balanced)`

This ensures the file is always available — no manual copy needed, even in worktrees.

The file contains:
- `current`: the active profile name (project-local, never overwritten by L0)
- `profiles`: map of profile name → `{ description, default_model, overrides }` (definitions from L0)

The `overrides` map allows specific agents to use a different model than the profile's `default_model`. For example, in `balanced`, static-check agents use `haiku` while the default is `sonnet`.

### Step 2: Parse Arguments

- **No arguments or `--show`**: Show current profile, then list all agents with their current `model:` frontmatter value. Format as a table. Stop here.
- **`--update`**: Re-import profile definitions from L0 while preserving the local `current` selection. Proceed to Step 2a.
- **Profile name argument** (`budget`, `balanced`, `advanced`, `quality`): Proceed to Step 3.
- **Invalid argument**: Show error with available profiles. Stop here.

### Step 2a: Update Profiles from L0

1. Resolve L0 root (same logic as bootstrap)
2. Read L0's `.claude/model-profiles.json`
3. Replace local `profiles` with L0's `profiles` (new definitions, new overrides)
4. Keep local `current` unchanged
5. If local `current` is not a key in the new profiles, warn and reset to `"balanced"`
6. Write updated file
7. Report: `Updated profile definitions from L0 (current: {current} preserved)`

### Step 3: Discover Agents

Use Glob to find all `.claude/agents/*.md` files in the project root.

For each agent file:
1. Read the file
2. Extract the `name:` field from YAML frontmatter
3. Extract the current `model:` field from YAML frontmatter

### Step 4: Compute Target Models

For the selected profile, determine each agent's target model:
1. If the agent name exists in `overrides` → use the override model
2. Otherwise → use the profile's `default_model`

### Step 5: Apply Changes

For each agent where the current model differs from the target model:
1. Use Edit to replace `model: {old}` with `model: {new}` in the frontmatter
2. Track the change: `{agent_name}: {old} → {new}`

### Step 6: Update Configuration

Edit `.claude/model-profiles.json` to set `"current"` to the new profile name.

### Step 7: Report

Output a summary:

```
Model Profile: {old_profile} → {new_profile}
Description: {profile.description}

Changes:
  full-audit-orchestrator:  sonnet → opus
  quality-gate-orchestrator: sonnet → opus
  script-parity-validator:  haiku → opus
  ...

{N} agents updated, {M} unchanged.
```

If no changes were needed (already on this profile), report:
```
Already on '{profile}' profile. No changes needed.
```

## Custom Overrides

Users can edit `.claude/model-profiles.json` directly to:
- Add custom profiles (e.g., `"mixed"` with opus for orchestrators, haiku for validators)
- Modify overrides within existing profiles
- Set specific agents to specific models regardless of default

After manual edits, run `/set-model-profile {name}` to apply.

## L0 Sync Model

Profile **definitions** (budget, balanced, advanced, quality + their overrides) come from L0.
Profile **selection** (`current`) is project-local and never overwritten.

The flow:
1. L0 defines canonical profiles in `.claude/model-profiles.json`
2. `/set-model-profile` bootstraps the file on first use (or `--update` refreshes definitions)
3. `/sync-l0` does NOT sync this file — it's managed by the skill to preserve `current`
4. Each project can add custom profiles without conflict
