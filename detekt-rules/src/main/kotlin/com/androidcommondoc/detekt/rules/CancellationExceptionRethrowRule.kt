package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtCatchClause
import org.jetbrains.kotlin.psi.KtThrowExpression
import org.jetbrains.kotlin.psi.KtTryExpression
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

        // Condition (i): any throw expression anywhere in the catch body — applies to all clause types
        val hasThrow = body.collectDescendantsOfType<KtThrowExpression>().isNotEmpty()
        if (hasThrow) return

        // Conditions (ii) and (iii) apply ONLY to Exception/Throwable clauses (STRICT ruling)
        if (caughtType == "Exception" || caughtType == "Throwable") {
            // Condition (ii): catch body contains a call to ensureActive()
            val hasEnsureActive = body.collectDescendantsOfType<KtCallExpression>()
                .any { it.calleeExpression?.text == "ensureActive" }
            if (hasEnsureActive) return

            // Condition (iii): a PRECEDING sibling catch clause catches CancellationException and rethrows it
            val tryExpr = catchClause.parent as? KtTryExpression
            if (tryExpr != null) {
                val thisCatchIndex = tryExpr.catchClauses.indexOf(catchClause)
                val hasPriorCERethrow = tryExpr.catchClauses
                    .take(thisCatchIndex)
                    .any { sibling ->
                        sibling.catchParameter?.typeReference?.text == "CancellationException" &&
                            sibling.catchBody
                                ?.collectDescendantsOfType<KtThrowExpression>()
                                ?.isNotEmpty() == true
                    }
                if (hasPriorCERethrow) return
            }
        }

        reportFinding(catchClause, caughtType)
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
