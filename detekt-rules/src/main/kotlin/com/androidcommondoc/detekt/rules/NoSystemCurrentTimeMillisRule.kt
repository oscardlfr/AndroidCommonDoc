package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression

/**
 * Forbids System.currentTimeMillis() in commonMain code.
 *
 * System.currentTimeMillis() is a JVM-only API that breaks KMP compilation.
 * Use Clock.System.now().toEpochMilliseconds() instead and inject Clock
 * as a constructor parameter for testability.
 *
 * AST-only: detects `System.currentTimeMillis()` call expressions.
 */
class NoSystemCurrentTimeMillisRule(config: Config) : Rule(
    config,
    "System.currentTimeMillis() is forbidden — use Clock.System.now().toEpochMilliseconds()"
) {
    override fun visitCallExpression(expression: KtCallExpression) {
        super.visitCallExpression(expression)

        val calleeText = expression.calleeExpression?.text ?: return
        if (calleeText != "currentTimeMillis") return

        val parent = expression.parent
        if (parent is KtDotQualifiedExpression) {
            val receiverText = parent.receiverExpression.text
            if (receiverText == "System") {
                report(
                    Finding(
                        Entity.from(parent),
                        "System.currentTimeMillis() is not available in commonMain. " +
                            "Use Clock.System.now().toEpochMilliseconds() and inject Clock for testability."
                    )
                )
            }
        }
    }
}
