# Nexus Desk OS Architectural Specification & Inter-Module Guide

> **Production Architectural Guide for Nexus Desk OS (v2.0.0)**  
> *Authored by Nexus Vantage Labs (`BL-ARCH-32`, updated Nov 2026)*

---

## 1. Architectural Topology Overview

Nexus Desk OS is an autonomous multi-instance mission control hub and virtual operations floor for AI agent fleets (`hermes`, `claude`, `opencode`, `codex`, `agy`).

```mermaid
flowchart TD
    ClientBrowser["Client Browser (SPA Vanilla JS)"] <-->|HTTP / REST API| FastAPIServer["FastAPI Server (:9200)"]
    ClientBrowser <-->|WebSocket (/ws/events)| EventBus["FastAPI Event Bus"]

    subgraph Backend_Modular_Architecture["Backend Modular Architecture"]
        FastAPIServer --> Routers["Modular Routers (backend/routers/)"]
        Routers --> CoreConfig["Core Config & Security (core/config.py)"]
        Routers --> CLIExecutor["Unified CLI Executor (services/cli_executor.py)"]
        Routers --> SnapshotVault["Snapshot Vault (services/snapshot_vault.py)"]
        Routers --> WarRoomServices["War Room Sub-Services (services/war_room/)"]
    end

    subgraph WarRoomServices["War Room Sub-Services"]
        Tasks["tasks.py (Async Jobs & Quotas)"]
        Reminders["reminders.py (Temporal Parsing & 5s Watcher)"]
        Inquiries["inquiries.py (Decision Matrix & Quick Chips)"]
        Participants["participants.py (Cross-Fleet Discovery & Whitelist)"]
        Execution["execution.py (Transcript Injection & Turn Chaining)"]
        RoundTable["roundtable.py (Multi-Round Rotational Deliberation)"]
    end

    subgraph Linux_Execution_Plane["Host Agent Execution Plane"]
        CLIExecutor -->|sudo -u agents_bs| HermesCLI["Hermes Agent CLI"]
        CLIExecutor -->|sudo -u freecoder| ClaudeCLI["Claude Code CLI"]
        CLIExecutor -->|sudo -u freecoder| OpenCodeCLI["OpenCode CLI (Zen Free)"]
        CLIExecutor -->|sudo -u thecodexer| CodexCLI["OpenAI Codex CLI"]
        CLIExecutor -->|sudo -u myvirtualcoder| AgyCLI["Antigravity AGY CLI"]
    end
```

---

## 2. Backend Sub-Service Contracts

### `services/cli_executor.py`
- **Purpose**: Eliminates duplicate subprocess invocation across 1-on-1 direct chat and multi-agent War Rooms.
- **Functions**:
  - `find_engine_binary(engine: str, user: str) -> Optional[str]`: Automatically discovers executable binaries in standard and user paths.
  - `sanitize_engine_output(raw_output: str, engine: str, agent_name: str) -> str`: Normalizes stdout/stderr across all 5 engines, stripping banner junk, token meters, and session IDs.
  - `run_agent_cli(...) -> Tuple[str, Optional[str]]`: Central async subprocess runner with strict timeouts, sandbox injection (`WARROOM_SANDBOX`, `WARROOM_SCRATCH`, `WARROOM_DELIVERABLES`), and model fallback retries.

### `services/snapshot_vault.py`
- **Purpose**: Creates pre-flight rollback tarballs and git branch safety snapshots before code edits.
- **Functions**:
  - `create_preflight_snapshot(item_id: str) -> Dict[str, Any]`
  - `restore_preflight_snapshot(archive_path_str: str) -> Dict[str, Any]`
  - `poll_canary_healthcheck(timeout_seconds: float = 5.0) -> bool`
  - `list_snapshots() -> List[Dict[str, Any]]`

### `services/war_room/`
- **`tasks.py`**: Two-phase asynchronous job ledger (`war_room_bg_tasks.json`), shared sandbox directory provisioning (`/home/nexus_shared/sandboxes/{room_id}`), and 1 GB quota enforcement.
- **`reminders.py`**: Natural-language temporal parsing (relative `in 15m`, absolute `at 12:00 PM JKT`, turn-conditioned `after Solaris finishes`, or `next hop`), background 5-second polling loop, and reminder broadcasts.
- **`inquiries.py`**: Operator decision matrix for questions requiring human guidance, 1-click option chips, and auto-resolution on human reply.
- **`participants.py`**: Cross-fleet dynamic agent discovery, room participant whitelist isolation, un-roped mention guarding, and broadcast panelist selection.
- **`execution.py`**: Contextual prompt preparation, recent transcript formatting, and turn execution.
- **`roundtable.py`**: Multi-round rotational deliberation orchestration ending with lead executive synthesis.

