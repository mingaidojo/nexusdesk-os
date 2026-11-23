# NexusDesk OS

> **Autonomous Multi-Instance AI Mission Control & Virtual Office Floor (`v2.0.0`)**  
> *Open-Source Edition — Developed & maintained by **Nexus Vantage Labs**.*

---

## Overview

**NexusDesk OS** is a self-hosted control plane and visual operations center for multi-agent autonomous AI fleets across **5 CLI engines**: `hermes`, `claude`, `opencode`, `codex`, and `agy`.

### Key Capabilities (Open-Source Edition)
- **AgentFloor (2D Blueprint & HD Isometric Pixel Loft):** Interactive virtual office canvas where agents work at desks, walk collision-free corridors, and emit real-time activity shouts.
- **1-on-1 Direct Chat & Neural TTS/STT:** Direct console chat per agent with dynamic model selection, artifact quick-view modal, Edge-TTS neural voices, and browser Web Speech recognition.
- **War Rooms (OSS Edition):** Persistent conference rooms (**`#general` + up to 3 custom rooms**, up to 3 agents per room) with participant management, speaker stage, and roundtable deliberation.
- **Workflows DAG & Crons:** Visual multi-step DAG pipelines and UTC/local schedule management.
- **Memory / Wiki & Tools:** Local memory vault, session history, and MCP tool configuration.

---

## Quickstart

### Option 1: GitHub Codespaces (Fastest)
1. Click **`<> Code` → `Codespaces` → `Create codespace on main`**.
2. Once setup completes, run:
   ```bash
   python3 backend/server.py
   ```
3. Open forwarded port **`9200`** from the **Ports** tab.

### Option 2: Docker Compose
```bash
cp .env.example .env
docker compose up -d --build
```
Open `http://127.0.0.1:9200` in Chrome or Edge.

### Option 3: Local Python
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
python3 frontend/build.py
python3 backend/server.py
```
Open `http://127.0.0.1:9200` in Chrome or Edge.

### Managing as a Systemd Service
Use [`manage.sh`](manage.sh) for day-to-day daemon operations:
```bash
./manage.sh status     # Check service & listening port
./manage.sh restart    # Reload systemd units + restart nexusdesk
./manage.sh logs       # Tail live journalctl logs
./manage.sh build      # Compile frontend bundle
```

---

## Architecture

- **Backend (`backend/`):** FastAPI + Uvicorn (configurable via `NEXUSDESK_HOST` / `NEXUSDESK_PORT`, default `127.0.0.1:9200`) with modular domain packages (`routers/`, `services/`, `core/`, `schemas/`) and an optional `backend/plugins/` extension hook.
- **Frontend (`frontend/`):** Zero-dependency partial compiler ([`frontend/build.py`](frontend/build.py)) assembling HTML partials (`src/templates/`) and modular JS (`src/js/`) into `frontend/dist/index.html`.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for topology and WebSocket contracts.

---

## Versioning & Documentation

- **Current Version:** [`VERSION`](VERSION) (`2.0.0`)
- **Release Notes:** [`CHANGELOG.md`](CHANGELOG.md)
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Versioning Workflow:** [`docs/VERSIONING_AND_RELEASES.md`](docs/VERSIONING_AND_RELEASES.md)

---

## License

Released under the [MIT License](./LICENSE).  
Copyright © 2026 **Nexus Vantage Labs**. All rights reserved.
