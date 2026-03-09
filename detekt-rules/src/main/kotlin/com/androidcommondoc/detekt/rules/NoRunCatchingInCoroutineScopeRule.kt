package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType

/**
 * Flags use of `runCatching` inside ViewModel classes.
 *
 * `runCatching` wraps its block in `try/catch(Throwable)` which silently swallows
 * `CancellationException`. In a ViewModel coroutine scope this breaks structured
 * concurrency — the coroutine will not be cancelled when the ViewModel is cleared.
 *
 * Use an explicit try/catch with CancellationException rethrow, or wrap only at
 * the repository/use-case boundary where CancellationException cannot occur.
 */
class NoRunCatchingInCoroutineScopeRule(config: Config) : Rule(
    config,
    "runCatching swallows CancellationException — do not use inside ViewModel or coroutine scope"
) {
    override fun visitClass(klass: KtClass) {
        super.visitClass(klass)

        if (!klass.superTypeListEntries.any { it.text.contains("ViewModel") }) return

        val callExpressions = klass.collectDescendantsOfType<KtCallExpression>()
        for (call in callExpressions) {
            if (call.calleeExpression?.text == "runCatching") {
                report(
                    Finding(
                        Entity.from(call),
                        "runCatching() in ViewModel '${klass.name}' swallows CancellationException. " +
                            "Use explicit try/catch and always rethrow CancellationException, " +
                            "or move runCatching to a non-coroutine boundary."
                    )
                )
            }
        }
    }
}
