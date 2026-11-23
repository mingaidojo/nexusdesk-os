"""
NexusDesk War Room Background Tasks & Sandbox Service
Manages two-phase asynchronous background delegation, sandbox creation, scratch pruning, and disk quotas.
Part of BL-ARCH-32 modularization.
"""

import asyncio
import gzip
import json
import os
import re
import shutil
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional

from core.config import DATA_DIR, get_instance_user_context
from core.config import broadcast_event

BACKGROUND_TASKS_FILE = DATA_DIR / "war_room_bg_tasks.json"
SANDBOX_BASE = Path("/home/nexus_shared/sandboxes")
ACTIVE_BG_TASK_PROCS: Dict[str, Any] = {}  # task_id -> asyncio.subprocess.Process
ADOPTED_BG_WATCHERS: Dict[str, asyncio.Task] = {}  # task_id -> asyncio.Task

def _kill_bg_proc(proc: Any) -> bool:
    """Safely terminates a background task process and its process group."""
    if not proc or proc.returncode is not None:
        return False
    try:
        os.killpg(os.getpgid(proc.pid), 15)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
    try:
        def _force(p):
            if p.returncode is None:
                try:
                    os.killpg(os.getpgid(p.pid), 9)
                except Exception:
                    try:
                        p.kill()
                    except Exception:
                        pass
        asyncio.get_running_loop().call_later(2.0, _force, proc)
    except Exception:
        pass
    return True

async def cancel_room_background_task(room_id: str, task_id: str) -> Dict[str, Any]:
    """Cancels a running background task, terminates its subprocess group (or adopted PID), and updates state."""
    rid = (room_id or "general").strip()
    proc = ACTIVE_BG_TASK_PROCS.pop(task_id, None)
    if proc:
        _kill_bg_proc(proc)
    watcher = ADOPTED_BG_WATCHERS.pop(task_id, None)
    if watcher and not watcher.done():
        watcher.cancel()
    tasks = get_room_bg_tasks(rid)
    target = next((t for t in tasks if t["id"] == task_id), None)
    if target and target.get("status") == "running":
        raw_pid = target.get("pid")
        if raw_pid and not proc:
            try:
                pid_int = int(raw_pid)
                if os.path.exists(f"/proc/{pid_int}"):
                    try:
                        os.killpg(os.getpgid(pid_int), 15)
                    except Exception:
                        os.kill(pid_int, 15)
            except Exception:
                pass
        target["status"] = "cancelled"
        target["updated_at"] = time.time()
        target["duration"] = round(time.time() - target.get("created_at", time.time()), 1)
        target["latest_progress"] = "Cancelled by operator"
        upsert_room_bg_task(rid, target)
    await broadcast_event("war_room_tasks_updated", {
        "room_id": rid,
        "tasks": get_room_bg_tasks(rid)
    })
    return target or {"id": task_id, "status": "cancelled"}

def get_bg_task_live_status(room_id: str, task_id: str, tail_lines: int = 40) -> Dict[str, Any]:
    """Returns real-time status and log tail for a specific background task."""
    rid = (room_id or "general").strip()
    tasks = get_room_bg_tasks(rid)
    target = next((t for t in tasks if t["id"] == task_id), None)
    if not target:
        return {"error": "Task not found", "id": task_id}

    now = time.time()
    created = target.get("created_at", now)
    elapsed = round(now - created, 1) if target.get("status") == "running" else (target.get("duration") or round(target.get("updated_at", now) - created, 1))
    log_path = Path(target.get("log_file", ""))
    log_tail = ""
    latest_line = target.get("latest_progress", "")
    if log_path.exists() and log_path.is_file():
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as lf:
                lines = lf.readlines()
                content_lines = [l.rstrip("\r\n") for l in lines if l.strip() and not l.startswith("#")]
                if content_lines:
                    latest_line = content_lines[-1][:160]
                log_tail = "".join(lines[-tail_lines:])
        except Exception as e:
            log_tail = f"(Error reading log: {e})"
    else:
        log_tail = "(Waiting for log output...)"

    return {
        "task": target,
        "elapsed": elapsed,
        "timeout": target.get("timeout", 600),
        "latest_progress": latest_line or "Initializing...",
        "log_tail": log_tail
    }

SEARCH_WEB_HELPER_CODE = r'''#!/usr/bin/env python3
# NexusDesk War Room Autonomous Internet Research Helper (BL-EVO-24)
# Allows agents to look up information from the internet about errors, APIs, and fixes.
# Usage: python3 search_web.py "<search query>"
import sys
import urllib.request
import urllib.parse
import json
import gzip
import re

def search(query, max_results=5):
    results = []
    # 1. DuckDuckGo HTML POST
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
        data = urllib.parse.urlencode({'q': query}).encode()
        req = urllib.request.Request('https://html.duckduckgo.com/html/', data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='replace')
            snippets = re.findall(r'<a class="result__snippet[^>]*>(.*?)</a>', html, re.DOTALL)
            urls = re.findall(r'<a class="result__url[^>]*href="([^"]+)"', html)
            for i, s in enumerate(snippets[:max_results]):
                clean_s = re.sub(r'<[^>]+>', '', s).strip()
                if clean_s:
                    url = urls[i].strip() if i < len(urls) else ''
                    results.append({'snippet': clean_s, 'url': url, 'source': 'DuckDuckGo'})
    except Exception:
        pass

    # 2. StackOverflow API
    if len(results) < max_results:
        try:
            clean_q = re.sub(r'[^a-zA-Z0-9\s]', ' ', query)
            clean_q = ' '.join(clean_q.split()[:6])
            url = f"https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q={urllib.parse.quote(clean_q)}&site=stackoverflow"
            headers = {'User-Agent': 'NexusDesk/1.0', 'Accept-Encoding': 'gzip'}
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as resp:
                raw_bytes = resp.read()
                if resp.headers.get('Content-Encoding') == 'gzip':
                    raw_bytes = gzip.decompress(raw_bytes)
                data = json.loads(raw_bytes.decode('utf-8'))
                for item in data.get('items', [])[:(max_results - len(results))]:
                    title = item.get('title', '')
                    link = item.get('link', '')
                    if title:
                        results.append({'snippet': f"SO Q&A: {title}", 'url': link, 'source': 'StackOverflow'})
        except Exception:
            pass

    return results

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python3 search_web.py "<search query>"')
        sys.exit(1)
    q = " ".join(sys.argv[1:])
    print(f"🔍 Searching the internet for: {q}...\\n")
    res = search(q)
    if not res:
        print("No search results found.")
    else:
        for i, r in enumerate(res, 1):
            print(f"[{i}] ({r['source']}) {r['snippet']}")
            if r['url']:
                print(f"    URL: {r['url']}")
            print()
'''

def sync_search_internet_for_blockers(blockers: List[str], task_desc: str) -> List[str]:
    """
    BL-EVO-24: Synchronously searches the internet for known fixes to detected blockers.
    """
    if not blockers:
        return []
    lead = blockers[0]
    clean_lead = re.sub(r'\(.*?\)', '', lead).strip()
    clean_desc = re.sub(r'[^a-zA-Z0-9\s]', ' ', task_desc)
    words = [w for w in clean_desc.split() if w.lower() not in ("auto-recovered", "background", "job", "from", "solaris", "agy", "claude", "task")]
    query_str = f"{' '.join(words[:4])} {clean_lead} fix python".strip()

    snippets = []
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
        data = urllib.parse.urlencode({'q': query_str}).encode()
        req = urllib.request.Request('https://html.duckduckgo.com/html/', data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=6) as resp:
            html = resp.read().decode('utf-8', errors='replace')
            raw_snippets = re.findall(r'<a class="result__snippet[^>]*>(.*?)</a>', html, re.DOTALL)
            for s in raw_snippets[:3]:
                clean_s = re.sub(r'<[^>]+>', '', s).strip()
                if clean_s and len(clean_s) > 20:
                    snippets.append(clean_s)
    except Exception as e:
        print(f"[WAR_ROOM_TASKS] Web research warning: {e}")

    return snippets

async def async_search_internet_for_blockers(blockers: List[str], task_desc: str) -> List[str]:
    """Runs internet research for blockers in a thread pool without blocking event loop."""
    try:
        return await asyncio.to_thread(sync_search_internet_for_blockers, blockers, task_desc)
    except Exception:
        return []

