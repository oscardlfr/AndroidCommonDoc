package com.androidcommondoc.dokka.markdown

import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class ContentHasherTest {

    @Nested
    inner class CrlfNormalization {

        @Test
        fun `hash_crlfEquivalentToLf_sameHash`() {
            assertEquals(ContentHasher.hash("hello\nworld"), ContentHasher.hash("hello\r\nworld"))
        }

        @Test
        fun `hash_crEquivalentToLf_sameHash`() {
            assertEquals(ContentHasher.hash("hello\nworld"), ContentHasher.hash("hello\rworld"))
        }
    }

    @Nested
    inner class TrailingWhitespace {

        @Test
        fun `hash_trailingSpacePerLineEquivalentToClean_sameHash`() {
            assertEquals(ContentHasher.hash("line\nother"), ContentHasher.hash("line  \nother"))
        }
    }

    @Nested
    inner class Format {

        @Test
        fun `hash_length_is12`() {
            assertEquals(12, ContentHasher.hash("abc").length)
        }

        @Test
        fun `hash_emptyInput_length12`() {
            assertEquals(12, ContentHasher.hash("").length)
        }

        @Test
        fun `hash_outputIsLowercaseHex`() {
            val result = ContentHasher.hash("abc")
            assertTrue(result.matches(Regex("[0-9a-f]{12}")), "Expected 12 lowercase hex chars, got: $result")
        }
    }

    @Nested
    inner class Determinism {

        @Test
        fun `hash_sameInput_sameHash`() {
            assertEquals(ContentHasher.hash("same"), ContentHasher.hash("same"))
        }

        @Test
        fun `hash_differentInputs_differentHashes`() {
            assertNotEquals(ContentHasher.hash("a"), ContentHasher.hash("b"))
        }
    }
}
