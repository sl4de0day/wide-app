<p align="center">
  <img src="assets/wide-logo.png" alt="Wide App" width="128">
  <h1 align="center">Wide App</h1>
  <p align="center">Desktop-first autonomous AI engineering and chat companion for the Wide ecosystem</p>
</p>

<p align="center">
  <a href="https://github.com/sl4de0day/wide-app/releases/latest">Download</a> ·
  <a href="#building-from-source">Build</a> ·
  <a href="https://github.com/sl4de0day/wide-app/releases">Changelog</a> ·
  <a href="https://github.com/sl4de0day/wide-ide">Wide IDE</a> ·
  <a href="https://github.com/sl4de0day/wide-cli">Wide CLI</a> ·
  <a href="https://github.com/sl4de0day/wide-sdk">Wide SDK</a> ·
  <a href="LICENSE">License</a>
</p>

---

**Wide App is a desktop-first autonomous AI workspace and chat companion that brings intelligent pair programming, code refactoring, and security auditing into a focused, distraction-free environment. Bound directly to your local project folders, it executes commands, inspects code, and performs multi-step engineering workflows with zero IDE clutter.**

Wide App is a high-performance cross-platform application designed for speed and minimal resource usage:
- **Windows:** Native Windows desktop shell running on Chromium runtime with hardware-accelerated rendering and automatic updates.
- **Linux:** Lightweight Wayland/X11 host running on dedicated Chromium runtime with multi-distro packaging.
- **Core Engine:** High-speed React renderer paired with multi-threaded Node.js backend sidecar and OpenCode integration.

## Features

- **Autonomous Agent.** A prompt-driven engineering loop with native tool execution (`read_file`, `write_file`, `edit_file`, `list_dir`, `run_command`, `web_search`) directly targeting your local workspace.
- **Project Isolation.** Every conversation binds to an explicit project directory, ensuring AI operations strictly stay within designated project boundaries.
- **AI Integration.** Pluggable multi-provider architecture supporting local offline inference via Ollama or OpenCode CLI, alongside cloud providers (Gemini, Claude, DeepSeek, OpenAI).
- **Session Management.** Complete conversation history with fast search, message pinning, grouped timestamp categorization, and instant workspace switching.
- **Desktop Experience.** Seamless ASCII logo splash animation on startup, maximized window management, and native dark/light theme adaptation.

## Installation

### Windows
Download the latest `Wide-App-Setup-*.exe` from the [Releases](https://github.com/sl4de0day/wide-app/releases/latest) page and run it. Wide App installs per user, so no administrator rights are required, and it places convenient shortcuts on your desktop and start menu.

### Linux
Download the package corresponding to your Linux distribution from [Releases](https://github.com/sl4de0day/wide-app/releases/latest):
- **Universal (.AppImage):**
  ```bash
  chmod +x Wide-App-*-x86_64.AppImage
  ./Wide-App-*-x86_64.AppImage
  ```
- **Ubuntu / Debian / Kali / Mint (.deb):**
  ```bash
  sudo apt install ./wide-app_*_amd64.deb
  ```
- **Fedora / RHEL / openSUSE (.rpm):**
  ```bash
  sudo dnf install ./wide-app-*.rpm
  ```
- **Arch Linux / Manjaro (.pkg.tar.zst):**
  ```bash
  sudo pacman -U ./wide-app-*.pkg.tar.zst
  ```

Wide App on Linux features native Wayland support, high DPI scaling, and desktop launcher integration.

## Building from source

### Windows
Requirements:
- Windows (x64)
- Node.js 18 or newer
- npm

```bash
npm install
npm run build:linux
node scripts/package-win.cjs
```

### Linux
Requirements:
- Linux (x86_64)
- Node.js 18 or newer
- npm

```bash
npm install
npm run build:linux

npm run package:appimage
npm run package:deb
npm run package:rpm
npm run package:arch

npm run package:all
```

## License

Wide App is free software licensed under the [GNU General Public License v3](LICENSE).

Copyright (C) 2026 sl4de.
