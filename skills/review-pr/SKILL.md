---
name: review-pr
description: "Code review of a pull request with structured suggestions."
intent: [review, pr, pull-request, code-review, feedback]
copilot: false
---

# Review PR Skill

Code review of a pull request with structured suggestions.

## Usage

```
/review-pr <PR number or URL>
```

## Steps

1. Parse PR identifier from `$ARGUMENTS`
2. Fetch PR information:
   ```bash
   gh pr view {pr} --json title,body,files,additions,deletions
   gh pr diff {pr}
   ```
3. Analyze the diff for:
   - **Correctness**: Logic errors, edge cases, null safety
   - **Security**: Injection risks, credential exposure, input validation
   - **Performance**: N+1 queries, unnecessary allocations, missing caching
   - **Patterns**: Compliance with project conventions (from CLAUDE.md)
   - **Tests**: Coverage of new/changed code

4. Output structured review:

```markdown
## PR Review: #{number} — {title}

### Summary
{1-2 sentences on what this PR does}

### Findings
| # | Severity | File | Line | Issue | Suggestion |
|---|----------|------|------|-------|------------|

### Verdict
{APPROVE / REQUEST_CHANGES / COMMENT}

### Positive Notes
- {what's done well}
```

## Notes

- Requires `gh` CLI authenticated
- Focus on actionable findings — skip style nitpicks
- Always note positive aspects, not just problems
