"""
NexusDesk War Room Router Package
=================================
Assembles the declarative FastAPI `router` across modularized sub-routers
(`routing_helpers`, `rooms`, `sandbox`, `ops`, `chat_turn`) and re-exports
helpers imported by other backend routers and background loops.
"""

from fastapi import APIRouter

from routers.war_room.chat_turn import (
    _war_room_chat_impl,
    router as chat_turn_router,
    war_room_chat,
    war_room_queue_drain_watcher,
)
from routers.war_room.ops import router as ops_router
from routers.war_room.rooms import router as rooms_router
from routers.war_room.routing_helpers import (
    ACTIVE_WAR_ROOM_TASKS,
    WAR_ROOM_PRESETS_CATALOG,
    get_concluding_orchestrator,
    is_error_turn,
    is_room_busy,
    resolve_contextual_targets,
    router as helpers_router,
)
from routers.war_room.sandbox import router as sandbox_router
from services.war_room.execution import (
    append_war_room_message,
    get_room_file as _get_room_history_file,
    read_war_room_history,
)
from services.war_room.reminders import war_room_reminders_watcher

router = APIRouter(tags=["war_room"])
router.include_router(helpers_router)
router.include_router(rooms_router)
router.include_router(sandbox_router)
router.include_router(ops_router)
router.include_router(chat_turn_router)

__all__ = [
    "router",
    "ACTIVE_WAR_ROOM_TASKS",
    "WAR_ROOM_PRESETS_CATALOG",
    "_get_room_history_file",
    "_war_room_chat_impl",
    "append_war_room_message",
    "get_concluding_orchestrator",
    "is_error_turn",
    "is_room_busy",
    "read_war_room_history",
    "resolve_contextual_targets",
    "war_room_chat",
    "war_room_queue_drain_watcher",
    "war_room_reminders_watcher",
]
