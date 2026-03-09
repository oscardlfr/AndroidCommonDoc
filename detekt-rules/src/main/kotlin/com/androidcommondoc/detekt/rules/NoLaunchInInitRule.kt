package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtAnonymousInitializer
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType

/**
 * Flags `launch { }` calls inside `init { }` blocks.
 *
 * Launching coroutines from `init {}` is dangerous because:
 * 1. The coroutine scope may outlive the object if the owner is cancelled
 *    before initialization completes.
 * 2. In ViewModels, `viewModelScope` is ready but init-launched coroutines
 *    can silently race with subclass initialization.
 * 3. In tests, init-launched coroutines are hard to control.
 *
 * Instead, use a dedicated `initialize()` or `load()` function, or trigger
 * loading from the UI layer via a one-time event in `LaunchedEffect`.
 */
class NoLaunchInInitRule(config: Config) : Rule(
    config,
    "launch {} inside init {} is dangerous — move to a named function called by the UI"
) {
    override fun visitAnonymousInitializer(initializer: KtAnonymousInitializer) {
        super.visitAnonymousInitializer(initializer)

        val launchCalls = initializer.collectDescendantsOfType<KtCallExpression>()
        for (call in launchCalls) {
            val callee = call.calleeExpression?.text ?: continue
            if (callee == "launch" || callee == "viewModelScope.launch") {
                report(
                    Finding(
                        Entity.from(call),
                        "launch {} inside init {} block. " +
                            "Coroutines launched from init{} are hard to test and may race with " +
                            "subclass initialization. Move to a named function (e.g. load(), initialize()) " +
                            "and call it from the UI layer via LaunchedEffect or similar."
                    )
                )
            }
        }
    }
}
