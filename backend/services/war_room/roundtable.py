"""
NexusDesk War Room Structured Round-Table Deliberation Service
Orchestrates rotational multi-agent discussions, round management, and executive synthesis.
Part of BL-ARCH-32 modularization.
"""

import asyncio
import time
import uuid
from typing import Dict, Any, List

from core.config import broadcast_event
from services.war_room.execution import (
    read_war_room_history,
    append_war_room_message,
    execute_agent_war_room_turn,
    extract_shout_snippet,
    get_interrupt_gen
)

ACTIVE_ROUNDTABLE_TASKS: Dict[str, asyncio.Task] = {}

async def run_roundtable_deliberation(
    room_id: str,
    topic: str,
    selected_agents: List[Dict[str, Any]],
    rounds: int,
    turn_callback=None
):
    """
    Executes a structured rotational round-table discussion over `rounds`, concluding
    with an Executive Consensus Synthesis by the lead specialist.
    """
    chain_gen = get_interrupt_gen(room_id)
    try:
        for r in range(1, rounds + 1):
            round_banner = {
                "id": str(uuid.uuid4()),
                "room_id": room_id,
                "sender": "NexusDesk Moderator",
                "sender_type": "system",
                "text": f"📢 **--- ROUND {r} OF {rounds} ---**",
                "timestamp": time.time()
            }
            append_war_room_message(round_banner, room_id=room_id)
            await broadcast_event("war_room_message", round_banner)
            await asyncio.sleep(1.0)

            for agent in selected_agents:
                await broadcast_event("war_room_speaker_start", {
                    "room_id": room_id,
                    "agent": agent["name"],
                    "engine": agent["engine"],
                    "color": agent["color"]
                })
                await broadcast_event("agent_state", {"agent": agent["name"], "state": "working"})

                curr_history = read_war_room_history(room_id=room_id, limit=20)
                directive = (
                    f"Round {r} of {rounds} discussion on topic: '{topic}'. "
                    f"Analyze the problem, evaluate previous points from colleagues, and propose your concrete angle."
                )
                reply = await execute_agent_war_room_turn(
                    agent=agent,
                    directive_text=directive,
                    transcript=curr_history,
                    room_id=room_id,
                    room_participants=selected_agents,
                    interrupt_gen=chain_gen
                )

                msg_entry = {
                    "id": str(uuid.uuid4()),
                    "room_id": room_id,
                    "sender": agent["name"],
                    "sender_type": "agent",
                    "text": reply,
                    "engine": agent["engine"],
                    "color": agent["color"],
                    "role": agent.get("role", ""),
                    "timestamp": time.time(),
                    "round_info": {"round": r, "total": rounds}
                }
                append_war_room_message(msg_entry, room_id=room_id)
                await broadcast_event("war_room_message", msg_entry)

                snippet = extract_shout_snippet(reply, max_len=75)
                await broadcast_event("agent_shout", {
                    "agent": agent["name"],
                    "message": snippet,
                    "category": "info",
                    "duration": 6,
                    "announce_tts": True,
                    "voice": agent.get("voice")
                })
                await broadcast_event("agent_state", {"agent": agent["name"], "state": "idle"})
                if turn_callback:
                    await turn_callback(room_id, agent["name"])
                await asyncio.sleep(1.5)

        # Final Executive Synthesis Turn
        lead_agent = next((a for a in selected_agents if a["name"].lower() == "solaris"), selected_agents[0])
        synthesis_banner = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": f"🏁 **ROUND-TABLE DELIBERATION COMPLETE**\nHanding microphone to **@{lead_agent['name']}** for Executive Consensus Synthesis.",
            "timestamp": time.time()
        }
        append_war_room_message(synthesis_banner, room_id=room_id)
        await broadcast_event("war_room_message", synthesis_banner)
        await asyncio.sleep(1.0)

        await broadcast_event("war_room_speaker_start", {
            "room_id": room_id,
            "agent": lead_agent["name"],
            "engine": lead_agent["engine"],
            "color": lead_agent["color"]
        })
        await broadcast_event("agent_state", {"agent": lead_agent["name"], "state": "working"})

        curr_history = read_war_room_history(room_id=room_id, limit=25)
        synthesis_directive = (
            f"The roundtable on '{topic}' has concluded. As Lead Synthesizer, synthesize all panelists' arguments into a structured, executive action plan with clear deliverables and next steps."
        )
        synth_reply = await execute_agent_war_room_turn(
            agent=lead_agent,
            directive_text=synthesis_directive,
            transcript=curr_history,
            room_id=room_id,
            room_participants=selected_agents,
            interrupt_gen=chain_gen
        )

        synth_entry = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": lead_agent["name"],
            "sender_type": "agent",
            "text": f"### 📋 Executive Synthesis & Consensus Plan\n\n{synth_reply}",
            "engine": lead_agent["engine"],
            "color": lead_agent["color"],
            "role": lead_agent.get("role", ""),
            "timestamp": time.time(),
            "is_synthesis": True
        }
        append_war_room_message(synth_entry, room_id=room_id)
        await broadcast_event("war_room_message", synth_entry)

        await broadcast_event("agent_shout", {
            "agent": lead_agent["name"],
            "message": "Round-table concluded. Executive consensus plan established.",
            "category": "task_complete",
            "duration": 8,
            "announce_tts": True,
            "voice": lead_agent.get("voice")
        })
        await broadcast_event("agent_state", {"agent": lead_agent["name"], "state": "idle"})
        await broadcast_event("war_room_speaker_stop", {"room_id": room_id, "agent": lead_agent["name"]})
        await broadcast_event("war_room_roundtable_complete", {"room_id": room_id, "topic": topic, "status": "finished"})

    except asyncio.CancelledError:
        cancel_msg = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": "🛑 **Round-table deliberation was stopped/cancelled by operator.**",
            "timestamp": time.time()
        }
        append_war_room_message(cancel_msg, room_id=room_id)
        await broadcast_event("war_room_message", cancel_msg)
        await broadcast_event("agent_state", {"agent": "all", "state": "idle"})
    except Exception as e:
        err_entry = {
            "id": str(uuid.uuid4()),
            "room_id": room_id,
            "sender": "NexusDesk Moderator",
            "sender_type": "system",
            "text": f"⚠️ **Round-Table Error**: Deliberation terminated unexpectedly: {str(e)}",
            "timestamp": time.time()
        }
        append_war_room_message(err_entry, room_id=room_id)
        await broadcast_event("war_room_message", err_entry)
        await broadcast_event("agent_state", {"agent": "all", "state": "idle"})
