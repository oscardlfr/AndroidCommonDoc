package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.lexer.KtTokens
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtConstantExpression
import org.jetbrains.kotlin.psi.KtObjectDeclaration
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType
import org.jetbrains.kotlin.psi.psiUtil.getParentOfType

/**
 * Flags magic number literals (Int/Long) inside UseCase class bodies.
 *
 * Magic numbers in business logic are hard to understand and maintain.
 * Non-trivial numeric literals should be extracted as named constants in a
 * companion object or as constructor parameters.
 *
 * Allowed: 0, 1, -1 (conventional identity/boundary values),
 *          numbers inside companion objects (they ARE named constants).
 * Flagged: any other integer literal in a UseCase function body.
 */
class NoMagicNumbersInUseCaseRule(config: Config) : Rule(
    config,
    "Magic numbers in UseCase business logic — extract as named constants or constructor parameters"
) {
    private val allowedValues = setOf("0", "1", "-1")

    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)

        val name = klass.name ?: return
        if (!name.endsWith("UseCase")) return

        val constants = klass.collectDescendantsOfType<KtConstantExpression>()
        for (constant in constants) {
            // Skip if inside companion object — those are named constants
            if (isInsideCompanionObject(constant)) continue

            val value = constant.text.trimEnd('L') // strip Long suffix
            if (value in allowedValues) continue

            // Only flag integer-like values (not booleans, nulls)
            if (!value.matches(Regex("-?\\d+"))) continue

            report(
                Finding(
                    Entity.from(constant),
                    "Magic number '$value' in UseCase '${name}'. " +
                        "Extract as a named constant: " +
                        "companion object { const val YOUR_CONSTANT = $value } " +
                        "or inject via constructor parameter for configurability."
                )
            )
        }
    }

    private fun isInsideCompanionObject(element: org.jetbrains.kotlin.psi.KtElement): Boolean {
        // companion object is a KtObjectDeclaration with COMPANION_KEYWORD modifier
        val enclosingObject = element.getParentOfType<KtObjectDeclaration>(strict = true)
        return enclosingObject?.hasModifier(KtTokens.COMPANION_KEYWORD) == true
    }
}
