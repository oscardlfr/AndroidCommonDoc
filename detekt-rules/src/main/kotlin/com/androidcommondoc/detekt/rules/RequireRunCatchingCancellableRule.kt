package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCatchClause
import org.jetbrains.kotlin.psi.KtImportDirective
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.lexer.KtTokens

/**
 * Flags `try/catch(Exception)` in suspend functions.
 *
 * Catching generic `Exception` in a suspend function risks swallowing
 * `CancellationException`, which breaks structured concurrency.
 * Use specific exception types, or rethrow CancellationException explicitly.
 *
 * Skips files that already import `CancellationException` (assumes correct handling).
 * Skips test source sets.
 */
class RequireRunCatchingCancellableRule(config: Config) : Rule(
    config,
    "Catching generic Exception in suspend function may swallow CancellationException. " +
        "Use runCatching with CancellationException rethrow, or catch specific types."
) {

    private var fileImportsCancellationException = false

    override fun visitImportDirective(importDirective: KtImportDirective) {
        super.visitImportDirective(importDirective)
        val importPath = importDirective.importPath?.pathStr ?: return
        if (importPath.endsWith("CancellationException")) {
            fileImportsCancellationException = true
        }
    }

    override fun visitCatchSection(catchClause: KtCatchClause) {
        super.visitCatchSection(catchClause)

        if (fileImportsCancellationException) return

        val catchType = catchClause.catchParameter?.typeReference?.text ?: return
        if (catchType != "Exception") return

        val enclosingFunction = findEnclosingSuspendFunction(catchClause) ?: return

        report(
            Finding(
                Entity.from(catchClause),
                "catch(Exception) in suspend function '${enclosingFunction.name}' " +
                    "may swallow CancellationException. " +
                    "Either catch specific exception types, or rethrow CancellationException explicitly."
            )
        )
    }

    private fun findEnclosingSuspendFunction(element: KtCatchClause): KtNamedFunction? {
        var current = element.parent
        while (current != null) {
            if (current is KtNamedFunction) {
                return if (current.hasModifier(KtTokens.SUSPEND_KEYWORD)) current else null
            }
            current = current.parent
        }
        return null
    }
}
