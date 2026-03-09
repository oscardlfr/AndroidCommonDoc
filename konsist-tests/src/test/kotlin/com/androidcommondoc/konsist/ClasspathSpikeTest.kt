package com.androidcommondoc.konsist

import com.androidcommondoc.konsist.support.ScopeFactory
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

/**
 * Canary tests validating KONS-01: Konsist 0.17.3 classpath isolation alongside Kotlin 2.3.10.
 *
 * These tests prove the full stack works: Gradle dependency resolution, Konsist classpath
 * isolation (kotlin-compiler-embeddable:2.0.21 parsing Kotlin 2.3.10 source), scope path
 * resolution via relative paths, and basic declaration API usage.
 *
 * If any of these tests fail, the entire phase approach must change.
 */
class ClasspathSpikeTest {

    @Test
    fun `Konsist resolves detekt-rules scope from isolated module`() {
        val scope = ScopeFactory.detektRulesScope()
        val files = scope.files.toList()

        assertThat(files).hasSizeGreaterThanOrEqualTo(6)

        // Verify the RuleSetProvider is found by file name
        val providerFile = files.firstOrNull {
            it.name == "AndroidCommonDocRuleSetProvider"
        }
        assertThat(providerFile)
            .withFailMessage(
                "AndroidCommonDocRuleSetProvider not found in detekt-rules scope. " +
                    "Found files: ${files.map { it.name }}"
            )
            .isNotNull

        // Verify the provider file has the correct package
        assertThat(providerFile!!.packagee?.name)
            .isEqualTo("com.androidcommondoc.detekt")
    }

    @Test
    fun `Konsist resolves build-logic scope from isolated module`() {
        val scope = ScopeFactory.buildLogicScope()
        val files = scope.files.toList()

        assertThat(files).hasSizeGreaterThanOrEqualTo(1)

        // Verify AndroidCommonDocExtension class is found
        val extensionClass = scope.classes().firstOrNull {
            it.name == "AndroidCommonDocExtension"
        }
        assertThat(extensionClass)
            .withFailMessage(
                "AndroidCommonDocExtension class not found in build-logic scope. " +
                    "Found classes: ${scope.classes().map { it.name }.toList()}"
            )
            .isNotNull
    }

    @Test
    fun `Konsist parses Kotlin 2_3_10 source files without error`() {
        val scope = ScopeFactory.detektRulesScope()

        // Exercise the kotlin-compiler-embeddable 2.0.21 parsing Kotlin 2.3.10 code.
        // If there is a ClassCastException or parse error, iterating classes and
        // accessing .name will fail immediately.
        val classNames = scope.classes().map { it.name }.toList()

        assertThat(classNames)
            .withFailMessage(
                "Expected at least one class parsed from detekt-rules sources. " +
                    "This indicates kotlin-compiler-embeddable:2.0.21 cannot parse " +
                    "Kotlin 2.3.10 source files."
            )
            .isNotEmpty
    }
}
