#!/usr/bin/env python3
"""
NexusDesk Frontend Build Script
Compiles modular HTML template partials (`templates/layout/`, `templates/tabs/`, `templates/modals/`),
CSS styles, and JavaScript modules from `src/` into a production-optimized standalone `dist/index.html`.
Zero external dependencies (uses standard python3 library).
Part of BL-ARCH-32 full-stack modularization.
"""

import sys
import json
from datetime import datetime
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent / "src"
DIST_DIR = Path(__file__).resolve().parent / "dist"
DIST_HTML = DIST_DIR / "index.html"
BUILD_INFO_FILE = Path(__file__).resolve().parent / ".build_version.json"

def get_next_build_id() -> str:
    """
    Generates a build ID in the format: YYYYMMDD-[batch no], e.g., 20261101-01.
    Maintains a local .build_version.json counter that auto-increments for builds on the same date.
    """
    today_str = datetime.now().strftime("%Y%m%d")
    batch_num = 1
    
    if BUILD_INFO_FILE.exists():
        try:
            data = json.loads(BUILD_INFO_FILE.read_text(encoding="utf-8"))
            if data.get("date") == today_str:
                batch_num = int(data.get("batch", 0)) + 1
        except Exception:
            batch_num = 1
            
    BUILD_INFO_FILE.write_text(json.dumps({"date": today_str, "batch": batch_num}, indent=2), encoding="utf-8")
    return f"{today_str}-{batch_num:02d}"

# Order of tab partials
TAB_PARTIALS = [
    "tab_floor.html",
    "tab_console.html",
    "tab_roster.html",
    "tab_memory.html",
    "tab_tools_matrix.html",
    "tab_tools_configured.html",
    "tab_tools_catalog.html",
    "tab_models_agents.html",
    "tab_models_failover.html",
    "tab_models_reasoning.html",
    "tab_models_memory.html",
    "tab_models_library.html",
    "tab_chat_agents.html",
    "tab_crons.html",
    "tab_workflows.html",
    "tab_security.html",
    "tab_system_dispatcher.html",
    "tab_system_daemon.html",
    "tab_system_logs.html",
    "tab_system_storage.html",
    "tab_system_gateways.html",
    "tab_system_profile.html",
    "tab_self_evolving.html",
    "tab_guide.html"
]

# Order of modal partials
MODAL_PARTIALS = [
    "cron_modal.html",
    "workflow_modal.html",
    "workflow_run_inspect_modal.html",
    "step_skill_modal.html",
    "ai_workflow_modal.html",
    "skill_tidy_modal.html",
    "timezone_modal.html",
    "fallback_modal.html",
    "agent_model_modal.html",
    "global_model_modal.html",
    "mission_briefing_modal.html",
    "security_settings_modal.html",
    "auth_unlock_modal.html",
    "agent_crud_modal.html",
    "mcp_config_modal.html",
    "modal_new_room_picker.html",
    "modal_export_transcript.html",
    "modal_invite_agent.html",
    "modal_create_warroom.html",
    "modal_delete_warroom.html",
    "modal_warroom_sandbox.html",
    "modal_fs_quickview.html",
    "modal_quick_model_picker.html",
    "modal_warroom_reminders.html",
    "modal_self_evolving_spec.html",
    "modal_self_evolving_patch.html",
    "modal_self_evolving_report.html",
    "modal_self_evolving_snapshots.html",
    "modal_mobile_voice_settings.html",
    "modal_chat_agent_form.html",
    "modal_chat_agent_studio.html",
    "modal_chat_agent_ops.html"
]

