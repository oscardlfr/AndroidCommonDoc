---
paths:
  - "**/*Test.kt"
  - "**/*.test.{js,cjs,mjs,ts}"
  - "**/tests/**"
  - "scripts/sh/run-*"
  - "scripts/sh/*test*"
---

# Testing rules

- Reproduce the failure before fixing it whenever the previous behavior can be exercised safely.
- Add both the accepted path and the corresponding malformed, foreign or ambiguous negative.
- Use pure Kotlin fakes over mocks and `runTest` for coroutine tests.
- Inject dispatchers; never test infinite scheduler loops directly.
- Use sequential `maxParallelForks = 1` where Windows file locking makes parallel test workers unsafe.
- Keep focused tests fast enough for iteration. Run the full local batch once before PR, then rely on GitHub CI for the independent second environment.
- Consumer-contract work is incomplete until toolkit root and consumer root are physically different in the fixture.
