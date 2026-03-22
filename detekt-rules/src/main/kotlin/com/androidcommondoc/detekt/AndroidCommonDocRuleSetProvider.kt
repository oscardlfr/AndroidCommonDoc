package com.androidcommondoc.detekt

import com.androidcommondoc.detekt.rules.CancellationExceptionRethrowRule
import com.androidcommondoc.detekt.rules.MutableStateFlowExposedRule
import com.androidcommondoc.detekt.rules.NoChannelForUiEventsRule
import com.androidcommondoc.detekt.rules.NoChannelForNavigationRule
import com.androidcommondoc.detekt.rules.NoHardcodedCredentialsRule
import com.androidcommondoc.detekt.rules.NoHardcodedDispatchersRule
import com.androidcommondoc.detekt.rules.NoHardcodedStringsInViewModelRule
import com.androidcommondoc.detekt.rules.NoJavaTimeInCommonMainRule
import com.androidcommondoc.detekt.rules.NoLaunchInInitRule
import com.androidcommondoc.detekt.rules.NoMagicNumbersInUseCaseRule
import com.androidcommondoc.detekt.rules.NoPlatformDepsInViewModelRule
import com.androidcommondoc.detekt.rules.NoRunCatchingInCoroutineScopeRule
import com.androidcommondoc.detekt.rules.NoSilentCatchRule
import com.androidcommondoc.detekt.rules.NoSystemCurrentTimeMillisRule
import com.androidcommondoc.detekt.rules.NoTurbineRule
import com.androidcommondoc.detekt.rules.PreferKotlinTimeClockRule
import com.androidcommondoc.detekt.rules.RequireRunCatchingCancellableRule
import com.androidcommondoc.detekt.rules.SealedUiStateRule
import com.androidcommondoc.detekt.rules.WhileSubscribedTimeoutRule
import dev.detekt.api.RuleSet
import dev.detekt.api.RuleSetId
import dev.detekt.api.RuleSetProvider

class AndroidCommonDocRuleSetProvider : RuleSetProvider {
    override val ruleSetId = RuleSetId("AndroidCommonDoc")

    override fun instance(): RuleSet = RuleSet(
        ruleSetId,
        listOf(
            // ── UiState & StateFlow ─────────────────────────────────────────
            ::SealedUiStateRule,
            ::WhileSubscribedTimeoutRule,
            ::MutableStateFlowExposedRule,
            // ── Coroutine safety ────────────────────────────────────────────
            ::CancellationExceptionRethrowRule,
            ::NoRunCatchingInCoroutineScopeRule,
            ::NoLaunchInInitRule,
            ::NoSilentCatchRule,
            // ── ViewModel boundaries ─────────────────────────────────────────
            ::NoPlatformDepsInViewModelRule,
            ::NoHardcodedDispatchersRule,
            ::NoHardcodedStringsInViewModelRule,
            // ── Events & navigation ──────────────────────────────────────────
            ::NoChannelForUiEventsRule,
            ::NoChannelForNavigationRule,
            // ── Business logic ───────────────────────────────────────────────
            ::NoMagicNumbersInUseCaseRule,
            // ── KMP / time safety ───────────────────────────────────────────────
            ::PreferKotlinTimeClockRule,
            ::NoSystemCurrentTimeMillisRule,
            ::NoJavaTimeInCommonMainRule,
            // ── Testing patterns ────────────────────────────────────────────────
            ::NoTurbineRule,
            // ── Security ────────────────────────────────────────────────────────
            ::NoHardcodedCredentialsRule,
            ::RequireRunCatchingCancellableRule,
        )
    )
}
