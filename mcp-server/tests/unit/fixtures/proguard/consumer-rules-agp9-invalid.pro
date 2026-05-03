# AGP 9 test fixture — global directives banned in consumer rules
# Confirmed banned (official docs): -dontoptimize, -dontobfuscate
# Plausible banned (global-options category, AGP source unverified):
#   -allowaccessmodification, -optimizations, -optimizationpasses, -dontusemixedcaseclassnames
# Ground truth: com.android.build.gradle.internal.r8.TargetedR8Rules.kt
#               ConsumerRuleGlobalGuardian.readConsumerKeepRulesRemovingBannedGlobals
-dontoptimize
-dontobfuscate
-allowaccessmodification
-optimizations !code/simplification/arithmetic,!code/simplification/cast
-optimizationpasses 5
-dontusemixedcaseclassnames
-keep class com.example.ValidKeep { *; }
