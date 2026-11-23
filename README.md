# Nexus Desk OS

> **Autonomous Multi-Instance AI Mission Control & Virtual Office Floor (`v2.0.0`)**  
> *Developed & maintained by **Nexus Vantage Labs** (`nexusvantagelabs`).*

---

## Overview

**Nexus Desk OS** is a self-hosted control plane and visual operations center for multi-agent autonomous AI fleets across **5 CLI engines**: `hermes`, `claude`, `opencode`, `codex`, and `agy`.

Key capabilities:
- **AgentFloor (2D Blueprint & HD Isometric Pixel Loft)**: Interactive virtual office canvas where agents work at desks, walk collision-free corridors, gather for conference briefings, and emit real-time activity shouts.
- **Multi-Agent War Rooms & Roundtable**: Persistent conference rooms with participant whitelists, Teams-style speaker stage, two-phase async background tasks in isolated sandboxes, natural-language reminders, and rotational roundtable deliberation.
- **1-on-1 Direct Chat & Neural TTS/STT**: Direct console chat per agent with dynamic model selection, artifact quick-view modal, Edge-TTS / Piper-TTS neural voices, and browser Web Speech recognition.
- **Chat Agents & Sub-Data Studio (`BL-EVO-42`)**: Dedicated Baileys multi-session WhatsApp SIM pairing, native `.xlsx` catalog/catering/orders sync, 5D anti-spam guardrails, and isolated per-agent crons.
- **Omnichannel Gateways (`BL-SYS-64`)**: WhatsApp & Telegram command routing (`/global` vs `/room`) with strict channel origin isolation.
- **Crons, Workflows DAG & Self-Evolving Hub**: Visual DAG pipelines, UTC/local schedule management, and autonomous backlog/snapshot rollback tooling.

---

## Architecture

- **Backend (`backend/`)**: FastAPI + Uvicorn on `:9200`, modularized into domain packages:
  - `routers/` (`war_room/`, `chat_agents.py`, `gateways.py`, `chat.py`, `fleet.py`, `models.py`, `tts.py`, `workflows.py`, `crons.py`, `self_evolving.py`, `fs.py`, `sessions.py`, `agents.py`, `tools_mcp.py`, `memory_wiki.py`, `auth.py`, `system_storage.py`)
  - `services/` (`cli_executor.py`, `chat_agents/`, `gateways/`, `war_room/`, `whatsapp/index.js`, `agent_runner.py`, `snapshot_vault.py`, `storage_cleaner.py`)
- **Frontend (`frontend/`)**: Zero-dependency partial compiler ([`frontend/build.py`](frontend/build.py)) assembling HTML partials (`src/templates/`) and modular JS (`src/js/core/`, `src/js/modules/{floor,chat,chat_agents}/`) into `frontend/dist/index.html`.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for full topology and WebSocket contracts.

---

## Quickstart & Operations

### Running Locally
```bash
# Build frontend bundle
python3 frontend/build.py

# Start backend server (using production venv)
/usr/local/lib/hermes-agent/venv/bin/python backend/server.py
```

Open `http://127.0.0.1:9200` in Chrome or Edge.

### Managing the Systemd Daemon
Use [`manage.sh`](manage.sh) for day-to-day daemon operations (handles `systemctl daemon-reload` automatically):

```bash
./manage.sh status     # Check service & live health
./manage.sh restart    # Reload systemd units + restart nexusdesk
./manage.sh logs       # Tail live journalctl logs
./manage.sh stop       # Stop daemon
./manage.sh start      # Start daemon
```

---

## Versioning & Documentation

- **Current Version**: [`VERSION`](VERSION) (`2.0.0`) — exposed via `GET /api/version`, `GET /api/system`, and the UI footer.
- **Release Notes**: [`CHANGELOG.md`](CHANGELOG.md)
- **Versioning Workflow**: [`docs/VERSIONING_AND_RELEASES.md`](docs/VERSIONING_AND_RELEASES.md) & [`scripts/bump_version.py`](scripts/bump_version.py)
- **Architecture & Modularization**:
  - [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
  - [`docs/MODULARIZATION_REPORT_202611.md`](docs/MODULARIZATION_REPORT_202611.md)
  - [`docs/OMNICHANNEL_CONTEXT_ROUTING.md`](docs/OMNICHANNEL_CONTEXT_ROUTING.md)
  - [`BACKLOG.md`](BACKLOG.md)

---

## License

Released under the [MIT License](./LICENSE).  
Copyright © 2026 **Nexus Vantage Labs**. All rights reserved.
