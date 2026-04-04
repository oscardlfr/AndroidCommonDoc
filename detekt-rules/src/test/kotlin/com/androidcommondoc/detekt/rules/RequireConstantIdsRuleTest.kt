package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class RequireConstantIdsRuleTest {
    private val rule = RequireConstantIdsRule(Config.empty)

    @Test
    fun `flags string literal as id argument`() {
        val code = """
            fun create() {
                Preference(id = "nudge_banner", title = "Nudge")
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("constant")
    }

    @Test
    fun `flags string literal id in any class`() {
        val code = """
            fun build() {
                Component(id = "header-section", type = "banner")
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts constant reference as id`() {
        val code = """
            fun create() {
                Preference(id = PreferenceIds.NUDGE_BANNER, title = "Nudge")
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts enum as id`() {
        val code = """
            fun create() {
                Component(id = ComponentId.NUDGE_BANNER, type = "banner")
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts variable reference as id`() {
        val code = """
            fun create(myId: String) {
                Preference(id = myId, title = "Nudge")
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts empty string as id`() {
        val code = """
            fun create() {
                Preference(id = "", title = "Default")
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores non-id named arguments with string literals`() {
        val code = """
            fun create() {
                Preference(id = PreferenceIds.X, title = "My Title")
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `flags multiple string literal ids`() {
        val code = """
            fun create() {
                Preference(id = "pref_one", title = "One")
                Preference(id = "pref_two", title = "Two")
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(2)
    }
}
