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

## Overview

Wide App brings the autonomous AI engineering agent capabilities of the Wide ecosystem into a focused, distraction-free desktop application. Powered by native project workspace integration, multi-model support, and conversational AI orchestration, Wide App allows you to direct full-stack coding tasks, architecture modifications, and security audits through natural language prompts.

- **Prompt-Driven Engineering:** Autonomous AI agent with native tool execution (`read_file`, `write_file`, `edit_file`, `list_dir`, `search`, `run_command`) directly targeting your local project folders.
- **Project-Centric Conversations:** Each conversation session is bound to an explicit local project directory, ensuring LLM operations and OpenCode runs strictly in your project files rather than temporary system folders.
- **Multi-Model & Provider Freedom:** Connect to local offline models via **Ollama** or **OpenCode CLI**, or utilize cloud providers (**Claude**, **Gemini**, **DeepSeek**, **OpenAI**).
- **Session History & Organization:** Pinned conversations, search across chats, grouped session timestamps, and quick switching across workspaces.
- **Minimalist Desktop UX:** Custom lightweight shell with maximized launch, ASCII splash animation, zero clutter, and dark/light system theme adaptation.

## Installation

### Pre-built Releases
Download the latest executable from the [Releases](https://github.com/sl4de0day/wide-app/releases/latest) page.

### Building from Source

Requirements:
- Node.js 18 or newer
- npm

```bash
git clone https://github.com/sl4de0day/wide-app.git
cd wide-app
npm install
npm run build:renderer
npm run build:backend
npm start
```

## Quick Start

1. **Launch Wide App:**
   Open the application. You are greeted with a clean workspace overview without distractions.

2. **Start a Conversation:**
   Click **New conversation** (or press `Ctrl+L`). Select your local project directory in the native folder picker.

3. **Prompt the Agent:**
   Direct Wide Agent with your engineering prompt:
   - "Refactor the authentication flow to use JWT tokens and secure HTTP-only cookies"
   - "Scan this repository for SQL injection and fix all identified vulnerabilities"
   - "Write comprehensive integration tests for the user payment endpoints"

4. **Multi-Model Switching:**
   Switch effortlessly between cloud reasoning models (DeepSeek-R1, Claude 3.7 Sonnet, Gemini 2.5 Flash) and local offline inference via Ollama or OpenCode CLI directly from the model picker.

## Ecosystem Architecture

| Component | Repository | Role |
| :--- | :--- | :--- |
| **Wide IDE** | [wide-ide](https://github.com/sl4de0day/wide-ide) | Security-first IDE with built-in pentest tools and AI agents |
| **Wide CLI** | [wide-cli](https://github.com/sl4de0day/wide-cli) | Terminal-first autonomous AI coding & security agent |
| **Wide SDK** | [wide-sdk](https://github.com/sl4de0day/wide-sdk) | Python framework for building custom autonomous coding and security agents |
| **Wide App** | [wide-app](https://github.com/sl4de0day/wide-app) | Desktop-first autonomous AI engineering and chat companion |

## License

Wide App is free software licensed under the [GNU General Public License v3](LICENSE).

Copyright (C) 2026 sl4de.
