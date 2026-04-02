package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoCustomCryptoRuleTest {
    private val rule = NoCustomCryptoRule(Config.empty)

    @Test
    fun `reports violating code`() {
        val code = """
            import javax.crypto.spec
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts compliant code`() {
        val code = """
            import Platform KeyStore/Keychain
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}