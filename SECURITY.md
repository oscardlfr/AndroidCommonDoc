# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest on `master` | ✅ |
| Older commits | ❌ |

AndroidCommonDoc follows a rolling release model. Only the latest version on `master` receives security updates.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, please report security issues by emailing **oscardlfr@gmail.com** with:

1. Description of the vulnerability
2. Steps to reproduce
3. Impact assessment (what could an attacker do?)
4. Suggested fix (if you have one)

### What qualifies as a security issue?

- Secrets or credentials in committed code
- Scripts that execute untrusted input without sanitization
- MCP server endpoints that could leak filesystem contents
- Detekt rules that could be bypassed to hide malicious patterns
- CI workflows that could be exploited via PR injection
- Dependencies with known CVEs (check with `/sbom-scan`)

### Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgment | Within 48 hours |
| Assessment | Within 1 week |
| Fix (if confirmed) | Within 2 weeks |
| Disclosure | After fix is deployed |

## Security Best Practices

This toolkit includes security-oriented features:

- **`/sbom` + `/sbom-scan`**: Generate Software Bill of Materials and scan for CVEs
- **`release-guardian-agent`**: Pre-release scan for debug flags, dev URLs, secrets, disabled security
- **`privacy-auditor`**: Audit for PII in logs, analytics consent, encrypted storage
- **Detekt rules**: Catch patterns that could lead to security issues (hardcoded dispatchers, silent catch blocks)
- **Pre-commit hooks**: Validate code before it reaches the repository
