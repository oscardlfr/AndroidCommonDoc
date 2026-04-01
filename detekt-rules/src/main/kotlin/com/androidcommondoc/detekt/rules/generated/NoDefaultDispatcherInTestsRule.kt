package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression

class NoDefaultDispatcherInTestsRule(config: Config) : Rule(
    config,
    "Tests must inject TestDispatcher; never use Dispatchers.Default directly"
) {
    override fun visitDotQualifiedExpression(expression: KtDotQualifiedExpression) {
        super.visitDotQualifiedExpression(expression)
        if (expression.text == "Dispatchers.Default") {
            report(
                Finding(
                    Entity.from(expression),
                    "Tests must inject TestDispatcher; never use Dispatchers.Default directly. Use injected testDispatcher parameter instead."
                )
            )
        }
    }
}
