"""
NexusDesk War Room Inquiries & Decision Matrix Service
Manages pending agent questions to the operator, quick action chips, and status resolution.
Part of BL-ARCH-32 modularization.
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional

from core.config import DATA_DIR

INQUIRIES_STATE_FILE = DATA_DIR / "war_room_inquiries.json"

def load_inquiries_state() -> Dict[str, List[Dict[str, Any]]]:
    """Loads inquiries state from disk."""
    if INQUIRIES_STATE_FILE.exists():
        try:
            with open(INQUIRIES_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
        except Exception:
            pass
    return {}

def save_inquiries_state(state: Dict[str, List[Dict[str, Any]]]):
    """Saves inquiries state to disk."""
    try:
        with open(INQUIRIES_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[WAR_ROOM_INQUIRIES] Warning saving inquiries state: {e}")

def get_room_inquiries(room_id: str) -> List[Dict[str, Any]]:
    """Returns inquiries for a specific room."""
    state = load_inquiries_state()
    rid = (room_id or "general").strip()
    return state.get(rid, [])

def set_room_inquiry(room_id: str, inquiry: Dict[str, Any]):
    """Sets or replaces the active inquiry from an agent in the room."""
    state = load_inquiries_state()
    rid = (room_id or "general").strip()
    inqs = state.get(rid, [])
    inqs = [i for i in inqs if i.get("agent", "").lower() != inquiry.get("agent", "").lower()]
    inqs.append(inquiry)
    state[rid] = inqs
    save_inquiries_state(state)

def resolve_room_inquiry(room_id: str, inquiry_id: str, resolution: str = "resolved", agent_name: Optional[str] = None) -> bool:
    """Resolves one or all active inquiries for a room."""
    state = load_inquiries_state()
    rid = (room_id or "general").strip()
    inqs = state.get(rid, [])
    if not inqs:
        return False
    original_len = len(inqs)
    if inquiry_id == "all":
        inqs = []
    else:
        inqs = [i for i in inqs if i.get("id") != inquiry_id and (not agent_name or i.get("agent", "").lower() != agent_name.lower())]
    state[rid] = inqs
    save_inquiries_state(state)
    return len(inqs) < original_len

def extract_quick_chips(question: str, next_step: Optional[str] = None, full_reply: str = "") -> List[Dict[str, str]]:
    """
    Generates context-aware 1-click decision chips with explicit `{label, prompt}` objects
    so operators never see vague 'Acknowledge' / 'Clarify' buttons.
    """
    if next_step and next_step.strip():
        step_title = next_step.strip()
        short_title = step_title[:28] + ("…" if len(step_title) > 28 else "")
        return [
            {"label": f"Approve: {short_title}", "prompt": f"Approved: proceed with {step_title}"},
            {"label": "Verify Deliverables", "prompt": "Please verify the current deliverables and report key metrics first."},
            {"label": "Adjust Plan...", "prompt": f"Before proceeding with '{step_title}', let's adjust: "},
        ]

    clean_q = re.sub(r"[*_`#]", "", question or "").strip()
    lower_q = clean_q.lower()
    combined_low = f"{lower_q} {(full_reply or '').lower()}"

    # 1. Explicit code/keyword reply requested (e.g., "reply `APPROVE 2Y3D`" or 'Reply "go" to use the defaults')
    code_match = re.search(
        r"\breply\s+[`\"']([A-Za-z0-9_\-\s]{2,28})[`\"']",
        full_reply or question or "",
        re.IGNORECASE,
    )
    if code_match:
        token = code_match.group(1).strip()
        if token.lower() == "go":
            return [
                {"label": 'Use Defaults ("go")', "prompt": "go — proceed with your recommended defaults."},
                {"label": "Customize Rules...", "prompt": "Let's customize the rules before running: "},
                {"label": "Hold for Now", "prompt": "Hold off on running this for now."},
            ]
        return [
            {"label": f"Reply: {token}", "prompt": token},
            {"label": "Hold / Do Not Proceed Yet", "prompt": "Hold off for now — do not execute yet."},
            {"label": "Give Different Instruction...", "prompt": "Instead of that, please: "},
        ]

    # 2. Deliverable reload / verification confirmation request
    if re.search(r"\b(reload|download|open)\b[\s\S]{0,60}\b(deliverables?|file|dashboard|html|csv)\b", combined_low) or (
        "confirm" in lower_q and any(w in lower_q for w in ("look right", "tab", "badge", "deliverable", "working", "device"))
    ):
        return [
            {"label": "Confirmed — Looks Good", "prompt": "Confirmed — I checked the deliverable and everything looks good."},
            {"label": "Found an Issue...", "prompt": "I checked the deliverable and noticed this issue: "},
            {"label": "Next Milestone...", "prompt": "The deliverable is verified. For our next step, please: "},
        ]

    # 3. Multi-question / numbered decisions block
    has_multi_q = (
        question.count("?") >= 2
        or bool(re.search(r"(?:^|\s)[12]\)\s+|\b(?:two|three|four|\d+)\s+(?:questions|decisions|rules)\b", lower_q))
    )
    if has_multi_q:
        return [
            {"label": "Approve Recommended Defaults", "prompt": "Approved — proceed with your recommended defaults for all the questions above."},
            {"label": "Answer 1-by-1...", "prompt": "1) \n2) "},
            {"label": "Compare Trade-offs", "prompt": "Briefly compare the trade-offs on those questions before I decide."},
        ]

    # 4. Post-task output review prompt
    if "specify next" in lower_q or "review output" in lower_q or "review deliverables" in lower_q:
        return [
            {"label": "Verify Deliverables", "prompt": "Summarize and verify the generated deliverables and key metrics."},
            {"label": "Specify Next Step...", "prompt": "For the next step, please: "},
            {"label": "Request Revision...", "prompt": "Please revise the output: "},
        ]

    # 5. Approval / confirmation questions
    if any(w in lower_q for w in ("approve", "confirm", "authorize", "permission", "ready to launch")):
        return [
            {"label": "Approve & Proceed", "prompt": "Approved — please proceed."},
            {"label": "Adjust Parameters...", "prompt": "Let's adjust the parameters before proceeding: "},
            {"label": "Hold / Reject", "prompt": "Do not proceed with that yet."},
        ]

    # 6. Yes/No or "Should I / Shall I / Do you want / Would you like / Can I..." questions
    if ("yes" in lower_q and "no" in lower_q) or re.search(
        r"\b(should\s+(?:i|we)|shall\s+(?:i|we)|do\s+you\s+(?:want|prefer|agree)|would\s+you\s+like|can\s+(?:i|we))\b",
        lower_q,
    ):
        if " or " in lower_q:
            return [
                {"label": "Use Your Recommendation", "prompt": "Go ahead with your recommended option."},
                {"label": "Pick Option...", "prompt": "Let's go with: "},
                {"label": "Modify Approach...", "prompt": "Instead, please: "},
            ]
        return [
            {"label": "Yes, Proceed", "prompt": "Yes, please go ahead with that."},
            {"label": "No, Skip That", "prompt": "No, skip that part."},
            {"label": "Adjust...", "prompt": "Let's adjust that: "},
        ]

    # 7. Proceed / continue questions
    if "proceed" in lower_q or "continue" in lower_q:
        return [
            {"label": "Proceed Now", "prompt": "Yes, proceed now."},
            {"label": "Give Direction...", "prompt": "Before continuing, please: "},
            {"label": "Pause", "prompt": "Pause here for now."},
        ]

    # 8. Choice / option questions ("which", "option A or B")
    if "choose" in lower_q or "option" in lower_q or "which" in lower_q:
        return [
            {"label": "Use Recommended Option", "prompt": "Proceed with the option you recommend best."},
            {"label": "Specify Choice...", "prompt": "My choice is: "},
            {"label": "Compare Options", "prompt": "Briefly compare the pros and cons of each option."},
        ]

    # 9. Smart self-explanatory default fallback (never 'Acknowledge' / 'Clarify')
    return [
        {"label": "Proceed as Proposed", "prompt": "Proceed as you proposed."},
        {"label": "Give Direction...", "prompt": "Here is what to do next: "},
        {"label": "Ask to Elaborate", "prompt": "Please clarify what specific decision or input you need from me."},
    ]


def extract_inquiry_from_reply(
    reply: str,
    agent_name: str,
    op_name: str = "Min",
) -> Optional[Dict[str, Any]]:
    """
    Analyzes an agent reply that mentioned `@user` / `@Min` to extract the genuine
    decision question(s) or action request, and filters out passive prose mentions
    (such as "Per @Min's directive, data collection is wrapped") so bogus banners
    are never created.
    """
    if not reply or not reply.strip():
        return None

    extracted_ns: Optional[str] = None
    ns_tag_match = re.search(r"<next_step>(.*?)</next_step>", reply, re.DOTALL | re.IGNORECASE)
    if ns_tag_match and ns_tag_match.group(1).strip():
        extracted_ns = ns_tag_match.group(1).strip()
    else:
        ns_line_match = re.search(
            r"(?:(?:Proposed\s+)?Next\s+(?:Step|Task|Action)|Following\s+task)\s*[:—–-]\s*([^\n\r]+)",
            reply,
            re.IGNORECASE,
        )
        if ns_line_match:
            cand_ns = re.sub(r"[*_`#]", "", ns_line_match.group(1)).strip()
            if len(cand_ns) >= 4:
                extracted_ns = cand_ns

    # Extract executive summary text if present, then strip XML tags & fenced code blocks for line scanning
    exec_sum_match = re.search(r"<executive_summary>([\s\S]*?)</executive_summary>", reply, re.IGNORECASE)
    exec_sum_text = exec_sum_match.group(1).strip() if exec_sum_match else ""

    body = re.sub(r"<executive_summary>[\s\S]*?</executive_summary>", "", reply, flags=re.IGNORECASE)
    body = re.sub(r"<(?:async_task|swarm_dispatch|set_reminder|set_schedule|manage_schedule|outbound_message|next_step)\b[^>]*>[\s\S]*?</(?:async_task|swarm_dispatch|set_reminder|set_schedule|manage_schedule|outbound_message|next_step)>", "", body, flags=re.IGNORECASE)
    body = re.sub(r"```[\s\S]*?```", "", body)

    raw_lines = [ln.strip() for ln in body.splitlines() if ln.strip()]

    # 1. Collect genuine question lines (excluding markdown tables and URLs)
    q_lines: List[str] = []
    for ln in raw_lines:
        if ln.startswith("|") or ln.startswith("#"):
            continue
        if "?" in ln:
            clean_ln = re.sub(r"[*_`#]", "", ln).strip()
            clean_ln = re.sub(r"^\s*(?:[-•*]|\d+[\).])\s*", "", clean_ln).strip()
            if len(clean_ln) > 10 and not re.match(r"^https?://", clean_ln):
                q_lines.append(clean_ln)

    #Also check executive summary for a question if body had none
    if not q_lines and "?" in exec_sum_text:
        for sent in re.split(r"(?<=[.!?])\s+", exec_sum_text):
            if "?" in sent and len(sent.strip()) > 10:
                q_lines.append(re.sub(r"[*_`#]", "", sent).strip())

    # 2. Check for direct callout / imperative addressed to @Min / @user (even without '?')
    op_esc = re.escape(op_name or "Min")
    direct_callout_re = re.compile(
        rf"(?:^|\s)(?:@(?:user|operator|{op_esc})\b\s*[:—–,\-]\s*|(?:{op_esc}|@(?:user|{op_esc}))\s*,\s*(?:please|i\s+need|i\s+recommend|reply|pick|confirm|reload|check|let\s+me\s+know)|awaiting\s+(?:@?{op_esc}|@?user|operator)(?:'s)?\s+)",
        re.IGNORECASE,
    )
    callout_lines: List[str] = []
    for ln in raw_lines:
        if ln.startswith("|") or ln.startswith("#"):
            continue
        if direct_callout_re.search(ln):
            clean_ln = re.sub(r"[*_`#]", "", ln).strip()
            if len(clean_ln) > 12:
                callout_lines.append(clean_ln)

    if not callout_lines and exec_sum_text and direct_callout_re.search(exec_sum_text):
        for sent in re.split(r"(?<=[.!?])\s+", exec_sum_text):
            if direct_callout_re.search(sent) or any(w in sent.lower() for w in ("need your", "please", "confirm", "reply", "approve", "decision")):
                callout_lines.append(re.sub(r"[*_`#]", "", sent).strip())

    # 3. Check if passive mention only (e.g. "Per @Min's directive..." with no questions, no callouts, no next_step)
    if not q_lines and not callout_lines and not extracted_ns:
        return None

    # 4. Format concise inquiry question summary
    if len(q_lines) >= 2:
        picked = q_lines[-3:] if len(q_lines) > 3 else q_lines
        inquiry_q = " • ".join(f"{idx+1}) {q[:120]}" for idx, q in enumerate(picked))
    elif len(q_lines) == 1:
        inquiry_q = q_lines[0][:240]
    elif callout_lines:
        inquiry_q = callout_lines[-1][:240]
    elif extracted_ns:
        inquiry_q = f"{agent_name} proposed next step: {extracted_ns}. Approve or adjust?"
    else:
        return None

    return {
        "question": inquiry_q,
        "next_step": extracted_ns,
        "status": "input_needed",
        "chips": extract_quick_chips(inquiry_q, next_step=extracted_ns, full_reply=reply),
    }
