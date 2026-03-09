/**
 * Onboarding prompt.
 *
 * Guides new developers through the AndroidCommonDoc toolkit --
 * its purpose, directory structure, key pattern docs, quality gates,
 * and how to adopt patterns effectively.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Project-type-specific onboarding guidance.
 */
const PROJECT_GUIDANCE: Record<string, string> = {
  android: `
### Android-Specific Guidance

As an Android developer, focus on these patterns first:
1. **ViewModel State Patterns** - UiState as sealed interface, StateFlow with WhileSubscribed(5_000)
2. **UI Screen Patterns** - Compose screen structure, navigation, state hoisting
3. **Testing Patterns** - runTest, UnconfinedTestDispatcher, pure-Kotlin fakes
4. **Compose Resources** - Resource placement in commonMain/composeResources/
5. **Error Handling** - Result<T> from core-error, CancellationException rethrow

Key Android conventions:
- Use \`koinViewModel()\` for DI in Compose
- Navigation3 with @Serializable routes
- No platform deps in ViewModels (no Context, Resources, UIKit)
- UiText for user-facing strings (StringResource / DynamicString)
`,
  kmp: `
### KMP-Specific Guidance

As a KMP developer, focus on these patterns first:
1. **KMP Architecture** - Source set hierarchy, applyDefaultHierarchyTemplate()
2. **Gradle Patterns** - Flat module naming, convention plugins, version catalogs
3. **Offline-First Patterns** - Data synchronization, conflict resolution
4. **Testing Patterns** - Cross-platform test strategies, expect/actual patterns
5. **Resource Management** - Compose resources in commonMain

Key KMP conventions:
- ALWAYS use \`applyDefaultHierarchyTemplate()\` in KMP modules
- commonMain: Pure Kotlin ONLY (no android.*, java.*, platform.* imports)
- jvmMain for shared Android + Desktop code (NOT duplicated across androidMain + desktopMain)
- appleMain for shared iOS + macOS code
- FLAT module names: \`core-json-api\`, \`core-network-ktor\`
- File naming: .kt (common), .jvm.kt (JVM), .android.kt (Android), etc.
`,
  ios: `
### iOS-Specific Guidance

As an iOS developer working with KMP shared code, focus on:
1. **KMP Architecture** - Understanding source sets and expect/actual patterns
2. **Offline-First Patterns** - How data sync works across platforms
3. **Error Handling** - Result<T> mapping to Swift error handling
4. **ViewModel Patterns** - How shared ViewModels expose state

Key iOS conventions:
- iOS/macOS use native SwiftUI NavigationStack (not shared Compose navigation)
- appleMain source set for shared iOS + macOS implementations
- .apple.kt suffix for Apple-specific implementations
- Observe KMP StateFlow from Swift using async/await or Combine wrappers
`,
};

export function registerOnboardingPrompt(server: McpServer): void {
  server.registerPrompt(
    "onboarding",
    {
      title: "Onboarding",
      description:
        "Welcome and guide new developers through AndroidCommonDoc toolkit patterns, " +
        "directory structure, quality gates, and best practices.",
      argsSchema: {
        projectType: z
          .enum(["android", "kmp", "ios"])
          .optional()
          .describe("Developer's primary focus area"),
      },
    },
    async ({ projectType }) => {
      const projectSpecific = projectType
        ? (PROJECT_GUIDANCE[projectType] ?? "")
        : "";

      const promptText = [
        "# Welcome to AndroidCommonDoc",
        "",
        "You are being onboarded to the AndroidCommonDoc toolkit -- a comprehensive repository of",
        "Android/KMP development patterns, guides, conventions, and automated quality gates.",
        "",
        "## Toolkit Purpose",
        "",
        "AndroidCommonDoc ensures that developers follow consistent, battle-tested patterns across all",
        "Android and KMP projects. It provides:",
        "- **Pattern Documentation** -- 9 detailed guides covering architecture, ViewModel state, testing, UI, Compose, Gradle, KMP, offline-first, and resource management",
        "- **Skill Definitions** -- 16 automated skills for building, testing, coverage, validation, and more",
        "- **Quality Gates** -- Automated validation scripts that check code against documented patterns",
        "- **Guard Tests** -- Konsist-based architecture tests distributed as templates for consumer projects",
        "",
        "## Directory Structure",
        "",
        "```",
        "AndroidCommonDoc/",
        "  docs/              -- 9 pattern documentation files (Markdown)",
        "  skills/            -- 16 skill definitions with SKILL.md and rules/",
        "  scripts/sh/        -- Validation shell scripts",
        "  scripts/ps1/       -- Validation PowerShell scripts (Windows parity)",
        "  konsist-tests/     -- Architecture validation tests (Konsist)",
        "  guard-tests/       -- Distributable guard test templates",
        "  mcp-server/        -- MCP server for AI agent access",
        "  .claude/           -- Claude Code agent configurations",
        "  .planning/         -- Project planning and execution state",
        "```",
        "",
        "## Key Pattern Documents",
        "",
        "Start with these documents in order:",
        "1. **kmp-architecture.md** -- Core architecture: source sets, layers, module naming",
        "2. **viewmodel-state-patterns.md** -- ViewModel rules: sealed UiState, StateFlow, events",
        "3. **testing-patterns.md** -- Test patterns: runTest, fakes over mocks, dispatchers",
        "4. **ui-screen-patterns.md** -- UI composition: Compose screens, navigation, state hoisting",
        "5. **gradle-patterns.md** -- Build system: convention plugins, version catalogs, composite builds",
        "6. **offline-first-patterns.md** -- Data patterns: sync, conflict resolution, caching",
        "7. **compose-resources-patterns.md** -- Compose resource handling across platforms",
        "8. **resource-management-patterns.md** -- Android resource management patterns",
        "9. **enterprise-integration-proposal.md** -- Enterprise workflow integration guide",
        "",
        "## Architecture Layers",
        "",
        "| Layer | Contains | Depends On |",
        "|-------|----------|-----------|",
        "| UI | Compose Screens, SwiftUI Views | ViewModel |",
        "| ViewModel | UiState, event handling | UseCases |",
        "| Domain | UseCases, Repository interfaces | Model |",
        "| Data | Repository impls, DataSources | Domain + Platform |",
        "| Model | Data classes, enums, sealed types | Nothing |",
        "",
        "## Running Quality Gates",
        "",
        "Quality gates validate your code against documented patterns:",
        "- Use the MCP server's validation tools to check your project",
        "- Run individual validation scripts from scripts/sh/ or scripts/ps1/",
        "- Install guard test templates in your consumer project for continuous checks",
        "",
        "## How to Adopt Patterns",
        "",
        "1. Read the relevant pattern doc for your current task",
        "2. Follow the rules and conventions described",
        "3. Use the skills for automated tasks (build, test, coverage)",
        "4. Run quality gates before committing",
        "5. Use architecture review prompts to validate your code",
        "",
        "## Common Mistakes to Avoid",
        "",
        "- Using data class with boolean flags for UiState (use sealed interface instead)",
        "- Forgetting to rethrow CancellationException in catch blocks",
        "- Putting platform dependencies in ViewModels (Context, Resources, UIKit)",
        "- Using Channel for navigation events (use state-driven navigation)",
        "- Duplicating code across androidMain and desktopMain (use jvmMain)",
        "- Nested module naming like core-json:api (use flat: core-json-api)",
        "- Using Dispatchers.Default directly in UseCases (inject testDispatcher)",
        "",
        projectSpecific,
      ].join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: promptText,
            },
          },
        ],
      };
    },
  );
}
