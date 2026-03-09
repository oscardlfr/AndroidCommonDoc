package com.androidcommondoc.konsist

import com.androidcommondoc.konsist.support.ScopeFactory
import com.lemonappdev.konsist.api.ext.list.withNameEndingWith
import com.lemonappdev.konsist.api.ext.list.withPackage
import com.lemonappdev.konsist.api.verify.assertTrue
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

/**
 * Validates the structural integrity of the detekt-rules module.
 *
 * Covers:
 * - Rule class naming conventions (suffix enforcement)
 * - RuleSetProvider existence and package placement
 * - Provider registration completeness (KONS-04 cross-file check)
 * - Test coverage structure: every Rule has a matching Test class (KONS-04 cross-file check)
 *
 * All violation messages are actionable: they name the offending class, state the
 * violated rule, and provide remediation guidance.
 */
class DetektRuleStructureTest {

    private val detektScope = ScopeFactory.detektRulesScope()

    @Test
    fun `every Rule class in rules package ends with Rule suffix`() {
        detektScope
            .classes()
            .withPackage("com.androidcommondoc.detekt.rules..")
            .assertTrue(
                additionalMessage = "All classes in the detekt rules package must end with " +
                    "'Rule' suffix. If this is a helper/utility, move it to a support package."
            ) {
                it.name.endsWith("Rule")
            }
    }

    @Test
    fun `RuleSetProvider exists and resides in detekt root package`() {
        val providers = detektScope
            .classes()
            .withNameEndingWith("RuleSetProvider")
            .toList()

        assertThat(providers)
            .withFailMessage(
                "No RuleSetProvider class found in detekt-rules module. " +
                    "Create a class ending with 'RuleSetProvider' in " +
                    "com.androidcommondoc.detekt package."
            )
            .isNotEmpty

        providers.forEach { provider ->
            assertThat(provider.packagee?.name)
                .withFailMessage(
                    "RuleSetProvider '${provider.name}' resides in package " +
                        "'${provider.packagee?.name}' but must be in " +
                        "'com.androidcommondoc.detekt' (NOT in the .rules subpackage)."
                )
                .isEqualTo("com.androidcommondoc.detekt")
        }
    }

    @Test
    fun `every Rule class is registered in the RuleSetProvider`() {
        val ruleClassNames = detektScope
            .classes()
            .withPackage("com.androidcommondoc.detekt.rules..")
            .filter { it.name.endsWith("Rule") }
            .map { it.name }
            .toSet()

        assertThat(ruleClassNames)
            .withFailMessage("Canary: no Rule classes found in detekt rules package")
            .isNotEmpty

        val providerFile = detektScope.files
            .firstOrNull { it.name == "AndroidCommonDocRuleSetProvider" }

        assertThat(providerFile)
            .withFailMessage(
                "AndroidCommonDocRuleSetProvider file not found in detekt-rules scope."
            )
            .isNotNull

        val importedNames = providerFile!!.imports
            .map { it.name.substringAfterLast(".") }
            .toSet()

        val unregistered = ruleClassNames - importedNames
        assertThat(unregistered)
            .withFailMessage {
                "Unregistered rules: $unregistered. " +
                    "Add import and ::ClassName to the instance() listOf() in " +
                    "AndroidCommonDocRuleSetProvider.kt"
            }
            .isEmpty()
    }

    @Test
    fun `every Rule class has a matching Test class`() {
        val testScope = ScopeFactory.detektRulesTestScope()

        val productionRules = detektScope
            .classes()
            .withPackage("com.androidcommondoc.detekt.rules..")
            .filter { it.name.endsWith("Rule") }
            .map { it.name }
            .toSet()

        assertThat(productionRules)
            .withFailMessage("Canary: no Rule classes found in detekt rules package")
            .isNotEmpty

        val testClasses = testScope
            .classes()
            .filter { it.name.endsWith("Test") }
            .map { it.name.removeSuffix("Test") }
            .toSet()

        val untested = productionRules - testClasses
        assertThat(untested)
            .withFailMessage {
                "Rules without test classes: $untested. " +
                    "Create <RuleName>Test.kt in detekt-rules/src/test/kotlin/"
            }
            .isEmpty()
    }
}