FUZZY_MATCH_HELPER_CODE = '''#!/usr/bin/env python3
"""
NexusDesk Autonomous Multi-Strategy Entity & Fuzzy Matcher (BL-EVO-25)
Usage: python3 fuzzy_match_helper.py <csv_path> "<query1>" ["<query2>" ...]
Automatically handles UTF-8 BOM (utf-8-sig), token overlap, substring matching,
difflib.SequenceMatcher similarity, and secondary column correlation (address, POI, tags).
"""
import csv
import difflib
import re
import sys
from pathlib import Path

def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9\\s]", " ", (s or "").lower()).strip()

def resolve_queries(csv_path: str, queries: list):
    p = Path(csv_path)
    if not p.exists():
        print(f"Error: File not found: {csv_path}")
        return
    with open(p, "r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        headers = reader.fieldnames or []

    if not rows:
        print(f"File {p.name} has 0 data rows.")
        return

    id_col = headers[0]
    name_col = next((h for h in headers if h != id_col and ("name" in h.lower() or "branch" in h.lower() or "label" in h.lower())), headers[min(1, len(headers)-1)])

    # Group unique primary entities (e.g. branches) with all associated secondary text (POI names, addresses, tags)
    entities = {}
    for r in rows:
        key = (r.get(id_col, ""), r.get(name_col, ""))
        if key not in entities:
            entities[key] = {"row": r, "blob": set()}
        for h in headers:
            val = (r.get(h) or "").strip()
            if val and len(val) < 120:
                entities[key]["blob"].add(f"{h}:{val}")

    for q in queries:
        qn = norm(q)
        q_tokens = [t for t in qn.split() if len(t) > 2]
        scored = []
        for (eid, ename), info in entities.items():
            en = norm(ename)
            seq_ratio = difflib.SequenceMatcher(None, qn, en).ratio()
            blob_text = " | ".join(info["blob"])
            blob_norm = norm(blob_text)
            tok_hits = sum(1 for t in q_tokens if t in en)
            sec_hits = [b for b in info["blob"] if any(t in norm(b) for t in q_tokens if t not in ("jakarta", "surabaya", "medan", "bandung", "semarang", "batam"))]
            score = seq_ratio + (0.25 * tok_hits) + (0.35 if qn in blob_norm else 0.0) + (0.2 * min(len(sec_hits), 3))
            scored.append((score, seq_ratio, eid, ename, sec_hits[:3]))

        scored.sort(key=lambda x: x[0], reverse=True)
        print(f"=== Query: '{q}' ===")
        for sc, sr, eid, ename, hits in scored[:5]:
            hit_str = f" | Secondary hits: {hits}" if hits else ""
            print(f"  [score={sc:.2f}, str_sim={sr:.2f}] {id_col}={eid} | {name_col}={ename}{hit_str}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 fuzzy_match_helper.py <csv_path> '<query1>' ['<query2>' ...]")
        sys.exit(1)
    resolve_queries(sys.argv[1], sys.argv[2:])
'''

def get_room_sandbox_path(room_id: str) -> Path:
    """Ensures and returns the shared multi-agent sandbox directory for a war room."""
    rid = (room_id or "general").strip()
    s_path = SANDBOX_BASE / rid
    try:
        s_path.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(s_path, 0o777)
        except Exception:
            pass
        scratch = s_path / "scratch"
        scratch.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(scratch, 0o777)
        except Exception:
            pass
        deliverables = s_path / "deliverables"
        deliverables.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(deliverables, 0o777)
        except Exception:
            pass

        # BL-EVO-24: Deploy search_web.py to scratch if not present
        search_helper = scratch / "search_web.py"
        if not search_helper.exists():
            try:
                search_helper.write_text(SEARCH_WEB_HELPER_CODE, encoding="utf-8")
                os.chmod(search_helper, 0o777)
            except Exception:
                pass

        # BL-EVO-25: Deploy fuzzy_match_helper.py to scratch if not present
        fuzzy_helper = scratch / "fuzzy_match_helper.py"
        if not fuzzy_helper.exists():
            try:
                fuzzy_helper.write_text(FUZZY_MATCH_HELPER_CODE, encoding="utf-8")
                os.chmod(fuzzy_helper, 0o777)
            except Exception:
                pass
    except Exception as e:
        print(f"[WAR_ROOM_TASKS] Warning ensuring sandbox for {rid}: {e}")
    return s_path

_SANDBOX_SKIP_DIRS = {"node_modules", "__pycache__", ".git", "Cache", "Code Cache", "GPUPersistentCache", "Safe Browsing", "ShaderCache", "GrShaderCache"}


def prune_sandbox_scratch(sandbox_dir: Path, ttl_days: int = 7) -> int:
    """Prunes scratch files older than ttl_days."""
    scratch = sandbox_dir / "scratch"
    if not scratch.exists():
        return 0
    now = time.time()
    cutoff = now - (ttl_days * 86400)
    pruned = 0
    for root, dirs, files in os.walk(scratch):
        dirs[:] = [d for d in dirs if not d.startswith(".") and not d.startswith("profile_") and d not in _SANDBOX_SKIP_DIRS]
        for f in files:
            if f in ("search_web.py", "fuzzy_match_helper.py"):
                continue
            fp = Path(root) / f
            try:
                if fp.stat().st_mtime < cutoff:
                    fp.unlink()
                    pruned += 1
            except Exception:
                pass
    return pruned

def get_sandbox_stats(room_id: str) -> Dict[str, Any]:
    """Calculates disk space usage and quotas for a room's sandbox."""
    s_path = get_room_sandbox_path(room_id)
    prune_sandbox_scratch(s_path, ttl_days=7)
    
    scratch_bytes = 0
    scratch_count = 0
    deliverables_bytes = 0
    deliverables_count = 0
    total_bytes = 0

    for root, dirs, files in os.walk(s_path):
        dirs[:] = [d for d in dirs if not d.startswith(".") and not d.startswith("profile_") and d not in _SANDBOX_SKIP_DIRS]
        for f in files:
            fp = Path(root) / f
            try:
                sz = fp.stat().st_size
                total_bytes += sz
                if "scratch" in fp.parts:
                    scratch_bytes += sz
                    scratch_count += 1
                elif "deliverables" in fp.parts:
                    deliverables_bytes += sz
                    deliverables_count += 1
            except Exception:
                pass

    total_mb = round(total_bytes / (1024 * 1024), 2)
    quota_mb = 1024  # 1 GB per room limit
    usage_pct = round((total_mb / quota_mb) * 100, 1)

    return {
        "room_id": room_id,
        "sandbox_path": str(s_path),
        "total_bytes": total_bytes,
        "total_mb": total_mb,
        "quota_mb": quota_mb,
        "usage_percent": usage_pct,
        "scratch_bytes": scratch_bytes,
        "scratch_mb": round(scratch_bytes / (1024 * 1024), 2),
        "scratch_count": scratch_count,
        "deliverables_bytes": deliverables_bytes,
        "deliverables_mb": round(deliverables_bytes / (1024 * 1024), 2),
        "deliverables_count": deliverables_count,
        "quota_exceeded": total_mb >= quota_mb,
        "approaching_quota": usage_pct >= 85.0
    }