---

## 3. Frontend Modular Partial Architecture

The frontend is built using zero external dependencies via [`frontend/build.py`](file:///home/myvirtualcoder/nexusdesk/frontend/build.py).

### HTML Template Partials (`frontend/src/templates/`)
- **`layout/`**: `sidebar.html`, `header.html`, `footer.html`.
- **`tabs/`**: `tab_floor.html`, `tab_console.html`, `tab_roster.html`, `tab_memory.html`, `tab_tools_matrix.html`, `tab_tools_configured.html`, `tab_tools_catalog.html`, `tab_models_agents.html`, `tab_models_failover.html`, `tab_models_reasoning.html`, `tab_models_memory.html`, `tab_models_library.html`, `tab_crons.html`, `tab_workflows.html`, `tab_chat_agents.html`, `tab_security.html`, `tab_system_daemon.html`, `tab_self_evolving.html`.
- **`modals/`**: Modular modal partials including `modal_chat_agent_{form,studio,ops}.html`, `modal_roundtable.html`, `modal_warroom_sandbox.html`, `modal_warroom_reminders.html`, `cron_modal.html`, and self-evolving inspection modals.

### JavaScript Submodules (`frontend/src/js/`)
- **`core/`**: `auth_interceptor.js`, `fleet_state.js`, `ui_navigation.js`, `hermes_sync.js`, `app_init.js`.
- **`modules/floor/`**: `floor_themes_camera.js`, `floor_iso_blocks.js`, `floor_iso_loft_furniture.js`, `floor_iso_loft.js`, `floor_2d_office.js`, `floor_navigation_ai.js`, `floor_interactions.js`.
- **`modules/chat_agents/`**: `ca_core_registry.js`, `ca_subdata_studio.js`, `ca_file_explorer.js`, `ca_sim_whatsapp.js`, `ca_crons_evolutions.js`.
- **`modules/chat/`**: `file_preview_artifacts.js`, `direct_chat.js`, `voice_tts_engine.js`, `war_room_tabs_switcher.js`, `war_room_rooms.js`, `war_room_stage.js`, `war_room_mentions_search.js`, `war_room_inquiries.js`, `war_room_reminders_tasks.js`, `war_room_messaging.js`, `war_room_roundtable.js`, `chat_export_copy.js`.
- **`modules/`**: `roster.js`, `agentfloor_iso.js`, `memory_vault.js`, `models_reasoning.js`, `agent_crud.js`, `tools_mcp.js`, `model_library.js`, `crons.js`, `workflows_dag.js`, `security_auth.js`, `system_maintenance.js`, `self_evolving.js`.

### Modular Backend Packages (`backend/`)
- **`routers/war_room/`**: `routing_helpers.py`, `rooms.py`, `sandbox.py`, `ops.py`, `chat_turn.py`, `__init__.py`.
- **`services/chat_agents/`**: `paths.py`, `registry.py`, `market_intel.py`, `subdata.py`, `sessions_guardrails.py`, `crons_workspace.py`, `llm_engine.py`, `__init__.py`.
- **`services/gateways/`**: `store.py`, `pairing.py`, `transports.py`, `briefings.py`, `inbound.py`, `__init__.py`.

---

## 4. WebSocket Message Contracts (`/ws/events`)

| Event Name | Direction | Payload Schema | Purpose |
| :--- | :--- | :--- | :--- |
| `agent_state` | Server $\to$ Client | `{ agent: str, state: "idle" \| "working" \| "error", instance: str }` | Updates AgentFloor and Roster status indicators |
| `agent_shout` | Server $\to$ Client | `{ agent: str, message: str, category: str, duration: int, announce_tts: bool }` | Real-time speech bubble & audio announcement |
| `war_room_message` | Server $\to$ Client | `{ id: str, room_id: str, sender: str, text: str, mentions: List[str] }` | Broadcasts new War Room messages to all clients |
| `war_room_speaker_start`| Server $\to$ Client | `{ room_id: str, agent: str, engine: str, color: str }` | Lights up active speaker border & Teams stage |
| `war_room_inquiries_updated` | Server $\to$ Client | `{ room_id: str, inquiries: List[dict] }` | Synchronizes active Operator Inquiries Deck |
| `war_room_reminders_updated` | Server $\to$ Client | `{ room_id: str, reminders: List[dict] }` | Updates reminder pill indicators & tray |
| `war_room_tasks_updated` | Server $\to$ Client | `{ room_id: str, tasks: List[dict] }` | Synchronizes two-phase async background jobs |
