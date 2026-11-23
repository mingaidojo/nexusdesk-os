from typing import Optional, List, Dict, Any
from pydantic import BaseModel

class AuthVerifyRequest(BaseModel):
    token: str

class AuthToggleRequest(BaseModel):
    enabled: bool
    regenerate_key: Optional[bool] = False

class ChatRequest(BaseModel):
    agent: str = "Solaris"
    message: str
    instance: Optional[str] = None
    engine: Optional[str] = None
    model: Optional[str] = None

class ChatClearRequest(BaseModel):
    agent: str = "Solaris"
    instance: Optional[str] = None
    reset_memory: Optional[bool] = False

class MemoryUpdateRequest(BaseModel):
    content: str
    instance: Optional[str] = None

class FileUpdateRequest(BaseModel):
    path: str
    content: str
    instance: Optional[str] = None

class SkillSaveRequest(BaseModel):
    path: str
    content: str
    instance: Optional[str] = None

class SkillLockRequest(BaseModel):
    path: str
    locked: bool
    instance: Optional[str] = None

class FallbackUpdateRequest(BaseModel):
    fallback_providers: List[Dict[str, Any]]
    instance: Optional[str] = None

class ReasoningUpdateRequest(BaseModel):
    reasoning_effort: str
    reasoning_overrides: Optional[Dict[str, str]] = {}
    instance: Optional[str] = None

class AgentModelUpdateRequest(BaseModel):
    agent_name: str
    model: str
    engine: Optional[str] = None
    fallback_model: Optional[str] = None
    fallback_models: Optional[List[str]] = []
    instance: Optional[str] = None
    clear_room_overrides: bool = True

class GlobalModelUpdateRequest(BaseModel):
    model: Optional[str] = None
    default: Optional[str] = None
    provider: Optional[str] = "abacus"
    base_url: Optional[str] = None
    instance: Optional[str] = None

