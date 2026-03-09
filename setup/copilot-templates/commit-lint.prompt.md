<!-- GENERATED from skills/commit-lint/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Validate and fix commit messages against Conventional Commits v1.0.0. Use when writing commits, reviewing commit history, or enforcing commit conventions."
---

Validate and fix commit messages against Conventional Commits v1.0.0. Use when writing commits, reviewing commit history, or enforcing commit conventions.

## Implementation

### macOS / Linux
```bash
# Collect commit messages
if [ -n "$MESSAGE" ]; then
  echo "$MESSAGE" | commit_lint_validate
else
  RANGE="${RANGE:-HEAD~1..HEAD}"
  git log "$RANGE" --pretty=format:"%H|%s|%b%x00" | while IFS='|' read -r hash subject body; do
    validate_commit "$hash" "$subject" "$body"
  done
fi
```

### Windows (PowerShell)
```powershell
if ($Message) {
    Invoke-CommitLintValidate -Message $Message
} else {
    $range = if ($Range) { $Range } else { "HEAD~1..HEAD" }
    $commits = git log $range --pretty=format:"%H|%s|%b%x00"
    foreach ($entry in $commits) {
        $parts = $entry -split '\|', 3
        Invoke-CommitLintValidate -Hash $parts[0] -Subject $parts[1] -Body $parts[2]
    }
}
```
