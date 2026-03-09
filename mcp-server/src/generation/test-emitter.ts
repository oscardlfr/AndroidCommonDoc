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

/** Generated rules package. */
const GENERATED_PACKAGE = "com.androidcommondoc.detekt.rules.generated";

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
 * Generate a banned-import test class.
 */
function emitBannedImportTest(
  className: string,
  rule: RuleDefinition,
): string {
  const banned = rule.detect.banned_import as string;
  const prefer = rule.detect.prefer as string;

  return `package ${GENERATED_PACKAGE}

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

  return `package ${GENERATED_PACKAGE}

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
 * Generate a banned-usage test class.
 */
function emitBannedUsageTest(
  className: string,
  rule: RuleDefinition,
): string {
  const bannedInit = rule.detect.banned_initializer as string;
  const prefer = rule.detect.prefer as string;
  const inClassExtending = rule.detect.in_class_extending as
    | string
    | undefined;

  const extendsClause = inClassExtending ? ` : ${inClassExtending}()` : "";

  return `package ${GENERATED_PACKAGE}

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
export function emitRuleTest(rule: RuleDefinition): string | null {
  // Never generate tests for hand-written rules
  if (rule.hand_written === true) {
    return null;
  }

  const className = toPascalCase(rule.id) + "Rule";

  switch (rule.type) {
    case "banned-import":
      return emitBannedImportTest(className, rule);
    case "prefer-construct":
      return emitPreferConstructTest(className, rule);
    case "banned-usage":
      return emitBannedUsageTest(className, rule);
    default:
      return null;
  }
}
