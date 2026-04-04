package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtBinaryExpression
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtValueArgument
import org.jetbrains.kotlin.psi.psiUtil.getParentOfType

/**
 * Flags UnconfinedTestDispatcher() passed as a constructor argument to
 * a class under test.
 *
 * UnconfinedTestDispatcher eagerly executes coroutines and skips delay(),
 * which masks timing bugs when injected into the class under test.
 * Use StandardTestDispatcher (the default in runTest) for the class under
 * test, and UnconfinedTestDispatcher only for backgroundScope collectors.
 *
 * Allowed:
 * - backgroundScope + UnconfinedTestDispatcher()
 * - backgroundScope.launch(UnconfinedTestDispatcher()) { ... }
 */
class NoUnconfinedTestDispatcherForClassScopeRule(config: Config) : Rule(
    config,
    "UnconfinedTestDispatcher must not be injected into the class under test — use StandardTestDispatcher instead"
) {
    override fun visitCallExpression(expression: KtCallExpression) {
        super.visitCallExpression(expression)

        if (expression.calleeExpression?.text != "UnconfinedTestDispatcher") return

        // Check parent chain to determine context
        val parent = expression.parent ?: return

        // ALLOW: binary + expression (backgroundScope + UnconfinedTestDispatcher())
        if (parent is KtBinaryExpression || parent.parent is KtBinaryExpression) return

        // Check if inside a KtValueArgument (i.e., passed as argument to something)
        val valueArg = expression.getParentOfType<KtValueArgument>(strict = false)
        if (valueArg != null) {
            // Find the enclosing call expression that this argument belongs to
            val enclosingCall = valueArg.getParentOfType<KtCallExpression>(strict = true)
            if (enclosingCall != null) {
                val calleeName = enclosingCall.calleeExpression?.text ?: ""
                // ALLOW: launch(UnconfinedTestDispatcher()), async(UnconfinedTestDispatcher())
                if (calleeName == "launch" || calleeName == "async") return

                // FLAG: any other call — this is class construction
                report(
                    Finding(
                        Entity.from(expression),
                        "UnconfinedTestDispatcher() passed as argument to '$calleeName'. " +
                            "UnconfinedTestDispatcher skips delay() and eagerly executes — " +
                            "do not inject into the class under test. " +
                            "Use StandardTestDispatcher (runTest default) for the class under test; " +
                            "reserve UnconfinedTestDispatcher for backgroundScope collectors."
                    )
                )
            }
        }
    }
}
