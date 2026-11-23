# Changelog

All notable changes to **Nexus Desk OS** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) tracked in [`VERSION`](./VERSION).

---

## [2.0.0] - 2026-11-13

### Added
- **Unified Semantic Versioning (`VERSION`)**: Single canonical version file (`2.0.0`) wired into FastAPI (`server.py`), `/api/system`, `/api/version`, `frontend/build.py` footer stamps (`v2.0.0 • Build YYYYMMDD-NN`), and [`scripts/bump_version.py`](scripts/bump_version.py).
- **Documentation Suite**: Added [`CHANGELOG.md`](CHANGELOG.md), [`docs/VERSIONING_AND_RELEASES.md`](docs/VERSIONING_AND_RELEASES.md), [`docs/MODULARIZATION_REPORT_202611.md`](docs/MODULARIZATION_REPORT_202611.md), and updated [`README.md`](README.md) & [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Daemon Management Script**: Added [`manage.sh`](manage.sh) (`start`, `stop`, `restart`, `status`, `logs`, `reload`) with automatic `systemctl daemon-reload` handling.
- **Modular Backend Packages**:
  - `backend/services/chat_agents/` (`paths.py`, `registry.py`, `market_intel.py`, `subdata.py`, `sessions_guardrails.py`, `crons_workspace.py`, `llm_engine.py`, `__init__.py` exporting 73 symbols).
  - `backend/services/gateways/` (`store.py`, `pairing.py`, `transports.py`, `briefings.py`, `inbound.py`, `__init__.py` exporting 36 symbols).
  - `backend/routers/war_room/` (`routing_helpers.py`, `rooms.py`, `sandbox.py`, `ops.py`, `chat_turn.py`, `__init__.py` aggregating 43 War Room endpoints).
- **Modular Frontend Subsystems**:
  - `frontend/src/js/modules/floor/` (7 AgentFloor modules: themes/camera, iso blocks, loft furniture, loft scene, 2D office, navigation AI, interactions).
  - `frontend/src/js/modules/chat_agents/` (5 Chat Agents Studio modules: registry, Sub-Data studio, file explorer, SIM/simulator, crons/evolutions).
  - `frontend/src/js/modules/chat/` expanded with `file_preview_artifacts.js`, `voice_tts_engine.js`, `war_room_tabs_switcher.js`, `war_room_rooms.js`, `war_room_mentions_search.js`, and `war_room_messaging.js`.
  - Split `modal_chat_agents.html` into `modal_chat_agent_form.html`, `modal_chat_agent_studio.html`, and `modal_chat_agent_ops.html`.

### Changed
- Standardized JSDoc `@module` headers across extracted frontend modules and `workflows_dag.js`, normalized LF line endings, and added Python package docstrings + section banners.
- Updated `.agents/skills/nexusdesk-dev/` (`SKILL.md` and `references/domino_effects.md`) to match the modular architecture and production interpreter (`/usr/local/lib/hermes-agent/venv/bin/python`).

### Fixed
- Added missing `import subprocess` in `backend/services/chat_agents/market_intel.py` (`extract_media_ocr_text`) and `backend/routers/war_room/sandbox.py` (`war_room_sandbox_archive`).
- Re-exported `war_room_reminders_watcher` in `backend/routers/war_room/__init__.py` for `server.py` lifespan startup.

### Removed
- Removed obsolete unreferenced legacy files: `backend/services/chat_agents.py.bak`, `frontend/src/js/modules/chat_console.js`, and `frontend/src/js/modules/workflows_crons.js`.

---

## [1.x / 0.2.0] - 2026-10-08 to 2026-11-12

### Added
- **Multi-Engine Execution Plane**: Unified CLI orchestration for `hermes`, `claude`, `opencode`, `codex`, and `agy` with 240s SIGINT soft-interception (`BL-WAR-47`), stream reading, and token-exhaustion failover.
- **War Rooms & Roundtable Deliberation**: Multi-agent conference rooms, shared sandboxes, two-phase async background tasks, natural-language reminders, operator decision matrix chips, and Teams-style stage view.
- **Chat Agents & Sub-Data Studio (`BL-EVO-42`)**: Dedicated Baileys multi-session WhatsApp SIM pairing, native `.xlsx` catalog/catering/orders sync, 5D anti-spam guardrails, and isolated per-agent crons.
- **Omnichannel Gateways (`BL-SYS-64`)**: WhatsApp + Telegram Global Mission Control (`/global`) and room routing with strict origin isolation.
- **Neural & Local TTS (`BL-TTS-15`)**: Edge-TTS, Piper-TTS, and browser Web Speech API synthesis/recognition with per-agent voice profiles.
- **Initial Modularization (Oct 2026)**: Split monolithic `server.py` into `routers/` and `services/`, and compiled `frontend/src/` partials via `frontend/build.py`.
