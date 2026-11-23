from typing import Dict, Any, List

MODEL_LIBRARY_SPECS: List[Dict[str, Any]] = [
    {
        "id": "claude-sonnet-5-5",
        "name": "Claude Sonnet 5.5",
        "provider": "anthropic",
        "provider_label": "Anthropic",
        "max_context": 500000,
        "max_context_label": "500,000 (500k tokens)",
        "max_output": 16384,
        "supports_reasoning": True,
        "category": "Flagship Architect & Systems Specialist",
        "speed": "Ultra Fast (~140 t/s)",
        "best_for": "Systems Engineering, Architecture, Cross-Engine War Room",
        "cost_tier": "Standard Anthropic"
    },
    {
        "id": "abacus/claude-sonnet-5-5",
        "name": "Claude Sonnet 5.5 (Abacus Route)",
        "provider": "abacus",
        "provider_label": "Anthropic / Abacus",
        "max_context": 500000,
        "max_context_label": "500,000 (500k tokens)",
        "max_output": 16384,
        "supports_reasoning": True,
        "category": "Enterprise Systems & Fallback",
        "speed": "Fast (~120 t/s)",
        "best_for": "Pylon / Sysadmin Deep Troubleshooting Fallback",
        "cost_tier": "Enterprise Route"
    },
    {
        "id": "abacus/gemini-3.8-flash",
        "name": "Gemini 3.8 Flash (Preview)",
        "provider": "abacus",
        "provider_label": "Google / Abacus",
        "max_context": 1048576,
        "max_context_label": "1,048,576 (1M tokens)",
        "max_output": 65536,
        "supports_reasoning": True,
        "category": "High-Context Multimodal & Narrative",
        "speed": "Ultra Fast (~180 t/s)",
        "best_for": "Large Workspace Ingestion, Video Storyboarding & Comprehensive Scripts",
        "cost_tier": "Low Cost / Generous Rate Limits"
    },
    {
        "id": "groq/openai/gpt-oss-120b",
        "name": "GPT-OSS 120B (Llama 3.1 Finetune)",
        "provider": "groq",
        "provider_label": "Groq LPU",
        "max_context": 131072,
        "max_context_label": "131,072 (131k tokens)",
        "max_output": 8192,
        "supports_reasoning": True,
        "category": "High-Speed Sysadmin & Analysis",
        "speed": "Extreme Speed (~350 t/s)",
        "best_for": "Low Latency Triage, Log Processing, Linux Monitoring",
        "cost_tier": "Free / Ultra Fast"
    },
    {
        "id": "groq/openai/gpt-oss-20b",
        "name": "GPT-OSS 20B",
        "provider": "groq",
        "provider_label": "Groq LPU",
        "max_context": 131072,
        "max_context_label": "131,072 (131k tokens)",
        "max_output": 8192,
        "supports_reasoning": False,
        "category": "Lightweight Triage",
        "speed": "Extreme Speed (~450 t/s)",
        "best_for": "Instant Heartbeats & Lightweight Dispatch",
        "cost_tier": "Free / Instant"
    },
    {
        "id": "nvidia/nemotron-3-ultra-550b-a55b",
        "name": "Nemotron-3 Ultra 550B",
        "provider": "nvidia",
        "provider_label": "NVIDIA NIM",
        "max_context": 1048576,
        "max_context_label": "1,048,576 (1M tokens)",
        "max_output": 8192,
        "supports_reasoning": True,
        "category": "Deep Reasoning & Theology",
        "speed": "Moderate (~45 t/s)",
        "best_for": "Complex Intent Routing, Scripture Research & Synthesis",
        "cost_tier": "Enterprise Heavyweights"
    },
    {
        "id": "nvidia/nemotron-3-super-120b-a12b",
        "name": "Nemotron-3 Super 120B",
        "provider": "nvidia",
        "provider_label": "NVIDIA NIM",
        "max_context": 1048576,
        "max_context_label": "1,048,576 (1M tokens)",
        "max_output": 8192,
        "supports_reasoning": True,
        "category": "Customer Care & Community Dialogue",
        "speed": "Fast (~95 t/s)",
        "best_for": "Pastoral Empathy, Member Support & Community Discussions",
        "cost_tier": "Enterprise Balanced"
    },
    {
        "id": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "name": "Nemotron-3.5 Lightning 30B",
        "provider": "nvidia",
        "provider_label": "NVIDIA NIM",
        "max_context": 262144,
        "max_context_label": "262,144 (256k tokens)",
        "max_output": 8192,
        "supports_reasoning": True,
        "category": "Analytical Fast Turnaround",
        "speed": "Very Fast (~160 t/s)",
        "best_for": "Rapid Logic Verification & Short Answers",
        "cost_tier": "Enterprise Fast"
    },
    {
        "id": "nous/inclusionai/ling-3.1-flash",
        "name": "Ling-3.1 Flash",
        "provider": "nous",
        "provider_label": "Nous Research",
        "max_context": 262144,
        "max_context_label": "262,144 (256k tokens)",
        "max_output": 8192,
        "supports_reasoning": False,
        "category": "Rapid Content Generation",
        "speed": "Ultra Fast (~220 t/s)",
        "best_for": "Community Social Drafts & Instant Responses",
        "cost_tier": "High Throughput"
    },
    {
        "id": "poolside/laguna-s-2.1:free",
        "name": "Laguna-S 2.1 Free",
        "provider": "nous",
        "provider_label": "Nous Research",
        "max_context": 262144,
        "max_context_label": "262,144 (256k tokens)",
        "max_output": 8192,
        "supports_reasoning": True,
        "category": "Default Autonomous Specialist",
        "speed": "Ultra Fast (~240 t/s)",
        "best_for": "Desktop Autonomous Operations & Command Execution",
        "cost_tier": "Free / Nous Tier"
    },
    {
        "id": "upstage/solar-pro4",
        "name": "Solar Pro4",
        "provider": "nous",
        "provider_label": "Nous Research",
        "max_context": 524288,
        "max_context_label": "524,288 (512k tokens)",
        "max_output": 8192,
        "supports_reasoning": True,
        "category": "Deep Reasoning & Extended Context",
        "speed": "Fast (~130 t/s)",
        "best_for": "Long Document Synthesis & Complex Workflows",
        "cost_tier": "Nous Production"
    },
    {
        "id": "meituan/longcat-2.5-preview:free",
        "name": "LongCat 2.5 Preview Free",
        "provider": "nous",
        "provider_label": "Nous Research",
        "max_context": 1048576,
        "max_context_label": "1,048,576 (1M tokens)",
        "max_output": 16384,
        "supports_reasoning": True,
        "category": "Ultra Long Context & Research",
        "speed": "Fast (~140 t/s)",
        "best_for": "Repository Analysis, Extensive Context Ingestion",
        "cost_tier": "Free / Nous Tier"
    },
    {
        "id": "xiaomi/mimo-v2.6-flash",
        "name": "MiMo-V2.6 Flash",
        "provider": "nous",
        "provider_label": "Nous Research",
        "max_context": 1050000,
        "max_context_label": "1,050,000 (1M+ tokens)",
        "max_output": 32768,
        "supports_reasoning": True,
        "category": "Multimodal Flash Agent",
        "speed": "Ultra Fast (~260 t/s)",
        "best_for": "Fast Multimodal Reasoning & Low-Latency Agents",
        "cost_tier": "Nous Production"
    },
    {
        "id": "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "name": "Llama 3.3 70B Instruct Fast",
        "provider": "cloudflare",
        "provider_label": "Cloudflare Workers AI",
        "max_context": 131072,
        "max_context_label": "131,072 (131k tokens)",
        "max_output": 8192,
        "supports_reasoning": False,
        "category": "Global Edge Failover",
        "speed": "Fast (~110 t/s)",
        "best_for": "Edge Redundancy, Bulletproof Fallback",
        "cost_tier": "Zero-Cost Serverless"
    },
    {
        "id": "abacus/gpt-4.1-mini",
        "name": "GPT-4.1 Mini",
        "provider": "abacus",
        "provider_label": "Abacus AI",
        "max_context": 128000,
        "max_context_label": "128,000 (128k tokens)",
        "max_output": 16384,
        "supports_reasoning": False,
        "category": "Structured Tool Calling & JSON",
        "speed": "Fast (~120 t/s)",
        "best_for": "Data Formatting, API Serialization & Workflows",
        "cost_tier": "Economical Tier"
    },
    {
        "id": "meta/llama-3.2-11b-vision-instruct",
        "name": "Llama 3.2 11B Vision Instruct",
        "provider": "groq",
        "provider_label": "Groq / Meta",
        "max_context": 131072,
        "max_context_label": "131,072 (131k tokens)",
        "max_output": 8192,
        "supports_reasoning": False,
        "category": "Visual & Image Inspection",
        "speed": "Extreme Speed (~300 t/s)",
        "best_for": "Image Captioning, OCR, Storyboard Verification",
        "cost_tier": "Free / Fast"
    }
]

