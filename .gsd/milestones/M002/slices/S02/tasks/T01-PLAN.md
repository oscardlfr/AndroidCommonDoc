# T01: 06-konsist-internal-tests 01

**Slice:** S02 — **Milestone:** M002

## Description

Bootstrap the konsist-tests standalone JVM module, validate Konsist 0.17.3 classpath isolation alongside Kotlin 2.3.10, and create the shared ScopeFactory utility that all subsequent test classes depend on.

Purpose: This is the critical foundation -- if the classpath spike fails, the entire phase approach must change. Getting this right first de-risks everything else.
Output: A working konsist-tests/ Gradle module with passing canary tests and shared scope utilities.

## Must-Haves

- [ ] "konsist-tests module compiles and resolves Konsist 0.17.3 from Maven Central"
- [ ] "ScopeFactory.detektRulesScope() returns a non-empty scope containing detekt-rules production files"
- [ ] "ScopeFactory.buildLogicScope() returns a non-empty scope containing build-logic production files"
- [ ] "./gradlew :konsist-tests:test runs and passes the classpath spike canary test"
- [ ] "Running ./gradlew :konsist-tests:test twice in a row never shows UP-TO-DATE -- second run re-executes"

## Files

- `konsist-tests/build.gradle.kts`
- `konsist-tests/settings.gradle.kts`
- `konsist-tests/gradle/wrapper/gradle-wrapper.properties`
- `konsist-tests/gradlew`
- `konsist-tests/gradlew.bat`
- `konsist-tests/gradle/wrapper/gradle-wrapper.jar`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/support/ScopeFactory.kt`
- `konsist-tests/src/test/kotlin/com/androidcommondoc/konsist/ClasspathSpikeTest.kt`
