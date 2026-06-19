# Ingentive Agent OS — Intune Deployment Guide

This document is for the IT team. It explains how to build signed,
notarized, Intune-ready packages of the Ingentive Agent OS desktop wrapper
and push them to user machines.

The wrapper is a per-user Electron app that boots the Next.js dashboard on
`http://127.0.0.1:<port>/` and opens the user's default browser when they
click the menu-bar / tray icon. There is **no self-updater** — Intune
manages updates.

---

## 1. Prerequisites

| Need                                  | Where it lives                                  |
|--------------------------------------|-------------------------------------------------|
| Node.js 20+                          | build host                                      |
| npm install completed                | repo root                                       |
| Apple Developer ID Application cert  | macOS keychain on the signing host              |
| Apple ID + app-specific password     | for `xcrun notarytool` notarization             |
| Windows Authenticode code-signing cert (.pfx) | `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` env |
| Microsoft Win32 Content Prep Tool    | https://aka.ms/win32contentpreptool             |
| Microsoft Intune tenant + admin role | https://intune.microsoft.com                    |

You can build all three platforms from a single CI runner, but in practice:

- **macOS .pkg/.dmg** must be built on macOS (signing + notarization).
- **Windows .msi** can be built on Windows (preferred) or on macOS/Linux
  via electron-builder's wine path.
- **Linux .deb/.rpm** can be built on Linux or macOS.

Recommended: a GitHub Actions matrix (mac, win, linux). Not configured yet.

---

## 2. Replace placeholder icons

The repo ships placeholders generated programmatically. Before publishing,
swap these with the real Ingentive logo:

| File                                   | Use                              | Spec            |
|----------------------------------------|----------------------------------|-----------------|
| `electron-resources/icon.icns`                      | macOS app icon                   | 1024×1024 ICNS  |
| `electron-resources/icon.ico`                       | Windows app icon                 | 256×256 ICO     |
| `electron-resources/icon.png`                       | Linux app icon                   | 512×512 PNG     |
| `electron/tray-icon.png`               | Win/Linux tray                   | 22×22 PNG       |
| `electron/tray-icon-Template.png`      | macOS menu bar (template image)  | 22×22 PNG, alpha-only |

For the macOS template icon, draw the glyph in **black with alpha** — macOS
auto-tints it to match the menu bar.

---

## 3. Build matrix

```bash
# macOS — .pkg + .dmg, universal binary
npm run electron:package:mac

# Windows — .msi (x64)
npm run electron:package:win

# Linux — .deb + .rpm (x64)
npm run electron:package:linux

# All three (CI):
npm run electron:package
```

Outputs land in `release/` with the naming
`Ingentive-Agent-OS-${version}-${os}-${arch}.${ext}`.

`npm run electron:build-app` is just an alias for `next build` and is run
automatically by the package scripts.

---

## 4. Signing

### macOS

Export the Developer ID Application certificate into the keychain of the
signing host, then:

```bash
export MAC_SIGNING_IDENTITY="Developer ID Application: Ingentive Limited (TEAMID)"
npm run electron:package:mac
```

`electron-builder` picks up `MAC_SIGNING_IDENTITY` via the
`identity: ${env.MAC_SIGNING_IDENTITY}` field in `electron-builder.yml`.
Hardened runtime + the entitlements in `electron-resources/entitlements.mac.plist` are
applied automatically.

If `MAC_SIGNING_IDENTITY` is unset, electron-builder still **produces** the
artifacts but they are unsigned — only suitable for local smoke-testing,
**not for Intune distribution**.

### Apple notarization

Notarize the signed `.pkg` so Gatekeeper doesn't block install:

```bash
xcrun notarytool submit "release/Ingentive-Agent-OS-0.1.0-mac-universal.pkg" \
  --apple-id "ci@ingentive.com" \
  --team-id "TEAMID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --wait

xcrun stapler staple "release/Ingentive-Agent-OS-0.1.0-mac-universal.pkg"
```

Repeat for the `.dmg` if you intend to distribute that out-of-band.

### Windows

Set the cert env vars before running the package script:

