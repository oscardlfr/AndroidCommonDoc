package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtCallExpression
import org.jetbrains.kotlin.psi.KtDotQualifiedExpression

class WhileSubscribedTimeoutRule(config: Config) : Rule(
    config,
    "SharingStarted.WhileSubscribed must specify a non-zero timeout"
) {

    override fun visitCallExpression(callExpression: KtCallExpression) {
        super.visitCallExpression(callExpression)

        val calleeText = callExpression.calleeExpression?.text ?: return

        if (calleeText != "WhileSubscribed") return

        // Verify it's SharingStarted.WhileSubscribed
        val parent = callExpression.parent
        if (parent is KtDotQualifiedExpression) {
            val receiverText = parent.receiverExpression.text
            if (receiverText != "SharingStarted") return
        }

        val args = callExpression.valueArguments

        if (args.isEmpty()) {
            report(
                Finding(
                    Entity.from(callExpression),
                    "WhileSubscribed() called without a timeout parameter. " +
                        "Use WhileSubscribed(5_000) to keep the upstream active for 5 seconds after the last subscriber."
                )
            )
            return
        }

        // Check first argument (stopTimeoutMillis)
        val firstArg = args[0].getArgumentExpression()?.text ?: return
        val normalizedArg = firstArg.replace("_", "")

        if (normalizedArg == "0" || normalizedArg == "0L") {
            report(
                Finding(
                    Entity.from(callExpression),
                    "WhileSubscribed(0) cancels upstream immediately on last unsubscribe. " +
                        "Use WhileSubscribed(5_000) to avoid restarting upstream on configuration changes."
                )
            )
        }
    }
}
