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

## Android CLI Knowledge Base (`kb://` URIs)

URLs starting with `kb://` are routed through Google's Android CLI (`android docs fetch`) instead of Jina/raw HTTP. The CLI ships a local index covering Android, Firebase, Kotlin, and Google Developers docs — first invocation downloads ~10 MB and builds an index (~10 s), subsequent fetches are near-instant.

### When to prefer `kb://` over `https://`

- The page is in Google's indexed set (Android Dev / Firebase / Kotlin / Google Dev).
- You want deterministic content across Jina outages or network hiccups.
- You need offline-capable validation after the initial index download.

### Example frontmatter

```yaml
validate_upstream:
  - url: "kb://android/kotlin/flow/stateflow-and-sharedflow"
    assertions:
      - type: api_present
        value: "stateIn"
        context: "Our WhileSubscribed pattern depends on stateIn"
      - type: deprecation_scan
        value: "StateFlow"
        context: "StateFlow is our core state primitive"
    on_failure: HIGH
```

### Prerequisites

- Android CLI v0.7+ on PATH (`android --version` resolves). Install: download binary from d.android.com/tools/agents or, without admin: `curl --ssl-no-revoke -fsSL https://edgedl.me.gvt1.com/edgedl/android/cli/latest/windows_x86_64/android.exe -o %USERPROFILE%\android-cli\android.exe` then add to User PATH.
- No device required for `android docs fetch` — it reads the local KB, not a connected device.

### Failure modes

| Symptom | Meaning | Fix |
|---|---|---|
| `Android CLI not on PATH` | binary missing or not in PATH | install CLI, restart terminal |
| `Knowledge Base has no entry for kb://...` | URL typo or not indexed | use `android docs search <query>` to find a valid `kb://` |
| `timed out after Nms` | first-run index build took too long | re-run with larger `timeout` or after `android docs search` primes the index |

### Fallback behavior

- `kb://` URLs do **not** fall back to HTTP on error — the CLI is authoritative for that scheme.
- `https://` URLs with `preferredSource: "android-cli"` try the CLI first (which rejects non-kb URIs), then fall back through the normal Jina → raw HTTP chain.

| Source | Origin | Offline-capable | Rate-limited |
|---|---|---|---|
| `kb://` | Android CLI local index | ✅ (after first run) | N/A |
| `https://*.jina.ai` | Jina Reader | ❌ | Jina fair-use |
| `https://` (raw) | direct HTTP | ❌ | Origin-specific |

## Severity Guide

- `on_failure: HIGH` — Critical API dependency (stateIn, Room, BiometricPrompt, CancellationException)
- `on_failure: MEDIUM` — Important but not breaking (keyword presence, DI patterns)
- `on_failure: LOW` — Informational (terminology changes)
