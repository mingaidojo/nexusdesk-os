import json
import time
import shutil
import urllib.request
import urllib.error
from typing import Optional
from pathlib import Path
import yaml
from fastapi import APIRouter, Request, HTTPException, Query
from core.config import (
    resolve_instance_key,
    get_instance_user_context,
    backup_file,
    set_instance_perms,
    safe_path_exists
)
from schemas.models import ToolToggleRequest, McpServerSaveRequest, McpTestRequest

router = APIRouter(tags=["tools_mcp"])

CORE_TOOLSETS = [
    {"id": "terminal", "name": "Terminal & Shell Execution", "desc": "Execute bash commands, system inspections, and scripts", "icon": "💻"},
    {"id": "web_search", "name": "Web Intelligence Search", "desc": "Live web querying via DuckDuckGo / Brave search engines", "icon": "🔍"},
    {"id": "browser", "name": "Headless Browser Automation", "desc": "DOM interaction, web screenshots, and browser page scraping", "icon": "🌐"},
    {"id": "file_editor", "name": "Workspace File Editor", "desc": "Full read, write, patch, and file inspection in agent workspace", "icon": "📝"},
    {"id": "python_repl", "name": "Python REPL & Data Science", "desc": "Isolated Python compute environment for equations & data analysis", "icon": "🐍"},
    {"id": "cron", "name": "Cron Scheduler", "desc": "Create, trigger, and manage recurring automation pipelines", "icon": "⏱️"},
    {"id": "skills", "name": "Skill Registry", "desc": "Autonomous skill execution, bundling, and learning repository", "icon": "⚡"},
    {"id": "*", "name": "Unrestricted Full Access", "desc": "All toolsets enabled (recommended for Orchestrators)", "icon": "👑"}
]

