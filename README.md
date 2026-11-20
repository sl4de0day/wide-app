<p align="center">
  <img src="assets/wide-logo.png" alt="Wide App" width="128">
  <h1 align="center">Wide App</h1>
  <p align="center">Prompt-only AI workspace for building and securing web projects without a full IDE</p>
</p>

<p align="center">
  <a href="https://github.com/sl4de0day/wide-app/releases/latest">Download</a> ·
  <a href="#building-from-source">Build</a> ·
  <a href="https://github.com/sl4de0day/wide-app/releases">Changelog</a> ·
  <a href="https://github.com/sl4de0day/wide-ide">Wide IDE</a> ·
  <a href="https://github.com/sl4de0day/wide-cli">Wide CLI</a> ·
  <a href="https://github.com/sl4de0day/wide-sdk">Wide SDK</a> ·
  <a href="https://github.com/sl4de0day/wide-action">Wide Action</a> ·
  <a href="https://github.com/sl4de0day/wide-rules">Wide Rules</a> ·
  <a href="LICENSE">License</a>
</p>

---

> **Wide blends web development and web security into one AI-powered workflow.** Write the code, catch the vulnerability, and test the fix in the same place.

**Wide App is for people who want to work only through prompts and do not need an advanced IDE. Point it at a project folder, describe what you want, and Wide's AI agents write the code, run the commands, and audit the result for security issues. When you need the editor, debugger, and pentest workbench, open the same project in [Wide IDE](https://github.com/sl4de0day/wide-ide).**

Wide App is a high-performance cross-platform application designed for speed and minimal resource usage:
- **Windows:** Electron desktop host with automated, checksum-verified background updates.
- **Linux:** Lightweight Wayland/X11 host running on dedicated Chromium runtime with multi-distro packaging.
- **Core Engine:** High-speed React renderer paired with a multi-threaded Node.js backend sidecar.

## Features

- **Autonomous Agent.** A prompt-driven engineering loop with native tool execution (`read_file`, `write_file`, `edit_file`, `list_dir`, `run_command`, `web_search`) directly targeting your local workspace.
- **Autonomous CDP Browser Drawer.** Built-in Playwright/CDP browser automation with live screencast frames, element highlighting overlays, HAR 1.2 traffic export with header redaction, stealth evasion mode, and 16 agent browser tools.
- **Integrated Database Subsystem.** Multi-engine database manager for SQLite, PostgreSQL, MySQL, and Redis with execution timing, persistent query history, CSV/JSON/SQL export, and Mermaid ERD visualization.
- **Project Isolation.** Every conversation binds to an explicit project directory, ensuring AI operations strictly stay within designated project boundaries.
- **AI Integration.** Pluggable multi-provider architecture supporting local offline inference via Ollama, cloud providers (Gemini, Claude, DeepSeek), and your existing Claude Code, Codex, and Antigravity subscriptions.
- **Session Management.** Complete conversation history with fast search, message pinning, grouped timestamp categorization, and instant workspace switching.
- **Cross-App Chat Synchronization.** Shares conversation state with Wide IDE (`active-chat.json`) and enables instant transition via the title bar.
- **Desktop Experience.** Maximized window management and native dark/light theme adaptation on Windows and Linux.

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
- Rust toolchain (cargo and rustc)
- Inno Setup 6 (to produce the installer)

```bash
npm install
npm run build
npm run package:win
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

## The Wide Ecosystem

Wide blends web development and web security into one AI-powered workflow. Every product runs on the same security rules, so a vulnerability caught in one place is caught everywhere.

| Product | Who it is for |
| :--- | :--- |
| [Wide IDE](https://github.com/sl4de0day/wide-ide) | **The flagship.** A full IDE for web developers and pentesters: write code, see vulnerabilities as you type, and test them with built-in pentest tools and AI agents. |
| [Wide App](https://github.com/sl4de0day/wide-app) | A prompt-only AI workspace for people who do not need a full IDE. Describe the task; Wide's agents build, fix, and audit the project. |
| [Wide CLI](https://github.com/sl4de0day/wide-cli) | The same AI agents and security scanner in your terminal. |
| [Wide Action](https://github.com/sl4de0day/wide-action) | The same rules as a pull request security gate in GitHub CI. |
| [Wide SDK](https://github.com/sl4de0day/wide-sdk) | A Python library for building your own agents on Wide's security tooling. |
| [Wide Rules](https://github.com/sl4de0day/wide-rules) | The shared rule and advisory database behind every Wide product. |

## License

Wide App is free software licensed under the [GNU General Public License v3](LICENSE).

Copyright (C) 2026 sl4de.
