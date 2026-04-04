---
description: AI-powered security review of changed files. Scans for injection, auth flaws, PII exposure, crypto weaknesses, and more.
---

Run an AI-powered security review on the current branch's changes.

Analyze the diff between the current branch and the base branch for security vulnerabilities:
- SQL/command/LDAP injection
- Authentication and authorization flaws
- PII/data exposure
- Cryptographic weaknesses
- XSS and CSRF
- Supply chain risks
- Business logic flaws

Report findings with severity (CRITICAL/HIGH/MEDIUM/LOW), affected file:line, and remediation guidance.

Based on: https://github.com/anthropics/claude-code-security-review

Arguments: $ARGUMENTS
