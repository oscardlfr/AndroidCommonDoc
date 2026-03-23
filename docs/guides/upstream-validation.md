---
scope: [guides, validation, upstream]
sources: [androidcommondoc]
targets: [android, desktop, ios, jvm]
slug: upstream-validation-guide
status: active
layer: L0
category: guides
description: "How to add validate_upstream assertions to pattern docs for automated upstream content validation"
version: 2
last_updated: "2026-03"
---

# Upstream Validation Guide

Add `validate_upstream` to pattern doc frontmatter to verify your patterns still match official upstream documentation.

## Quick Start

```yaml
# In your pattern doc frontmatter, before the closing ---
validate_upstream:
  - url: "https://developer.android.com/kotlin/flow/stateflow-and-sharedflow"
    assertions:
      - type: api_present
        value: "stateIn"
        context: "Our WhileSubscribed pattern depends on stateIn"
      - type: deprecation_scan
        value: "StateFlow"
        context: "StateFlow is our core state primitive"
    on_failure: HIGH
```

Run: `/audit-docs --with-upstream` or `node mcp-server/build/cli/audit-docs.js --with-upstream`

## Assertion Types

| Type | What it checks | When to use | Strength |
|------|---------------|-------------|----------|
| `api_present` | API name exists in upstream | Core API your pattern depends on | **Strong** |
| `deprecation_scan` | No deprecation keywords near API | API must not be deprecated | **Strong** |
| `api_absent` | API name NOT in upstream | API you explicitly avoid | **Strong** |
| `keyword_absent` | Keyword not near qualifier | Pattern you teach against | Medium |
| `pattern_match` | Regex matches in upstream | Complex API signatures | Medium |
| `keyword_present` | Keyword appears in upstream | Domain-specific concepts only | **Weak** |

## Assertion Quality Rules

Every doc MUST have at least 1 **strong** assertion (`api_present`, `deprecation_scan`, or `api_absent`). Docs with only `keyword_present` provide zero real validation.

### ❌ Bad — Generic keywords that always pass

```yaml
# WRONG — "multiplatform" appears on every Kotlin page, this will never fail
assertions:
  - type: keyword_present
    value: "multiplatform"
    context: "Must support multiplatform"
  - type: keyword_present
    value: "Kotlin"
    context: "Must mention Kotlin"
```

### ✅ Good — Specific APIs that would fail if deprecated

```yaml
# RIGHT — validates the actual APIs our doc teaches
assertions:
  - type: api_present
    value: "BiometricPrompt"
    context: "Our biometric auth pattern wraps BiometricPrompt"
  - type: deprecation_scan
    value: "BiometricPrompt"
    context: "If deprecated, our auth-biometric module needs rewrite"
  - type: api_present
    value: "CryptoObject"
    context: "We pass CryptoObject for crypto-backed auth"
```

### Minimum assertion quality per doc type

| Doc type | Required assertions |
|----------|-------------------|
| API/module docs (`*-patterns.md`, `*-modules.md`) | ≥2 `api_present` + ≥1 `deprecation_scan` |
| Hub docs (`*-hub.md`) | ≥1 `api_present` or `keyword_present` (specific domain term) |
| Guide docs | ≥1 `api_present` for tools/APIs referenced |

### `keyword_present` — when it IS valid

Only for domain-specific terms that wouldn't appear on unrelated pages:
- ✅ `"BiometricPrompt"` — specific API
- ✅ `"PKCE"` — specific protocol
- ✅ `"version catalog"` — specific Gradle concept
- ❌ `"multiplatform"` — too generic
- ❌ `"Kotlin"` — appears everywhere
- ❌ `"encryption"` — too broad

## URL Selection

Point to the **specific page** where the API is documented, not a hub or overview.

| ❌ Wrong | ✅ Right |
|----------|---------|
| `developer.android.com/jetpack` | `developer.android.com/reference/androidx/biometric/BiometricPrompt` |
| `kotlinlang.org/docs/multiplatform.html` | `kotlinlang.org/docs/multiplatform-expect-actual.html` |
| `firebase.google.com/docs` | `firebase.google.com/docs/auth/android/start` |

Jina Reader handles JS-rendered pages. Raw HTTP fallback only works for static HTML.

| Source | Works with Jina | Works with raw |
|--------|----------------|----------------|
| kotlinlang.org | ✅ | ✅ |
| developer.android.com | ✅ | ❌ (JS-rendered) |
| jetbrains.com/help | ✅ | ❌ (JS-rendered) |
| insert-koin.io | ✅ | ❌ (JS-rendered) |
| GitHub repos | ✅ | ✅ |

## Severity Guide

- `on_failure: HIGH` — Critical API dependency (stateIn, Room, BiometricPrompt, CancellationException)
- `on_failure: MEDIUM` — Important but not breaking (keyword presence, DI patterns)
- `on_failure: LOW` — Informational (terminology changes)
