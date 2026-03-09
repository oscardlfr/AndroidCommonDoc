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
```

## Profiles

| Profile | Strategy | When to use |
|---------|----------|-------------|
| `budget` | All haiku | Quick checks, cost-conscious iterations |
| `balanced` | Haiku for grep-like, Sonnet for reasoning | Day-to-day development (default) |
| `advanced` | Opus for orchestration + deep analysis, Sonnet for rest | Serious work needing high-quality planning |
| `quality` | All opus | Critical audits, pre-release, production issues |

## Execution

### Step 1: Read Configuration

Read `.claude/model-profiles.json` from the project root. This file contains:
- `current`: the active profile name
- `profiles`: map of profile name → `{ description, default_model, overrides }`

The `overrides` map allows specific agents to use a different model than the profile's `default_model`. For example, in `balanced`, static-check agents use `haiku` while the default is `sonnet`.

### Step 2: Parse Arguments

- **No arguments or `--show`**: Show current profile, then list all agents with their current `model:` frontmatter value. Format as a table. Stop here.
- **Profile name argument** (`budget`, `balanced`, `quality`): Proceed to Step 3.
- **Invalid argument**: Show error with available profiles. Stop here.

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

## L0 Sync

This skill and its config are synced to downstream projects via L0 sync. Each project can maintain its own `current` profile selection independently — the profile definitions come from L0 but the active selection is project-local.
