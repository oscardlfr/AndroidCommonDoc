package com.androidcommondoc.dokka.markdown

import org.jetbrains.dokka.model.doc.*
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KdocRendererTest {

    private fun text(body: String): Text = Text(body = body)
    private fun para(vararg children: DocTag): P = P(children = children.toList())
    private fun descRoot(vararg children: DocTag): DocTag = P(children = children.toList())

    @Nested
    inner class FirstSentence {

        @Test
        fun `firstSentence_nullInput_returnsEmpty`() {
            assertEquals("", KdocRenderer.firstSentence(null))
        }

        @Test
        fun `firstSentence_singleSentenceWithDot_returnsSentence`() {
            val root = P(children = listOf(text("Parses input. Returns a result.")))
            val result = KdocRenderer.firstSentence(root)
            assertEquals("Parses input.", result)
        }

        @Test
        fun `firstSentence_noDot_returnsWholeText`() {
            val root = P(children = listOf(text("Short doc")))
            val result = KdocRenderer.firstSentence(root)
            assertEquals("Short doc", result)
        }

        @Test
        fun `firstSentence_longTextNoDot_clampsTo80Chars`() {
            val long = "A".repeat(100)
            val root = P(children = listOf(text(long)))
            val result = KdocRenderer.firstSentence(root)
            assertTrue(result.length <= 80)
        }

        @Test
        fun `firstSentence_emptyP_returnsEmpty`() {
            val root = P(children = emptyList())
            val result = KdocRenderer.firstSentence(root)
            assertEquals("", result)
        }
    }

    @Nested
    inner class RenderDescription {

        @Test
        fun `renderDescription_nullInput_returnsEmpty`() {
            assertEquals("", KdocRenderer.renderDescription(null))
        }

        @Test
        fun `renderDescription_simpleText_returnsText`() {
            val root = P(children = listOf(text("Does something useful.")))
            val result = KdocRenderer.renderDescription(root)
            assertEquals("Does something useful.", result.trim())
        }

        @Test
        fun `renderDescription_codeInline_wrappedInBackticks`() {
            val codeNode = CodeInline(children = listOf(text("MyClass")))
            val root = P(children = listOf(codeNode))
            val result = KdocRenderer.renderDescription(root)
            assertTrue(result.contains("`MyClass`"))
        }
    }

    @Nested
    inner class RenderParams {

        @Test
        fun `renderParams_empty_returnsEmpty`() {
            assertEquals("", KdocRenderer.renderParams(emptyList()))
        }

        @Test
        fun `renderParams_singleParam_hasHeaderAndEntry`() {
            val param = Param(
                root = P(children = listOf(text("The input value."))),
                name = "value",
            )
            val result = KdocRenderer.renderParams(listOf(param))
            assertTrue(result.contains("#### Parameters"))
            assertTrue(result.contains("`value`"))
            assertTrue(result.contains("The input value."))
        }

        @Test
        fun `renderParams_multipleParams_allListed`() {
            val p1 = Param(root = P(children = listOf(text("First"))), name = "a")
            val p2 = Param(root = P(children = listOf(text("Second"))), name = "b")
            val result = KdocRenderer.renderParams(listOf(p1, p2))
            assertTrue(result.contains("`a`"))
            assertTrue(result.contains("`b`"))
        }
    }

    @Nested
    inner class RenderReturn {

        @Test
        fun `renderReturn_null_returnsEmpty`() {
            assertEquals("", KdocRenderer.renderReturn(null))
        }

        @Test
        fun `renderReturn_withDoc_hasHeaderAndText`() {
            val ret = Return(root = P(children = listOf(text("The computed value."))))
            val result = KdocRenderer.renderReturn(ret)
            assertTrue(result.contains("#### Return"))
            assertTrue(result.contains("The computed value."))
        }
    }

    @Nested
    inner class RenderThrows {

        @Test
        fun `renderThrows_empty_returnsEmpty`() {
            assertEquals("", KdocRenderer.renderThrows(emptyList()))
        }

        @Test
        fun `renderThrows_single_hasHeaderAndException`() {
            val t = Throws(
                root = P(children = listOf(text("When the input is null."))),
                name = "NullPointerException",
                exceptionAddress = null,
            )
            val result = KdocRenderer.renderThrows(listOf(t))
            assertTrue(result.contains("#### Throws"))
            assertTrue(result.contains("`NullPointerException`"))
            assertTrue(result.contains("When the input is null."))
        }
    }

    @Nested
    inner class RenderSee {

        @Test
        fun `renderSee_empty_returnsEmpty`() {
            assertEquals("", KdocRenderer.renderSee(emptyList()))
        }

        @Test
        fun `renderSee_single_hasHeaderAndRef`() {
            val see = See(
                root = P(children = emptyList()),
                name = "com.sample.OtherClass",
                address = null,
            )
            val result = KdocRenderer.renderSee(listOf(see))
            assertTrue(result.contains("#### See also"))
            assertTrue(result.contains("`com.sample.OtherClass`"))
        }
    }
}
