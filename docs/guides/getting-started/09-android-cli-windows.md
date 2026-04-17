---
title: "Step 9 — Android CLI on Windows / Paso 9 — Android CLI en Windows"
slug: getting-started-android-cli-windows
category: guides
description: >
  Install Google's Android CLI v0.7+ without admin rights and connect a
  physical Android device for runtime UI validation via `android-layout-diff`.
  Instalar Android CLI v0.7+ sin permisos de administrador y conectar un
  dispositivo Android físico para validación UI en runtime vía
  `android-layout-diff`.
last_updated: "2026-04-17"
---

# Step 9 — Android CLI on Windows

Runtime UI validation (the `android-layout-diff` MCP tool) relies on Google's Android CLI v0.7+ and an authorized adb device. The Android emulator is **disabled on Windows** in v0.7; a USB-connected physical device is the supported path. This guide covers the install without requiring Administrator.

> For context on why this exists, see Plan 19-02 in `.planning/phases/19-android-cli-integration/19-02-PLAN.md` and the POC findings in `.planning/phases/19-POC/19-POC-FINDINGS.md`.

---

## English

### Prerequisites

| Tool | Min version | Check |
|------|-------------|-------|
| curl | any (Windows built-in) | `curl --version` |
| Android SDK platform-tools | any | `adb --version` |
| Physical Android device | any | `adb devices` (must list as `device`, not `unauthorized`) |
| USB cable that supports data (not charge-only) | — | the device prompts to trust the computer |

### Install without Administrator

The official Windows installer (`install.cmd`) writes to `C:\ProgramData\AndroidCLI` and modifies the Machine PATH — both require elevation. A user-scope install avoids that:

```powershell
# 1. Download the binary (4.3 MB)
curl.exe --ssl-no-revoke -fsSL `
  https://edgedl.me.gvt1.com/edgedl/android/cli/latest/windows_x86_64/android.exe `
  -o "$env:USERPROFILE\android-cli\android.exe"

# 2. Add to the User PATH (no admin needed, persists across terminals)
$p = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($p -notlike "*android-cli*") {
  [Environment]::SetEnvironmentVariable('Path', $p + ";$env:USERPROFILE\android-cli", 'User')
}
```

Open a **new** terminal and verify:

```powershell
android --version
# → 0.7.15222914 (or later)
```

`--ssl-no-revoke` is required because Windows `curl.exe` rejects Google's CDN certificates on strict revocation checks. It is safe for this single download; it does not affect other commands.

### Initialize the CLI

`android init` installs the official `android-cli` skill into every agent directory it detects. On a Windows user account with Claude Code installed, that is:

```
~\.claude\skills\android-cli\
~\.codex\skills\android-cli\
~\.cursor\skills\android-cli\
~\.gemini\antigravity\skills\android-cli\
~\.gemini\skills\android-cli\
~\.copilot\skills\android-cli\
~\.config\opencode\skills\android-cli\
```

Run it once:

```bash
android init
```

No PATH edits, no MCP server, no background daemon — `init` is purely a skill-install step.

### Connect a device

1. Enable **Developer Options** on the Android device (tap the build number 7 times in Settings → About).
2. Turn on **USB debugging** (Developer Options).
3. Plug the device into the host with a data-capable USB cable.
4. Accept the **Allow USB debugging?** prompt on the device. Tick *Always allow from this computer*.
5. Verify:

```bash
adb devices
# List of devices attached
# R3CT30KAMEH    device
```

If the device shows `unauthorized`, re-accept the prompt on the phone. If it shows `offline`, unplug and re-plug (the adb daemon sometimes stalls after sleep).

### Verify `android-layout-diff` end-to-end

With the device unlocked and on the home screen:

```bash
# Capture a baseline
android layout --pretty --output=baseline.json

# Navigate somewhere else on the device (manually or via adb shell am start)

# Run the MCP tool via Claude, or directly via the CLI for a smoke test:
android layout --diff --pretty --output=diff.json
cat diff.json  # expect { "added": [...], "modified": [...] }
```

### Multi-device troubleshooting

If `adb devices` lists more than one entry (physical device + offline emulator is common), pass `--device=<serial>` to every `android` invocation. The `android-layout-diff` MCP tool takes the serial via the `device_serial` parameter.

### Known Windows limitations

| Limitation | Impact | Workaround |
|---|---|---|
| `android emulator` commands disabled on Windows | no local emulator | use a physical device or CI Linux (Plan 19-04 workflow) |
| Non-ASCII characters garbled on `cmd.exe` stdout | broken UI text in captures | always use `--output=<file>` and read the file as UTF-8 |
| `curl.exe` rejects Google CDN certs by default | install script fails | pass `--ssl-no-revoke` as shown above |

---

## Español

### Requisitos previos

| Herramienta | Versión mínima | Comprobación |
|-------------|----------------|--------------|
| curl | cualquiera (incluido en Windows) | `curl --version` |
| platform-tools del Android SDK | cualquiera | `adb --version` |
| Dispositivo Android físico | cualquiera | `adb devices` (debe aparecer como `device`, no `unauthorized`) |
| Cable USB con datos (no solo carga) | — | el dispositivo pide confirmación de confianza |

### Instalar sin administrador

```powershell
# 1. Descargar el binario (4.3 MB)
curl.exe --ssl-no-revoke -fsSL `
  https://edgedl.me.gvt1.com/edgedl/android/cli/latest/windows_x86_64/android.exe `
  -o "$env:USERPROFILE\android-cli\android.exe"

# 2. Añadir al PATH de usuario (sin admin, persistente)
$p = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($p -notlike "*android-cli*") {
  [Environment]::SetEnvironmentVariable('Path', $p + ";$env:USERPROFILE\android-cli", 'User')
}
```

Abre una **terminal nueva** y verifica:

```powershell
android --version
# → 0.7.15222914 (o posterior)
```

### Inicializar el CLI

```bash
android init
```

Instala la skill oficial `android-cli` en todos los directorios de agentes detectados. En Windows con Claude Code instalado, uno de ellos es `~\.claude\skills\android-cli\`.

### Conectar un dispositivo

1. Activa **Opciones de desarrollador** (toca 7 veces el número de compilación en Ajustes → Información del teléfono).
2. Activa **Depuración USB**.
3. Conecta el dispositivo al host con un cable USB que soporte datos.
4. Acepta **¿Permitir depuración USB?** en el dispositivo. Marca *Permitir siempre desde este ordenador*.
5. Verifica `adb devices`.

### Limitaciones conocidas en Windows

| Limitación | Impacto | Workaround |
|---|---|---|
| `android emulator` deshabilitado en Windows | sin emulador local | device físico o CI Linux (flujo del Plan 19-04) |
| Caracteres no-ASCII corruptos en stdout de `cmd.exe` | texto UI roto en capturas | siempre usa `--output=<file>` y lee UTF-8 |
| `curl.exe` rechaza certs de la CDN de Google | falla el script de instalación | pasa `--ssl-no-revoke` como arriba |

## Cross-references

- [upstream-validation](../upstream-validation.md) — `kb://` URLs routed through `android docs fetch`
- [compose-layout-validation](../../compose/compose-layout-validation.md) — sibling Compose validation (build-time rule)
- Plan 19-02 — `android-layout-diff` MCP tool design
- 19-POC-FINDINGS — schema evidence and edge-case matrix
