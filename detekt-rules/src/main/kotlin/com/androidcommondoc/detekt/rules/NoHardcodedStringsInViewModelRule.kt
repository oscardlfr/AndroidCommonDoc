package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.lexer.KtTokens
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtObjectDeclaration
import org.jetbrains.kotlin.psi.KtStringTemplateExpression

import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType
import org.jetbrains.kotlin.psi.psiUtil.getParentOfType

/**
 * Flags non-empty hardcoded string literals used in ViewModel function bodies.
 *
 * ViewModels must not contain hardcoded user-visible strings. All user-facing text
 * should go through `UiText` (either `StringResource` for resource-backed strings
 * or `DynamicString` for runtime-computed strings). Hardcoded strings bypass
 * localization and violate the ViewModel boundary contract.
 *
 * Exceptions:
 * - Empty strings (`""`)
 * - Log tag strings (assigned to a variable named `TAG` or `LOG_TAG`)
 * - Strings inside `Log.*` call arguments
 * - Strings in companion objects (constants are fine)
 */
class NoHardcodedStringsInViewModelRule(config: Config) : Rule(
    config,
    "Hardcoded string literals in ViewModels violate UiText contract — use StringResource or DynamicString"
) {
    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)

        if (!klass.superTypeListEntries.any { it.text.contains("ViewModel") }) return

        val stringTemplates = klass.collectDescendantsOfType<KtStringTemplateExpression>()
        for (template in stringTemplates) {
            // Skip if inside a companion object (constants are fine)
            if (isInsideCompanionObject(template)) continue

            val text = template.text
            // Skip empty strings and blank strings
            if (text == "\"\"" || text.trim('"').isBlank()) continue

            // Skip Log tag assignments (val TAG = "ClassName")
            val parent = template.parent
            if (parent != null) {
                val parentText = parent.text
                if (parentText.contains("TAG") || parentText.contains("LOG_TAG")) continue
                // Skip strings passed directly to Log.* calls
                if (parentText.startsWith("Log.") || parentText.contains("Timber.")) continue
            }

            // Skip strings inside StringResource(...) or UiText.StringResource(...)
            val enclosingCall = template.getParentOfType<KtCallExpression>(strict = true)
            if (enclosingCall != null) {
                val calleeName = enclosingCall.calleeExpression?.text ?: ""
                if (calleeName == "StringResource" || calleeName.endsWith(".StringResource")) continue
            }

            report(
                Finding(
                    Entity.from(template),
                    "Hardcoded string $text in ViewModel '${klass.name}'. " +
                        "Use StringResource(R.string.your_key) for localized text " +
                        "or DynamicString(text) only for runtime-computed, non-translatable strings. " +
                        "Never hardcode user-facing text in ViewModels."
                )
            )
        }
    }

    private fun isInsideCompanionObject(element: org.jetbrains.kotlin.psi.KtElement): Boolean {
        val enclosingObject = element.getParentOfType<KtObjectDeclaration>(strict = true)
        return enclosingObject?.hasModifier(KtTokens.COMPANION_KEYWORD) == true
    }
}
