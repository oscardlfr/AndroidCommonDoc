# Valid app-level rules — same directives are OK here (not consumer rules)
-dontoptimize
-dontobfuscate
-allowaccessmodification
-keep class com.example.ValidKeep { *; }
