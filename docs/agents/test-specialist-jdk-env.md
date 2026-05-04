---
scope: test-specialist
category: agents
slug: test-specialist-jdk-env
sources: [setup/agent-templates/test-specialist.md]
targets: []
---

# test-specialist-jdk-env — Common Gradle Error Triage (BL-W32-16)

UnsupportedClassVersionError / class version mismatch:
  1. Query context-provider for "project JDK requirement" memory - get correct major version
  2. If JAVA_HOME mismatches, override inline: JAVA_HOME="<path>" <gradle-invocation>
  3. Windows path example: Eclipse Adoptium JDK install dir (query context-provider for exact path)
  4. If still failing after JAVA_HOME override, escalate to team-lead with full Gradle output
