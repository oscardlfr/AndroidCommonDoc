---
paths:
  - "**/*.md"
  - "docs/**"
  - "BACKLOG.md"
  - "CHANGELOG.md"
  - "README.md"
---

# Documentation rules

- Keep `AGENTS.md` portable and concise; keep `CLAUDE.md` adapter-only.
- Put durable decisions in ADRs or pattern docs, current work in the backlog/work artifacts and execution evidence in reports.
- Do not record live PR status, CI state, branch heads, temporary hashes or active waves in startup instructions or auto-memory.
- Use relative repository links and required frontmatter. Public artifacts must not name private consumers or expose local paths/usernames.
- Update canonical docs first, then regenerate adapters and inventories. Never patch generated copies as the source of truth.
