package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtStringTemplateExpression
import org.jetbrains.kotlin.psi.KtValueArgument

/**
 * Flags string literals passed as `id` named arguments.
 *
 * IDs should reference constants (companion object, object declaration,
 * or enum) to prevent typos, enable refactoring, and ensure consistency.
 * Magic string IDs are a maintenance hazard — if the same ID is used in
 * multiple places, a typo in one is invisible until runtime.
 *
 * Scope: ALL Kotlin files, not just ViewModels.
 */
class RequireConstantIdsRule(config: Config) : Rule(
    config,
    "Parameter 'id' should reference a constant, not a string literal"
) {
    override fun visitArgument(argument: KtValueArgument) {
        super.visitArgument(argument)

        // Only check named arguments where name is "id"
        val argName = argument.getArgumentName()?.asName?.identifier ?: return
        if (argName != "id") return

        // Check if the value expression is a string literal
        val valueExpr = argument.getArgumentExpression() ?: return
        if (valueExpr is KtStringTemplateExpression) {
            // Skip empty strings
            if (valueExpr.text == "\"\"") return

            report(
                Finding(
                    Entity.from(argument),
                    "Parameter 'id' should reference a constant, not a string literal. " +
                        "Define IDs in an object (e.g., PreferenceIds.NUDGE_BANNER) " +
                        "to prevent typos and enable safe refactoring."
                )
            )
        }
    }
}
