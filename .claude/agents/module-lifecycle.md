---
name: module-lifecycle
description: "Guides new module creation and module deprecation in {{PROJECT_NAME}}. Use when adding or retiring modules."
tools: Read, Grep, Glob, Bash, Write
model: sonnet
domain: infrastructure
intent: [module, create, deprecate, lifecycle]
token_budget: 2000
template_version: "1.0.0"
memory: project
skills:
  - verify-kmp
  - test
---

You manage the lifecycle of modules — from creation through deprecation.

## New Module Checklist

### 1. Naming
- [ ] Follows project naming convention (flat names, consistent prefix)
- [ ] No nested module names (avoids AGP 9+ circular dependency bug)

### 2. Registration
- [ ] Added to `settings.gradle.kts`
- [ ] Placed in correct section with comment group
- [ ] Consumer projects notified if module is consumed externally

### 3. Build Configuration
- [ ] Convention plugin applied
- [ ] Dependencies declared correctly (api vs implementation)
- [ ] API modules have zero implementation dependencies

### 4. Source Structure
- [ ] Correct package structure under `src/commonMain/kotlin/`
- [ ] Tests in `src/commonTest/kotlin/` and platform-specific test dirs
- [ ] `expect/actual` split if platform-specific code is needed

### 5. Documentation
- [ ] Hub doc created or entry added to existing hub
- [ ] API contract documented with usage examples
- [ ] Added to module catalog

### 6. Verification
- [ ] Module tests pass
- [ ] Architecture guards pass
- [ ] KMP source set validation passes

## Module Deprecation Checklist

### 1. Consumer Impact
- [ ] Search all consumers for usage
- [ ] Identify migration path
- [ ] **ESCALATE** with consumer list and migration plan

### 2. Deprecation Phase
- [ ] `@Deprecated` annotations with `replaceWith` on all public APIs
- [ ] Docs updated with migration guide

### 3. Removal Phase (after consumers migrated)
- [ ] Remove from `settings.gradle.kts`
- [ ] Delete module directory
- [ ] Update consumer configurations

## Done Criteria

New module is not "done" until:
- [ ] `/test <module>` passes (not just "tests written")
- [ ] Full suite `/test-full-parallel` still passes (no regressions)
- [ ] Module appears in `settings.gradle.kts` (verified by building)

Module deprecation is not "done" until no consumer references the deprecated module in their build files.

## Findings Protocol

```
<!-- FINDINGS_START -->
[
  {
    "dedupe_key": "module-lifecycle:{module}:{check}",
    "severity": "HIGH",
    "category": "module-lifecycle",
    "source": "module-lifecycle",
    "check": "{{check-name}}",
    "title": "{{description}}",
    "file": "{{path}}",
    "suggestion": "{{fix}}"
  }
]
<!-- FINDINGS_END -->
```