# Order of JS compilation
JS_MODULES = [
    # Core lifecycle & state
    "core/auth_interceptor.js",
    "core/fleet_state.js",
    "core/ui_navigation.js",
    "core/nexus_select.js",
    # Feature Modules
    "modules/roster.js",
    "modules/agentfloor_iso.js",
    # AgentFloor Canvas Subsystem
    "modules/floor/floor_themes_camera.js",
    "modules/floor/floor_iso_blocks.js",
    "modules/floor/floor_iso_loft_furniture.js",
    "modules/floor/floor_iso_loft.js",
    "modules/floor/floor_2d_office.js",
    "modules/floor/floor_navigation_ai.js",
    "modules/floor/floor_interactions.js",
    # Chat & War Room Console Subsystem
    "modules/chat/file_preview_artifacts.js",
    "modules/chat/direct_chat.js",
    "modules/chat/voice_tts_engine.js",
    "modules/chat/war_room_tabs_switcher.js",
    "modules/chat/war_room_rooms.js",
    "modules/chat/war_room_stage.js",
    "modules/chat/war_room_mentions_search.js",
    "modules/chat/war_room_inquiries.js",
    "modules/chat/war_room_reminders_tasks.js",
    "modules/chat/war_room_messaging.js",
    "modules/chat/war_room_roundtable.js",
    "modules/chat/chat_export_copy.js",
    "modules/memory_vault.js",
    "modules/models_reasoning.js",
    "modules/agent_crud.js",
    "modules/tools_mcp.js",
    "modules/model_library.js",
    # Chat Agents Studio Subsystem
    "modules/chat_agents/ca_core_registry.js",
    "modules/chat_agents/ca_subdata_studio.js",
    "modules/chat_agents/ca_file_explorer.js",
    "modules/chat_agents/ca_sim_whatsapp.js",
    "modules/chat_agents/ca_crons_evolutions.js",
    "modules/crons.js",
    "modules/workflows_dag.js",
    "modules/security_auth.js",
    "modules/system_maintenance.js",
    "modules/self_evolving.js",
    "modules/guide.js",
    # Background sync & app initialization
    "core/hermes_sync.js",
    "core/app_init.js",
]

def compile_body_templates() -> str:
    """Recursively compiles layout, tabs, and modals partials into a unified body markup."""
    templates_dir = SRC_DIR / "templates"
    layout_dir = templates_dir / "layout"
    tabs_dir = templates_dir / "tabs"
    modals_dir = templates_dir / "modals"

    # If partial directories exist, assemble dynamically
    if layout_dir.exists() and tabs_dir.exists() and modals_dir.exists():
        sidebar = (layout_dir / "sidebar.html").read_text(encoding="utf-8").strip()
        header = (layout_dir / "header.html").read_text(encoding="utf-8").strip()
        footer = (layout_dir / "footer.html").read_text(encoding="utf-8").strip()

        tab_chunks = []
        for t in TAB_PARTIALS:
            tp = tabs_dir / t
            if tp.exists():
                tab_chunks.append(tp.read_text(encoding="utf-8").strip())
        tabs_html = "\n\n".join(tab_chunks)

        modal_chunks = []
        for m in MODAL_PARTIALS:
            mp = modals_dir / m
            if mp.exists():
                modal_chunks.append(mp.read_text(encoding="utf-8").strip())
        modals_html = "\n\n".join(modal_chunks)

        return f"""{sidebar}

  <!-- Right Content Wrapper (Header + Main Content + Footer) -->
  <div id="content-wrapper" class="flex-1 flex flex-col min-w-0 h-dvh w-full overflow-y-auto overflow-x-hidden custom-scrollbar transition-all duration-200">

{header}

    <!-- Main Content Container (Adaptive Screen-Fit with Bottom Clearance & Integrated Footer) -->
    <main class="flex-1 p-3 sm:p-5 pb-16 sm:pb-20 w-full flex flex-col overflow-x-hidden min-h-0">

{tabs_html}

    </main>

{footer}

</div> <!-- Close #content-wrapper -->

{modals_html}
"""

    # Fallback to single body.html if partials are absent
    body_path = templates_dir / "body.html"
    return body_path.read_text(encoding="utf-8").strip()