def get_model_specs(model_id: str) -> Dict[str, Any]:
    if not model_id:
        model_id = "nvidia/nemotron-3-ultra-550b-a55b"
    norm_id = model_id.strip().lower()
    for spec in MODEL_LIBRARY_SPECS:
        if spec["id"].lower() == norm_id:
            return dict(spec)
        if norm_id in spec["id"].lower() or spec["id"].lower() in norm_id:
            res = dict(spec)
            res["id"] = model_id
            return res

    # Heuristics based on model name substrings
    if "gemini" in norm_id or "longcat" in norm_id or "mimo" in norm_id:
        ctx = 1048576
        ctx_label = "1,048,576 (1M tokens)"
        supp_reasoning = True
    elif "solar" in norm_id:
        ctx = 524288
        ctx_label = "524,288 (512k tokens)"
        supp_reasoning = True
    elif "nemotron" in norm_id:
        if "ultra" in norm_id or "super" in norm_id:
            ctx = 1048576
            ctx_label = "1,048,576 (1M tokens)"
        else:
            ctx = 262144
            ctx_label = "262,144 (256k tokens)"
        supp_reasoning = True
    elif any(k in norm_id for k in ("laguna", "ling")):
        ctx = 262144
        ctx_label = "262,144 (256k tokens)"
        supp_reasoning = True
    elif any(k in norm_id for k in ("120b", "70b", "llama-3", "gpt-4")):
        ctx = 131072
        ctx_label = "131,072 (131k tokens)"
        supp_reasoning = "120b" in norm_id or "llama" in norm_id
    elif "claude" in norm_id:
        ctx = 200000
        ctx_label = "200,000 (200k tokens)"
        supp_reasoning = True
    elif "deepseek" in norm_id:
        ctx = 131072
        ctx_label = "131,072 (131k tokens)"
        supp_reasoning = True
    else:
        ctx = 32768
        ctx_label = "32,768 (32k tokens)"
        supp_reasoning = False

    provider = norm_id.split("/")[0] if "/" in norm_id else "custom"
    clean_name = norm_id.split("/")[-1].replace("-", " ").replace("_", " ").title()

    return {
        "id": model_id,
        "name": clean_name,
        "provider": provider,
        "provider_label": provider.upper(),
        "max_context": ctx,
        "max_context_label": ctx_label,
        "max_output": 8192,
        "supports_reasoning": supp_reasoning,
        "category": "Autonomous Inference",
        "speed": "Standard",
        "best_for": "Specialist Agent Reasoning",
        "cost_tier": "Standard"
    }
