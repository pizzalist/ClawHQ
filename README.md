<div align="center">

# 🏢 AI Office

**Virtual AI Company Management Platform**

*Watch AI agents collaborate in a virtual office — assign tasks, build teams, and ship products with autonomous AI workers.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![PixiJS](https://img.shields.io/badge/PixiJS-7-E72264?logo=data:image/svg+xml;base64,&logoColor=white)](https://pixijs.com/)
[![Built with OpenClaw](https://img.shields.io/badge/Built%20with-OpenClaw-blueviolet)](https://openclaw.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![AI Office Screenshot](docs/screenshot.png)

</div>

---

## What is this?

AI Office is a visual management platform where AI agents work as a team inside a virtual office. You define roles (PM, developer, designer, QA, DevOps), assign tasks, and watch them collaborate in real-time — complete with animated sprites, desk assignments, and a live activity feed.

Think of it as **a company where every employee is an AI**.

## ✨ Features

- 🖥️ **Isometric Office View** — PixiJS-rendered office with desks, agents, and real-time state animations
- 🤖 **Multi-Agent Teams** — PM, Developer, Reviewer, Designer, DevOps, QA roles with configurable AI models
- 📋 **Task Management** — Create, assign, and track tasks with automatic agent orchestration
- 🔗 **Task Chaining** — Agents can spawn sub-tasks, forming autonomous workflows
- 📊 **Live Dashboard** — Real-time metrics, agent states, and task progress
- 💬 **Activity Feed** — WebSocket-powered live log of all agent actions and events
- ⚡ **Command Input** — Natural language commands to manage your AI team
- 🎭 **Team Presets** — One-click team configurations for common setups
- 🔴 **Failure Timeline** — Visual debugging of failed tasks and error chains
- 🎮 **Demo Mode** — Works without OpenClaw CLI for exploration and development

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 10
- [**OpenClaw**](https://openclaw.com) CLI (optional — runs in demo mode without it)

### Install & Run

```bash
git clone https://github.com/anthropics/ai-office.git
cd ai-office
npm install
npm run dev
```

The web UI opens at `http://localhost:5173` and the API server runs on `http://localhost:3100`.

### Production Build

```bash
npm run build
npm run start -w @ai-office/server
```

## 🏗️ Architecture

```
ai-office/
├── packages/
│   ├── web/          # React + PixiJS frontend
│   │   └── src/
│   │       ├── office/       # PixiJS scene (Floor, Desks, AgentSprites)
│   │       ├── components/   # React UI (Sidebar, Dashboard, TaskModal...)
│   │       └── store.ts      # Zustand state + WebSocket client
│   ├── server/       # Express + WebSocket backend
│   │   └── src/
│   │       ├── index.ts            # HTTP + WS server
│   │       ├── agent-manager.ts    # Agent lifecycle & state machine
│   │       ├── task-queue.ts       # Task assignment & orchestration
│   │       ├── openclaw-adapter.ts # OpenClaw CLI integration
│   │       └── db.ts              # SQLite persistence
│   └── shared/       # Shared types & constants
├── turbo.json        # Turborepo pipeline
└── package.json      # Workspace root
```

**Data flow:** React UI ↔ WebSocket ↔ Express Server ↔ OpenClaw CLI ↔ AI Models

## ⚙️ How It Works

1. **Create agents** with roles (developer, PM, etc.) and AI models (Claude, GPT)
2. **Submit tasks** via the UI or command input
3. The **task queue** assigns work to idle agents based on role matching
4. The server spawns **OpenClaw sessions** that execute tasks autonomously
5. Agents transition through states: `idle` → `working` → `reviewing` → `done`
6. Agents can **chain tasks** — a PM can break work into subtasks for developers
7. Everything syncs in real-time via WebSocket to the visual office

Without the OpenClaw CLI installed, the app runs in **demo mode** with simulated agent behavior.

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, PixiJS 7, Zustand, Vite |
| Backend | Express, WebSocket (ws), better-sqlite3 |
| Shared | TypeScript 5.7, Turborepo |
| AI Runtime | OpenClaw CLI |

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## 📄 License

[MIT](LICENSE) © 2026

---

<div align="center">

**Built with [OpenClaw](https://openclaw.com)** 🐾

*Give it a ⭐ if you think AI agents deserve an office too.*

</div>
