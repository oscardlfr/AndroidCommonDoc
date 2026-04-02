package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtAnnotationEntry

/**
 * Blocks @Suppress and @SuppressWarnings unless the suppressed warning
 * is in the configured allowlist.
 *
 * Default allowlist covers legitimate KMP interop suppressions
 * (UNCHECKED_CAST, unused stubs, K/Native init patterns).
 * Projects can extend via detekt.yml:
 *
 * ```yaml
 * AndroidCommonDoc:
 *   NoSuppressAnnotationsRule:
 *     active: true
 *     allowedSuppressions:
 *       - UNCHECKED_CAST
 *       - unused
 * ```
 */
class NoSuppressAnnotationsRule(config: Config) : Rule(
    config,
    "@Suppress annotations hide warnings instead of fixing them"
) {
    @Suppress("UNCHECKED_CAST")
    private val allowedSuppressions: Set<String> = (config.valueOrDefault(
        "allowedSuppressions",
        DEFAULT_ALLOWED
    ) as? List<*>)
        ?.map { it.toString() }
        ?.toSet()
        ?: DEFAULT_ALLOWED.toSet()

    override fun visitAnnotationEntry(annotationEntry: KtAnnotationEntry) {
        super.visitAnnotationEntry(annotationEntry)
        val name = annotationEntry.shortName?.asString() ?: return

        if (name != "Suppress" && name != "SuppressWarnings") return

        val arguments = annotationEntry.valueArguments
        if (arguments.isEmpty()) {
            report(finding(annotationEntry, "empty @Suppress"))
            return
        }

        for (arg in arguments) {
            val suppressionName = extractStringValue(arg) ?: continue
            if (suppressionName !in allowedSuppressions) {
                report(finding(annotationEntry,
                    "@Suppress(\"$suppressionName\") is not in the allowlist. " +
                    "Fix the underlying warning instead of suppressing it. " +
                    "Allowed: ${allowedSuppressions.sorted().joinToString()}"
                ))
                return
            }
        }
    }

    private fun extractStringValue(arg: org.jetbrains.kotlin.psi.ValueArgument): String? {
        val expr = arg.getArgumentExpression() ?: return null
        val text = expr.text
        return text.removeSurrounding("\"")
    }

    private fun finding(element: KtAnnotationEntry, detail: String) = Finding(
        Entity.from(element),
        detail
    )

    companion object {
        private val DEFAULT_ALLOWED = listOf(
            "UNCHECKED_CAST",
            "USELESS_CAST",
            "USELESS_IS_CHECK",
            "unused",
            "UNUSED_PARAMETER",
            "DEPRECATION",
            "OPT_IN_USAGE",
            "EagerInitialization",
        )
    }
}