def build():
    print("🔨 Building NexusDesk Frontend from Modular Partials & Modules...")

    head_path = SRC_DIR / "templates" / "head.html"
    css_path = SRC_DIR / "styles" / "main.css"

    if not head_path.exists():
        raise FileNotFoundError(f"Missing head template: {head_path}")
    if not css_path.exists():
        raise FileNotFoundError(f"Missing CSS styles: {css_path}")

    head_content = head_path.read_text(encoding="utf-8").strip()
    css_content = css_path.read_text(encoding="utf-8").strip()
    body_content = compile_body_templates()

    # Also keep templates/body.html updated as the canonical assembled artifact
    body_out_path = SRC_DIR / "templates" / "body.html"
    body_out_path.write_text(body_content, encoding="utf-8")

    # Concatenate JS modules (supporting both legacy single files and new submodules)
    js_chunks = []
    for rel_path in JS_MODULES:
        js_file = SRC_DIR / "js" / rel_path
        if not js_file.exists():
            # Check legacy fallbacks
            if rel_path.startswith("modules/chat/"):
                legacy_chat = SRC_DIR / "js" / "modules" / "chat_console.js"
                if legacy_chat.exists() and "modules/chat_console.js" not in [j[0] for j in js_chunks]:
                    content = legacy_chat.read_text(encoding="utf-8").strip()
                    js_chunks.append((
                        "modules/chat_console.js",
                        f"    // ==============================================================\n"
                        f"    // MODULE: modules/chat_console.js (Legacy Combined Module)\n"
                        f"    // ==============================================================\n"
                        f"{content}"
                    ))
                continue
            elif rel_path in ("modules/crons.js", "modules/workflows_dag.js"):
                legacy_wf = SRC_DIR / "js" / "modules" / "workflows_crons.js"
                if legacy_wf.exists() and "modules/workflows_crons.js" not in [j[0] for j in js_chunks]:
                    content = legacy_wf.read_text(encoding="utf-8").strip()
                    js_chunks.append((
                        "modules/workflows_crons.js",
                        f"    // ==============================================================\n"
                        f"    // MODULE: modules/workflows_crons.js (Legacy Combined Module)\n"
                        f"    // ==============================================================\n"
                        f"{content}"
                    ))
                continue
            if rel_path.startswith("modules/chat_agents/") or rel_path == "modules/self_evolving.js":
                print(f"  ℹ️  Skipping optional Pro JS module: {rel_path}")
                continue
            raise FileNotFoundError(f"Missing JS module: {js_file}")
        content = js_file.read_text(encoding="utf-8").strip()
        js_chunks.append((
            rel_path,
            f"    // ==============================================================\n"
            f"    // MODULE: {rel_path}\n"
            f"    // ==============================================================\n"
            f"{content}"
        ))

    combined_js = "\n\n".join([chunk[1] for chunk in js_chunks])

    # Generate current build ID (YYYYMMDD-batch) and read canonical VERSION
    build_id = get_next_build_id()
    version_file = SRC_DIR.parent.parent / "VERSION"
    app_version = version_file.read_text(encoding="utf-8").strip() if version_file.exists() else "2.0.0"
    print(f"📦 Stamping Version v{app_version} | Build ID: {build_id}")

    # Inject version & build ID into placeholder
    body_content = body_content.replace("BUILD_ID_PLACEHOLDER", f"v{app_version} • Build {build_id}")

    # Assemble HTML document
    html_output = f"""{head_content}
{css_content}
  </style>
</head>
{body_content}

  <!-- ============================================================== -->
  <!-- JAVASCRIPT APPLICATION LOGIC (BUILT FROM frontend/src/js/)     -->
  <!-- ============================================================== -->
  <script>
{combined_js}
  </script>
</body>
</html>
"""

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    DIST_HTML.write_text(html_output, encoding="utf-8")
    print(f"✅ Build complete: {DIST_HTML} ({len(html_output.splitlines())} lines, {len(html_output)} bytes)")

if __name__ == "__main__":
    build()