MCP_CURATED_CATALOG = [
    # Official Core Protocol Servers (Local stdio daemons)
    {"name": "filesystem", "category": "Core / Storage", "desc": "Secure local filesystem access with configurable allowed directory paths", "auth": "Local Path", "badge": "CORE", "group": "core", "default_command": "npx -y @modelcontextprotocol/server-filesystem", "default_args": ["/home/agents_bs/workspace"], "env": {}},
    {"name": "postgres", "category": "Core / Database", "desc": "Direct PostgreSQL database queries and automated schema inspection", "auth": "Conn String", "badge": "CORE", "group": "core", "default_command": "npx -y @modelcontextprotocol/server-postgres", "default_args": ["postgresql://localhost/hermes"], "env": {}},
    {"name": "sqlite", "category": "Core / Database", "desc": "Embedded SQLite database queries and automated schema inspection", "auth": "Local DB", "badge": "CORE", "group": "core", "default_command": "npx -y @modelcontextprotocol/server-sqlite", "default_args": ["--db-path", "/home/agents_bs/.hermes/hermes.db"], "env": {}},
    {"name": "brave-search", "category": "Core / Search", "desc": "Real-time web search and content retrieval via Brave Search API", "auth": "API Key", "badge": "SEARCH", "group": "core", "default_command": "npx -y @modelcontextprotocol/server-brave-search", "default_args": [], "env": {"BRAVE_API_KEY": "BSA_..."}},
    {"name": "git", "category": "Core / VCS", "desc": "Git repository inspection, git log, branch creation, diffs, and staging", "auth": "Local Path", "badge": "CORE", "group": "core", "default_command": "npx -y @modelcontextprotocol/server-git", "default_args": ["--repository", "/home/agents_bs/workspace"], "env": {}},
    {"name": "puppeteer", "category": "Core / Browser", "desc": "Headless Chromium browser automation, webpage rendering, and scraping", "auth": "None", "badge": "AUTOMATION", "group": "core", "default_command": "npx -y @modelcontextprotocol/server-puppeteer", "default_args": [], "env": {}},
    {"name": "fetch", "category": "Core / Web", "desc": "Efficient web page retrieval and HTML-to-Markdown conversion daemon", "auth": "None", "badge": "UTILITY", "group": "core", "default_command": "npx -y @modelcontextprotocol/server-fetch", "default_args": [], "env": {}},
    {"name": "memory", "category": "Core / Knowledge", "desc": "Persistent knowledge graph memory server with entity and relation tracking", "auth": "Local Graph", "badge": "KNOWLEDGE", "group": "core", "default_command": "npx -y @modelcontextprotocol/server-memory", "default_args": [], "env": {}},
    {"name": "rg", "category": "Core / Search", "desc": "Fast code search using ripgrep for symbols, definitions, and references", "auth": "None", "badge": "UTILITY", "group": "core", "default_command": "rg", "default_args": [], "env": {}},

    # Cloud & Ecosystem Connectors
    {"name": "linear", "category": "Project Tracking", "desc": "Find, create, and update Linear issues, projects, cycles, and roadmaps", "auth": "API Key", "badge": "POPULAR", "group": "cloud", "default_url": "https://mcp.linear.app/sse", "default_command": "", "default_args": [], "env": {"LINEAR_API_KEY": "lin_api_..."}},
    {"name": "supabase", "category": "Database & Cloud", "desc": "Postgres database queries, storage, and authentication management", "auth": "API Key", "badge": "ESSENTIAL", "group": "cloud", "default_command": "npx -y @supabase/mcp-server", "default_args": [], "env": {"SUPABASE_URL": "https://xyz.supabase.co", "SUPABASE_SERVICE_KEY": "ey..."}},
    {"name": "cloudflare", "category": "DevOps & Edge", "desc": "Full Cloudflare API: Workers, DNS, Cache, and AI Gateway access", "auth": "API Key", "badge": "OFFICIAL", "group": "cloud", "default_command": "npx -y @cloudflare/mcp-server-cloudflare", "default_args": [], "env": {"CLOUDFLARE_API_TOKEN": "cf_..."}},
    {"name": "deepwiki", "category": "Code Intelligence", "desc": "Ask deep semantic questions about any public GitHub repository", "auth": "None", "badge": "FREE", "group": "cloud", "default_command": "npx -y deepwiki-mcp", "default_args": [], "env": {}},
    {"name": "sentry", "category": "Observability", "desc": "Real-time production error context, stack traces, and crash telemetry", "auth": "API Key", "badge": "MONITORING", "group": "cloud", "default_command": "npx -y @sentry/mcp-server", "default_args": [], "env": {"SENTRY_AUTH_TOKEN": "sntry_..."}},
    {"name": "stripe", "category": "Fintech & Payments", "desc": "Payments, customers, subscriptions, and invoice automation", "auth": "API Key", "badge": "FINTECH", "group": "cloud", "default_command": "npx -y @stripe/mcp", "default_args": [], "env": {"STRIPE_SECRET_KEY": "sk_test_..."}},
    {"name": "notion", "category": "Knowledge Base", "desc": "Access and manipulate structured pages and databases in Notion", "auth": "OAuth", "badge": "PRODUCTIVITY", "group": "cloud", "default_command": "npx -y @notionhq/mcp-server-notion", "default_args": [], "env": {"NOTION_API_KEY": "secret_..."}},
    {"name": "datadog", "category": "Infrastructure", "desc": "Cloud server metrics, trace analytics, logs, and alert monitors", "auth": "API Key", "badge": "ENTERPRISE", "group": "cloud", "default_command": "npx -y @datadog/mcp-server-datadog", "default_args": [], "env": {"DATADOG_API_KEY": "...", "DATADOG_APP_KEY": "..."}},
    {"name": "figma", "category": "Design & UI", "desc": "Design system inspection, token resolution, and Code Connect", "auth": "OAuth", "badge": "DESIGN", "group": "cloud", "default_command": "npx -y figma-developer-mcp", "default_args": [], "env": {"FIGMA_ACCESS_TOKEN": "figd_..."}},
    {"name": "github", "category": "Version Control", "desc": "Issues, pull requests, commits, and GitHub Actions management", "auth": "PAT", "badge": "DEV", "group": "cloud", "default_command": "npx -y @modelcontextprotocol/server-github", "default_args": [], "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."}}
]