def load_bg_tasks_state() -> Dict[str, List[Dict[str, Any]]]:
    """Loads background tasks ledger."""
    if not BACKGROUND_TASKS_FILE.exists():
        return {}
    try:
        with open(BACKGROUND_TASKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_bg_tasks_state(state: Dict[str, List[Dict[str, Any]]]):
    """Saves background tasks ledger."""
    try:
        with open(BACKGROUND_TASKS_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[WAR_ROOM_TASKS] Warning saving bg tasks: {e}")

def get_room_bg_tasks(room_id: str) -> List[Dict[str, Any]]:
    """Returns background tasks for a room."""
    rid = (room_id or "general").strip()
    return load_bg_tasks_state().get(rid, [])

def upsert_room_bg_task(room_id: str, task_rec: Dict[str, Any]):
    """Upserts a background task record into the ledger."""
    rid = (room_id or "general").strip()
    st = load_bg_tasks_state()
    tasks = st.get(rid, [])
    idx = next((i for i, t in enumerate(tasks) if t["id"] == task_rec["id"]), -1)
    if idx >= 0:
        tasks[idx] = task_rec
    else:
        tasks.append(task_rec)
    st[rid] = tasks[-50:]
    save_bg_tasks_state(st)

def detect_task_output_blockers(
    output_str: str,
    artifacts: List[str],
    task_description: str = "",
    command: str = "",
    exit_code: int = 0
) -> List[str]:
    """
    BL-EVO-23: Automated Output & Deliverable Quality Validation.
    Scans stdout/stderr logs and deliverables to detect HTTP error codes (401, 403, 406, 429, 5xx),
    network/API connection blocks, zero-record extractions, and empty/header-only deliverables.
    """
    blockers = []
    text = output_str or ""

    # 1. HTTP Status Code Blockers
    http_matches = re.findall(
        r'(?:HTTP\s*(?:Error)?\s*|status(?:_code)?\s*[:=]\s*)((?:401|403|404|406|429|500|502|503|504))\b(?:\s*[:\-]\s*([^\n\r,;]+))?',
        text,
        re.IGNORECASE
    )
    for code, desc in http_matches:
        d = desc.strip() if desc else ""
        msg = f"HTTP Error {code}" + (f": {d}" if d else "")
        if msg not in blockers:
            blockers.append(msg)

    # 2. Network / Connection / Anti-Scraping / Cloudflare Blockers
    network_patterns = [
        (r'ConnectionRefusedError|connection\s+refused|Errno\s+111', "Connection Refused (Remote endpoint rejected connection)"),
        (r'NameResolutionError|Failed\s+to\s+resolve|getaddrinfo\s+failed', "DNS Name Resolution Failed"),
        (r'RemoteDisconnected|ConnectionResetError|Max\s+retries\s+exceeded', "Connection Dropped / Max Retries Exceeded"),
        (r'CERTIFICATE_VERIFY_FAILED|SSL:\s*CERTIFICATE', "SSL Certificate Verification Failed"),
        (r'Attention\s+Required!\s*\|\s*Cloudflare|challenge-platform|cf-browser-verification', "Cloudflare Anti-Bot Challenge / WAF Block"),
        (r'Rate\s+limit\s+exceeded|Too\s+Many\s+Requests', "Rate Limit Exceeded"),
    ]
    for pat, label in network_patterns:
        if re.search(pat, text, re.IGNORECASE):
            if label not in blockers:
                blockers.append(label)

    # 3. Harvest / Scraper Zero-Yield Signatures
    zero_yield_patterns = [
        r'Total\s+after\s+dedup\s*:\s*0\b',
        r'Total\s+(?:harvested|records|found|scraped|extracted)\s*:\s*0\b',
        r'Saved\s+0\s+(?:records|rows|items|branches|files|entries)',
        r'Found\s+0\s+(?:records|rows|items|branches|results|entries)',
        r'Extracted\s+0\s+(?:records|rows|items|branches|entries)',
        r'Total\s*:\s*0\b',
        r'0\s+records\s+(?:harvested|extracted|scraped|saved|found)',
        r'0\s+rows\s+(?:written|extracted|found|saved)',
    ]
    for pat in zero_yield_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            blockers.append(f"Zero Records Harvested ({m.group(0).strip()})")
            break

    # 4. Artifact & Deliverable Quality Validation
    valid_data_artifacts = []
    empty_artifacts = []

    for art in artifacts:
        p = Path(art)
        if not p.exists() or not p.is_file():
            continue
        try:
            size = p.stat().st_size
            fname = p.name
            if size == 0:
                empty_artifacts.append(f"Deliverable '{fname}' is 0 bytes (empty file)")
                continue

            ext = p.suffix.lower()
            if ext in ('.csv', '.tsv'):
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    lines = [ln.strip() for ln in f if ln.strip()]
                if len(lines) == 0:
                    empty_artifacts.append(f"Deliverable '{fname}' is completely empty (0 rows)")
                elif len(lines) == 1:
                    empty_artifacts.append(f"Deliverable '{fname}' contains only a CSV header row (0 data rows)")
                else:
                    valid_data_artifacts.append((fname, len(lines) - 1, size))
            elif ext == '.json':
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    try:
                        data = json.load(f)
                        if isinstance(data, list):
                            if len(data) == 0:
                                empty_artifacts.append(f"Deliverable '{fname}' is an empty JSON array ([] - 0 items)")
                            else:
                                valid_data_artifacts.append((fname, len(data), size))
                        elif isinstance(data, dict):
                            has_data = False
                            for k in ('data', 'results', 'records', 'items', 'branches', 'rows'):
                                if isinstance(data.get(k), list):
                                    if len(data[k]) > 0:
                                        valid_data_artifacts.append((fname, len(data[k]), size))
                                        has_data = True
                                        break
                                    else:
                                        has_data = False
                            if not has_data:
                                if len(data) == 0:
                                    empty_artifacts.append(f"Deliverable '{fname}' is an empty JSON object (0 keys)")
                                else:
                                    valid_data_artifacts.append((fname, len(data), size))
                    except Exception:
                        empty_artifacts.append(f"Deliverable '{fname}' contains invalid/malformed JSON")
            else:
                if size > 0:
                    valid_data_artifacts.append((fname, 1, size))
                else:
                    empty_artifacts.append(f"Deliverable '{fname}' is 0 bytes")
        except Exception:
            pass

    for ea in empty_artifacts:
        if ea not in blockers:
            blockers.append(ea)

    # 5. Check if this was a harvesting/scraping/data extraction job that produced no data
    combined_desc = (task_description + " " + command).lower()
    is_data_job = any(w in combined_desc for w in [
        "fetch", "scrape", "crawl", "harvest", "extract", "download",
        "export", "collector", "gather", "retrieve", "query"
    ])
    if is_data_job and not valid_data_artifacts and not blockers and exit_code == 0:
        if not artifacts:
            blockers.append(f"Data harvesting task '{task_description}' produced 0 deliverables in deliverables/")
        else:
            blockers.append("Data harvesting task produced 0 valid data records across deliverables")

    return blockers


def summarize_deliverable_metrics(artifacts: List[str]) -> str:
    """Summarizes record counts and file sizes for valid deliverables."""
    summaries = []
    for art in artifacts:
        p = Path(art)
        if not p.exists() or not p.is_file():
            continue
        size_kb = max(0.1, round(p.stat().st_size / 1024.0, 1))
        fname = p.name
        ext = p.suffix.lower()
        if ext in ('.csv', '.tsv'):
            try:
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    lines = [ln.strip() for ln in f if ln.strip()]
                row_count = max(0, len(lines) - 1)
                summaries.append(f"- `{fname}`: **{row_count:,} data rows** ({size_kb} KB)")
            except Exception:
                summaries.append(f"- `{fname}`: ({size_kb} KB)")
        elif ext == '.json':
            try:
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    data = json.load(f)
                if isinstance(data, list):
                    summaries.append(f"- `{fname}`: **{len(data):,} items** ({size_kb} KB)")
                elif isinstance(data, dict):
                    count = 0
                    for k in ('data', 'results', 'records', 'items', 'branches', 'rows'):
                        if isinstance(data.get(k), list):
                            count = len(data[k])
                            break
                    if count:
                        summaries.append(f"- `{fname}`: **{count:,} records** ({size_kb} KB)")
                    else:
                        summaries.append(f"- `{fname}`: ({size_kb} KB)")
            except Exception:
                summaries.append(f"- `{fname}`: ({size_kb} KB)")
        else:
            summaries.append(f"- `{fname}`: ({size_kb} KB)")
    return "\n".join(summaries)


async def launch_two_phase_background_task(
    rid: str,
    agent: Dict[str, Any],
    task_description: str,
    command: Optional[str] = None,
    timeout: int = 600,
    followup_directive: Optional[str] = None,
    auto_proceed_on_success: bool = False,
    next_task_description: Optional[str] = None,
    next_command: Optional[str] = None
) -> Dict[str, Any]:
    """
    BL-WAR-17, BL-WAR-18 & BL-EVO-19: Two-Phase Async Delegation Handshake & Proactive Multi-Agent Return Turn.
    Phase 1: Registers tracked job in war_room_bg_tasks.json, emits immediate receipt in the room.
    Phase 2: Runs command in background subprocess, preserves partial/final stdout/stderr & sandbox artifacts,
             supports auto-proceed chaining on exit code 0 or structured post-job permission gates,
             and triggers a proactive return speaking turn by the originating agent upon completion/failure.
    """
    from services.war_room.execution import (
        read_war_room_history,
        append_war_room_message,
        execute_agent_war_room_turn,
        get_interrupt_gen
    )
    from services.war_room.inquiries import set_room_inquiry, get_room_inquiries

    task_id = f"task_{uuid.uuid4().hex[:8]}"
    # BL-WAR-39: remember the room interrupt generation so an operator interrupt also suppresses this
    # job's proactive return turn (the job itself keeps running and preserves its artifacts)
    launch_gen = get_interrupt_gen(rid)
    now = time.time()
    s_path = get_room_sandbox_path(rid)
    deliverables_dir = s_path / "deliverables"
    scratch_dir = s_path / "scratch"

    task_rec = {
        "id": task_id,
        "room_id": rid,
        "agent": agent["name"],
        "engine": agent.get("engine", "hermes"),
        "color": agent.get("color", "#38bdf8"),
        "description": task_description,
        "command": command or "",
        "timeout": timeout or 600,
        "status": "running",
        "created_at": now,
        "updated_at": now,
        "log_file": str(scratch_dir / f"{task_id}.log"),
        "auto_proceed_on_success": bool(auto_proceed_on_success),
        "next_task_description": next_task_description or "",
        "next_command": next_command or ""
    }
    upsert_room_bg_task(rid, task_rec)
    await broadcast_event("war_room_tasks_updated", {
        "room_id": rid,
        "tasks": get_room_bg_tasks(rid)
    })

    # Phase 1: Immediate Registration Receipt
    chain_info = ""
    if auto_proceed_on_success and (next_command or next_task_description):
        next_label = next_task_description or "downstream task"
        chain_info = f" • **Auto-Chaining Active**: Will autonomously proceed to *{next_label}* upon clean exit (code 0)."

    reg_msg = {
        "id": str(uuid.uuid4()),
        "room_id": rid,
        "sender": "NexusDesk Moderator",
        "sender_type": "system",
        "text": (
            f"⏳ **Two-Phase Async Handshake (`{task_id}`)**: **@{agent['name']}** registered background job: "
            f"*{task_description}* (Timeout: {timeout}s).{chain_info} Floor is yielded while background runner executes; "
            f"**@{agent['name']}** will automatically take a proactive return turn when finished."
        ),
        "timestamp": now
    }
    append_war_room_message(reg_msg, room_id=rid)
    await broadcast_event("war_room_message", reg_msg)
    # BL-EVO-18: Emit background process start event for omnichannel escalation gateways
    await broadcast_event("war_room_task_registered", {
        "room_id": rid,
        "task_id": task_id,
        "agent": agent["name"],
        "description": task_description,
        "timeout": timeout or 600,
    })

    async def _worker():
        start_t = time.time()
        log_path = Path(task_rec["log_file"])
        inst_key = agent.get("fleet", "agents_bs")
        ctx = get_instance_user_context(inst_key)
        ws_dir = agent.get("workspace_dir") or str(ctx["workspace"])

        before_files = set()
        if deliverables_dir.exists():
            before_files = {str(p) for p in deliverables_dir.rglob("*") if p.is_file()}

        stdout_str = ""
        stderr_str = ""
        exit_code = 0
        timed_out = False
        was_cancelled = False

        try:
            # Initialize real-time log header immediately
            header_log = (
                f"# Task ID: {task_id}\n"
                f"# Agent: {agent['name']}\n"
                f"# Description: {task_description}\n"
                f"# Command: {command}\n"
                f"# Started At: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                f"--- LIVE OUTPUT STREAM ---\n"
            )
            try:
                scratch_dir.mkdir(parents=True, exist_ok=True)
                with open(log_path, "w", encoding="utf-8") as lf:
                    lf.write(header_log)
                os.chmod(log_path, 0o666)
            except Exception:
                pass

            if command and command.strip():
                # Enforce umask 000 + low CPU/IO priority (nice 15, ionice idle) so heavy background jobs
                # never starve NexusDesk UI or interactive War Room agent turns
                shared_cmd = f"umask 000 && {command}"
                log_fd = open(log_path, "a", encoding="utf-8", buffering=1)
                proc = await asyncio.create_subprocess_exec(
                    "sudo", "-u", ctx["user"], "-H",
                    "PYTHONUNBUFFERED=1",
                    f"WARROOM_SANDBOX={s_path}",
                    f"WARROOM_SCRATCH={scratch_dir}",
                    f"WARROOM_DELIVERABLES={deliverables_dir}",
                    "nice", "-n", "15", "ionice", "-c", "3",
                    "bash", "-c", shared_cmd,
                    stdout=log_fd,
                    stderr=log_fd,
                    cwd=ws_dir,
                    start_new_session=True
                )
                ACTIVE_BG_TASK_PROCS[task_id] = proc
                task_rec["pid"] = proc.pid
                task_rec["latest_progress"] = "Process started..."
                upsert_room_bg_task(rid, task_rec)

                async def _progress_poller():
                    last_reported = ""
                    try:
                        while proc.returncode is None:
                            await asyncio.sleep(2.5)
                            if proc.returncode is not None:
                                break
                            elapsed_now = round(time.time() - start_t, 1)
                            latest_line = ""
                            if log_path.exists():
                                try:
                                    with open(log_path, "r", encoding="utf-8", errors="replace") as rf:
                                        lines = [l.strip() for l in rf.readlines() if l.strip() and not l.startswith("#") and not l.startswith("---")]
                                        if lines:
                                            latest_line = lines[-1][:160]
                                except Exception:
                                    pass
                            task_rec["elapsed"] = elapsed_now
                            if latest_line:
                                task_rec["latest_progress"] = latest_line
                            if latest_line != last_reported or int(elapsed_now) % 5 == 0:
                                last_reported = latest_line
                                upsert_room_bg_task(rid, task_rec)
                                await broadcast_event("war_room_task_progress", {
                                    "room_id": rid,
                                    "task_id": task_id,
                                    "agent": agent["name"],
                                    "description": task_description,
                                    "elapsed": elapsed_now,
                                    "timeout": timeout or 600,
                                    "latest_progress": task_rec.get("latest_progress", "Running..."),
                                    "status": "running"
                                })
                    except asyncio.CancelledError:
                        pass
                    except Exception as pe:
                        print(f"[WAR_ROOM_TASKS] Poller warning for {task_id}: {pe}")

                poller_task = asyncio.create_task(_progress_poller())
                try:
                    await asyncio.wait_for(proc.wait(), timeout=timeout or 600)
                    exit_code = proc.returncode or 0
                except asyncio.TimeoutError:
                    timed_out = True
                    exit_code = -1
                    _kill_bg_proc(proc)
                finally:
                    poller_task.cancel()
                    ACTIVE_BG_TASK_PROCS.pop(task_id, None)
                    try:
                        log_fd.write(f"\n# Exit Code: {exit_code} (Timed Out: {timed_out})\n")
                        log_fd.close()
                    except Exception:
                        pass

                # Check if operator cancelled this job via UI
                curr_tasks = get_room_bg_tasks(rid)
                curr_rec = next((t for t in curr_tasks if t["id"] == task_id), None)
                if curr_rec and curr_rec.get("status") == "cancelled":
                    was_cancelled = True

                if log_path.exists():
                    try:
                        with open(log_path, "r", encoding="utf-8", errors="replace") as rf:
                            full_txt = rf.read()
                            if "--- LIVE OUTPUT STREAM ---\n" in full_txt:
                                stdout_str = full_txt.split("--- LIVE OUTPUT STREAM ---\n", 1)[1].strip()
                            else:
                                stdout_str = full_txt.strip()
                    except Exception:
                        pass
            else:
                await asyncio.sleep(2.5)
                stdout_str = f"Async delegated task '{task_description}' completed."
                try:
                    with open(log_path, "a", encoding="utf-8") as lf:
                        lf.write(stdout_str + "\n")
                except Exception:
                    pass

            if was_cancelled:
                return

            after_files = set()
            if deliverables_dir.exists():
                after_files = {str(p) for p in deliverables_dir.rglob("*") if p.is_file()}
            new_artifacts = sorted(list(after_files - before_files))

            # Include any deliverables modified during this job run even if already present
            modified_deliverables = []
            if deliverables_dir.exists():
                for p in deliverables_dir.rglob("*"):
                    if p.is_file():
                        try:
                            if p.stat().st_mtime >= (start_t - 2.0):
                                modified_deliverables.append(str(p))
                        except Exception:
                            pass
            checked_artifacts = sorted(list(set(new_artifacts + modified_deliverables)))
            display_artifacts = new_artifacts or checked_artifacts

            duration = round(time.time() - start_t, 1)
            task_rec["duration"] = duration
            task_rec["elapsed"] = duration
            task_rec["updated_at"] = time.time()
            task_rec["exit_code"] = exit_code
            task_rec["artifacts"] = display_artifacts

            output_preview = (stdout_str or stderr_str or "(No console output)")[:1800]

            # BL-EVO-23: Automated Output & Deliverable Quality Validation
            detected_blockers = detect_task_output_blockers(
                output_str=stdout_str or stderr_str or "",
                artifacts=checked_artifacts,
                task_description=task_description,
                command=command or "",
                exit_code=exit_code
            )
            has_blockers = bool(detected_blockers)
            if has_blockers:
                task_rec["blockers"] = detected_blockers

            if timed_out:
                task_rec["status"] = "timeout"
            elif exit_code != 0:
                task_rec["status"] = "failed"
            elif has_blockers:
                task_rec["status"] = "completed_with_blockers"
            else:
                task_rec["status"] = "completed"

            upsert_room_bg_task(rid, task_rec)
            await broadcast_event("war_room_tasks_updated", {
                "room_id": rid,
                "tasks": get_room_bg_tasks(rid)
            })

            if timed_out or exit_code != 0 or has_blockers:
                # BL-SYS-01 & BL-EVO-23: lets outbound gateways escalate a crashed/timed-out/blocked async task
                await broadcast_event("war_room_task_failed", {
                    "room_id": rid,
                    "task_id": task_id,
                    "agent": agent["name"],
                    "description": task_description,
                    "status": task_rec["status"],
                    "exit_code": exit_code,
                    "blockers": detected_blockers if has_blockers else None
                })
            else:
                # BL-EVO-19: Broadcast completion event for live UI listeners and outbound gateways
                await broadcast_event("war_room_task_completed", {
                    "room_id": rid,
                    "task_id": task_id,
                    "description": task_description,
                    "status": "completed",
                    "duration": duration,
                    "agent": agent["name"],
                    "artifacts": display_artifacts
                })

            artifacts_md = ""
            if display_artifacts:
                artifacts_md = "\n**Generated Deliverables**:\n" + "\n".join([f"- `{p}`" for p in display_artifacts])

            metrics_md = summarize_deliverable_metrics(display_artifacts)

            # BL-EVO-19: Check for pre-authorized auto-proceed chaining (inhibited if blockers detected)
            has_chain = bool(auto_proceed_on_success and (next_command or next_task_description) and not timed_out and exit_code == 0 and not has_blockers)
            extracted_next_step = (next_task_description or "").strip()

            if timed_out or exit_code != 0:
                status_hdr = "⚠️ **Async Task Timeout & Partial Artifact Report**" if timed_out else f"⚠️ **Async Task Failed (Exit {exit_code}) & Partial Output Report**"
                res_text = (
                    f"<executive_summary>\n"
                    f"Background job {task_id} for {agent['name']} encountered a {'timeout' if timed_out else 'non-zero exit'} after {duration}s; partial logs preserved.\n"
                    f"</executive_summary>\n\n"
                    f"{status_hdr}\n"
                    f"- **Job ID**: `{task_id}` — *{task_description}*\n"
                    f"- **Full Execution Log**: `{log_path}`\n"
                    f"{artifacts_md}\n\n"
                    f"### Captured Partial Output / Stderr\n"
                    f"```\n{output_preview}\n```\n\n"
                    f"🔔 **@user**: Please review the partial output above or advise if I should retry with adjusted parameters."
                )
            elif has_chain:
                # Auto-proceed chaining triggered
                next_desc = next_task_description or f"Downstream phase after {task_description}"
                res_text = (
                    f"<executive_summary>\n"
                    f"{agent['name']} completed {task_description} clean in {duration}s. Pre-authorized auto-chaining active: launching {next_desc}.\n"
                    f"</executive_summary>\n\n"
                    f"🔔 **Proactive Return Turn — Async Job `{task_id}` Complete (Auto-Chained)**\n"
                    f"- **Completed Task**: *{task_description}*\n"
                    f"- **Duration**: `{duration}s`\n"
                    f"- **Execution Log**: `{log_path}`"
                    f"{artifacts_md}\n\n"
                    f"### Execution Output\n"
                    f"```\n{output_preview}\n```\n\n"
                    f"⚡ **Auto-Proceed Triggered**: Operator pre-authorized automatic chaining on clean exit (exit code 0). Transitioning directly to *{next_desc}*.\n"
                    f"<async_task>{json.dumps({'description': next_desc, 'command': next_command, 'timeout': timeout or 600})}</async_task>"
                )
            elif has_blockers:
                # BL-EVO-23 & BL-EVO-24: Autonomous agent diagnostic & workaround turn with real-time internet research
                blockers_md = "\n".join([f"- ⚠️ **{b}**" for b in detected_blockers])
                curr_hist = read_war_room_history(room_id=rid, limit=15)

                # BL-EVO-24: Perform real-time internet research for error solutions
                web_research = await async_search_internet_for_blockers(detected_blockers, task_description)
                internet_md = "\n".join([f"- 🌐 {snippet}" for snippet in web_research]) if web_research else "- 🌐 (Run `python3 scratch/search_web.py \"<error>\"` to investigate)"

                diagnostic_prompt = (
                    f"You are {agent['name']} ({agent.get('role', 'Specialist')}).\n"
                    f"Your background async task `{task_id}` ('{task_description}') finished executing in {duration}s, BUT automated quality validation detected CRITICAL DATA / EXECUTION BLOCKERS:\n\n"
                    f"{blockers_md}\n\n"
                    f"Log file: `{log_path}`\n"
                    f"Deliverables checked: {display_artifacts or 'None'}\n\n"
                    f"Captured Output Preview:\n"
                    f"```\n{output_preview}\n```\n\n"
                    f"🌐 REAL-TIME INTERNET RESEARCH ON DETECTED ERROR / BLOCKERS (BL-EVO-24):\n"
                    f"{internet_md}\n\n"
                    f"CRITICAL AUTONOMOUS RESEARCH & RESOLUTION DIRECTIVE (BL-EVO-24):\n"
                    f"The operator instructed: 'If agent don't know about the error log, agent shall look for information from internet about how to fix the situation. If there is no way out, then agent will also report about it.'\n\n"
                    f"1. ANALYZE & RESEARCH: Examine the error log and the real-time internet research findings above. If you need more web context, you can execute `python3 {scratch_dir}/search_web.py \"<your search query>\"` directly.\n"
                    f"2. AUTONOMOUS REMEDIATION: Formulate and implement the researched workaround (e.g., using alternative Overpass mirrors like https://overpass.kumi.systems/api/interpreter or https://lz4.overpass-api.de/api/interpreter, setting proper User-Agent/Accept headers, or using alternative open data APIs).\n"
                    f"3. PROPOSE REVISED ACTION: Tag your concrete next action with <next_step>[Concrete revised action or script to execute]</next_step> so the operator can authorize immediate execution.\n"
                    f"4. REPORT GENUINE ROADBLOCKS: If and ONLY if there is genuinely NO WAY OUT (an insurmountable external blocker requiring operator credentials, human CAPTCHA solving, or paid keys), clearly report the blocker to @user with what was researched on the internet and what exact decision is needed."
                )
                try:
                    res_text = await execute_agent_war_room_turn(agent, diagnostic_prompt, curr_hist, room_id=rid, interrupt_gen=launch_gen)
                    ns_tag_match = re.search(r'<next_step>(.*?)</next_step>', res_text, re.DOTALL | re.IGNORECASE)
                    if ns_tag_match and ns_tag_match.group(1).strip():
                        extracted_next_step = ns_tag_match.group(1).strip()
                    elif not extracted_next_step:
                        ns_line_match = re.search(r'(?:(?:Proposed\s+)?Next\s+(?:Step|Task|Action)|Workaround|Revised\s+Plan)\s*[:—–-]\s*([^\n\r]+)', res_text, re.IGNORECASE)
                        if ns_line_match:
                            extracted_next_step = re.sub(r'[*_`#]', '', ns_line_match.group(1)).strip()
                except Exception as ex_turn:
                    print(f"[WAR_ROOM_TASKS] Agent turn execution fallback for {task_id}: {ex_turn}")
                    res_text = (
                        f"<executive_summary>\n"
                        f"{agent['name']}'s async task {task_id} completed with exit code 0 but automated quality validation detected data harvesting blockers (0 records).\n"
                        f"</executive_summary>\n\n"
                        f"⚠️ **Async Task Completed with Harvesting Blockers (0 Records)**\n"
                        f"- **Task**: *{task_description}*\n"
                        f"- **Duration**: `{duration}s`\n"
                        f"- **Execution Log**: `{log_path}`\n\n"
                        f"### ⚠️ Detected Blockers\n"
                        f"{blockers_md}\n\n"
                        f"### Captured Output Preview\n"
                        f"```\n{output_preview}\n```\n\n"
                        f"🔔 **@user**: The script finished with exit code 0 but failed to harvest records due to HTTP errors (406, 403). "
                        f"An autonomous workaround is recommended."
                    )
            else:
                # Clean completion without blockers! Auto-synthesize agent proactive return turn (BL-EVO-38)
                curr_hist = read_war_room_history(room_id=rid, limit=15)
                synth_prompt = (
                    f"Your background async task `{task_id}` ('{task_description}') has finished cleanly in {duration}s.\n"
                    f"Log file: `{log_path}`\n"
                    f"Verified Deliverables:\n{metrics_md or artifacts_md or 'None'}\n\n"
                    f"Captured Output Preview:\n{output_preview}\n\n"
                    + (f"Follow-up Directive: {followup_directive}\n" if followup_directive else "")
                    + f"You promised to report back once finished. Now analyze the output and deliverables above, present your substantive findings and conclusions to the room and @user.\n"
                    f"CRITICAL RULE (BL-EVO-21): If downstream work remains or if you are proposing next actions, "
                    f"declare the next step clearly and tag it with <next_step>[Short actionable description of next step]</next_step>."
                )
                try:
                    res_text = await execute_agent_war_room_turn(agent, synth_prompt, curr_hist, room_id=rid, interrupt_gen=launch_gen)
                    ns_tag_match = re.search(r'<next_step>(.*?)</next_step>', res_text, re.DOTALL | re.IGNORECASE)
                    if ns_tag_match and ns_tag_match.group(1).strip():
                        extracted_next_step = ns_tag_match.group(1).strip()
                    elif not extracted_next_step:
                        ns_line_match = re.search(r'(?:(?:Proposed\s+)?Next\s+(?:Step|Task|Action)|Following\s+task)\s*[:—–-]\s*([^\n\r]+)', res_text, re.IGNORECASE)
                        if ns_line_match:
                            extracted_next_step = re.sub(r'[*_`#]', '', ns_line_match.group(1)).strip()
                except Exception as ex_synth:
                    print(f"[WAR_ROOM_TASKS] Agent return turn execution fallback for {task_id}: {ex_synth}")
                    if extracted_next_step:
                        step_callout = (
                            f"👉 **Proposed Next Step**: *{extracted_next_step}*\n\n"
                            f"👤 **@user**: Background processing for '*{task_description}*' completed clean. "
                            f"Approve *\"{extracted_next_step}\"* to proceed, or let me know if you would like adjustments."
                        )
                    else:
                        step_callout = (
                            f"👤 **@user**: Background processing for '*{task_description}*' is complete and verified. "
                            f"Deliverables are saved in `{deliverables_dir}`. Please review the output above or advise on our next milestone."
                        )
                    if metrics_md:
                        step_callout = f"📦 **Verified Deliverables**:\n{metrics_md}\n\n" + step_callout

                    res_text = (
                        f"<executive_summary>\n"
                        f"{agent['name']} completed background job {task_id} ({task_description}) in {duration}s."
                        + (f" Proposed next step: {extracted_next_step}." if extracted_next_step else "")
                        + f"\n</executive_summary>\n\n"
                        f"🔔 **Proactive Return Turn — Async Job `{task_id}` Complete**\n"
                        f"- **Task**: *{task_description}*\n"
                        f"- **Duration**: `{duration}s`\n"
                        f"- **Execution Log**: `{log_path}`"
                        f"{artifacts_md}\n\n"
                        f"### Execution Output\n"
                        f"```\n{output_preview}\n```\n\n"
                        f"{step_callout}"
                    )

            if get_interrupt_gen(rid) != launch_gen:
                print(f"[WAR_ROOM_TASKS] Return turn for {task_id} suppressed: room interrupted by operator")
                return

            from core.config import get_operator_name
            op_name = get_operator_name()
            done_msg = {
                "id": str(uuid.uuid4()),
                "room_id": rid,
                "sender": agent["name"],
                "sender_type": "agent",
                "text": res_text,
                "engine": agent.get("engine", "hermes"),
                "color": agent.get("color", "#38bdf8"),
                "role": agent.get("role", ""),
                "mentions": [op_name, "user"],
                "mentions_user": True,
                "timestamp": time.time()
            }
            append_war_room_message(done_msg, room_id=rid)
            await broadcast_event("war_room_message", done_msg)

            # BL-EVO-19, BL-EVO-21 & BL-EVO-23: Register a Post-Job Permission Gate Inquiry so actionable decision chips render immediately
            if not has_chain:
                post_inquiry = _build_post_task_inquiry(
                    rid=rid,
                    task_id=task_id,
                    task_description=task_description,
                    agent=agent,
                    duration=duration,
                    timeout=timeout or 600,
                    timed_out=timed_out,
                    exit_code=exit_code,
                    has_blockers=has_blockers,
                    extracted_next_step=extracted_next_step,
                    log_path=log_path,
                    output_str=stdout_str or stderr_str or "",
                    display_artifacts=display_artifacts,
                )
                set_room_inquiry(rid, post_inquiry)
                await broadcast_event("war_room_inquiries_updated", {
                    "room_id": rid,
                    "inquiries": get_room_inquiries(rid)
                })
                await broadcast_event("war_room_user_mentioned", {
                    "room_id": rid,
                    "agent": agent["name"],
                    "engine": agent.get("engine", "hermes"),
                    "text": res_text,
                    "inquiry": post_inquiry,
                    "origin_channel": "internal"
                })

        except Exception as e:
            print(f"[WAR_ROOM_TASKS] Async worker error for {task_id}: {e}")

    asyncio.create_task(_worker())
    return task_rec


def _extract_last_log_insight(output_str: str, is_error: bool = False) -> str:
    """Extracts the most informative recent progress line or error/exception line from task console output."""
    if not output_str:
        return ""
    lines = [
        ln.strip()
        for ln in output_str.splitlines()
        if ln.strip()
        and not ln.strip().startswith("#")
        and not ln.strip().startswith("--- LIVE OUTPUT STREAM")
    ]
    if not lines:
        return ""
    if is_error:
        for ln in reversed(lines[-25:]):
            if any(k in ln for k in ("Error", "Exception", "Traceback", "FAILED", "Cannot find", "Errno", "SyntaxError")):
                return ln[:110]
    return lines[-1][:110]


def _build_post_task_inquiry(
    *,
    rid: str,
    task_id: str,
    task_description: str,
    agent: Dict[str, Any],
    duration: float,
    timeout: int,
    timed_out: bool,
    exit_code: int,
    has_blockers: bool,
    extracted_next_step: str,
    log_path: Path,
    output_str: str,
    display_artifacts: List[str],
) -> Dict[str, Any]:
    """Constructs an accurate, outcome-aware Post-Task Inquiry card (`timeout`, `failed`, `completed_with_blockers`, or `completed`)."""
    inq_id = str(uuid.uuid4())
    log_name = log_path.name if log_path else f"{task_id}.log"

    if timed_out:
        status = "timeout"
        last_prog = _extract_last_log_insight(output_str, is_error=False)
        prog_note = f' (last progress: "{last_prog}")' if last_prog else ""
        next_timeout = int(max((timeout or 600) * 2, 1800))
        inq_q = f"⏱️ Task '{task_description}' timed out after {duration}s{prog_note}. Optimize & resume, retry with {next_timeout}s timeout, or inspect log?"
        chips = [
            {
                "label": "Optimize & Resume",
                "prompt": f"Task '{task_description}' ({task_id}) timed out after {duration}s. Inspect {log_name}, optimize or resume from partial progress, and re-run.",
            },
            {
                "label": f"Retry ({next_timeout}s Timeout)",
                "prompt": f"Retry task '{task_description}' with a {next_timeout}s timeout and progress checkpointing.",
            },
            {
                "label": "Inspect Timeout Log",
                "prompt": f"Inspect the partial log {log_name} from timed-out task {task_id} and diagnose where it stalled.",
            },
        ]
    elif exit_code != 0:
        status = "failed"
        last_err = _extract_last_log_insight(output_str, is_error=True)
        err_note = f" — {last_err}" if last_err else ""
        inq_q = f"❌ Task '{task_description}' failed (exit code {exit_code} after {duration}s){err_note}. Diagnose & fix error or inspect log?"
        chips = [
            {
                "label": "Diagnose & Fix Error",
                "prompt": f"Diagnose the exit code {exit_code} failure in {log_name}, fix the bug, and re-run '{task_description}'.",
            },
            {
                "label": "Inspect Error Log",
                "prompt": f"Show and analyze the failure traceback in {log_name} for task {task_id}.",
            },
            {
                "label": "Revise Approach...",
                "prompt": f"Let's revise the approach for '{task_description}': ",
            },
        ]
    elif has_blockers:
        status = "completed_with_blockers"
        if extracted_next_step:
            short_step = extracted_next_step[:26] + ("…" if len(extracted_next_step) > 26 else "")
            inq_q = f"⚠️ Task '{task_description}' hit data blockers. Proposed Workaround: {extracted_next_step}. Execute workaround or inspect logs?"
            chips = [
                {"label": f"Apply: {short_step}", "prompt": f"Approved: execute workaround '{extracted_next_step}'."},
                {"label": "Inspect Error Logs", "prompt": f"Inspect {log_name} and report full details on the data blockers."},
                {"label": "Revise Plan...", "prompt": f"Let's revise the plan for '{task_description}': "},
            ]
        else:
            inq_q = f"⚠️ Task '{task_description}' hit data blockers (0 valid records). Apply workaround or inspect logs?"
            chips = [
                {"label": "Apply Workaround & Retry", "prompt": f"Formulate a workaround for the data blockers in {log_name} and re-run '{task_description}'."},
                {"label": "Inspect Error Logs", "prompt": f"Inspect {log_name} and explain the exact data blocker encountered."},
                {"label": "Revise Plan...", "prompt": f"Let's revise the plan for '{task_description}': "},
            ]
    else:
        status = "completed"
        art_note = f" — {len(display_artifacts)} deliverable(s) ready" if display_artifacts else ""
        if extracted_next_step:
            short_step = extracted_next_step[:28] + ("…" if len(extracted_next_step) > 28 else "")
            inq_q = f"✅ Task '{task_description}' completed ({duration}s){art_note}. Proposed Next Step: {extracted_next_step}. Approve or verify deliverables?"
            chips = [
                {"label": f"Approve: {short_step}", "prompt": f"Approved: proceed with {extracted_next_step}"},
                {"label": "Verify Deliverables", "prompt": "Summarize and verify the generated deliverables and key metrics."},
                {"label": "Adjust Next Step...", "prompt": f"Before proceeding with '{extracted_next_step}', let's adjust: "},
            ]
        else:
            inq_q = f"✅ Task '{task_description}' completed ({duration}s){art_note}. Verify deliverables or specify next milestone?"
            chips = [
                {"label": "Verify Deliverables", "prompt": "Summarize and verify the generated deliverables and key metrics."},
                {"label": "Next Milestone...", "prompt": "For our next step, please: "},
                {"label": "Request Revision...", "prompt": f"Please revise the output of '{task_description}': "},
            ]

    return {
        "id": inq_id,
        "room_id": rid,
        "agent": agent["name"],
        "engine": agent.get("engine", "hermes"),
        "color": agent.get("color", "#38bdf8"),
        "timestamp": time.time(),
        "status": status,
        "question": inq_q,
        "next_step": extracted_next_step or None,
        "chips": chips,
    }


def _resolve_agent_for_os_user(os_user: str, room_id: str, default_agent: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Maps a Linux process owner username to the corresponding War Room agent metadata."""
    if default_agent and default_agent.get("name"):
        return default_agent
    try:
        from services.war_room.participants import get_room_participants
        participants = get_room_participants(room_id)
    except Exception:
        participants = []

    user_low = (os_user or "").lower().strip()
    engine_pref = None
    if user_low == "freecoder":
        engine_pref = "opencode"
    elif user_low == "thecodexer":
        engine_pref = "codex"
    elif user_low == "agents_bs":
        engine_pref = "hermes"

    if engine_pref:
        matched = next((p for p in participants if p.get("engine") == engine_pref), None)
        if matched:
            return matched

    # For myvirtualcoder (shared by Agy & Claude) or fallback, check recent room messages
    try:
        from services.war_room.execution import read_war_room_history
        hist = read_war_room_history(room_id=room_id, limit=6)
        for m in reversed(hist):
            if m.get("sender_type") == "agent":
                sender = m.get("sender", "")
                matched = next((p for p in participants if p.get("name", "").lower() == sender.lower()), None)
                if matched:
                    return matched
    except Exception:
        pass

    if user_low == "freecoder":
        return {"name": "OpenCode", "engine": "opencode", "color": "#a855f7", "role": "Open-Source Multi-Model Code Specialist"}
    if user_low == "thecodexer":
        return {"name": "Codex", "engine": "codex", "color": "#06b6d4", "role": "Analytical Code & Verification Specialist"}
    if user_low == "myvirtualcoder":
        return {"name": "Agy", "engine": "agy", "color": "#0284c7", "role": "Research & Antigravity Autonomy Specialist"}
    return {"name": "Solaris", "engine": "hermes", "color": "#10b981", "role": "Orchestrator"}


async def _monitor_adopted_bg_process(rid: str, task_rec: Dict[str, Any]) -> None:
    """
    Watches an adopted or resumed OS background process (by PID and log_file),
    streams live progress every 2.5s to the War Room tray, and triggers a proactive
    return turn + inquiry banner when the process finishes.
    """
    from services.war_room.execution import (
        read_war_room_history,
        append_war_room_message,
        execute_agent_war_room_turn,
        get_interrupt_gen,
    )
    from services.war_room.inquiries import set_room_inquiry, get_room_inquiries

    task_id = task_rec["id"]
    pid = int(task_rec.get("pid") or 0)
    if pid <= 0:
        return

    start_t = float(task_rec.get("created_at") or time.time())
    timeout = int(task_rec.get("timeout") or 7200)
    log_path = Path(task_rec.get("log_file") or "")
    task_description = task_rec.get("description") or f"Background job (PID {pid})"
    agent = {
        "name": task_rec.get("agent", "OpenCode"),
        "engine": task_rec.get("engine", "opencode"),
        "color": task_rec.get("color", "#a855f7"),
        "role": task_rec.get("role", "Specialist"),
    }
    s_path = get_room_sandbox_path(rid)
    deliverables_dir = s_path / "deliverables"
    launch_gen = get_interrupt_gen(rid)
    last_reported = ""

    try:
        while os.path.exists(f"/proc/{pid}"):
            # Check zombie state ('Z') in /proc/<pid>/stat
            try:
                stat_txt = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8", errors="replace")
                rparen = stat_txt.rfind(")")
                if rparen != -1:
                    state_char = stat_txt[rparen + 2:rparen + 3]
                    if state_char == "Z":
                        break
            except Exception:
                break

            elapsed_now = round(time.time() - start_t, 1)
            latest_line = ""
            if log_path.exists() and log_path.is_file():
                try:
                    with open(log_path, "r", encoding="utf-8", errors="replace") as rf:
                        lines = [l.strip() for l in rf.readlines() if l.strip() and not l.startswith("#") and not l.startswith("---")]
                        if lines:
                            latest_line = lines[-1][:160]
                except Exception:
                    pass

            task_rec["elapsed"] = elapsed_now
            task_rec["updated_at"] = time.time()
            if latest_line:
                task_rec["latest_progress"] = latest_line
            if latest_line != last_reported or int(elapsed_now) % 5 == 0:
                last_reported = latest_line
                upsert_room_bg_task(rid, task_rec)
                await broadcast_event("war_room_task_progress", {
                    "room_id": rid,
                    "task_id": task_id,
                    "agent": agent["name"],
                    "description": task_description,
                    "elapsed": elapsed_now,
                    "timeout": timeout,
                    "latest_progress": task_rec.get("latest_progress", "Running..."),
                    "status": "running",
                })
            await asyncio.sleep(2.5)

        # Check if operator cancelled via UI
        curr_tasks = load_bg_tasks_state().get(rid, [])
        curr_rec = next((t for t in curr_tasks if t["id"] == task_id), None)
        if curr_rec and curr_rec.get("status") == "cancelled":
            return

        stdout_str = ""
        if log_path.exists() and log_path.is_file():
            try:
                stdout_str = log_path.read_text(encoding="utf-8", errors="replace").strip()
            except Exception:
                pass

        # Determine exit status from log tail
        tail_chunk = stdout_str[-2000:] if stdout_str else ""
        timed_out = "# Exit Code: -1 (Timed Out: True)" in tail_chunk
        failed_in_log = bool(
            re.search(r"(?:Traceback \(most recent call last\)|# Exit Code: [1-9]\d*|\bFATAL\b)", tail_chunk)
            and not re.search(r"\b(?:DONE|COMPLETED|SUCCESS|ALL_TESTS_PASSED)\b", tail_chunk[-400:], re.IGNORECASE)
        )
        exit_code = -1 if timed_out else (1 if failed_in_log else 0)

        modified_deliverables = []
        if deliverables_dir.exists():
            for p in deliverables_dir.rglob("*"):
                if p.is_file():
                    try:
                        if p.stat().st_mtime >= (start_t - 2.0):
                            modified_deliverables.append(str(p))
                    except Exception:
                        pass
        display_artifacts = sorted(modified_deliverables)
        duration = round(time.time() - start_t, 1)
        task_rec["duration"] = duration
        task_rec["elapsed"] = duration
        task_rec["updated_at"] = time.time()
        task_rec["exit_code"] = exit_code
        task_rec["artifacts"] = display_artifacts

        detected_blockers = detect_task_output_blockers(
            output_str=stdout_str,
            artifacts=display_artifacts,
            task_description=task_description,
            command=task_rec.get("command", ""),
            exit_code=exit_code,
        )
        has_blockers = bool(detected_blockers)
        if has_blockers:
            task_rec["blockers"] = detected_blockers

        if timed_out:
            task_rec["status"] = "timeout"
        elif exit_code != 0:
            task_rec["status"] = "failed"
        elif has_blockers:
            task_rec["status"] = "completed_with_blockers"
        else:
            task_rec["status"] = "completed"

        upsert_room_bg_task(rid, task_rec)
        await broadcast_event("war_room_tasks_updated", {
            "room_id": rid,
            "tasks": load_bg_tasks_state().get(rid, []),
        })

        output_preview = (stdout_str[-1800:] if stdout_str else "(No console output)")
        artifacts_md = "\n**Generated Deliverables**:\n" + "\n".join([f"- `{p}`" for p in display_artifacts]) if display_artifacts else ""
        metrics_md = summarize_deliverable_metrics(display_artifacts)
        extracted_next_step = ""

        if timed_out or exit_code != 0:
            status_hdr = "⚠️ **Async Task Timeout & Partial Artifact Report**" if timed_out else f"⚠️ **Async Task Failed (Exit {exit_code}) & Partial Output Report**"
            res_text = (
                f"<executive_summary>\n"
                f"Background job {task_id} for {agent['name']} encountered a {'timeout' if timed_out else 'failure'} after {duration}s; partial logs preserved.\n"
                f"</executive_summary>\n\n"
                f"{status_hdr}\n"
                f"- **Job ID**: `{task_id}` — *{task_description}*\n"
                f"- **Full Execution Log**: `{log_path}`\n"
                f"{artifacts_md}\n\n"
                f"### Captured Log Tail\n"
                f"```\n{output_preview}\n```\n\n"
                f"🔔 **@user**: Please review the partial output above or advise if I should retry."
            )
        else:
            curr_hist = read_war_room_history(room_id=rid, limit=15)
            synth_prompt = (
                f"Your background async task `{task_id}` ('{task_description}') has finished cleanly in {duration}s.\n"
                f"Log file: `{log_path}`\n"
                f"Verified Deliverables:\n{metrics_md or artifacts_md or 'None'}\n\n"
                f"Captured Output Preview:\n{output_preview}\n\n"
                f"Present your substantive findings and verified conclusions to the room and @user.\n"
                f"If downstream work remains, tag it with <next_step>[Short actionable description]</next_step>."
            )
            try:
                res_text = await execute_agent_war_room_turn(agent, synth_prompt, curr_hist, room_id=rid, interrupt_gen=launch_gen)
                ns_tag_match = re.search(r"<next_step>(.*?)</next_step>", res_text, re.DOTALL | re.IGNORECASE)
                if ns_tag_match and ns_tag_match.group(1).strip():
                    extracted_next_step = ns_tag_match.group(1).strip()
            except Exception:
                res_text = (
                    f"<executive_summary>\n"
                    f"{agent['name']} completed background job {task_id} ({task_description}) in {duration}s.\n"
                    f"</executive_summary>\n\n"
                    f"🔔 **Proactive Return Turn — Async Job `{task_id}` Complete**\n"
                    f"- **Task**: *{task_description}*\n"
                    f"- **Duration**: `{duration}s`\n"
                    f"- **Execution Log**: `{log_path}`{artifacts_md}\n\n"
                    f"### Execution Output\n"
                    f"```\n{output_preview}\n```"
                )

        from core.config import get_operator_name
        op_name = get_operator_name()
        done_msg = {
            "id": str(uuid.uuid4()),
            "room_id": rid,
            "sender": agent["name"],
            "sender_type": "agent",
            "text": res_text,
            "engine": agent.get("engine", "opencode"),
            "color": agent.get("color", "#a855f7"),
            "role": agent.get("role", ""),
            "mentions": [op_name, "user"],
            "mentions_user": True,
            "timestamp": time.time(),
        }
        append_war_room_message(done_msg, room_id=rid)
        await broadcast_event("war_room_message", done_msg)

        post_inquiry = _build_post_task_inquiry(
            rid=rid,
            task_id=task_id,
            task_description=task_description,
            agent=agent,
            duration=duration,
            timeout=timeout,
            timed_out=timed_out,
            exit_code=exit_code,
            has_blockers=has_blockers,
            extracted_next_step=extracted_next_step,
            log_path=log_path,
            output_str=stdout_str,
            display_artifacts=display_artifacts,
        )
        set_room_inquiry(rid, post_inquiry)
        await broadcast_event("war_room_inquiries_updated", {
            "room_id": rid,
            "inquiries": get_room_inquiries(rid),
        })
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[WAR_ROOM_TASKS] Adopted watcher error for {task_id} (PID {pid}): {e}")
    finally:
        ADOPTED_BG_WATCHERS.pop(task_id, None)


def _ensure_adopted_pid_watcher(rid: str, task_rec: Dict[str, Any]) -> None:
    """Ensures an async monitor coroutine is running for an active adopted/resumed task."""
    tid = task_rec.get("id")
    if not tid or tid in ACTIVE_BG_TASK_PROCS:
        return
    existing = ADOPTED_BG_WATCHERS.get(tid)
    if existing and not existing.done():
        return
    try:
        loop = asyncio.get_running_loop()
        ADOPTED_BG_WATCHERS[tid] = loop.create_task(_monitor_adopted_bg_process(rid, task_rec))
    except RuntimeError:
        pass


def discover_and_adopt_sandbox_bg_processes_sync(
    room_id: str,
    default_agent: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Scans `/proc` for self-spawned or detached background processes operating inside
    `/home/nexus_shared/sandboxes/{room_id}` that were launched without an `<async_task>` tag
    (e.g., via `nohup python3 -u .../scratch/script.py > .../scratch/job.log 2>&1 &`),
    adopts them into `war_room_bg_tasks.json`, and reconciles stale 'running' records whose PID exited.
    """
    import pwd

    rid = (room_id or "general").strip()
    s_path = str(SANDBOX_BASE / rid)
    scratch_path = Path(s_path) / "scratch"
    tasks = load_bg_tasks_state().get(rid, [])

    # 1. Reconcile any existing "running" tasks whose PID is already dead and has no active watcher
    changed = False
    tracked_pids = set()
    for t in tasks:
        if t.get("status") == "running":
            t_pid = t.get("pid")
            tid = t.get("id")
            if t_pid:
                t_pid_int = int(t_pid)
                if os.path.exists(f"/proc/{t_pid_int}"):
                    tracked_pids.add(t_pid_int)
                    # Refresh latest_progress from log file on read
                    lp = Path(t.get("log_file") or "")
                    if lp.exists() and lp.is_file():
                        try:
                            lines = [
                                l.strip()
                                for l in lp.read_text(encoding="utf-8", errors="replace").splitlines()
                                if l.strip() and not l.startswith("#") and not l.startswith("---")
                            ]
                            if lines:
                                t["latest_progress"] = lines[-1][:160]
                        except Exception:
                            pass
                    t["elapsed"] = round(time.time() - float(t.get("created_at") or time.time()), 1)
                    _ensure_adopted_pid_watcher(rid, t)
                elif tid not in ACTIVE_BG_TASK_PROCS and tid not in ADOPTED_BG_WATCHERS:
                    # Process exited while daemon was down; finalize its record from log
                    lp = Path(t.get("log_file") or "")
                    log_txt = lp.read_text(encoding="utf-8", errors="replace") if (lp.exists() and lp.is_file()) else ""
                    if "# Exit Code: -1 (Timed Out: True)" in log_txt:
                        t["status"] = "timeout"
                    elif "Traceback (most recent call last)" in log_txt[-1500:]:
                        t["status"] = "failed"
                    else:
                        t["status"] = "completed"
                    t["updated_at"] = time.time()
                    t["duration"] = round(t["updated_at"] - float(t.get("created_at") or t["updated_at"]), 1)
                    changed = True

    if changed:
        st = load_bg_tasks_state()
        st[rid] = tasks[-50:]
        save_bg_tasks_state(st)

    # Collect active interactive CLI turn PIDs so we never confuse a live CLI turn with a detached bg task
    active_cli_pids = set()
    try:
        from services.cli_executor import ACTIVE_AGENT_PROCS
        for p_obj in ACTIVE_AGENT_PROCS.values():
            if p_obj and getattr(p_obj, "pid", None):
                active_cli_pids.add(int(p_obj.pid))
    except Exception:
        pass

    # 2. Scan /proc for untracked sandbox worker processes
    candidates: List[Dict[str, Any]] = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        pid = int(entry)
        if pid in tracked_pids or pid in active_cli_pids:
            continue
        proc_dir = Path(f"/proc/{pid}")
        try:
            raw_cmd = (proc_dir / "cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
            if not raw_cmd:
                continue
            # Ignore parent sudo/nice/bash wrappers if they just wrap a python/node command
            if raw_cmd.startswith(("sudo ", "nice ", "ionice ", "/bin/bash -c ", "bash -c ", "sh -c ")):
                continue
            # Must be an actual script/tool runner referencing this room's sandbox (or writing stdout to its scratch log)
            stdout_link = ""
            try:
                stdout_link = os.readlink(str(proc_dir / "fd/1"))
            except Exception:
                pass

            if s_path not in raw_cmd and s_path not in stdout_link:
                continue
            # Skip interactive CLI engine binaries themselves
            if any(b in raw_cmd for b in ("opencode run", "claude -p", "hermes chat", "codex exec", "agy ")):
                continue

            # Check parent PID: if parent is an active interactive CLI turn, wait until turn finishes or check if detached (ppid==1 or bash wrapper with ppid==1)
            stat_txt = (proc_dir / "stat").read_text(encoding="utf-8", errors="replace")
            rparen = stat_txt.rfind(")")
            after_fields = stat_txt[rparen + 2:].split()
            state_char = after_fields[0] if after_fields else ""
            ppid = int(after_fields[1]) if len(after_fields) > 1 else 0
            if state_char == "Z" or ppid in active_cli_pids:
                continue

            # Determine process owner and start time
            st_info = proc_dir.stat()
            try:
                os_user = pwd.getpwuid(st_info.st_uid).pw_name
            except Exception:
                os_user = ""
            created_at = float(st_info.st_mtime)

            # Determine log file
            log_file = ""
            if stdout_link and stdout_link.startswith(s_path) and not stdout_link.startswith("pipe:"):
                log_file = stdout_link
            else:
                m_redir = re.search(r">\s*([^\s;&|]+\.log)", raw_cmd)
                if m_redir:
                    log_file = m_redir.group(1)
            if not log_file and scratch_path.exists():
                logs = sorted(scratch_path.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
                if logs and logs[0].stat().st_mtime >= created_at - 10:
                    log_file = str(logs[0])

            # Extract readable script/job title from command
            script_matches = re.findall(r"([a-zA-Z0-9_\-]+\.(?:py|js|ts|sh))", raw_cmd)
            script_label = script_matches[-1] if script_matches else raw_cmd[:60]

            # Read latest progress line from log_file
            latest_prog = "Running in sandbox..."
            if log_file and os.path.isfile(log_file):
                try:
                    with open(log_file, "r", encoding="utf-8", errors="replace") as lf:
                        lines = [l.strip() for l in lf.readlines() if l.strip() and not l.startswith("#") and not l.startswith("---")]
                        if lines:
                            latest_prog = lines[-1][:160]
                except Exception:
                    pass

            ag = _resolve_agent_for_os_user(os_user, rid, default_agent=default_agent)
            candidates.append({
                "pid": pid,
                "command": raw_cmd,
                "script_label": script_label,
                "log_file": log_file or str(scratch_path / f"adopted_{pid}.log"),
                "created_at": created_at,
                "latest_progress": latest_prog,
                "agent": ag,
            })
        except Exception:
            continue

    newly_adopted: List[Dict[str, Any]] = []
    for cand in candidates:
        # Check if we already have a running task with the same log_file or pid
        existing = next(
            (
                t for t in tasks
                if t.get("status") == "running"
                and (t.get("pid") == cand["pid"] or (cand["log_file"] and t.get("log_file") == cand["log_file"]))
            ),
            None,
        )
        if existing:
            existing["pid"] = cand["pid"]
            existing["latest_progress"] = cand["latest_progress"]
            existing["elapsed"] = round(time.time() - float(existing.get("created_at") or cand["created_at"]), 1)
            upsert_room_bg_task(rid, existing)
            _ensure_adopted_pid_watcher(rid, existing)
            continue

        task_id = f"task_{uuid.uuid4().hex[:8]}"
        ag = cand["agent"]
        elapsed = round(max(0.1, time.time() - cand["created_at"]), 1)
        task_rec = {
            "id": task_id,
            "room_id": rid,
            "agent": ag["name"],
            "engine": ag.get("engine", "opencode"),
            "color": ag.get("color", "#a855f7"),
            "description": f"Background job ({cand['script_label']}) from {ag['name']}",
            "command": cand["command"],
            "timeout": 7200,
            "status": "running",
            "adopted": True,
            "pid": cand["pid"],
            "created_at": cand["created_at"],
            "updated_at": time.time(),
            "elapsed": elapsed,
            "latest_progress": cand["latest_progress"],
            "log_file": cand["log_file"],
            "auto_proceed_on_success": False,
            "next_task_description": "",
            "next_command": "",
        }
        upsert_room_bg_task(rid, task_rec)
        _ensure_adopted_pid_watcher(rid, task_rec)
        newly_adopted.append(task_rec)

    return newly_adopted


async def discover_and_adopt_sandbox_bg_processes(
    room_id: str,
    default_agent: Optional[Dict[str, Any]] = None,
    announce_in_room: bool = True,
) -> List[Dict[str, Any]]:
    """Async wrapper that discovers/adopts self-spawned sandbox jobs and broadcasts live updates to the War Room."""
    from services.war_room.execution import append_war_room_message

    rid = (room_id or "general").strip()
    newly_adopted = discover_and_adopt_sandbox_bg_processes_sync(rid, default_agent=default_agent)
    if newly_adopted:
        await broadcast_event("war_room_tasks_updated", {
            "room_id": rid,
            "tasks": get_room_bg_tasks(rid),
        })
        if announce_in_room:
            for t in newly_adopted:
                log_name = os.path.basename(t.get("log_file") or "")
                reg_msg = {
                    "id": str(uuid.uuid4()),
                    "room_id": rid,
                    "sender": "NexusDesk Moderator",
                    "sender_type": "system",
                    "text": (
                        f"⏳ **Auto-Adopted Background Job (`{t['id']}`, PID `{t['pid']}`)**: Tracking live background process launched by "
                        f"**@{t['agent']}** — *{t['description']}* (`{log_name}`). Live progress is now pinned in the War Room tray; "
                        f"**@{t['agent']}** will automatically take a proactive return turn when finished."
                    ),
                    "timestamp": time.time(),
                }
                append_war_room_message(reg_msg, room_id=rid)
                await broadcast_event("war_room_message", reg_msg)
    return newly_adopted
