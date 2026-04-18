package com.androidcommondoc.dokka.markdown

import org.jetbrains.dokka.links.DRI
import org.jetbrains.dokka.model.*
import org.jetbrains.dokka.model.properties.PropertyContainer
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// ── Fake factory ─────────────────────────────────────────────────────────────
// DModule.dri is hardcoded as DRI.topLevel — no dri param in its constructor.
// DObject has no modifier param. DAnnotation: name before dri. DInterface:
// documentation before sources. Param order follows actual dokka-core 2.2.0 source.

private val emptyDRI = DRI()
private val unitType = GenericTypeConstructor(dri = DRI(), projections = emptyList())

private fun fakeClass(dri: DRI = emptyDRI) = DClass(
    dri = dri,
    name = "Fake",
    constructors = emptyList(),
    functions = emptyList(),
    properties = emptyList(),
    classlikes = emptyList(),
    sources = emptyMap(),
    visibility = emptyMap(),
    companion = null,
    generics = emptyList(),
    supertypes = emptyMap(),
    documentation = emptyMap(),
    expectPresentInSet = null,
    modifier = emptyMap(),
    sourceSets = emptySet(),
    isExpectActual = false,
)

private fun fakeInterface(dri: DRI = emptyDRI) = DInterface(
    dri = dri,
    name = "Fake",
    documentation = emptyMap(),
    expectPresentInSet = null,
    sources = emptyMap(),
    functions = emptyList(),
    properties = emptyList(),
    classlikes = emptyList(),
    visibility = emptyMap(),
    companion = null,
    generics = emptyList(),
    supertypes = emptyMap(),
    modifier = emptyMap(),
    sourceSets = emptySet(),
    isExpectActual = false,
)

private fun fakeObject(dri: DRI = emptyDRI) = DObject(
    name = "Fake",
    dri = dri,
    documentation = emptyMap(),
    expectPresentInSet = null,
    sources = emptyMap(),
    functions = emptyList(),
    properties = emptyList(),
    classlikes = emptyList(),
    visibility = emptyMap(),
    supertypes = emptyMap(),
    sourceSets = emptySet(),
    isExpectActual = false,
)

private fun fakeEnum(dri: DRI = emptyDRI) = DEnum(
    dri = dri,
    name = "Fake",
    entries = emptyList(),
    documentation = emptyMap(),
    expectPresentInSet = null,
    sources = emptyMap(),
    functions = emptyList(),
    properties = emptyList(),
    classlikes = emptyList(),
    visibility = emptyMap(),
    companion = null,
    constructors = emptyList(),
    supertypes = emptyMap(),
    sourceSets = emptySet(),
    isExpectActual = false,
)

private fun fakeAnnotation(dri: DRI = emptyDRI) = DAnnotation(
    name = "Fake",
    dri = dri,
    documentation = emptyMap(),
    expectPresentInSet = null,
    sources = emptyMap(),
    functions = emptyList(),
    properties = emptyList(),
    classlikes = emptyList(),
    visibility = emptyMap(),
    companion = null,
    constructors = emptyList(),
    generics = emptyList(),
    sourceSets = emptySet(),
    isExpectActual = false,
)

// DModule.dri is hardcoded as DRI.topLevel — not a constructor param.
private fun fakeModule() = DModule(
    name = "fake-module",
    packages = emptyList(),
    documentation = emptyMap(),
    sourceSets = emptySet(),
)

private fun fakeFunction(dri: DRI = emptyDRI) = DFunction(
    dri = dri,
    name = "fake",
    isConstructor = false,
    parameters = emptyList(),
    documentation = emptyMap(),
    expectPresentInSet = null,
    sources = emptyMap(),
    visibility = emptyMap(),
    type = unitType,
    generics = emptyList(),
    receiver = null,
    modifier = emptyMap(),
    sourceSets = emptySet(),
    isExpectActual = false,
)

// ── Tests ─────────────────────────────────────────────────────────────────────

class SymbolClassifierTest {

    @Nested
    inner class Classify {

        @Test
        fun `classify_DClass_returnsTypeA`() {
            assertEquals(SymbolType.TYPE_A, SymbolClassifier.classify(fakeClass()))
        }

        @Test
        fun `classify_DInterface_returnsTypeA`() {
            assertEquals(SymbolType.TYPE_A, SymbolClassifier.classify(fakeInterface()))
        }

        @Test
        fun `classify_DObject_returnsTypeA`() {
            assertEquals(SymbolType.TYPE_A, SymbolClassifier.classify(fakeObject()))
        }

        @Test
        fun `classify_DEnum_returnsTypeA`() {
            assertEquals(SymbolType.TYPE_A, SymbolClassifier.classify(fakeEnum()))
        }

        @Test
        fun `classify_DAnnotation_returnsTypeA`() {
            assertEquals(SymbolType.TYPE_A, SymbolClassifier.classify(fakeAnnotation()))
        }

        @Test
        fun `classify_DModule_returnsHub`() {
            assertEquals(SymbolType.HUB, SymbolClassifier.classify(fakeModule()))
        }

        @Test
        fun `classify_DFunction_returnsTypeB`() {
            assertEquals(SymbolType.TYPE_B, SymbolClassifier.classify(fakeFunction()))
        }
    }

    @Nested
    inner class IsTopLevel {

        @Test
        fun `isTopLevel_packageNonNullClassNamesNull_returnsTrue`() {
            val fn = fakeFunction(dri = DRI(packageName = "com.example", classNames = null))
            assertTrue(SymbolClassifier.isTopLevel(fn))
        }

        @Test
        fun `isTopLevel_packageNonNullClassNamesNonNull_returnsFalse`() {
            val fn = fakeFunction(dri = DRI(packageName = "com.example", classNames = "MyClass"))
            assertFalse(SymbolClassifier.isTopLevel(fn))
        }

        @Test
        fun `isTopLevel_packageNull_returnsFalse`() {
            val fn = fakeFunction(dri = DRI(packageName = null, classNames = null))
            assertFalse(SymbolClassifier.isTopLevel(fn))
        }
    }
}
