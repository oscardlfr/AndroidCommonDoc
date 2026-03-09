package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class SealedUiStateRuleTest {
    private val rule = SealedUiStateRule(Config.empty)

    @Test
    fun `reports data class ending in UiState`() {
        val code = """
            data class HomeUiState(val isLoading: Boolean)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("sealed")
    }

    @Test
    fun `reports plain class ending in UiState`() {
        val code = """
            class SettingsUiState
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `reports abstract class ending in UiState`() {
        val code = """
            abstract class ProfileUiState
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts sealed interface UiState`() {
        val code = """
            sealed interface HomeUiState {
                data object Loading : HomeUiState
                data class Success(val items: List<String>) : HomeUiState
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts sealed class UiState`() {
        val code = """
            sealed class HomeUiState
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores non-UiState data class`() {
        val code = """
            data class UserProfile(val name: String)
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
