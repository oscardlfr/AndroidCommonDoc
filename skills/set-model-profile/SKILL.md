---
name: set-model-profile
description: "Switch the model tier used by all AndroidCommonDoc agents."
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
/set-model-profile --update     # Validate the checked-in L0 profile definitions
```

## Profiles

| Profile | Strategy | When to use |
|---------|----------|-------------|
| `budget` | All haiku | Quick checks, cost-conscious iterations |
| `balanced` | Haiku for grep-like, Sonnet for reasoning | Day-to-day development (default) |
| `advanced` | Opus for orchestration + deep analysis, Sonnet for rest | Serious work needing high-quality planning |
| `quality` | All opus | Critical audits, pre-release, production issues |

## Execution

### Step 0: Enforce the runtime boundary

Resolve the layer first:

```bash
node .claude/runtime/l0-toolkit-launcher.cjs describe layer --project-root "$PWD"
```

In a runtime-enabled L1/L2 consumer, stop without editing. The runtime owns the
canonical agent templates and `.claude/model-profiles.json`; changing either
would invalidate its content pin. Select the host model/effort at session
launch instead. `/set-model-profile` is an L0-maintainer operation.

### Step 1: Read Configuration

Read `.claude/model-profiles.json` from the project root.

If the file is missing in L0, fail closed and restore it from Git. Do not guess a
sibling checkout, consult ambient variables, or manufacture profile defaults.

The file contains:
- `current`: the active profile name for this L0 checkout
- `profiles`: map of profile name → `{ description, default_model, overrides }`

The `overrides` map allows specific agents to use a different model than the profile's `default_model`. For example, in `balanced`, static-check agents use `haiku` while the default is `sonnet`.

### Step 2: Parse Arguments

- **No arguments or `--show`**: Show current profile, then list all agents with their current `model:` frontmatter value. Format as a table. Stop here.
- **`--update`**: Validate the checked-in L0 definitions without changing the current selection. Proceed to Step 2a.
- **Profile name argument** (`budget`, `balanced`, `advanced`, `quality`): Proceed to Step 3.
- **Invalid argument**: Show error with available profiles. Stop here.

### Step 2a: Validate L0 Profiles

1. Read the checked-in `.claude/model-profiles.json`.
2. Confirm `current` names a declared profile.
3. Keep `current` unchanged; do not import from another checkout.
4. Report: `L0 profile definitions valid (current: {current})`.

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

## L0-only custom overrides

L0 maintainers can edit `.claude/model-profiles.json` directly to:
- Add custom profiles (e.g., `"mixed"` with opus for orchestrators, haiku for validators)
- Modify overrides within existing profiles
- Set specific agents to specific models regardless of default

After manual edits, run `/set-model-profile {name}` to apply.

## Runtime ownership

L0 defines canonical profiles in `.claude/model-profiles.json` and may use this
skill to update its own agent sources. Runtime-enabled consumers receive the
profile catalog and canonical agents as content-pinned runtime assets; they do
not mutate either file locally.
