# Work Skill

Smart task routing — analyzes freeform text and delegates to the right agent or skill.

## Usage

```
/work <task description>
```

## Routing Logic

### Level 1 — Deterministic Keyword Rules (instant, 0 tokens)

Match `$ARGUMENTS` against these patterns in order. First match wins:

| Pattern | Route |
|---------|-------|
| `bug\|error\|fix\|broken\|crash` | `/debug` |
| `test\|coverage\|benchmark` | Delegate to `test-specialist` agent |
| `review\|PR\|pull request` | `/review-pr` |
| `research\|investigate\|explore` | `/research` |
| `decide\|choose\|compare\|tradeoff` | `/decide` |
| `verify\|check spec\|meets criteria` | `/verify` |
| `map\|architecture\|modules\|inventory` | `/map-codebase` |
| `pre-pr\|validate\|ready to merge` | `/pre-pr` |
| `note\|idea\|remember` | `/note` |
| `audit\|quality` | `/audit` |
| `prioritize\|roadmap\|features\|backlog` | Agent(`product-strategist`) * |
| `post\|blog\|social\|marketing\|content` | Agent(`content-creator`) * |
| `landing\|page\|conversion\|copy\|seo` | Agent(`landing-page-strategist`) * |
| `pricing\|tiers\|monetize` | Agent(`product-strategist`) * |

\* Business agents are opt-in. If the agent doesn't exist in `.claude/agents/`, fall through to Level 2.

### Level 2 — Frontmatter Discovery (if no Level 1 match)

1. Scan `.claude/agents/*.md` for `intent:` frontmatter
2. Match keywords in user description against intent arrays
3. If match found -> suggest that agent
4. If no match -> check if `dev-lead` agent exists:
   - If yes: spawn `dev-lead` in worktree
   - If no: execute the task directly (Claude handles inline)

## Steps

1. Parse task description from `$ARGUMENTS`
2. Run Level 1 keyword matching against the routing table above
3. If no Level 1 match, run Level 2 frontmatter discovery:
   - Read each `.claude/agents/*.md` file
   - Extract `intent:` array from YAML frontmatter
   - Score keyword overlap with `$ARGUMENTS`
   - Select highest-scoring agent (if any scores > 0)
4. Display the routing decision:

```
Routing: "{task}" -> {target skill or agent}
Reason: {matched keyword or intent}

Proceed? (y/n)
```

5. Wait for user confirmation before executing
6. On confirmation, invoke the matched skill or spawn the matched agent

## Notes

- Level 1 is checked first — it is instant and deterministic
- Level 2 only runs when Level 1 has no match
- **Before routing to any agent, verify it exists** in `.claude/agents/` — if not, fall through
- Business agents (product-strategist, content-creator, landing-page-strategist) are opt-in templates; they only exist if the project activated them via `/setup`
- `dev-lead` is also a template — only exists if the project copied it from `setup/agent-templates/`
- Always show the routing decision and ask for confirmation before executing
- If the user disagrees with routing, ask them to clarify or pick a target manually
