# Lingvist Desktop

> Put the Lingvist website into a small Windows desktop window: frameless,
> always-on-top, with adjustable opacity — park it in a corner and drill vocabulary.

An Electron **desktop shell** that loads the official site <https://lingvist.com/>
as-is. It does not re-implement, modify, or cache any web content. Sign in with your
own account and the experience is identical to the browser.

> ⚠️ This project is only a shell. It does not include or distribute any Lingvist
> content or trademarks. The Lingvist name, trademarks and product content belong to
> their official owner. The app icon is an original design made for this project.

[简体中文](./README.md) | English

## What it is / isn't

| | |
|---|---|
| ✅ Is | A desktop window that loads the official site, plus desktop features: tray, always-on-top, frameless, opacity |
| ❌ Isn't | A Lingvist client rewrite, crack, offline course pack, or third-party API wrapper |

## Features

- **Frameless window**: no title bar, the page fills the entire window
- **Drag anywhere**: hold the left mouse button on any blank area to move the window
- **Always on top**: floats above other windows, toggleable (on by default)
- **Adjustable opacity**: 30%–100%, via hotkeys or a slider
- **System tray**: closing the window just hides it to the tray; click the tray icon to bring it back
- **Remembers window state**: size, position, maximized state and opacity are persisted
- **Customizable shortcuts**: every shortcut can be rebound in the settings window
- **Persistent login**: cookies / localStorage are kept, so you stay signed in
- External links open in your system browser; microphone permission is granted only to lingvist.com (needed for listening exercises)
- Offline? You get a retryable error page instead of a blank screen

## Quick start

Requirements: Windows x64, Node.js 18 or newer.

```bash
npm install
npm start
```

If you prefer not to touch the command line, just double-click **`start.bat`**.

> Slow Electron download in some regions:
> `npm config set electron_mirror https://npmmirror.com/mirrors/electron/`

## Building

```bash
npm run dist          # NSIS installer + portable exe
npm run dist:portable # portable single file only
npm run dist:dir      # runnable folder only: dist/win-unpacked
```

Output goes to `dist/`. Double-click `dist/win-unpacked/Lingvist Desktop.exe` to run,
or right-click it → "Send to" → "Desktop (create shortcut)".

## Controls

| Action | How |
|--------|-----|
| Move window | Hold left mouse button on any blank area and drag |
| Resize | Drag any edge / corner (native Windows behavior) |
| Show / hide | `Ctrl+Shift+H`, or click the tray icon |
| Toggle always-on-top | `Ctrl+Shift+T`, or tray menu → "Always on top" |
| Opacity | `Ctrl+Shift+ -` / `Ctrl+Shift+ =` (also `↑` `↓`), 10% per step |
| Open settings | `Ctrl+Shift+,`, or tray menu → "Settings…" |
| Reset window size | `Ctrl+Shift+D` |
| Reload | `Ctrl+R` |
| Quit | Tray menu → "Quit" (closing the window only hides it) |

Dragging only starts after the pointer moves more than 6px, and is disabled on inputs,
buttons, links and video elements — so normal clicking is unaffected.

## Settings window

Open it with `Ctrl+Shift+,` or tray menu → "Settings…":

- Opacity slider + presets (applies live)
- Always-on-top switch
- Shortcut recording for five actions: click a field, then press the new key combo
  (Esc cancels, "Clear" disables)

**Shortcuts that fail to register are highlighted in red** — just pick a different combo.
Settings are stored in `%APPDATA%/Lingvist Desktop/settings.json`.

## Project structure

```
src/
  main.js        Main process: window, tray, settings, shortcuts, navigation guard
  preload.js     Preload: drag-anywhere + minimal IPC bridge
  settings.html  Settings window UI
  error.html     Fallback page when loading fails
assets/          Icons (tray / window / installer)
scripts/
  make-icon.js      Generates a placeholder icon (pure Node, no assets needed)
  use-image-icon.js Converts an image into the full icon set
start.bat / start-safe.bat    Launchers
build-installer-admin.bat     Build an installer (run as administrator)
```

## FAQ

**Blank window / exits immediately**
Don't launch it from the terminal or file preview of another Electron app (VS Code,
another instance of this project, etc.) — that triggers
`Invalid file descriptor to ICU data received`. Double-click it from Explorer instead.

**Crashes on startup with `GPU process isn't usable`**
The GPU process can't start. Use `npm run start:safe`, or double-click `start-safe.bat`.
Note that Chromium flags must be written **before** the app path.

**Shortcuts don't work**
Open the settings window and check whether they're marked red — Electron can't register
a combo that's already taken by the system or another app. Pick another one. Every
feature is also reachable from the tray menu, so you can never get locked out.

**Build fails with `Cannot create symbolic link`**
Windows requires the "Create symbolic links" privilege. Right-click
`build-installer-admin.bat` → Run as administrator, or enable Windows Developer Mode.

**Login redirect is blocked**
Add the relevant domain to `ALLOWED_HOSTS` in `src/main.js`.

**Why is it ~300MB?**
Electron bundles an entire Chromium runtime; our own code is only 0.4MB. If that
bothers you, the only real fix is switching to a WebView2 approach (Tauri, etc.),
which drops the size to a few MB but means rewriting the main process.

## Privacy & compliance

- No data is collected or uploaded; all session data stays on your machine
- No script injection, no page rewriting — navigation is guarded only at the shell level
- Third-party login domains (Google / Apple) are allowed inside the app and share the session

## License

The code is released under the [MIT License](./LICENSE).
Lingvist trademarks and content belong to their official owner.
