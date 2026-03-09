# T06: 14.2-docs-content-quality 06

**Slice:** S04 — **Milestone:** M004

## Description

Split the 5 largest DawSync docs (1667, 1619, 868, 648, 656 lines) into hub+sub-doc format following established pattern.

Purpose: These 5 docs are the most severely oversized, ranging from 648 to 1667 lines. They must be split before the remaining 13 oversized docs (Plan 08) to handle the hardest cases first.
Output: 5 massive docs converted to hub+sub-doc format, all within size limits.

## Must-Haves

- [ ] "PRODUCT_SPEC.md (1667 lines) split into hub (<100) + sub-docs (<300 each)"
- [ ] "ABLETON_TEST_DATA.md (1619 lines) split into hub (<100) + sub-docs (<300 each)"
- [ ] "TESTING.md (868 lines) split into hub (<100) + sub-docs (<300 each)"
- [ ] "NAVIGATION.md (648 lines) split into hub (<100) + sub-docs (<300 each)"
- [ ] "ANDROID_2026.md (656 lines) split into hub (<100) + sub-docs (<300 each)"
- [ ] "All sub-docs have parent frontmatter field"
- [ ] "Cross-references updated after each split"

## Files

- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
- `[object Object]`
