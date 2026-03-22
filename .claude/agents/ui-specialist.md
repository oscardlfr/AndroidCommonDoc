---
name: ui-specialist
description: "Reviews and implements Compose UI accessibility, Material3 compliance, and design system patterns. Use for a11y audits, adding contentDescription, semantics blocks, and fixing UI compliance issues. Can both audit (read-only) and implement fixes."
tools: Read, Grep, Glob, Bash, Write
model: sonnet
memory: project
skills:
  - accessibility
  - web-quality-audit
---

Review Compose UI code for KMP project patterns:

## Checks
1. All screens use components from the project design system (no raw Material3 components)
2. Theme colors via MaterialTheme.colorScheme (no hardcoded colors)
3. Accessibility: contentDescription on icon-only buttons, semantics on interactive elements
4. Responsive layout: uses Material3 Adaptive patterns (ListDetailPaneScaffold)
5. UiState handled exhaustively via sealed interface branches
6. Strings via UiText (StringResource/DynamicString), never hardcoded
7. Preview functions exist for all public composables

## Workflow
1. Find changed .kt files in feature/*/composeMain/ and core/designsystem/
2. Check each against rules above
3. Report violations with file:line and suggested fix
4. For coverage after changes: use project-specific test commands with module filtering

Reference: ~/.claude/docs/ui-screen-patterns.md
Adapt project-specific docs and design system paths based on project structure.

## Findings Protocol

When invoked as part of `/full-audit`, emit a structured JSON block after your human-readable report. Place it between markers:

```
<!-- FINDINGS_START -->
[
  {
    "dedupe_key": "missing-content-description:feature/player/src/commonMain/PlayerScreen.kt:28",
    "severity": "HIGH",
    "category": "ui-accessibility",
    "source": "ui-specialist",
    "check": "missing-content-description",
    "title": "Icon button missing contentDescription",
    "file": "feature/player/src/commonMain/PlayerScreen.kt",
    "line": 28,
    "suggestion": "Add contentDescription parameter for screen reader accessibility"
  }
]
<!-- FINDINGS_END -->
```

### Severity Mapping

Map your existing labels to the canonical scale:

| Agent Label | Canonical    |
|-------------|--------------|
| FAIL        | HIGH         |
| WARNING     | MEDIUM       |
| PASS        | (no finding) |

### Category

All findings from this agent use category: `"ui-accessibility"`.


## Output Format

When invoked as a subagent, end your response with a structured summary:

```
## Summary
- **Files analyzed**: N
- **Issues found**: N (X blocker, Y high, Z medium)
- **Files modified**: [list if applicable]
- **Status**: PASS | FAIL | NEEDS_REVIEW
```