@router.get("/api/tools")
def get_tools_config(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    agent_tools = {}
    if cfg_file.exists():
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                for a in cfg.get("agents", []):
                    name = a.get("name")
                    if name:
                        agent_tools[name] = a.get("allowed_toolsets", ["*"])
        except Exception:
            pass

    if not agent_tools:
        def_name = f"{ctx['label'].split()[0]} Agent" if ctx.get("label") else "Default Agent"
        agent_tools[def_name] = ["*"]

    return {
        "core_toolsets": CORE_TOOLSETS,
        "agent_tools": agent_tools,
        "instance": inst_key
    }

@router.post("/api/tools/toggle")
def toggle_agent_tool(req: ToolToggleRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}

        target = next((a for a in cfg.get("agents", []) if a.get("name", "").lower() == req.agent_name.lower()), None)
        if not target:
            raise HTTPException(status_code=404, detail=f"Agent '{req.agent_name}' not found")

        current_tools = list(target.get("allowed_toolsets", ["*"]))
        tool_id = req.toolset.strip()

        if req.enabled:
            if tool_id not in current_tools:
                current_tools.append(tool_id)
        else:
            if tool_id in current_tools:
                current_tools.remove(tool_id)

        target["allowed_toolsets"] = current_tools
        with open(cfg_file, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
        set_instance_perms(cfg_file, inst_key)

        return {"status": "ok", "agent": req.agent_name, "allowed_toolsets": current_tools, "instance": inst_key}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/mcp")
def get_mcp_overview(request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    user_home = Path(f"/home/{ctx['user']}")
    
    servers = {}
    
    # 1. Hermes MCP Servers (~/.hermes/config.yaml or mcp_servers.json)
    cfg_file = ctx["home"] / "config.yaml"
    mcp_file = ctx["home"] / "mcp_servers.json"
    hermes_servers = {}
    if safe_path_exists(mcp_file):
        try:
            with open(mcp_file, "r") as f:
                hermes_servers = json.load(f).get("mcp_servers", {})
        except Exception:
            pass
            
    if not hermes_servers and safe_path_exists(cfg_file):
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
                hermes_servers = cfg.get("mcp_servers", {})
        except Exception:
            pass

    for s_name, s_val in hermes_servers.items():
        srv = dict(s_val) if isinstance(s_val, dict) else {"command": str(s_val)}
        srv["engine"] = "hermes"
        servers[s_name] = srv

    # 2. Claude Code MCP Servers (~/.claude.json)
    claude_cfg = user_home / ".claude.json"
    if safe_path_exists(claude_cfg):
        try:
            with open(claude_cfg, "r") as f:
                c_data = json.load(f)
                c_mcps = c_data.get("mcpServers", {})
                for c_name, c_val in c_mcps.items():
                    if c_name not in servers:
                        srv = dict(c_val) if isinstance(c_val, dict) else {"command": str(c_val)}
                        srv["engine"] = "claude"
                        servers[c_name] = srv
        except Exception:
            pass

    # 3. AGY MCP Servers (~/.gemini/antigravity-cli/mcp/)
    agy_mcp_dir = user_home / ".gemini" / "antigravity-cli" / "mcp"
    if safe_path_exists(agy_mcp_dir):
        try:
            for item in agy_mcp_dir.iterdir():
                if item.is_dir() and item.name not in servers:
                    servers[item.name] = {
                        "command": "agy",
                        "args": ["mcp", item.name],
                        "engine": "agy",
                        "category": "AGY Integration"
                    }
        except Exception:
            pass

    # 4. OpenCode MCP Servers (~/.config/opencode/opencode.json)
    opencode_cfg = user_home / ".config" / "opencode" / "opencode.json"
    if safe_path_exists(opencode_cfg):
        try:
            with open(opencode_cfg, "r") as f:
                op_data = json.load(f)
                op_mcps = op_data.get("mcp", {}) or op_data.get("mcp_servers", {})
                for o_name, o_val in op_mcps.items():
                    if o_name not in servers:
                        srv = dict(o_val) if isinstance(o_val, dict) else {"command": str(o_val)}
                        srv["engine"] = "opencode"
                        servers[o_name] = srv
        except Exception:
            pass

    return {
        "configured_servers": servers,
        "catalog": MCP_CURATED_CATALOG,
        "instance": inst_key
    }

@router.post("/api/mcp/server")
def save_mcp_server(req: McpServerSaveRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}

        if "mcp_servers" not in cfg:
            cfg["mcp_servers"] = {}

        srv_data = {}
        if req.url:
            srv_data["url"] = req.url.strip()
        if req.command:
            srv_data["command"] = req.command.strip()
        if req.args:
            srv_data["args"] = req.args
        if req.env:
            srv_data["env"] = req.env

        cfg["mcp_servers"][req.name.strip()] = srv_data

        with open(cfg_file, "w") as f:
            yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
        set_instance_perms(cfg_file, inst_key)

        return {"status": "saved", "name": req.name, "server": srv_data, "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/mcp/server/{name}")
def delete_mcp_server(name: str, request: Request, instance: Optional[str] = Query(None)):
    inst_key = resolve_instance_key(request, instance)
    ctx = get_instance_user_context(inst_key)
    cfg_file = ctx["home"] / "config.yaml"
    if not cfg_file.exists():
        raise HTTPException(status_code=404, detail=f"config.yaml not found for instance {inst_key}")
    try:
        backup_file(cfg_file)
        with open(cfg_file, "r") as f:
            cfg = yaml.safe_load(f) or {}

        servers = cfg.get("mcp_servers", {})
        if name in servers:
            del servers[name]
            cfg["mcp_servers"] = servers
            with open(cfg_file, "w") as f:
                yaml.dump(cfg, f, default_flow_style=False, sort_keys=False)
            set_instance_perms(cfg_file, inst_key)

        return {"status": "deleted", "name": name, "instance": inst_key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/mcp/test")
def test_mcp_server(req: McpTestRequest, request: Request):
    inst_key = resolve_instance_key(request, req.instance)
    start_t = time.time()

    cmd = req.command
    url = req.url
    if req.name and not cmd and not url:
        ctx = get_instance_user_context(inst_key)
        cfg_file = ctx["home"] / "config.yaml"
        if cfg_file.exists():
            try:
                with open(cfg_file, "r") as f:
                    cfg = yaml.safe_load(f) or {}
                    srv = cfg.get("mcp_servers", {}).get(req.name.strip(), {})
                    cmd = srv.get("command")
                    url = srv.get("url")
            except Exception:
                pass

    if url:
        try:
            req_probe = urllib.request.Request(
                url.strip(),
                headers={"User-Agent": "NexusDesk-MCP-Probe/1.0", "Accept": "text/event-stream,application/json,*/*"}
            )
            with urllib.request.urlopen(req_probe, timeout=3.5) as resp:
                elapsed_ms = int((time.time() - start_t) * 1000)
                return {
                    "status": "online",
                    "transport": "sse",
                    "latency_ms": elapsed_ms,
                    "status_code": resp.status,
                    "detail": f"Remote SSE endpoint reachable (HTTP {resp.status})"
                }
        except urllib.error.HTTPError as e:
            elapsed_ms = int((time.time() - start_t) * 1000)
            return {
                "status": "online" if e.code in (401, 403, 405, 400) else "warning",
                "transport": "sse",
                "latency_ms": elapsed_ms,
                "status_code": e.code,
                "detail": f"Server responded with HTTP {e.code} ({e.reason})"
            }
        except Exception as e:
            elapsed_ms = int((time.time() - start_t) * 1000)
            return {
                "status": "error",
                "transport": "sse",
                "latency_ms": elapsed_ms,
                "detail": f"Connection failed: {str(e)}"
            }

    elif cmd:
        parts = cmd.strip().split()
        exe = parts[0] if parts else ""
        exe_path = shutil.which(exe)
        elapsed_ms = int((time.time() - start_t) * 1000)
        if exe_path:
            return {
                "status": "online",
                "transport": "stdio",
                "latency_ms": elapsed_ms,
                "path": exe_path,
                "detail": f"Local binary '{exe}' found on PATH at {exe_path}"
            }
        else:
            # Check if the missing executable is 'rg' and provide specific guidance
            if exe == "rg":
                detail_message = (
                    f"Executable '{exe}' not found directly on PATH. "
                    "For 'rg' (ripgrep), please ensure it is installed and accessible in the system's PATH. "
                    "You can usually install it via your system's package manager (e.g., `sudo apt install ripgrep` "
                    "on Debian/Ubuntu, `brew install ripgrep` on macOS, or download from https://github.com/BurntSushi/ripgrep/releases)."
                )
            else:
                detail_message = (
                    f"Executable '{exe}' not found directly on PATH. "
                    f"Please ensure '{exe}' is installed and accessible in the system's PATH."
                )

            try:
                from routers.self_evolving import record_telemetry_event
                record_telemetry_event(
                    category="Missing Tools",
                    pillar="mcp_tools",
                    source="tools",
                    summary=f"MCP binary '{exe}' not found on system PATH",
                    details=f"Server '{req.name}' failed probe: {detail_message}",
                    affected_files=["backend/routers/tools_mcp.py"]
                )
            except Exception:
                pass
            return {
                "status": "warning",
                "transport": "stdio",
                "latency_ms": elapsed_ms,
                "detail": detail_message
            }

    raise HTTPException(status_code=400, detail="Either command or url must be specified for testing.")
