# cli-mandate-cleanup — Quality Gate Sentinel

Wave-phase-gate Rule A audit-trail.

- Branch: cli-mandate-cleanup
- Scope: PR #170 — purge pre-CLI references in dev + arch templates (cleanup C5 of PR2 audit)
- Issues addressed: (1) BANNED TOOLS contradiction "grep for expected changes" in 4 dev templates; (2) "verified and APPROVED" old verdict nomenclature in 4 dev templates; (3) arch-testing.md:409 wrapper-script ban contradicts canonical chain
- 5 templates × dual-location (data-layer + domain-model + test-specialist + ui-specialist + arch-testing)
- Predecessor: PR #169 cli-audit-pr2 (merged 7af5bf7) — this PR closes the deuda findings from that audit
- PR target: develop
