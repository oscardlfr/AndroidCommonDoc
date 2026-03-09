package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType

/**
 * Flags hardcoded `Dispatchers.Main`, `Dispatchers.IO`, or `Dispatchers.Default`
 * inside ViewModel classes and classes ending in `UseCase`.
 *
 * Hardcoded dispatchers make unit tests flaky and require MainDispatcherRule or
 * similar workarounds. Dispatchers should be injected via constructor parameter
 * (typically a `CoroutineDispatchers` interface) so tests can substitute a
 * `TestCoroutineDispatcher`.
 */
class NoHardcodedDispatchersRule(config: Config) : Rule(
    config,
    "Dispatchers must be injected, not hardcoded in ViewModels or UseCases"
) {
    private val hardcodedDispatchers = setOf("Main", "IO", "Default", "Unconfined")

    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)

        val name = klass.name ?: return
        val isViewModel = klass.superTypeListEntries.any { it.text.contains("ViewModel") }
        val isUseCase = name.endsWith("UseCase")

        if (!isViewModel && !isUseCase) return

        val dotExpressions = klass.collectDescendantsOfType<KtDotQualifiedExpression>()
        for (expr in dotExpressions) {
            val receiver = expr.receiverExpression.text
            val selector = expr.selectorExpression?.text ?: continue

            if (receiver == "Dispatchers" && selector in hardcodedDispatchers) {
                report(
                    Finding(
                        Entity.from(expr),
                        "Hardcoded Dispatchers.$selector in '${name}'. " +
                            "Inject dispatchers via a CoroutineDispatchers interface or constructor parameter " +
                            "so tests can substitute a TestCoroutineDispatcher."
                    )
                )
            }
        }
    }
}
