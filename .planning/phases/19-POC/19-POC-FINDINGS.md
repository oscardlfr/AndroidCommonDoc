# 19-POC: `android layout --diff` Schema Reverse Engineering

**Status:** Not started
**Blocks:** Plan 19-02
**Parallel with:** Plan 19-01 (no dependency)

## Context

Google's Android CLI v0.7 exposes `android layout --diff` and `android screen capture --annotate` but does NOT document the output JSON schema. Plan 19-02 parser depends on that schema — committing parser code before pinning the shape is how we ship brittle integrations.

Phase 1 research (researcher agent, 2026-04-17): "No documented públicamente. Solo se sabe que devuelve 'una lista de los elementos de diseño que cambiaron desde la última snapshot'. El schema completo del árbol de layout no está en la documentación pública de v0.7."

## Goal

Pin the JSON schema of `android layout --diff` and the annotation format of `android screen capture --annotate` with real captured output — or recommend deferral if schema too opaque/unstable.

## Prerequisites (manual, user action)

1. Install Android CLI v0.7 on Windows host:
   - Download from d.android.com/tools/agents (not brew, not npm)
   - Run `android --version` — confirm `0.7.x`
2. Connect physical Android device via USB:
   - Enable Developer Options + USB debugging on device
   - Run `adb devices` — confirm device listed as `authorized`
3. Install a DawSync build on device: `./gradlew :app:installDebug` then verify via `adb shell am start` or launch manually

## POC Steps

### Step 1: Baseline capture

```bash
# Launch DawSync to a known state (e.g., main screen)
# Capture baseline screenshot + layout
android screen capture --output=baseline.png --annotate
android layout --pretty --output=baseline.json
```

**Document**: contents of `baseline.json` — key names, types, nesting, element count.

### Step 2: Modified state capture

```bash
# Navigate DawSync to a visually different state (e.g., error dialog)
android screen capture --output=modified.png --annotate
android layout --pretty --output=modified.json
```

**Document**: diff between `baseline.json` and `modified.json` (by hand or via `diff`).

### Step 3: Diff invocation

```bash
# Use the diff subcommand with both snapshots
android layout --diff --output=diff.json
```

**Document**: schema of `diff.json` — is it an array of changes? With `type: "added" | "removed" | "modified"`? What fields per change?

### Step 4: Edge cases

- **No baseline**: run `android layout --diff` without a prior snapshot — document exit code + stderr
- **No device**: disconnect device, run command — document exit code + error
- **Offline**: disconnect network, run `android screen capture` — confirm it works offline (it should, per researcher findings)
- **Malformed**: corrupt `baseline.json` manually, run `--diff` — document behavior

### Step 5: Annotation format

Open `baseline.png` (captured with `--annotate`). Inspect visually:
- Are annotations `#N` overlaid as text labels?
- Are there bounding boxes?
- Run `android screen resolve --screenshot=baseline.png --string="input tap #5"` — confirm it returns `input tap X Y`
- Is the mapping between `#N` and coordinates exposed anywhere? (check stdout, sidecar files)

## Deliverable

This file updated with:

1. **Schema section**: full JSON example of `diff.json` with typed key descriptions
2. **Stability section**: are IDs `#N` stable across re-captures of the same screen? Or do they renumber?
3. **Error matrix**:
   | Scenario | Exit code | Stderr |
   |----------|-----------|--------|
   | No baseline | ? | ? |
   | No device | ? | ? |
   | Offline | ? | ? |
   | Malformed JSON | ? | ? |
4. **Parser design**: recommended TypeScript types + parsing strategy for `android-layout-diff.ts`
5. **Risk assessment**: schema stability (likely to change in v0.8?), fallback strategy

## Exit Criteria

**Option A (proceed to 19-02)**: Deliverable sections 1-5 complete with real CLI output. Parser design confirmed feasible.

**Option B (defer layout-diff)**: Schema too opaque, IDs not stable, or CLI behavior inconsistent across runs. Recommendation written: either (a) wait for v0.8 stable release, (b) fall back to Compose Preview-only validation for Phase 19, (c) use `uiautomator dump` as alternative.

## References

- Android CLI overview: https://developer.android.com/tools/agents/android-cli
- Researcher report: Phase 1 findings (see `partitioned-hugging-grove.md`)
- Windows physical device guide: to be created in Plan 19-02 scope

## Log

- **2026-04-17**: POC scaffold created. Awaiting manual execution by user with device.
