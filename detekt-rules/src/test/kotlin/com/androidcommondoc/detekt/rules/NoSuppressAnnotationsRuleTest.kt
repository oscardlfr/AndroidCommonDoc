package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.TestConfig
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoSuppressAnnotationsRuleTest {
    private val rule = NoSuppressAnnotationsRule(Config.empty)

    @Test
    fun `flags Suppress with non-allowed reason`() {
        val code = """
            @Suppress("Filename")
            fun process() {}
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("not in the allowlist")
    }

    @Test
    fun `flags SuppressWarnings with non-allowed reason`() {
        val code = """
            @SuppressWarnings("warnings")
            class LegacyHelper
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `flags file-level Suppress with non-allowed reason`() {
        val code = """
            @file:Suppress("ktlint:standard:no-wildcard-imports")
            package com.example
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `allows UNCHECKED_CAST (default allowlist)`() {
        val code = """
            @Suppress("UNCHECKED_CAST")
            fun process(items: List<*>): List<String> = items as List<String>
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `allows DEPRECATION (default allowlist)`() {
        val code = """
            @Suppress("DEPRECATION")
            fun useLegacy() { oldMethod() }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `allows unused (default allowlist)`() {
        val code = """
            @Suppress("unused")
            actual fun platformInit() {}
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `flags when one of multiple reasons is not allowed`() {
        val code = """
            @Suppress("UNCHECKED_CAST", "Filename")
            fun process() {}
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("Filename")
    }

    @Test
    fun `allows multiple reasons all in allowlist`() {
        val code = """
            @Suppress("UNCHECKED_CAST", "DEPRECATION")
            fun process() {}
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `does not flag other annotations`() {
        val code = """
            import kotlinx.serialization.Serializable

            @Serializable
            data class User(val name: String)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `custom allowlist via config`() {
        val config = TestConfig("allowedSuppressions" to listOf("MagicNumber"))
        val customRule = NoSuppressAnnotationsRule(config)

        val allowed = """
            @Suppress("MagicNumber")
            val x = 42
        """.trimIndent()
        assertThat(customRule.lint(allowed)).isEmpty()

        val blocked = """
            @Suppress("UNCHECKED_CAST")
            fun f() {}
        """.trimIndent()
        assertThat(customRule.lint(blocked)).hasSize(1)
    }
}
