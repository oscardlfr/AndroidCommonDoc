package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoChannelForUiEventsRuleTest {
    private val rule = NoChannelForUiEventsRule(Config.empty)

    @Test
    fun `reports Channel usage in ViewModel`() {
        val code = """
            import kotlinx.coroutines.channels.Channel
            import androidx.lifecycle.ViewModel

            class HomeViewModel : ViewModel() {
                val events = Channel<UiEvent>()
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("MutableSharedFlow")
    }

    @Test
    fun `reports private Channel usage in ViewModel`() {
        val code = """
            import kotlinx.coroutines.channels.Channel
            import androidx.lifecycle.ViewModel

            class SettingsViewModel : ViewModel() {
                private val _events = Channel<String>(Channel.BUFFERED)
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `accepts MutableSharedFlow in ViewModel`() {
        val code = """
            import kotlinx.coroutines.flow.MutableSharedFlow
            import androidx.lifecycle.ViewModel

            class HomeViewModel : ViewModel() {
                val events = MutableSharedFlow<UiEvent>()
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `ignores Channel in non-ViewModel file`() {
        val code = """
            import kotlinx.coroutines.channels.Channel

            class MessageBus {
                val channel = Channel<Message>()
            }
        """.trimIndent()

        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
