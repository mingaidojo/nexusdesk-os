import secrets
from fastapi import APIRouter, Request, HTTPException
from core.config import (
    NEXUSDESK_AUTH_ENABLED,
    NEXUSDESK_SECRET_KEY,
    verify_token,
    set_auth_config,
    broadcast_event
)
from schemas.models import AuthVerifyRequest, AuthToggleRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.get("/status")
def auth_status(request: Request):
    auth_header = request.headers.get("Authorization")
    token = None
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif request.headers.get("X-NexusDesk-Token"):
        token = request.headers.get("X-NexusDesk-Token").strip()
    elif "token" in request.query_params:
        token = request.query_params.get("token").strip()

    is_authenticated = verify_token(token)
    return {
        "auth_enabled": NEXUSDESK_AUTH_ENABLED,
        "authenticated": is_authenticated,
        "masked_key": f"{NEXUSDESK_SECRET_KEY[:8]}...{NEXUSDESK_SECRET_KEY[-8:]}" if NEXUSDESK_SECRET_KEY else "NONE",
        "secret_key": NEXUSDESK_SECRET_KEY if not NEXUSDESK_AUTH_ENABLED else None,
        "mode": "ENFORCED" if NEXUSDESK_AUTH_ENABLED else "DEVELOPMENT (OPTIONAL)"
    }

@router.post("/verify")
def auth_verify(payload: AuthVerifyRequest):
    if not NEXUSDESK_AUTH_ENABLED:
        return {"valid": True, "auth_enabled": False}
    if verify_token(payload.token):
        return {"valid": True, "auth_enabled": True}
    raise HTTPException(status_code=401, detail="Invalid NexusDesk Secret Key")

@router.post("/toggle")
async def auth_toggle(payload: AuthToggleRequest):
    new_key = secrets.token_hex(32) if payload.regenerate_key else NEXUSDESK_SECRET_KEY
    set_auth_config(bool(payload.enabled), new_key)

    await broadcast_event("auth_config_changed", {
        "auth_enabled": bool(payload.enabled),
        "secret_key": new_key
    })
    return {
        "status": "ok",
        "auth_enabled": bool(payload.enabled),
        "secret_key": new_key
    }
