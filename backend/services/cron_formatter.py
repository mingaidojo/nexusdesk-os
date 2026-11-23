from datetime import datetime
from typing import Any, Dict
from croniter import croniter

def format_cron_schedule(sched_obj: Any) -> Dict[str, Any]:
    if isinstance(sched_obj, dict):
        kind = sched_obj.get("kind", "cron")
        expr = sched_obj.get("expr") or sched_obj.get("display") or ""
        minutes = sched_obj.get("minutes")
    else:
        kind = "cron"
        expr = str(sched_obj)
        minutes = None

    human_schedule = "Custom schedule"
    if kind == "interval" or (minutes and minutes > 0) or "every" in str(expr).lower():
        m = minutes or 0
        if "20160" in str(expr) or m == 20160:
            human_schedule = "Every 14 days"
        elif m >= 1440:
            human_schedule = f"Every {m // 1440} days"
        elif m >= 60:
            human_schedule = f"Every {m // 60} hours"
        elif m > 0:
            human_schedule = f"Every {m} minutes"
        else:
            human_schedule = str(expr)
    elif kind == "once":
        human_schedule = "One-time execution"
    elif expr:
        parts = expr.strip().split()
        if len(parts) == 5:
            min_p, hour_p, dom_p, mon_p, dow_p = parts
            if min_p == "0" and hour_p == "2" and dom_p == "*" and mon_p == "*" and dow_p == "*":
                human_schedule = "Every day at 02:00 AM"
            elif min_p == "0" and hour_p == "1" and dom_p == "*" and mon_p == "*" and dow_p == "*":
                human_schedule = "Every day at 01:00 AM"
            elif min_p == "0" and hour_p == "22" and dom_p == "*" and mon_p == "*" and dow_p == "*":
                human_schedule = "Every day at 10:00 PM"
            elif min_p == "0" and hour_p == "0" and dom_p == "*" and mon_p == "*" and dow_p == "*":
                human_schedule = "Every day at Midnight (00:00)"
            elif min_p == "0" and hour_p == "*/2" and dom_p == "*" and mon_p == "*" and dow_p == "*":
                human_schedule = "Every 2 hours"
            elif min_p == "0" and hour_p == "8" and dom_p == "*" and mon_p == "*" and dow_p == "*":
                human_schedule = "Every day at 08:00 AM"
            elif "*/" in hour_p:
                step = hour_p.replace("*/", "")
                human_schedule = f"Every {step} hours"
            elif hour_p.isdigit() and min_p.isdigit():
                h = int(hour_p)
                m = int(min_p)
                am_pm = "AM" if h < 12 else "PM"
                h12 = h if (h == 12 or h == 0) else (h % 12)
                if h12 == 0: h12 = 12
                human_schedule = f"Daily at {h12:02d}:{m:02d} {am_pm}"
            else:
                human_schedule = expr
        else:
            human_schedule = expr

    try:
        now = datetime.now()
        if " " in expr and len(expr.split()) == 5:
            itr = croniter(expr, now)
            nxt = itr.get_next(datetime)
            diff = nxt - now
            total_seconds = max(0, int(diff.total_seconds()))
            hours, remainder = divmod(total_seconds, 3600)
            minutes, _ = divmod(remainder, 60)
            
            day_str = nxt.strftime("%a")
            h_str = nxt.strftime("%I:%M %p")
            countdown_str = f"in {hours}h {minutes}m" if hours > 0 else f"in {minutes}m"
            next_exec_str = f"{day_str}, {h_str} ({countdown_str})"
            
            return {
                "human_schedule": human_schedule,
                "next_execution": next_exec_str,
                "countdown": f"{hours:02d}h {minutes:02d}m",
                "next_run_iso": nxt.isoformat()
            }
        else:
            return {
                "human_schedule": human_schedule,
                "next_execution": "Scheduled interval",
                "countdown": "-",
                "next_run_iso": None
            }
    except Exception:
        return {
            "human_schedule": human_schedule,
            "next_execution": "Scheduled",
            "countdown": "-",
            "next_run_iso": None
        }