class CronUpdateRequest(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    schedule_expr: Optional[str] = None
    enabled: Optional[bool] = None
    target_type: Optional[str] = "prompt"  # "prompt" or "workflow"
    workflow_id: Optional[str] = None
    instance: Optional[str] = None

class CronCreateRequest(BaseModel):
    name: str
    prompt: str = ""
    schedule_expr: str = "0 8 * * *"
    enabled: bool = True
    target_type: Optional[str] = "prompt"  # "prompt" or "workflow"
    workflow_id: Optional[str] = None
    instance: Optional[str] = None

class AgentCreateRequest(BaseModel):
    name: str
    role: str
    engine: Optional[str] = "hermes"
    model: Optional[str] = "abacus/gemini-3.8-flash"
    fallback_model: Optional[str] = None
    fallback_models: Optional[List[str]] = []
    system_prompt: Optional[str] = ""
    theme: Optional[str] = "custom"
    color: Optional[str] = "#06b6d4"
    voice_gender: Optional[str] = "female"
    voice_pitch: Optional[float] = 1.0
    voice_rate: Optional[float] = 1.0
    instance: Optional[str] = None

class AgentUpdateRequest(BaseModel):
    new_name: Optional[str] = None
    role: Optional[str] = None
    engine: Optional[str] = None
    model: Optional[str] = None
    fallback_model: Optional[str] = None
    fallback_models: Optional[List[str]] = None
    system_prompt: Optional[str] = None
    theme: Optional[str] = None
    color: Optional[str] = None
    voice_gender: Optional[str] = None
    voice_pitch: Optional[float] = None
    voice_rate: Optional[float] = None
    instance: Optional[str] = None

class ToolToggleRequest(BaseModel):
    agent_name: str
    toolset: str
    enabled: bool
    instance: Optional[str] = None

class McpInstallRequest(BaseModel):
    name: str
    instance: Optional[str] = None

class McpServerSaveRequest(BaseModel):
    name: str
    url: Optional[str] = None
    command: Optional[str] = None
    args: Optional[List[str]] = []
    env: Optional[Dict[str, str]] = {}
    instance: Optional[str] = None

class McpTestRequest(BaseModel):
    name: Optional[str] = None
    command: Optional[str] = None
    url: Optional[str] = None
    instance: Optional[str] = None

class AgentShoutRequest(BaseModel):
    agent: str
    message: str
    category: Optional[str] = "info"  # info, task_start, task_complete, critical
    duration: Optional[int] = 7  # seconds to display bubble
    announce_tts: Optional[bool] = True
    instance: Optional[str] = None

class WarRoomChatRequest(BaseModel):
    message: str
    target_agents: Optional[List[str]] = None
    handoff_enabled: Optional[bool] = True
    max_hops: Optional[int] = 8
    max_turns: Optional[int] = None
    execution_mode: Optional[str] = "sequential"  # "sequential" | "parallel" | "orchestrate_parallel"
    lead_agent: Optional[str] = None
    synthesize_swarm: Optional[bool] = True
    pause_before_swarm: Optional[bool] = False
    model: Optional[str] = None
    instance: Optional[str] = None
    room_id: Optional[str] = "general"
    skip_user_echo: Optional[bool] = False  # set when the directive is already on the transcript (drained queue)
    origin_channel: Optional[str] = None  # None/web for UI, or 'whatsapp', 'telegram', 'email', 'webhook'

class WarRoomSwarmLaunchRequest(BaseModel):
    room_id: Optional[str] = "general"
    lead_agent: Optional[str] = None
    directive: str = ""
    tasks: List[Dict[str, str]]
    max_waves: Optional[int] = 1
    synthesize_swarm: Optional[bool] = True
    instance: Optional[str] = None

class WarRoomRoundTableRequest(BaseModel):
    topic: str
    agents: List[str]
    rounds: Optional[int] = 3
    instance: Optional[str] = None
    room_id: Optional[str] = "general"

class WarRoomClearRequest(BaseModel):
    instance: Optional[str] = None
    room_id: Optional[str] = "general"
    reset_memory: Optional[bool] = False

class WarRoomCreateRoomRequest(BaseModel):
    name: str
    topic: Optional[str] = None
    room_type: Optional[str] = "warroom"  # "warroom" or "chat"
    preset: Optional[str] = "general_conference"  # "general_conference", "coding_sprint", "deep_research", "security_audit", "executive_advisory"
    worktree_isolation: Optional[bool] = False
    instance: Optional[str] = None
    participants: Optional[List[str]] = None

class WarRoomInviteRequest(BaseModel):
    room_id: str
    agent_name: str
    instance: Optional[str] = None

class WarRoomRemoveAgentRequest(BaseModel):
    room_id: str
    agent_name: str

class WarRoomRenameRequest(BaseModel):
    name: str

class WarRoomAgentModelRequest(BaseModel):
    room_id: str
    agent_name: str
    model: str
    scope: Optional[str] = "room"  # "room" | "global"

class WarRoomOrchestratorRequest(BaseModel):
    room_id: str
    orchestrator: Optional[str] = None  # agent name or None to clear/revert to default

class WarRoomPresetRequest(BaseModel):
    room_id: str
    preset: str  # coding_sprint, deep_research, security_audit, executive_advisory, general_conference
    wow_rules: Optional[str] = None  # Custom Way of Working markdown text or None

class WarRoomInquiryResolveRequest(BaseModel):
    room_id: str
    inquiry_id: str
    resolution: Optional[str] = "dismissed"
    agent: Optional[str] = None

class WarRoomTaskRegisterRequest(BaseModel):
    room_id: str = "general"
    agent: str
    task_description: str
    command: Optional[str] = None
    followup_directive: Optional[str] = None
    notify_targets: Optional[List[str]] = None
    timeout: Optional[int] = 600
    auto_proceed_on_success: Optional[bool] = False
    next_task_description: Optional[str] = None
    next_command: Optional[str] = None

class WarRoomReminderCreateRequest(BaseModel):
    room_id: str = "general"
    text: str
    trigger_type: Optional[str] = None  # "next_hop", "after_agent", "relative_time", "absolute_time", or auto-parse
    target_agent: Optional[str] = None
    delay_seconds: Optional[int] = None
    due_timestamp: Optional[float] = None
    fire_at: Optional[float] = None
    label: Optional[str] = None
    timezone_offset_hours: Optional[float] = 7.0  # Default GMT+7 (Asia/Jakarta)

class WarRoomReminderCancelRequest(BaseModel):
    room_id: str = "general"
    reminder_id: str = "all"

class WarRoomScheduleSaveRequest(BaseModel):
    id: Optional[str] = None
    room_id: str = "general"
    title: Optional[str] = None
    prompt: str
    frequency: str = "daily"  # "once" | "daily" | "weekdays" | "weekly" | "interval"
    days_of_week: Optional[List[int]] = None  # Mon=0..Sun=6 for weekly
    time_hhmm: Optional[str] = "08:30"
    delay_minutes: Optional[int] = None
    interval_minutes: Optional[int] = None
    fire_at: Optional[float] = None
    tz_offset_hours: Optional[float] = 7.0
    mode: str = "agent_dispatch"  # "static_notice" | "agent_dispatch" | "roundtable"
    targets: Optional[List[str]] = None
    roundtable_rounds: Optional[int] = 2
    push_to_owner_channel: Optional[bool] = False
    enabled: Optional[bool] = True
    created_by: Optional[str] = "operator"
    created_via: Optional[str] = "modal"

class WarRoomSandboxArchiveRequest(BaseModel):
    room_id: Optional[str] = "general"

class WarRoomSandboxPruneRequest(BaseModel):
    room_id: Optional[str] = "general"


class SessionSaveRequest(BaseModel):
    title: str
    session_type: str = "warroom"  # "warroom" or "direct"
    target: str = "general"  # room_id or agent_name
    tags: Optional[List[str]] = []
    description: Optional[str] = ""
    messages: Optional[List[Dict[str, Any]]] = []
    instance: Optional[str] = None
    is_auto_archive: Optional[bool] = False

class SessionRestoreRequest(BaseModel):
    target_mode: Optional[str] = None  # "warroom" or "direct"
    target_id: Optional[str] = None    # room_id or agent_name
    instance: Optional[str] = None

class SessionDistillWikiRequest(BaseModel):
    title: str
    target_agent: Optional[str] = None  # agent name if saving to agent memory/notes
    folder: Optional[str] = "notes"      # "memory", "notes", "war-room"
    content: Optional[str] = None
    summary_mode: Optional[bool] = False
    messages: Optional[List[Dict[str, Any]]] = []
    instance: Optional[str] = None


# ==============================================================
# SELF-EVOLVING HUB SCHEMAS (BL-SYS-21 & BL-SYS-22)
# ==============================================================

class SelfEvolvingConfigUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    auto_synthesize_nightly: Optional[bool] = None
    review_mode: Optional[str] = None  # "manual" or "autonomous"
    max_buffer_entries: Optional[int] = None

class TelemetryEventRecordRequest(BaseModel):
    category: str = "UX & Friction"  # "UX & Friction", "Engine & Timeouts", "Permissions", "Missing Tools", "Feature Requests"
    pillar: str = "system_core"      # "operations", "models", "mcp_tools", "workflows", "system_core"
    source: str = "manual"           # "chat", "war_room", "workflows", "tools", "cli", "manual"
    summary: str
    details: Optional[str] = ""
    stack_trace: Optional[str] = ""
    affected_files: Optional[List[str]] = []
    attachments: Optional[List[Dict[str, Any]]] = []
    create_backlog_item: Optional[bool] = False
    priority: Optional[str] = None
    agent: Optional[str] = None
    instance: Optional[str] = None

class SelfEvolvingSynthesizeRequest(BaseModel):
    force: Optional[bool] = False
    inst_key: Optional[str] = "agents_bs"

class SelfEvolvingItemUpdateRequest(BaseModel):
    item_id: str
    status: Optional[str] = None      # "detected", "in_progress", "patched", "dismissed"
    priority: Optional[str] = None    # "Critical", "High", "Medium", "Low"
    assigned_agent: Optional[str] = None
    resolution_notes: Optional[str] = None

class SelfEvolvingPatchRequest(BaseModel):
    item_id: str
    agent: Optional[str] = "Solaris"
    auto_rollback: Optional[bool] = True
    dry_run: Optional[bool] = False
    proposed_code_changes: Optional[Dict[str, str]] = None
    patch_directive: Optional[str] = None

class SelfEvolvingRollbackRequest(BaseModel):
    snapshot_archive: Optional[str] = None
    item_id: Optional[str] = None





