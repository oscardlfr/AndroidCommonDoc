package com.androidcommondoc.detekt.rules.generated

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoPlatformStorageInCommonRuleTest {
    private val rule = NoPlatformStorageInCommonRule(Config.empty)

    @Test
    fun `reports violating code`() {
        val code = """
            import android.content.SharedPreferences
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts compliant code`() {
        val code = """
            import expect/actual + multiplatform-settings / SQLDelight
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}