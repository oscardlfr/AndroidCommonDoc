# AndroidCommonDoc — Claude Code adapter

@AGENTS.md

## Claude Code specifics

- Confirm loaded instruction files with `/context`; `AGENTS.md` must appear through this explicit import.
- Run `/doctor prompt-audit` after changing `AGENTS.md`, this adapter, `.claude/rules/`, skills, agents or hooks.
- `.claude/rules/` supplies path-scoped detail. Do not copy those rules back into this always-loaded file.
- Use `/init-session --orchestrate` for the qualified runtime. Do not bootstrap roles manually from an agent template.
- Auto-memory is advisory only. Never infer current PR, wave, runtime or authorization state from memory.
- In a consumer checkout, `--add-dir <L0-root>` grants toolkit access; loading the sibling's instruction files additionally requires `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`. The consumer contract remains authoritative for consumer work.
