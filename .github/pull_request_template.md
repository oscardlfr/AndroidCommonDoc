## What

<!-- One sentence: what does this PR do? -->

## Why

<!-- Why is this change needed? Link to issue if applicable. -->

## Scope

- [ ] Skills / agents / commands (triggers auto-sync to downstream)
- [ ] Scripts (SH + PS1 parity maintained)
- [ ] Detekt rules (affects all consuming projects)
- [ ] MCP server / tools
- [ ] Documentation
- [ ] CI workflows
- [ ] Setup wizard

## Downstream Impact

<!-- Will this change affect L1/L2 projects? -->
- [ ] **Additive** — new skills/agents, no breaking changes
- [ ] **Breaking** — renamed/removed entries, changed script flags (describe below)
- [ ] **No downstream impact** — internal only (docs, tests, CI)

## Quality Checklist

- [ ] Tests added or updated (bats for scripts, vitest for MCP, JUnit for Detekt)
- [ ] `rehash-registry.sh --check` passes (if skills/agents/commands changed)
- [ ] `/readme-audit` passes (if counts changed)
- [ ] SH ↔ PS1 parity maintained (if scripts changed)
- [ ] No `local` outside bash functions
- [ ] No `console.log` in MCP server code

## Testing

<!-- How was this tested? -->
- [ ] `npx bats scripts/tests/*.bats` — shell tests pass
- [ ] `cd mcp-server && npx vitest run` — vitest pass
- [ ] Manual verification on a consumer project (if applicable)

---
<!-- Run /pre-pr before pushing to catch CI failures locally -->
