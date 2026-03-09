---
name: sync-gsd-skills
description: "Sync skills from Claude Code marketplace, L0, and L0 agents to GSD-2 user-level directory. Opt-in only -- never runs automatically unless explicitly enabled."
user-invocable: true
allowed-tools: [Bash, Read, Glob]
category: guides
---

## Usage Examples

```
/sync-gsd-skills                       # sync all sources
/sync-gsd-skills --source marketplace  # only marketplace skills
/sync-gsd-skills --source l0           # only L0 skills
/sync-gsd-skills --dry-run             # preview without syncing
/sync-gsd-skills --verbose             # show per-file details
/sync-gsd-skills --enable-hook         # opt-in: install session-start hook
/sync-gsd-skills --disable-hook        # opt-out: remove session-start hook
```

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--source marketplace\|l0\|all` | `all` | Which sources to sync |
| `--dry-run` | false | Preview changes without writing |
| `--verbose` | false | Show per-file sync details |
| `--enable-hook` | false | Install session-start auto-sync hook |
| `--disable-hook` | false | Remove session-start auto-sync hook |

## Behavior

### Prerequisites

- GSD-2 must be installed (`~/.gsd/` directory exists)
- If `~/.gsd/` does not exist, print message and exit:
  ```
  GSD-2 not detected (~/.gsd/ not found). Install GSD-2 first.
  ```

### Sources

| Source | Location | Target Subdir |
|--------|----------|---------------|
| Marketplace | `~/.claude/skills/*/SKILL.md` | `~/.gsd/agent/skills/marketplace/{name}/SKILL.md` |
| L0 Skills | `$ANDROID_COMMON_DOC/skills/*/SKILL.md` | `~/.gsd/agent/skills/l0/{name}/SKILL.md` |
| L0 Agents | `$ANDROID_COMMON_DOC/.claude/agents/*.md` | `~/.gsd/agent/skills/l0-agents/{name}/SKILL.md` |

### Sync Algorithm

1. Discover all source files matching patterns above
2. Compute SHA-256 hash of each file's content
3. Read `~/.gsd/agent/skills/.sync-manifest.json` (if exists)
4. For each file:
   - If not in manifest: copy to target → mark as **new**
   - If hash differs from manifest: copy → mark as **updated**
   - If hash matches: skip → mark as **unchanged**
5. Update manifest with new hashes and timestamp
6. Report summary: N new, M updated, P unchanged

### Manifest Schema

File: `~/.gsd/agent/skills/.sync-manifest.json`

```json
{
  "version": 1,
  "last_sync": "2026-03-19T22:00:00Z",
  "sources": {
    "marketplace": {
      "root": "~/.claude/skills",
      "entries": {
        "pdf": { "hash": "sha256:abc...", "synced_at": "..." }
      }
    },
    "l0": { "root": "$ANDROID_COMMON_DOC/skills", "entries": {} },
    "l0-agents": { "root": "$ANDROID_COMMON_DOC/.claude/agents", "entries": {} }
  }
}
```

### Hook Management

`--enable-hook` adds to `~/.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "bash \"$ANDROID_COMMON_DOC/scripts/sh/sync-gsd-skills.sh\" --source all 2>/dev/null || true"
      }]
    }]
  }
}
```

`--disable-hook` removes the SessionStart hook entry containing `sync-gsd-skills`.

### Execution

```bash
bash "$ANDROID_COMMON_DOC/scripts/sh/sync-gsd-skills.sh" \
  ${SOURCE:+--source "$SOURCE"} \
  ${DRY_RUN:+--dry-run} \
  ${VERBOSE:+--verbose}
```

### Output

```
GSD Skill Sync
  Sources: marketplace (12), l0 (28), l0-agents (11)
  Results: 3 new, 2 updated, 46 unchanged
  Target:  ~/.gsd/agent/skills/
```

With `--verbose`:
```
  [NEW]     marketplace/pdf/SKILL.md
  [UPDATED] l0/coverage/SKILL.md (hash mismatch)
  [OK]      l0/test/SKILL.md
  ...
```

## Important Rules

1. **Never auto-sync** -- only runs when user invokes or explicitly enables hook
2. **No deletion** -- only adds/updates, never removes skills from GSD
3. **Idempotent** -- safe to run multiple times
4. **Prefix subdirs** prevent name collisions between sources
5. **`|| true`** in hook ensures session start is never blocked by sync failures

## Cross-References

- Script: `scripts/sh/sync-gsd-skills.sh` / `scripts/ps1/sync-gsd-skills.ps1`
- Skill: `/setup` -- W7 step offers GSD integration
