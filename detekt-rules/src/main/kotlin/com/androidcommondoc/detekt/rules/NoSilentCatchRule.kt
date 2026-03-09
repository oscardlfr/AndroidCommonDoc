package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCatchClause
import org.jetbrains.kotlin.psi.KtThrowExpression
import org.jetbrains.kotlin.psi.psiUtil.collectDescendantsOfType

/**
 * Flags `catch(e: Exception)` and `catch(e: Throwable)` blocks that do not
 * contain any throw or rethrow statement.
 *
 * Silent exception swallowing hides bugs and makes debugging very difficult.
 * The minimum safe pattern is to log and rethrow. For `CancellationException`
 * specifically, swallowing it breaks coroutine structured concurrency — see
 * `CancellationExceptionRethrowRule` for that specific case.
 *
 * This rule is complementary — it catches broader silent-catch patterns.
 *
 * Allowed: catch blocks that contain at least one `throw` expression.
 * Flagged: catch blocks for Exception/Throwable/RuntimeException with no rethrow.
 */
class NoSilentCatchRule(config: Config) : Rule(
    config,
    "Silent catch block swallows exceptions without rethrowing — at minimum log and rethrow"
) {
    private val broadCatchTypes = setOf(
        "Exception",
        "Throwable",
        "RuntimeException",
        "Error",
    )

    override fun visitCatchSection(catchClause: KtCatchClause) {
        super.visitCatchSection(catchClause)

        val caughtType = catchClause.catchParameter?.typeReference?.text ?: return
        if (caughtType !in broadCatchTypes) return

        val body = catchClause.catchBody ?: run {
            // Empty catch body — definitely silent
            reportFinding(catchClause, caughtType)
            return
        }

        val hasThrow = body.collectDescendantsOfType<KtThrowExpression>().isNotEmpty()
        if (!hasThrow) {
            reportFinding(catchClause, caughtType)
        }
    }

    private fun reportFinding(catchClause: KtCatchClause, caughtType: String) {
        report(
            Finding(
                Entity.from(catchClause),
                "catch($caughtType) block does not rethrow. " +
                    "Silent catches hide bugs and swallow CancellationException. " +
                    "At minimum: log the error and rethrow, or convert to a typed Result."
            )
        )
    }
}
