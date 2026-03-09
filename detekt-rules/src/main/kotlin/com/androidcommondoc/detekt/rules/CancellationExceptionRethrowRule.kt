package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCatchClause
import org.jetbrains.kotlin.psi.KtThrowExpression
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType

class CancellationExceptionRethrowRule(config: Config) : Rule(
    config,
    "CancellationException must always be rethrown in catch blocks"
) {

    private val targetExceptionTypes = setOf("CancellationException", "Exception", "Throwable")

    override fun visitCatchSection(catchClause: KtCatchClause) {
        super.visitCatchSection(catchClause)

        val caughtType = catchClause.catchParameter?.typeReference?.text ?: return

        if (caughtType !in targetExceptionTypes) return

        val body = catchClause.catchBody ?: run {
            reportFinding(catchClause, caughtType)
            return
        }

        val hasThrow = body.collectDescendantsOfType<KtThrowExpression>().isNotEmpty()

        if (!hasThrow) {
            reportFinding(catchClause, caughtType)
        }
    }

    private fun reportFinding(catchClause: KtCatchClause, caughtType: String) {
        val message = if (caughtType == "CancellationException") {
            "CancellationException is caught but not rethrown. " +
                "Always rethrow CancellationException to support coroutine cancellation."
        } else {
            "Catching '$caughtType' without rethrowing may swallow CancellationException. " +
                "Ensure CancellationException is rethrown to support coroutine cancellation."
        }
        report(Finding(Entity.from(catchClause), message))
    }
}
