package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType

/**
 * Flags test functions that call startObserving() without a corresponding
 * advanceUntilIdle() or runCurrent() call.
 *
 * Classes that launch internal collectors via startObserving() need the
 * test scheduler to run before assertions can observe their effects.
 * Forgetting advanceUntilIdle() leads to tests that assert against stale
 * initial state and pass incorrectly.
 *
 * Only applies to functions annotated with @Test.
 *
 * Simplified: checks co-occurrence only, not ordering.
 */
class RequireAdvanceUntilIdleAfterStartObservingRule(config: Config) : Rule(
    config,
    "startObserving() in test requires advanceUntilIdle() or runCurrent() to process launched collectors"
) {
    private val triggerMethods = setOf("startObserving")
    private val schedulerAdvanceMethods = setOf("advanceUntilIdle", "runCurrent")

    override fun visitNamedFunction(function: KtNamedFunction) {
        super.visitNamedFunction(function)

        // Only check @Test functions
        val hasTestAnnotation = function.annotationEntries.any { annotation ->
            annotation.shortName?.asString() == "Test"
        }
        if (!hasTestAnnotation) return

        val body = function.bodyBlockExpression ?: return

        val calls = body.collectDescendantsOfType<KtCallExpression>()
        val callNames = calls.mapNotNull { it.calleeExpression?.text }.toSet()

        // Check if any trigger method is called
        val hasTrigger = callNames.any { it in triggerMethods }
        if (!hasTrigger) return

        // Check if any scheduler advance method is called
        val hasAdvance = callNames.any { it in schedulerAdvanceMethods }
        if (hasAdvance) return

        // Find the startObserving call for precise location
        val triggerCall = calls.first { it.calleeExpression?.text in triggerMethods }

        report(
            Finding(
                Entity.from(triggerCall),
                "Test '${function.name}' calls startObserving() but never calls " +
                    "advanceUntilIdle() or runCurrent(). Classes that launch internal " +
                    "collectors need the scheduler to run before assertions can observe " +
                    "their effects. Add advanceUntilIdle() after startObserving()."
            )
        )
    }
}
