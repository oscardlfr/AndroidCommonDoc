/**
 * Kotlin test source code emitter for generated Detekt rules.
 *
 * Generates companion JUnit 5 test classes for each generated rule,
 * mirroring the exact same test pattern used by the 5 existing
 * hand-written rules: Config.empty, rule.lint(code), assertThat(findings).
 *
 * Uses `rule.lint(code)` (AST-only), NOT `rule.compileAndLint(code)`
 * which requires type resolution.
 */

import type { RuleDefinition } from "../registry/types.js";
import { logger } from "../utils/logger.js";

/** Default generated rules package. */
const DEFAULT_GENERATED_PACKAGE = "com.androidcommondoc.detekt.rules.generated";

/**
 * Convert a kebab-case rule ID to a PascalCase class name with Rule suffix.
 */
function toPascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Resolve the banned import prefixes from a rule's detect block.
 * Same logic as kotlin-emitter's resolveBannedImportPrefixes.
 */
function resolveBannedImportPrefixes(detect: Record<string, unknown>): string[] | null {
  const prefixes = detect.banned_import_prefixes;
  if (Array.isArray(prefixes) && prefixes.length > 0) {
    return prefixes.filter((p): p is string => typeof p === "string");
  }
  const single = detect.banned_import;
  if (typeof single === "string") {
    return [single];
  }
  return null;
}

/**
 * Generate a banned-import test class.
 * Uses the first banned prefix for the violating test case.
 */
function emitBannedImportTest(
  className: string,
  rule: RuleDefinition,
  pkg: string = DEFAULT_GENERATED_PACKAGE,
): string {
  const prefixes = resolveBannedImportPrefixes(rule.detect);
  if (!prefixes || prefixes.length === 0) {
    logger.warn(`Test emitter: banned-import rule '${rule.id}' has no banned prefixes — skipping`);
    return "";
  }
  const banned = prefixes[0];
  const prefer = (rule.detect.prefer as string) ?? "com.example.compliant";

  return `package ${pkg}

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class ${className}Test {
    private val rule = ${className}(Config.empty)

    @Test
    fun \`reports violating code\`() {
        val code = """
            import ${banned}
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun \`accepts compliant code\`() {
        val code = """
            import ${prefer}
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}`;
}

/**
 * Generate a prefer-construct test class.
 */
function emitPreferConstructTest(
  className: string,
  rule: RuleDefinition,
  pkg: string = DEFAULT_GENERATED_PACKAGE,
): string {
  const classSuffix = rule.detect.class_suffix as string;
  const mustBe = rule.detect.must_be as string;

  // Build the compliant declaration based on must_be value
  let compliantDecl: string;
  switch (mustBe) {
    case "sealed":
      compliantDecl = `sealed interface Home${classSuffix}`;
      break;
    case "abstract":
      compliantDecl = `abstract class Home${classSuffix}`;
      break;
    case "data":
      compliantDecl = `data class Home${classSuffix}(val x: Int)`;
      break;
    default:
      compliantDecl = `sealed interface Home${classSuffix}`;
  }

  return `package ${pkg}

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class ${className}Test {
    private val rule = ${className}(Config.empty)

    @Test
    fun \`reports violating code\`() {
        val code = """
            class Home${classSuffix}(val isLoading: Boolean)
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun \`accepts compliant code\`() {
        val code = """
            ${compliantDecl} {
                data object Loading : Home${classSuffix}
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}`;
}

/**
 * Resolve the banned initializer/expression from a rule's detect block.
 * Same logic as kotlin-emitter's resolveBannedInitializer.
 */
function resolveBannedInitializer(detect: Record<string, unknown>): string | null {
  const init = detect.banned_initializer;
  if (typeof init === "string") return init;
  if (Array.isArray(init) && init.length > 0 && typeof init[0] === "string") return init[0];
  const expr = detect.banned_expression;
  if (typeof expr === "string") return expr;
  return null;
}

/**
 * Generate a banned-usage test class.
 */
function emitBannedUsageTest(
  className: string,
  rule: RuleDefinition,
  pkg: string = DEFAULT_GENERATED_PACKAGE,
): string {
  const bannedInit = resolveBannedInitializer(rule.detect);
  if (!bannedInit) {
    logger.warn(`Test emitter: banned-usage rule '${rule.id}' has no banned initializer/expression — skipping`);
    return "";
  }
  const prefer = (rule.detect.prefer as string) ?? "the recommended alternative";
  const inClassExtending = rule.detect.in_class_extending as
    | string
    | undefined;

  const extendsClause = inClassExtending ? ` : ${inClassExtending}()` : "";

  return `package ${pkg}

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class ${className}Test {
    private val rule = ${className}(Config.empty)

    @Test
    fun \`reports violating code\`() {
        val code = """
            class MyClass${extendsClause} {
                val events = ${bannedInit}Unit>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun \`accepts compliant code\`() {
        val code = """
            class MyClass${extendsClause} {
                val events = ${prefer}<Unit>()
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}`;
}

/**
 * Emit a Kotlin test class for a generated Detekt rule.
 *
 * Returns null for hand_written rules (they already have hand-written tests).
 * Returns null for unsupported rule types.
 *
 * @param rule - The rule definition from frontmatter
 * @returns Full Kotlin test source code string, or null
 */
export function emitRuleTest(rule: RuleDefinition, pkg: string = DEFAULT_GENERATED_PACKAGE): string | null {
  // Never generate tests for hand-written rules
  if (rule.hand_written === true) {
    return null;
  }

  const className = toPascalCase(rule.id) + "Rule";

  let result: string | null;
  switch (rule.type) {
    case "banned-import":
      result = emitBannedImportTest(className, rule, pkg);
      break;
    case "prefer-construct":
      result = emitPreferConstructTest(className, rule, pkg);
      break;
    case "banned-usage":
      result = emitBannedUsageTest(className, rule, pkg);
      break;
    default:
      result = null;
  }
  return result === "" ? null : result;
}
