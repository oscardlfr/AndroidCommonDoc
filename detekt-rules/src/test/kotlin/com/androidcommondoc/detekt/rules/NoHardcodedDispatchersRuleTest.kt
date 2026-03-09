package com.androidcommondoc.detekt.rules

import dev.detekt.api.Config
import dev.detekt.test.lint
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class NoHardcodedDispatchersRuleTest {
    private val rule = NoHardcodedDispatchersRule(Config.empty)

    @Test
    fun `reports Dispatchers-IO in ViewModel`() {
        val code = """
            class SyncViewModel : ViewModel() {
                fun sync() {
                    viewModelScope.launch(Dispatchers.IO) { doSync() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("Dispatchers.IO")
    }

    @Test
    fun `reports Dispatchers-Main in ViewModel`() {
        val code = """
            class HomeViewModel : ViewModel() {
                fun update() {
                    withContext(Dispatchers.Main) { updateUi() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
    }

    @Test
    fun `reports Dispatchers-Default in UseCase`() {
        val code = """
            class ProcessDataUseCase {
                suspend operator fun invoke() = withContext(Dispatchers.Default) {
                    heavyComputation()
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).hasSize(1)
        assertThat(findings[0].message).contains("Dispatchers.Default")
    }

    @Test
    fun `accepts injected dispatcher in ViewModel`() {
        val code = """
            class SyncViewModel(
                private val dispatchers: CoroutineDispatchers
            ) : ViewModel() {
                fun sync() {
                    viewModelScope.launch(dispatchers.io) { doSync() }
                }
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }

    @Test
    fun `accepts Dispatchers in non-ViewModel non-UseCase class`() {
        val code = """
            class AppModule {
                fun provideIO(): CoroutineDispatcher = Dispatchers.IO
            }
        """.trimIndent()
        val findings = rule.lint(code)
        assertThat(findings).isEmpty()
    }
}
