package com.androidcommondoc.dokka.markdown

import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlatformLabelerTest {

    @Nested
    inner class Sorting {

        @Test
        fun `labels_multiplePlatforms_alphabeticallySorted`() {
            assertEquals(listOf("apple", "common", "jvm"), PlatformLabeler.labels(listOf("common", "apple", "jvm")))
        }

        @Test
        fun `labels_singleElement_returnsSingle`() {
            assertEquals(listOf("common"), PlatformLabeler.labels(listOf("common")))
        }

        @Test
        fun `labels_empty_returnsEmpty`() {
            assertEquals(emptyList(), PlatformLabeler.labels(emptyList()))
        }
    }

    @Nested
    inner class MainSuffixStripping {

        @Test
        fun `labels_mainSuffix_stripped`() {
            assertEquals(
                listOf("apple", "common", "jvm"),
                PlatformLabeler.labels(listOf("commonMain", "appleMain", "jvmMain")),
            )
        }

        @Test
        fun `labels_mixedMainAndPlain_normalizedAndSorted`() {
            assertEquals(
                listOf("apple", "jvm"),
                PlatformLabeler.labels(listOf("appleMain", "jvm")),
            )
        }
    }

    @Nested
    inner class Deduplication {

        @Test
        fun `labels_duplicates_deduped`() {
            assertEquals(listOf("apple", "jvm"), PlatformLabeler.labels(listOf("jvm", "jvm", "apple")))
        }

        @Test
        fun `labels_duplicatesAfterNormalization_deduped`() {
            // appleMain + apple both normalize to "apple"
            assertEquals(listOf("apple", "jvm"), PlatformLabeler.labels(listOf("appleMain", "apple", "jvm")))
        }
    }

    @Nested
    inner class PlatformNormalization {

        @Test
        fun `label_commonMain_normalizesToCommon`() {
            val info = PlatformLabeler.labels(listOf("commonMain", "jvmMain"))
            assertEquals(listOf("common", "jvm"), info)
        }

        @Test
        fun `label_jvmMain_normalizesToJvm`() {
            val info = PlatformLabeler.labels(listOf("appleMain", "jvmMain"))
            assertEquals(listOf("apple", "jvm"), info)
        }
    }

    @Nested
    inner class NoConcatenationBug {

        @Test
        fun `labels_noElementContainsConcatenatedNames`() {
            val result = PlatformLabeler.labels(listOf("common", "apple", "desktop"))
            assertTrue(result.none { it.contains("common") && it.length > "common".length },
                "No element should be a concatenation like 'commonapple'")
        }

        @Test
        fun `labels_eachElementIsSingleShortName`() {
            val result = PlatformLabeler.labels(listOf("common", "apple", "jvm", "desktop"))
            result.forEach { label ->
                assertTrue(label.length <= 10, "Each label must be a short single name, got: '$label'")
            }
        }
    }
}
