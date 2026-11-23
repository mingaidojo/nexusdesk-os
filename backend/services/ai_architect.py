import os
import re
import json
import yaml
import urllib.request
import difflib
from pathlib import Path
from typing import Dict, Any, List, Optional
from core.config import get_instance_user_context, set_instance_perms, backup_file

AI_ARCHITECT_TIMEOUT = 45

class AIArchitectService:
    def __init__(self):
        pass

    def _get_provider_credentials(self, inst_key: str = "agents_bs") -> Dict[str, Any]:
        ctx = get_instance_user_context(inst_key)
        cfg_file = ctx["home"] / "config.yaml"
        if not cfg_file.exists():
            return {}
        try:
            with open(cfg_file, "r") as f:
                cfg = yaml.safe_load(f) or {}
            return cfg.get("providers", {})
        except Exception:
            return {}

    def _call_llm(self, prompt: str, system_prompt: str = "", inst_key: str = "agents_bs") -> str:
        providers = self._get_provider_credentials(inst_key)
        
        # Priority 1: Abacus Routellm (gemini-2.5-flash / gpt-4o-mini)
        if "abacus" in providers and providers["abacus"].get("api_key"):
            ab_cfg = providers["abacus"]
            api_key = ab_cfg.get("api_key")
            base_url = ab_cfg.get("base_url", "https://routellm.abacus.ai/v1")
            url = f"{base_url.rstrip('/')}/chat/completions"
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            
            payload = {
                "model": "gemini-2.5-flash",
                "messages": messages,
                "temperature": 0.2
            }
            req = urllib.request.Request(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                data=json.dumps(payload).encode("utf-8")
            )
            try:
                with urllib.request.urlopen(req, timeout=AI_ARCHITECT_TIMEOUT) as resp:
                    data = json.loads(resp.read().decode())
                    return data["choices"][0]["message"]["content"].strip()
            except Exception as e:
                print(f"[AI_ARCHITECT] Abacus fallback failed: {e}")

        # Priority 2: Nvidia API (nemotron-3-ultra-550b-a55b)
        if "nvidia" in providers and providers["nvidia"].get("api_key"):
            nv_cfg = providers["nvidia"]
            api_key = nv_cfg.get("api_key")
            base_url = nv_cfg.get("base_url", "https://integrate.api.nvidia.com/v1")
            url = f"{base_url.rstrip('/')}/chat/completions"
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            payload = {
                "model": "nvidia/nemotron-3-ultra-550b-a55b",
                "messages": messages,
                "temperature": 0.2,
                "max_tokens": 2500
            }
            req = urllib.request.Request(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                data=json.dumps(payload).encode("utf-8")
            )
            try:
                with urllib.request.urlopen(req, timeout=AI_ARCHITECT_TIMEOUT) as resp:
                    data = json.loads(resp.read().decode())
                    return data["choices"][0]["message"]["content"].strip()
            except Exception as e:
                print(f"[AI_ARCHITECT] Nvidia fallback failed: {e}")

        raise RuntimeError("No working LLM provider available for AI Architect service.")

    def draft_workflow(self, directive: str, available_agents: List[str], inst_key: str = "agents_bs") -> Dict[str, Any]:
        agents_str = ", ".join(available_agents) if available_agents else "Solaris, Lore, Chroma, Chorusius, Scribe, Pylon"
        system_prompt = (
            "You are an Expert Multi-Agent System Architect for NexusDesk. "
            "Your job is to translate a user request into a deterministic sequential multi-agent workflow DAG. "
            "Available fleet agents: " + agents_str + ".\n"
            "Return ONLY a valid JSON object without markdown code fences or backticks. Format:\n"
            "{\n"
            '  "id": "slug_identifier",\n'
            '  "name": "Human Friendly Pipeline Name",\n'
            '  "description": "Clear high-level purpose summary",\n'
            '  "steps": [\n'
            '    {\n'
            '      "order": 1,\n'
            '      "agent": "AgentName",\n'
            '      "action": "Specific task and handover instruction",\n'
            '      "skill": "optional_skill_identifier_or_null",\n'
            '      "approval_required": false\n'
            '    }\n'
            '  ]\n'
            "}"
        )
        
        user_prompt = f"Design an optimal multi-agent workflow for this directive:\n\"{directive}\""
        raw_res = self._call_llm(user_prompt, system_prompt=system_prompt, inst_key=inst_key)
        
        # Clean json fences if returned
        cleaned = raw_res.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()

        try:
            parsed = json.loads(cleaned)
            # Ensure proper schema
            if not parsed.get("id"):
                parsed["id"] = "wf_" + re.sub(r'[^a-zA-Z0-9_]', '', parsed.get("name", "pipeline").lower().replace(" ", "_"))
            if not parsed.get("steps") or not isinstance(parsed["steps"], list):
                raise ValueError("Workflow must contain a non-empty 'steps' list")
            
            for idx, s in enumerate(parsed["steps"]):
                s["order"] = idx + 1
                if not s.get("agent"):
                    s["agent"] = "Solaris"
                if not s.get("action"):
                    s["action"] = "Execute step"
                s["approval_required"] = bool(s.get("approval_required", False))

            return parsed
        except Exception as e:
            raise ValueError(f"AI generated invalid workflow schema: {e}\nRaw output: {raw_res[:300]}")

    def tidy_skill(self, original_content: str, skill_name: str, inst_key: str = "agents_bs") -> Dict[str, Any]:
        system_prompt = (
            "You are a Senior AI Agent Skill Author and Refactor Specialist. "
            "Your task is to tidy, deduplicate, and organize a sprawling SKILL.md file. "
            "CRITICAL CONSTRAINTS (DO NOT VIOLATE):\n"
            "1. NEVER delete or alter critical software versions (e.g., pillow==12.3.0, python versions).\n"
            "2. NEVER delete or alter exact folder IDs, Google Drive URLs, Instagram Account IDs, or Sheet IDs.\n"
            "3. Retain all YAML frontmatter (name, description, user_locked).\n"
            "4. Organize into clear Markdown sections: Overview, Rules & Constraints, Operational Step Procedures, Fallback Models, Error Handling.\n"
            "5. Remove rambling conversation artifacts, obsolete debug notes, and duplicate paragraphs.\n"
            "Return the entire cleaned SKILL.md content directly without enclosing in ```markdown code fences."
        )

        user_prompt = f"Tidy and deduplicate this SKILL.md content for skill '{skill_name}':\n\n{original_content}"
        cleaned_content = self._call_llm(user_prompt, system_prompt=system_prompt, inst_key=inst_key)

        # Remove outer fences if model wrapped the whole file
        if cleaned_content.startswith("```markdown"):
            cleaned_content = cleaned_content[len("```markdown"):].strip()
        elif cleaned_content.startswith("```"):
            cleaned_content = cleaned_content[3:].strip()
        if cleaned_content.endswith("```"):
            cleaned_content = cleaned_content[:-3].strip()

        # Compute unified diff
        orig_lines = original_content.splitlines(keepends=True)
        new_lines = cleaned_content.splitlines(keepends=True)
        diff_lines = list(difflib.unified_diff(orig_lines, new_lines, fromfile=f"a/{skill_name}.md", tofile=f"b/{skill_name}.md"))
        diff_text = "".join(diff_lines)

        # Run automated safety linter on the proposed changes
        lint_warnings = self._lint_skill_changes(original_content, cleaned_content, inst_key)

        return {
            "skill_name": skill_name,
            "original_length": len(original_content),
            "cleaned_length": len(cleaned_content),
            "diff": diff_text,
            "cleaned_content": cleaned_content,
            "lint_warnings": lint_warnings
        }

    def _lint_skill_changes(self, orig: str, cleaned: str, inst_key: str = "agents_bs") -> List[str]:
        warnings = []
        ctx = get_instance_user_context(inst_key)

        # Check critical strings: pillow==12.3.0
        if "pillow==12.3.0" in orig.lower() and "pillow==12.3.0" not in cleaned.lower():
            warnings.append("⚠️ CRITICAL: 'pillow==12.3.0' pin was removed or altered in cleaned version.")

        # Check Google Drive folder IDs
        orig_ids = re.findall(r'[0-9a-zA-Z_\-]{25,}', orig)
        for gid in orig_ids:
            if gid in ("INSTAGRAM_ACCOUNT_ID_2", "INSTAGRAM_ACCOUNT_ID"):
                continue
            if gid not in cleaned:
                warnings.append(f"⚠️ Warning: Reference ID '{gid}' present in original was omitted.")

        # Check script references
        script_refs = re.findall(r'(\b[\w\-]+\.py\b)', orig)
        for s in set(script_refs):
            if s not in cleaned:
                warnings.append(f"⚠️ Script reference '{s}' was removed.")

        return warnings[:8]  # Cap warnings

    def format_vibecoding_spec(self, item: Dict[str, Any]) -> str:
        """
        Formats a comprehensive, self-contained task prompt for Vibecoding with
        external LLM tools (Antigravity, Claude Code, Cursor, OpenCode).
        """
        item_id = item.get("id", "BL-EVO-XX")
        title = item.get("title", "Untitled Backlog Item")
        cat = item.get("category", "UX & Friction")
        prio = item.get("priority", "Medium")
        pillar = item.get("pillar", "system_core")
        occurrences = item.get("occurrence_count", 1)
        first_seen = item.get("first_seen", "N/A")
        last_seen = item.get("last_seen", "N/A")
        root_cause = item.get("root_cause", "No detailed root cause documented.")
        err_sig = item.get("error_signature") or item.get("raw_sample") or "No raw stack trace captured."
        
        affected_files = item.get("affected_files", [])
        if affected_files:
            files_md = "\n".join([f"- [`{Path(f).name}`](file:///home/myvirtualcoder/nexusdesk/{f})" for f in affected_files])
        else:
            files_md = "- None specified (System-wide)"

        attachments = item.get("attachments", [])
        att_section = ""
        if attachments:
            att_lines = [
                f"- **{a.get('filename', 'Attachment')}**: Local `{a.get('local_path', '')}` ([Download]({a.get('url', '')}))"
                for a in attachments
            ]
            att_section = "\n## 2B. Operator Uploaded Attachments & Screenshots\n" + "\n".join(att_lines) + "\n"

        criteria = item.get("implementation_criteria", [])
        if criteria:
            crit_md = "\n".join([f"- [ ] {c}" for c in criteria])
        else:
            crit_md = "- [ ] Resolve the observed error and prevent regression\n- [ ] Verify clean compilation and daemon restart"

        verif_cmds = item.get("verification_commands", [
            "python3 frontend/build.py",
            "python3 -m py_compile backend/routers/*.py backend/services/*.py",
            "sudo -n systemctl restart nexusdesk",
            "curl -s http://127.0.0.1:9200/api/system | jq ."
        ])
        verif_md = "\n".join(verif_cmds)

        return (
            f"# 🧬 NEXUSDESK AUTONOMOUS TASK SPECIFICATION: {item_id}\n\n"
            f"**Title**: {title}\n"
            f"**Category**: `{cat}` | **Priority**: `{prio}` | **Pillar**: `{pillar}`\n"
            f"**Observed Frequency**: {occurrences}x across sessions\n"
            f"**Timeline**: First seen `{first_seen}` • Last seen `{last_seen}`\n\n"
            f"---\n\n"
            f"## 1. Problem Context & Symptoms\n"
            f"{root_cause}\n\n"
            f"## 2. Affected Codebase Locations\n"
            f"{files_md}\n"
            f"{att_section}\n"
            f"## 3. Observed Error Signatures & Traces\n"
            f"```\n{err_sig}\n```\n\n"
            f"## 4. Implementation Acceptance Criteria\n"
            f"{crit_md}\n\n"
            f"## 5. Verification & Healthcheck Commands\n"
            f"```bash\n{verif_md}\n```\n\n"
            f"---\n*Generated by NexusDesk Self-Evolving Hub (BL-SYS-21 / BL-SYS-22)*\n"
        )

    def synthesize_telemetry_to_backlog(
        self,
        telemetry_entries: List[Dict[str, Any]],
        existing_backlog: Optional[List[Dict[str, Any]]] = None,
        inst_key: str = "agents_bs"
    ) -> List[Dict[str, Any]]:
        """
        Synthesizes raw telemetry events from `telemetry_buffer.jsonl` into
        curated, deduplicated PRD backlog items with zero runtime LLM overhead.
        Uses Abacus/Nvidia LLM if available, otherwise falls back to deterministic clustering.
        """
        if not telemetry_entries:
            return existing_backlog or []

        existing = list(existing_backlog or [])
        existing_by_sig = {e.get("signature_key", e.get("id")): e for e in existing}

        # Cluster raw entries by (category, normalized_summary_key)
        from collections import defaultdict
        clusters: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

        for entry in telemetry_entries:
            cat = entry.get("category", "UX & Friction")
            summary = entry.get("summary", "Unknown issue")
            # Normalize summary key (first 60 chars alphanumeric)
            norm_key = re.sub(r'[^a-zA-Z0-9]', '_', summary.lower()[:60]).strip('_')
            sig_key = f"{cat}::{norm_key}"
            clusters[sig_key].append(entry)

        # Determine next ID counter
        max_idx = 0
        for item in existing:
            m = re.match(r'BL-EVO-(\d+)', item.get("id", ""))
            if m:
                max_idx = max(max_idx, int(m.group(1)))

        new_items = []
        for sig_key, entries in clusters.items():
            first_entry = entries[0]
            cat = first_entry.get("category", "UX & Friction")
            pillar = first_entry.get("pillar", "system_core")
            timestamps = [e.get("timestamp") for e in entries if e.get("timestamp")]
            first_seen = min(timestamps) if timestamps else "2026-10-25T00:00:00"
            last_seen = max(timestamps) if timestamps else "2026-10-25T00:00:00"
            count = len(entries)

            all_files = set()
            all_attachments = []
            seen_att_paths = set()
            for e in entries:
                for f in e.get("affected_files", []):
                    if f:
                        all_files.add(f)
                for att in e.get("attachments", []):
                    if isinstance(att, dict):
                        apath = att.get("local_path") or att.get("url")
                        if apath and apath not in seen_att_paths:
                            seen_att_paths.add(apath)
                            all_attachments.append(att)
            affected_files_list = sorted(list(all_files))

            # Combine representative error signatures
            sample_errors = [e.get("details") or e.get("summary") for e in entries if (e.get("details") or e.get("summary"))]
            error_sig = sample_errors[0] if sample_errors else first_entry.get("summary", "")

            # If existing item matches this signature, update it
            if sig_key in existing_by_sig:
                ex = existing_by_sig[sig_key]
                ex["occurrence_count"] = ex.get("occurrence_count", 1) + count
                ex["last_seen"] = last_seen
                for f in affected_files_list:
                    if f not in ex.get("affected_files", []):
                        ex.setdefault("affected_files", []).append(f)
                for att in all_attachments:
                    ex_atts = ex.setdefault("attachments", [])
                    if not any(a.get("local_path") == att.get("local_path") for a in ex_atts):
                        ex_atts.append(att)
                continue

            max_idx += 1
            item_id = f"BL-EVO-{max_idx:02d}"

            # Derive priority based on frequency and category
            if cat in ("Engine & Timeouts", "Permissions") or count >= 5:
                priority = "High" if count < 8 else "Critical"
            elif cat == "UX & Friction":
                priority = "Medium" if count < 4 else "High"
            else:
                priority = "Low" if count < 3 else "Medium"

            # Generate structured title and root cause
            raw_summary = first_entry.get("summary", "Friction point")
            clean_title = raw_summary[:80]
            if len(raw_summary) > 80:
                clean_title += "..."

            # Standard criteria and verification
            impl_criteria = [
                f"Isolate root cause for: {clean_title}",
                f"Update affected components: {', '.join(affected_files_list) if affected_files_list else 'System'}",
                "Ensure robust exception handling and state rollback",
                "Verify zero performance overhead when idle"
            ]
            verif_cmds = [
                "python3 frontend/build.py",
                "python3 -m py_compile backend/routers/*.py backend/services/*.py",
                "sudo -n systemctl restart nexusdesk",
                "curl -s http://127.0.0.1:9200/api/system | jq ."
            ]

            root_cause_analysis = (
                f"Observed {count}x occurrences in module '{pillar}' ({first_entry.get('source', 'internal')}). "
                f"Primary symptom: {first_entry.get('summary', 'Unknown error')}. "
                f"Details: {first_entry.get('details', 'No additional details provided.')}"
            )

            # Try LLM refinement if possible
            try:
                llm_prompt = (
                    f"Transform this system telemetry cluster into a concise, professional PRD backlog item:\n"
                    f"Category: {cat}\n"
                    f"Pillar: {pillar}\n"
                    f"Occurrences: {count}\n"
                    f"Summary: {raw_summary}\n"
                    f"Details: {error_sig}\n"
                    f"Affected Files: {affected_files_list}\n\n"
                    f"Respond ONLY with a JSON object in this format:\n"
                    f"{{\n"
                    f'  "title": "Concise imperative title (max 65 chars)",\n'
                    f'  "root_cause": "2-3 sentence root cause and impact analysis",\n'
                    f'  "implementation_criteria": ["Acceptance criterion 1", "Acceptance criterion 2", "Acceptance criterion 3"]\n'
                    f"}}"
                )
                raw_llm = self._call_llm(llm_prompt, system_prompt="You are a Principal Systems Architect.", inst_key=inst_key)
                cleaned_llm = raw_llm.strip()
                if cleaned_llm.startswith("```"):
                    lines = cleaned_llm.split("\n")
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    cleaned_llm = "\n".join(lines).strip()
                parsed = json.loads(cleaned_llm)
                if parsed.get("title"):
                    clean_title = parsed["title"]
                if parsed.get("root_cause"):
                    root_cause_analysis = parsed["root_cause"]
                if parsed.get("implementation_criteria") and isinstance(parsed["implementation_criteria"], list):
                    impl_criteria = parsed["implementation_criteria"]
            except Exception:
                # Fallback to deterministic synthesis without failing
                pass

            new_item = {
                "id": item_id,
                "signature_key": sig_key,
                "title": clean_title,
                "category": cat,
                "pillar": pillar,
                "priority": priority,
                "occurrence_count": count,
                "first_seen": first_seen,
                "last_seen": last_seen,
                "affected_files": affected_files_list,
                "attachments": all_attachments,
                "root_cause": root_cause_analysis,
                "error_signature": error_sig[:500],
                "raw_sample": sample_errors[0][:300] if sample_errors else "",
                "implementation_criteria": impl_criteria,
                "verification_commands": verif_cmds,
                "status": "detected",  # "detected", "in_progress", "patched", "dismissed"
                "assigned_agent": None,
                "patch_history": []
            }
            new_items.append(new_item)

        # Prepend new items
        all_backlog = new_items + existing
        return all_backlog

    def discover_candidate_files(self, item: Dict[str, Any], max_candidates: int = 3) -> List[str]:
        """
        Autonomously scans the codebase for candidate files relevant to the issue
        when no affected_files were specified in the user report or telemetry event.
        Scores candidate source files based on keyword density, component signatures, and relevance.
        """
        root_dir = Path(__file__).resolve().parent.parent.parent
        query_text = f"{item.get('title', '')} {item.get('root_cause', '')} {item.get('error_signature', '')}"
        
        # Extract meaningful alphanumeric tokens (length >= 3)
        raw_tokens = re.findall(r'[a-zA-Z0-9_\-]+', query_text.lower())
        stopwords = {
            "the", "and", "can", "cant", "not", "for", "with", "this", "that", "from",
            "are", "was", "were", "but", "see", "fix", "look", "what", "how", "why",
            "still", "same", "also", "into", "onto", "over", "under", "attached",
            "artifacts", "screenshot", "png", "jpg", "com", "microsoft", "emmx", "view"
        }
        tokens = [t for t in raw_tokens if len(t) >= 3 and t not in stopwords]
        
        # Domain concept keyword expansion
        expanded_keywords = set(tokens)
        if any(k in expanded_keywords for k in ["chat", "warroom", "war-room", "console", "scroll", "input", "button", "send"]):
            expanded_keywords.update([
                "chat_console", "tab-console", "console-warroom-view", "console-direct-view",
                "warroom-conversation", "chat-conversation", "chat-text-input", "warroom-text-input",
                "console-active-mode"
            ])
        if any(k in expanded_keywords for k in ["layout", "css", "screen", "overflow", "height", "viewport", "cut", "off"]):
            expanded_keywords.update(["main.css", "body.html", "ui_navigation.js"])
        if any(k in expanded_keywords for k in ["agent", "fleet", "roster", "card"]):
            expanded_keywords.update(["roster.js", "agents.py", "fleet.py"])
        if any(k in expanded_keywords for k in ["cron", "workflow", "schedule"]):
            expanded_keywords.update(["workflows.py", "workflows_crons.js"])
        if any(k in expanded_keywords for k in ["auth", "security", "token", "login"]):
            expanded_keywords.update(["security_auth.js", "security.py"])

        candidates_scored = {}
        search_dirs = [
            root_dir / "frontend" / "src" / "styles",
            root_dir / "frontend" / "src" / "templates",
            root_dir / "frontend" / "src" / "js",
            root_dir / "backend" / "routers",
            root_dir / "backend" / "services"
        ]

        allowed_extensions = {".css", ".html", ".js", ".py"}

        for s_dir in search_dirs:
            if not s_dir.exists():
                continue
            for p in s_dir.rglob("*"):
                if not p.is_file() or p.suffix not in allowed_extensions:
                    continue
                # Skip build, tests, backups
                if any(x in p.parts for x in ["dist", "node_modules", "venv", "__pycache__", "benchmark", "test"]):
                    continue
                try:
                    rel_path = str(p.relative_to(root_dir))
                    content = p.read_text(encoding="utf-8", errors="ignore").lower()
                    
                    score = 0
                    for kw in expanded_keywords:
                        kw_lower = kw.lower()
                        # Matching in filename gives highest boost
                        if kw_lower in rel_path.lower():
                            score += 25
                        # Matching in content
                        count = content.count(kw_lower)
                        if count > 0:
                            score += min(count, 10) * 2

                    if score > 0:
                        candidates_scored[rel_path] = score
                except Exception:
                    continue

        if not candidates_scored:
            # Fallback sensible defaults based on UI vs backend classification
            if any(k in query_text.lower() for k in ["ui", "css", "screen", "view", "chat", "warroom", "button"]):
                return ["frontend/src/styles/main.css", "frontend/src/templates/body.html"]
            return ["backend/server.py"]

        sorted_candidates = sorted(candidates_scored.items(), key=lambda x: x[1], reverse=True)
        return [path for path, score in sorted_candidates[:max_candidates]]

    def generate_code_patch(
        self,
        item: Dict[str, Any],
        patch_directive: Optional[str] = None,
        agent_name: str = "Solaris",
        inst_key: str = "agents_bs"
    ) -> Dict[str, str]:
        """
        Synthesizes a concrete, working code modification for the target affected files
        based on the backlog issue specification, root cause analysis, and acceptance criteria.
        If affected_files is empty, autonomously discovers candidate files across the codebase.
        Returns a dict mapping { relative_file_path: patched_full_content }.
        """
        affected_files = item.get("affected_files", [])
        if not affected_files:
            # Autonomously discover target files from codebase search
            discovered = self.discover_candidate_files(item)
            if discovered:
                affected_files = discovered
                item["affected_files"] = discovered
            else:
                raise ValueError("Autonomous file discovery could not identify candidate files for this issue.")

        root_dir = Path(__file__).resolve().parent.parent.parent
        patched_files = {}

        # Focus on primary affected file
        primary_rel = affected_files[0]
        target_path = root_dir / primary_rel

        if not target_path.exists():
            raise FileNotFoundError(f"Target affected file does not exist: {target_path}")

        original_code = target_path.read_text(encoding="utf-8")
        criteria_list = "\n".join([f"- {c}" for c in item.get("implementation_criteria", [])])
        directive_text = f"\nOperator Specific Directive: {patch_directive}" if patch_directive else ""

        # BL-SYS-25: Surgical Search/Replace or Full Rewrite based on file size
        # If file is over 150 lines or 8KB, ask for targeted exact SEARCH/REPLACE blocks to prevent API truncation or timeouts
        is_large_file = len(original_code.splitlines()) > 150 or len(original_code) > 8000

        if is_large_file:
            system_prompt = (
                f"You are {agent_name}, a Principal Systems Architect and Staff Engineer for NexusDesk. "
                f"Your mission is to write a surgical, production-grade fix for `{primary_rel}`. "
                f"Do NOT return the entire file. Instead, return one or more exact SEARCH/REPLACE blocks in this exact format:\n\n"
                f"<<<<<<< SEARCH\n"
                f"exact code snippet to find\n"
                f"=======\n"
                f"exact replacement code snippet\n"
                f">>>>>>> REPLACE\n\n"
                f"Ensure the SEARCH block matches existing file text exactly, including whitespace and indentation. "
                f"Do not include conversational preamble."
            )
            user_prompt = (
                f"Resolve this issue for `{primary_rel}`:\n"
                f"**Issue**: {item.get('id')} - {item.get('title')}\n"
                f"**Root Cause**: {item.get('root_cause')}\n"
                f"**Implementation Criteria**:\n{criteria_list}{directive_text}\n\n"
                f"**Reference Snippet of `{primary_rel}`**:\n"
                f"```\n{original_code[:6000]}\n...\n{original_code[-4000:]}\n```\n\n"
                f"Return the exact <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks."
            )
        else:
            system_prompt = (
                f"You are {agent_name}, a Principal Systems Architect and Staff Engineer for NexusDesk. "
                f"Your mission is to write a clean, reliable, production-grade code fix for `{primary_rel}`. "
                f"Return ONLY the complete updated file content wrapped in a single markdown code fence (e.g. ```python or ```javascript). "
                f"Do not include conversational preamble or markdown explanations outside the code block."
            )
            user_prompt = (
                f"Please generate the complete, production-ready patched version of `{primary_rel}` to resolve this issue:\n\n"
                f"**Issue ID**: {item.get('id', 'BL-EVO-XX')}\n"
                f"**Title**: {item.get('title')}\n"
                f"**Category**: {item.get('category')} ({item.get('pillar')})\n"
                f"**Root Cause Analysis**: {item.get('root_cause')}\n"
                f"**Error Trace / Signature**: {item.get('error_signature')}\n\n"
                f"**Implementation Acceptance Criteria**:\n{criteria_list}{directive_text}\n\n"
                f"**Original Content of `{primary_rel}`**:\n"
                f"```\n{original_code}\n```\n\n"
                f"Now return the entire updated file content for `{primary_rel}` inside a single code block."
            )

        raw_reply = self._call_llm(user_prompt, system_prompt=system_prompt, inst_key=inst_key)
        cleaned = raw_reply.strip()

        if is_large_file and "<<<<<<< SEARCH" in cleaned and ">>>>>>> REPLACE" in cleaned:
            # Apply search/replace blocks surgically
            patched_code = original_code
            pattern = re.compile(r'<<<<<<< SEARCH\r?\n(.*?)\r?\n=======\r?\n(.*?)\r?\n>>>>>>> REPLACE', re.DOTALL)
            matches = list(pattern.finditer(cleaned))
            if not matches:
                raise ValueError(f"Could not parse SEARCH/REPLACE blocks from model output.")
            
            applied_count = 0
            for m in matches:
                search_block = m.group(1)
                replace_block = m.group(2)
                if search_block in patched_code:
                    patched_code = patched_code.replace(search_block, replace_block, 1)
                    applied_count += 1
                else:
                    # Normalized whitespace attempt
                    search_stripped = search_block.strip()
                    if search_stripped and search_stripped in patched_code:
                        patched_code = patched_code.replace(search_stripped, replace_block.strip(), 1)
                        applied_count += 1

            if applied_count == 0:
                raise ValueError(f"Surgical patch search blocks did not match contents of {primary_rel}.")
            new_code = patched_code
        else:
            code_match = re.search(r'```(?:python|javascript|js|html|css)?\s*\n(.*?)```', cleaned, re.DOTALL)
            if code_match:
                new_code = code_match.group(1)
            elif cleaned.startswith("```") and cleaned.endswith("```"):
                lines = cleaned.split("\n")[1:-1]
                new_code = "\n".join(lines)
            else:
                new_code = cleaned

        if not new_code or len(new_code.strip()) < 50:
            raise ValueError(f"Model generated empty or invalid code patch for {primary_rel}.")

        if new_code.strip() == original_code.strip():
            raise ValueError("Model returned unchanged file content; no modifications generated.")

        patched_files[primary_rel] = new_code
        return patched_files


ai_architect = AIArchitectService()
