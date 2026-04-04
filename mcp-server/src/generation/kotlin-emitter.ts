/**
 * Kotlin source code emitter for Detekt rules.
 *
 * Generates AST-only Detekt rule source code from RuleDefinition objects.
 * All generated rules use Kotlin PSI visitor patterns -- no type resolution,
 * no bindingContext, no RequiresAnalysisApi (avoids Detekt #8882).
 *
 * Generated rules are placed in the `com.androidcommondoc.detekt.rules.generated`
 * package and follow the exact same patterns as the 5 existing hand-written rules.
 */

import type { RuleDefinition } from "../registry/types.js";
import { logger } from "../utils/logger.js";

/** Default generated rules package. */
const DEFAULT_GENERATED_PACKAGE = "com.androidcommondoc.detekt.rules.generated";

/**
 * Convert a kebab-case rule ID to a PascalCase class name with Rule suffix.
 *
 * @example toPascalCase("prefer-kotlin-time") => "PreferKotlinTime"
 */
function toPascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Resolve the banned import prefixes from a rule's detect block.
 *
 * Supports both:
 * - `banned_import_prefixes: [array]` (canonical frontmatter form)
 * - `banned_import: "string"` (legacy / single-prefix form)
 *
 * Returns null if neither field is present.
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
 * Emit a banned-import rule.
 *
 * Uses visitImportDirective to check importedFqName against banned prefixes.
 * Supports multiple prefixes joined with `||`.
 */
function emitBannedImportRule(
  className: string,
  rule: RuleDefinition,
  pkg: string = DEFAULT_GENERATED_PACKAGE,
): string {
  const prefixes = resolveBannedImportPrefixes(rule.detect);
  if (!prefixes || prefixes.length === 0) {
    logger.warn(`Kotlin emitter: banned-import rule '${rule.id}' has no banned prefixes — skipping`);
    return "";
  }
  const prefer = (rule.detect.prefer as string) ?? "the recommended alternative";

  const condition = prefixes
    .map((p) => `importPath.startsWith("${p}")`)
    .join(" ||\n                ");

  return `package ${pkg}

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtImportDirective

class ${className}(config: Config) : Rule(
    config,
    "${rule.message}"
) {
    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)
        val importPath = importDirective.importedFqName?.asString() ?: return
        if (${condition}) {
            report(
                Finding(
                    Entity.from(importDirective),
                    "${rule.message} Use '${prefer}' instead of '${'$'}importPath'."
                )
            )
        }
    }
}`;
}

/**
 * Emit a prefer-construct rule.
 *
 * Uses visitClass to check if a class with a given suffix has the required modifier.
 */
function emitPreferConstructRule(
  className: string,
  rule: RuleDefinition,
  pkg: string = DEFAULT_GENERATED_PACKAGE,
): string {
  const classSuffix = rule.detect.class_suffix as string;
  const mustBe = rule.detect.must_be as string;

  // Map must_be to the Kotlin PSI check method
  let checkMethod: string;
  switch (mustBe) {
    case "sealed":
      checkMethod = "isSealed()";
      break;
    case "abstract":
      checkMethod = "isAbstract()";
      break;
    case "data":
      checkMethod = "isData()";
      break;
    case "open":
      checkMethod = "hasModifier(org.jetbrains.kotlin.lexer.KtTokens.OPEN_KEYWORD)";
      break;
    default:
      checkMethod = "isSealed()";
  }

  return `package ${pkg}

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtClass

class ${className}(config: Config) : Rule(
    config,
    "${rule.message}"
) {
    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)
        val name = klass.name ?: return
        if (name.endsWith("${classSuffix}") && !klass.${checkMethod}) {
            report(
                Finding(
                    Entity.from(klass),
                    "${rule.message}"
                )
            )
        }
    }
}`;
}

/**
 * Resolve the banned expression/initializer from a rule's detect block.
 *
 * Supports:
 * - `banned_initializer: "string"` or `banned_initializer: [array]`
 * - `banned_expression: "string"` (alias used in some frontmatter)
 *
 * Returns the first string found, or null.
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
 * Emit a banned-usage rule.
 *
 * Uses visitClass to check properties for banned initializer text.
 * Optionally filters by supertype when in_class_extending is specified.
 */
function emitBannedUsageRule(
  className: string,
  rule: RuleDefinition,
  pkg: string = DEFAULT_GENERATED_PACKAGE,
): string {
  const bannedInit = resolveBannedInitializer(rule.detect);
  if (!bannedInit) {
    logger.warn(`Kotlin emitter: banned-usage rule '${rule.id}' has no banned initializer/expression — skipping`);
    return "";
  }
  const prefer = (rule.detect.prefer as string) ?? "the recommended alternative";
  const inClassExtending = rule.detect.in_class_extending as
    | string
    | undefined;

  const supertypeCheck = inClassExtending
    ? `
        val extendsTarget = klass.superTypeListEntries.any { entry ->
            entry.text.contains("${inClassExtending}")
        }
        if (!extendsTarget) return`
    : "";

  return `package ${pkg}

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtProperty

class ${className}(config: Config) : Rule(
    config,
    "${rule.message}"
) {
    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)${supertypeCheck}

        klass.body?.properties?.forEach { property ->
            checkProperty(property, klass)
        }
    }

    private fun checkProperty(property: KtProperty, klass: KtClass) {
        val initializerText = property.initializer?.text ?: return
        if (initializerText.contains("${bannedInit}")) {
            report(
                Finding(
                    Entity.from(property),
                    "${rule.message} Use '${prefer}' instead."
                )
            )
        }
    }
}`;
}

/**
 * Emit a Kotlin Detekt rule source file from a RuleDefinition.
 *
 * Returns null for hand_written rules (never overwrite hand-written rules).
 * Returns null for unsupported rule types.
 *
 * @param rule - The rule definition from frontmatter
 * @returns Full Kotlin source code string, or null if the rule should not be generated
 */
export function emitRule(rule: RuleDefinition, pkg: string = DEFAULT_GENERATED_PACKAGE): string | null {
  // Never overwrite hand-written rules
  if (rule.hand_written === true) {
    return null;
  }

  const className = toPascalCase(rule.id) + "Rule";

  let result: string | null;
  switch (rule.type) {
    case "banned-import":
      result = emitBannedImportRule(className, rule, pkg);
      break;
    case "prefer-construct":
      result = emitPreferConstructRule(className, rule, pkg);
      break;
    case "banned-usage":
      result = emitBannedUsageRule(className, rule, pkg);
      break;
    default:
      result = null;
  }
  // Empty string means the emitter couldn't resolve required detect fields
  return result === "" ? null : result;
}

/**
 * Generate import statements and rule references for RuleSetProvider registration.
 *
 * This is a helper that produces the code snippet to add to
 * AndroidCommonDocRuleSetProvider. The actual file modification
 * happens in Plan 04.
 *
 * @param ruleClassNames - Array of generated rule class names
 * @returns Code snippet with imports and ::references, or empty string if no rules
 */
export function emitRuleSetProviderUpdate(ruleClassNames: string[], pkg: string = DEFAULT_GENERATED_PACKAGE): string {
  if (ruleClassNames.length === 0) {
    return "";
  }

  const imports = ruleClassNames
    .map((name) => `import ${pkg}.${name}`)
    .join("\n");

  const references = ruleClassNames.map((name) => `            ::${name},`).join("\n");

  return `// Generated rule imports
${imports}

// Generated rule references (add to RuleSet listOf)
${references}`;
}
