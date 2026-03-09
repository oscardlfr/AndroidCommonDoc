package com.androidcommondoc.konsist

import com.androidcommondoc.konsist.support.ScopeFactory
import com.lemonappdev.konsist.api.architecture.KoArchitectureCreator
import com.lemonappdev.konsist.api.architecture.Layer
import com.lemonappdev.konsist.core.exception.KoAssertionFailedException
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * Architecture enforcement tests covering KONS-02 (5-layer architecture) and
 * KONS-04 (cross-file structural checks: layer import violations + module isolation).
 *
 * Uses fixture files in src/test/resources/fixtures/layer-violation/ to demonstrate
 * that Konsist detects layer boundary violations that Detekt's single-file analysis cannot.
 *
 * Also validates real toolkit code: detekt-rules and build-logic modules must remain
 * isolated from each other (separate Gradle modules with independent classpaths).
 */
class ArchitectureTest {

    // 5-layer architecture definition matching standard Android/KMP conventions.
    // Each layer maps to a package hierarchy used in the fixture files.
    private val ui = Layer("UI", "com.example.ui..")
    private val viewModel = Layer("ViewModel", "com.example.viewmodel..")
    private val domain = Layer("Domain", "com.example.domain..")
    private val data = Layer("Data", "com.example.data..")
    private val model = Layer("Model", "com.example.model..")

    // --- Fixture-based architecture violation detection (KONS-02) ---

    @Test
    fun `fixture with data-imports-ui violation is detected by assertArchitecture`() {
        val fixtureScope = ScopeFactory.fixtureScope("layer-violation")

        // assertArchitecture MUST fail because DataImportsUi.kt imports com.example.ui
        // from the Data layer, which is not allowed (Data depends only on Domain).
        // Konsist throws KoAssertionFailedException (not standard AssertionError).
        val error = assertThrows<KoAssertionFailedException> {
            with(KoArchitectureCreator) {
                fixtureScope.assertArchitecture {
                    ui.dependsOn(viewModel)
                    viewModel.dependsOn(domain)
                    data.dependsOn(domain)
                    domain.dependsOnNothing()
                    model.dependsOnNothing()
                }
            }
        }

        assertThat(error.message)
            .describedAs(
                "Error message should identify the Data layer violation. " +
                    "DataImportsUi.kt imports com.example.ui from com.example.data, " +
                    "which violates the rule that Data depends only on Domain."
            )
            .containsIgnoringCase("data")
    }

    @Test
    fun `fixture with model-imports-domain violation is detected`() {
        val fixtureScope = ScopeFactory.fixtureScope("layer-violation")

        // assertArchitecture MUST fail because ModelImportsDomain.kt imports
        // com.example.domain from the Model layer, which should depend on nothing.
        val error = assertThrows<KoAssertionFailedException> {
            with(KoArchitectureCreator) {
                fixtureScope.assertArchitecture {
                    ui.dependsOn(viewModel)
                    viewModel.dependsOn(domain)
                    data.dependsOn(domain)
                    domain.dependsOnNothing()
                    model.dependsOnNothing()
                }
            }
        }

        assertThat(error.message)
            .describedAs(
                "Error message should identify the Model layer violation. " +
                    "ModelImportsDomain.kt imports com.example.domain from com.example.model, " +
                    "which violates the rule that Model depends on nothing."
            )
            .containsIgnoringCase("model")
    }

    @Test
    fun `5-layer architecture rules pass when no violations exist`() {
        // Use the full fixture scope but only assert on files that follow the rules.
        // ValidDataLayer.kt, UiScreen.kt, DomainUseCase.kt, ViewModelStub.kt all follow
        // the 5-layer architecture rules.
        // We exclude the violation fixture files to create a clean architecture scope.
        val fixtureScope = ScopeFactory.fixtureScope("layer-violation")

        val validScope = fixtureScope.slice { file ->
            file.name != "DataImportsUi" && file.name != "ModelImportsDomain"
        }

        require(validScope.files.isNotEmpty()) {
            "Canary: valid-only scope is empty. Expected at least ValidDataLayer.kt"
        }

        // This should pass: all remaining files follow the architecture rules.
        // ValidDataLayer.kt imports Domain from Data -- allowed.
        // UiScreen.kt, DomainUseCase.kt, ViewModelStub.kt have no cross-layer imports.
        with(KoArchitectureCreator) {
            validScope.assertArchitecture {
                ui.dependsOn(viewModel)
                viewModel.dependsOn(domain)
                data.dependsOn(domain)
                domain.dependsOnNothing()
                model.dependsOnNothing()
            }
        }

        // Architecture rules documented as executable code:
        // UI -> ViewModel
        // ViewModel -> Domain
        // Data -> Domain
        // Domain -> nothing
        // Model -> nothing
    }

    // --- Real-code module isolation checks (KONS-04) ---

    @Test
    fun `detekt-rules and build-logic modules are isolated from each other`() {
        // KONS-04: Cross-file module isolation check on real toolkit code.
        // These are separate Gradle modules and must not cross-import.

        // Check 1: detekt-rules must not import build-logic packages
        val detektFiles = ScopeFactory.detektRulesScope().files
        detektFiles.forEach { file ->
            val buildLogicImports = file.imports.filter { imp ->
                imp.name.startsWith("com.androidcommondoc.gradle")
            }
            assertThat(buildLogicImports)
                .withFailMessage {
                    "detekt-rules file '${file.name}' imports build-logic packages: " +
                        "${buildLogicImports.map { it.name }}. " +
                        "These are separate Gradle modules with independent classpaths. " +
                        "Remove the cross-module imports."
                }
                .isEmpty()
        }

        // Check 2: build-logic must not import detekt rule implementations
        val buildLogicFiles = ScopeFactory.buildLogicScope().files
        buildLogicFiles.forEach { file ->
            val detektImports = file.imports.filter { imp ->
                imp.name.startsWith("com.androidcommondoc.detekt.rules")
            }
            assertThat(detektImports)
                .withFailMessage {
                    "build-logic file '${file.name}' imports detekt rule implementations: " +
                        "${detektImports.map { it.name }}. " +
                        "Use the JAR artifact via Gradle dependency instead of direct imports."
                }
                .isEmpty()
        }
    }
}
