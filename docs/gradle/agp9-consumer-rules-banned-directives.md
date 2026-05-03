---
scope: [gradle, build-config, r8, proguard, security]
sources: [agp, androidcommondoc]
targets: [android]
slug: agp9-consumer-rules-banned-directives
status: active
layer: L0
parent: gradle-hub
category: gradle
description: "AGP 9 banned ProGuard global directives in consumer rules: confirmed banned (-dontoptimize, -dontobfuscate), plausible banned (4 additional), controlling property, and how the PR2 proguard-validator uses this taxonomy."
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://developer.android.com/build/releases/past-releases/agp-9-0-0-release-notes"
    type: doc-page
    tier: 2
validate_upstream:
  - field: banned_directives_confirmed
    source: "https://developer.android.com/build/releases/past-releases/agp-9-0-0-release-notes"
    retrieved: "2026-05-03"
---

# AGP 9 Banned Consumer-Rules ProGuard Directives

AGP 9.0 introduced enforcement of a set of ProGuard directives that are **banned from consumer rules files**. Consumer rules (e.g., `consumer-rules.pro`) in library modules are merged into the app's R8 configuration. Global directives in these files affect the entire build, not just the library — which breaks R8's module-level optimization model.

**Source**: [AGP 9.0.0 Release Notes](https://developer.android.com/build/releases/past-releases/agp-9-0-0-release-notes) (retrieved 2026-05-03)

## Section 1: Confirmed Banned Directives (AGP 9.0, cited)

These directives are explicitly banned per the AGP 9.0 release notes:

| Directive | Why banned |
|-----------|-----------|
| `-dontoptimize` | Disables R8 optimization globally — defeats the module-level optimization model |
| `-dontobfuscate` | Disables obfuscation globally — library authors cannot opt out the entire app |

**Behaviour when encountered**: AGP 9.0 raises a build error when these directives appear in consumer rules (controlled by `android.r8.globalOptionsInConsumerRules.disallowed`, default `true`).

## Section 2: Plausible Banned Directives (Unverified — Needs Source Confirmation)

The following directives are plausible additional bans based on `ConsumerRuleGlobalGuardian.readConsumerKeepRulesRemovingBannedGlobals` in:

```
tools/base/build-system/gradle-core/src/main/java/com/android/build/gradle/internal/r8/TargetedR8Rules.kt
```

These have **not been confirmed against official AGP release notes or AOSP source** as of 2026-05-03:

| Directive | Why plausible |
|-----------|--------------|
| `-allowaccessmodification` | Global scope change — modifies access modifiers across all modules |
| `-optimizations` | Fine-grained optimization control — module-level use is inappropriate |
| `-optimizationpasses` | Controls pass count globally — module-level use is inappropriate |
| `-dontusemixedcaseclassnames` | Affects obfuscation namespace globally |

**Action required**: verify against AOSP source `TargetedR8Rules.kt` before treating as ERROR-level violations. Until verified, the PR2 validator treats these as WARN (see Section 4).

## Section 3: Controlling Property

```properties
# gradle.properties
android.r8.globalOptionsInConsumerRules.disallowed=true
```

- **Default**: `true` from AGP 9.0.0.
- **Effect when `true`**: AGP raises a build error for confirmed banned directives found in consumer rules files.
- **Effect when `false`**: Suppresses enforcement — useful during migration, but should not remain in production builds.
- **Migration path**: remove or replace banned directives with module-scoped alternatives before enabling enforcement.

## Section 4: PR2 Validator Integration

The `proguard-validator` MCP tool (`mcp-server/src/tools/proguard-validator.ts`) uses this taxonomy to classify findings:

| Level | Directives | Rationale |
|-------|-----------|-----------|
| `ERROR` | `-dontoptimize`, `-dontobfuscate` | Confirmed banned per AGP 9.0 release notes; AGP 9 will reject these at build time |
| `WARN` | `-allowaccessmodification`, `-optimizations`, `-optimizationpasses`, `-dontusemixedcaseclassnames` | Plausible bans from source inspection; not yet confirmed in official docs |

The validator reports ERROR-level findings as actionable blocks and WARN-level findings as advisory until source confirmation is obtained.

**To promote WARN → ERROR**: verify the 4 plausible directives against `TargetedR8Rules.kt` in AOSP, update this doc's Section 2 status, and bump the validator's classification table accordingly.
