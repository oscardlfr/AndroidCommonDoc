---
scope: [security, encryption, key-management, biometric]
sources: [android-keystore, ios-keychain, jvm-keystore]
targets: [android, desktop, ios, macos]
slug: security-hub
status: active
layer: L0
category: security
description: "Security category hub: encryption patterns, key management, biometric auth, secure storage for KMP"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://developer.android.com/privacy-and-security/cryptography"
    type: doc-page
    tier: 2
---

# Security

Generic KMP security patterns — encryption, key management, biometric authentication, and secure data handling.

> Security implementations use expect/actual for platform cryptography. Never roll custom crypto — use platform-provided APIs.

## Documents

| Document | Description |
|----------|-------------|
| [security-patterns](security-patterns.md) | Encryption architecture, key management, biometric auth, anti-patterns |
| [biometric-owasp-a07-lifecycle](biometric-owasp-a07-lifecycle.md) | OWASP A07 biometric lifecycle: session binding, key invalidation, BIOMETRIC_STRONG default, re-auth triggers |
| [biometric-gdpr-article9-android](biometric-gdpr-article9-android.md) | GDPR Art.9 biometric obligations: errString sanitization, log minimization, Right to Erasure boundary |

## Key Rules

- Encryption via platform APIs (Android KeyStore, iOS Keychain, JVM KeyStore)
- Never hardcode keys, passwords, or secrets in source code
- Key rotation designed from day one — store key version alongside encrypted data
- Biometric auth is local-only — never send biometric data to server
- All crypto operations are `suspend` — never block main thread
