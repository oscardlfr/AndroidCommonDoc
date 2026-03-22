package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.api.Entity
import dev.detekt.api.Finding
import dev.detekt.api.Rule
import org.jetbrains.kotlin.psi.KtProperty
import org.jetbrains.kotlin.psi.KtStringTemplateExpression

/**
 * Flags hardcoded string literals assigned to variables whose names
 * suggest they contain credentials: password, secret, key, token.
 *
 * Only triggers when:
 * - Variable name matches credential patterns (case-insensitive)
 * - Value is a string literal (not a function call or reference)
 * - Value length >= 6 characters (avoids placeholder values like "key")
 *
 * Ignores test source sets.
 */
class NoHardcodedCredentialsRule(config: Config) : Rule(
    config,
    "Hardcoded credential detected. Store secrets in environment variables, " +
        "system keystore, or encrypted configuration — never in source code."
) {

    private val credentialPatterns = listOf(
        Regex("(?i).*(password|passwd|pwd).*"),
        Regex("(?i).*(secret[_-]?key|api[_-]?key|auth[_-]?key).*"),
        Regex("(?i).*(keystore[_-]?password|master[_-]?key).*"),
        Regex("(?i).*(bearer[_-]?token|access[_-]?token|refresh[_-]?token).*"),
    )

    override fun visitProperty(property: KtProperty) {
        super.visitProperty(property)

        val name = property.name ?: return
        if (credentialPatterns.none { it.matches(name) }) return

        // Check if initializer is a string literal
        val initializer = property.initializer ?: return
        if (initializer is KtStringTemplateExpression && !initializer.hasInterpolation()) {
            val value = initializer.entries.joinToString("") { it.text }
            if (value.length >= 6) {
                report(
                    Finding(
                        Entity.from(property),
                        "Variable '$name' contains a hardcoded credential value. " +
                            "Move to environment variable or system keystore."
                    )
                )
            }
        }
    }
}