```powershell
$env:WIN_CSC_LINK = "C:\certs\ingentive-code-signing.pfx"
$env:WIN_CSC_KEY_PASSWORD = "…"
npm run electron:package:win
```

electron-builder signs the produced `.msi` with SignTool automatically.

### Linux

`.deb` and `.rpm` packages don't need a code-signing cert for Intune
distribution, but you may wish to sign the `.rpm` with GPG for your
internal yum repo.

---

## 5. Wrap the Windows .msi as .intunewin

Intune Win32 apps need the `.intunewin` wrapper:

1. Download `IntuneWinAppUtil.exe` from
   https://github.com/Microsoft/Microsoft-Win32-Content-Prep-Tool
2. Put the signed `.msi` in a folder by itself, e.g. `C:\stage\agentos`.
3. Run:
   ```powershell
   IntuneWinAppUtil.exe `
     -c C:\stage\agentos `
     -s Ingentive-Agent-OS-0.1.0-win-x64.msi `
     -o C:\stage\out
   ```
4. Upload `C:\stage\out\Ingentive-Agent-OS-0.1.0-win-x64.intunewin` to Intune.

Install command in Intune:
`msiexec /i "Ingentive-Agent-OS-0.1.0-win-x64.msi" /qn`

Uninstall command:
`msiexec /x {YOUR-MSI-PRODUCT-CODE-GUID} /qn`

Detection rule: MSI product code (Intune auto-fills from the package).

---

## 6. Upload to Intune

### macOS line-of-business app (.pkg)

1. Intune admin centre → **Apps** → **macOS** → **Add** → **Line-of-business app**.
2. Upload the **notarized** `.pkg`.
3. Assignment: required for the user group(s) that should have Agent OS.
4. Intune tracks install state via the bundle ID `com.ingentive.agent-os`.

### Windows Win32 app (.intunewin)

1. Intune → **Apps** → **Windows** → **Add** → **Windows app (Win32)**.
2. Upload the `.intunewin`.
3. Install behaviour: **System** (the MSI is per-machine).
4. Install command: see section 5.
5. Detection: MSI product code.

### Linux app

Intune supports Linux app deployment for Ubuntu 22.04+ and RHEL 9+ with
the Intune Linux agent installed:

1. Intune → **Apps** → **Linux** → **Add**.
2. Upload `.deb` (Ubuntu) and/or `.rpm` (RHEL).
3. Assignment: required for the relevant device group.

---

## 7. Per-user vs per-machine install

The Agent OS dashboard reads:

- `~/.claude/`
- `~/.codex/`
- `~/.copilot/`
- `~/Library/Application Support/Code/User/...` (macOS) / equivalents

These are **user-scoped**. The wrapper therefore must run as the
logged-in user, not as a system service.

| Platform | Install scope                                                                 |
|----------|-------------------------------------------------------------------------------|
| macOS    | `/Applications` (machine-wide install, but the app launches per-user)         |
| Windows  | `.msi` is per-machine (`perMachine: true`), launches in user session via login-item |
| Linux    | `.deb`/`.rpm` install per-machine, launched per-user via the desktop entry's auto-start |

Auto-start at login is enabled by default; the tray menu lets each user
toggle it.

---

## 8. Updating

Intune handles updates. Ship a new build by:

1. Bump `package.json` `version`.
2. Build + sign + notarize as above.
3. Re-upload the new artifact to the existing Intune app entry (replace).
4. Intune pushes the new version to assigned devices.

No in-app updater is bundled — do not enable `electron-updater`.

---

## 9. Troubleshooting

| Symptom                                       | Fix                                                                 |
|-----------------------------------------------|---------------------------------------------------------------------|
| macOS install blocked: "unidentified developer" | Notarize the `.pkg` (section 4).                                  |
| Dashboard never opens, tray says "Starting…"  | Check `~/Library/Logs/Ingentive Agent OS/` and the system console. |
| Tray icon missing on Linux                    | Confirm GNOME has AppIndicator extension or use KDE/XFCE.          |
| MSI install fails on user machines            | Confirm Intune assignment is **system** scope.                     |
| Port 3007–3020 all busy                       | The app fails fast with a dialog; rare, but bump `MAX_PORT` in `electron/main.cjs`. |
