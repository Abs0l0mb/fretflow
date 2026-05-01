"""
server.py — Production FastAPI backend for FretFlow

Auth:
  GET  /api/auth/google    → redirect to Google OAuth consent
  GET  /api/auth/callback  → Google callback → sets session cookie → redirect /
  POST /api/auth/logout    → clear session cookie
  GET  /api/me             → return current user (validates cookie)

Protected endpoints (require valid session):
  POST /api/convert         → MIDI (base64) + viterbi params → GP5 binary
  POST /api/suggest-params → MIDI (base64) → best viterbi params as JSON
  POST /api/mp3/stems      → MP3 (base64) → {stem: MIDI base64, …}

Static:
  GET  /*                  → SPA frontend

Required env vars:
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  SECRET_KEY               (any long random string for cookie signing)
  APP_BASE_URL             (e.g. https://yourdomain.com — no trailing slash)
  ALLOWED_EMAILS           (optional, comma-separated; empty = allow all Google accounts)

Usage:
  uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""

import argparse
import asyncio
import base64
import os
import secrets
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Optional

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI, Form, Request, Depends
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from authlib.integrations.httpx_client import AsyncOAuth2Client
from pathlib import Path
import bcrypt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import (
    upsert_user, get_user_by_email, get_password_hash, set_password_hash,
    create_user_with_password, check_and_increment_usage, close_pool,
    verify_email_token, set_verification_token, FREE_CONVERSIONS_PER_MONTH,
)
from email_utils import send_verification_email
from midi_to_jsonl import midi_to_jsonl_active_compressed
from viterbi_predict import load_config, load_events_from_jsonl, viterbi_decode, save_predicted_jsonl
from jsonl_to_tab import load_pred_events, build_gp5_from_pred_rows, E_STD_TUNING
from tune_viterbi import tune_file

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CONFIG_PATH  = os.path.join(os.path.dirname(__file__), "viterbi_config.jsonc")
PROFILE_PATH = os.path.join(os.path.dirname(__file__), "tune_profile.json")
STATIC_DIR   = os.environ.get(
    "STATIC_DIR",
    str(Path(__file__).parent.parent / "frontend" / "runtime" / "dist" / "build")
)
MAX_MIDI_BYTES = 10 * 1024 * 1024   # 10 MB
MAX_MP3_BYTES  = 50 * 1024 * 1024   # 50 MB

# Auth config
SECRET_KEY      = os.environ.get("SECRET_KEY", "change-me-in-production")
GOOGLE_CLIENT_ID     = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
APP_BASE_URL    = os.environ.get("APP_BASE_URL", "http://localhost:8000").rstrip("/")
ALLOWED_EMAILS  = {e.strip() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()}
DEV_MODE        = os.environ.get("DEV_MODE", "").lower() in ("1", "true", "yes")
ADMIN_EMAIL     = os.environ.get("ADMIN_EMAIL", "")
ADMIN_PASSWORD  = os.environ.get("ADMIN_PASSWORD", "")

SESSION_COOKIE  = "fretflow_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7  # 7 days
_signer         = URLSafeTimedSerializer(SECRET_KEY, salt="fretflow-session")

_executor = ThreadPoolExecutor(max_workers=int(os.environ.get("VITERBI_WORKERS", "2")))

# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def make_session_cookie(user: dict) -> str:
    return _signer.dumps(user)

def read_session_cookie(token: str) -> Optional[dict]:
    try:
        return _signer.loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None

def get_current_user(request: Request) -> Optional[dict]:
    if DEV_MODE:
        return {"email": "dev@localhost", "name": "Dev User", "picture": ""}
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    return read_session_cookie(token)

def require_user(request: Request) -> dict:
    user = get_current_user(request)
    if user is None:
        return None  # caller returns error response
    return user

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get("DATABASE_URL", "")

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await close_pool()

app = FastAPI(title="FretFlow", docs_url=None, redoc_url=None, lifespan=lifespan)

# ---------------------------------------------------------------------------
# Google OAuth endpoints
# ---------------------------------------------------------------------------

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO  = "https://www.googleapis.com/oauth2/v3/userinfo"


@app.get("/api/auth/google")
async def auth_google():
    """Redirect the browser to Google's OAuth consent screen."""
    redirect_uri = f"{APP_BASE_URL}/api/auth/callback"
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "online",
    }
    url = GOOGLE_AUTH_URL + "?" + "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(url)


@app.get("/api/auth/callback")
async def auth_callback(code: str, request: Request):
    """Exchange Google auth code for user info, set session cookie."""
    redirect_uri = f"{APP_BASE_URL}/api/auth/callback"

    async with AsyncOAuth2Client(
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        redirect_uri=redirect_uri,
    ) as client:
        token = await client.fetch_token(GOOGLE_TOKEN_URL, code=code)
        resp  = await client.get(GOOGLE_USERINFO)

    info  = resp.json()
    email = info.get("email", "")

    if ALLOWED_EMAILS and email not in ALLOWED_EMAILS:
        return RedirectResponse(f"/?error=not-allowed")

    if DATABASE_URL:
        await upsert_user(
            email=email,
            name=info.get("name", email),
            picture=info.get("picture", ""),
            google_id=info.get("sub"),
        )

    user = {
        "email":   email,
        "name":    info.get("name", email),
        "picture": info.get("picture", ""),
    }

    cookie = make_session_cookie(user)
    response = RedirectResponse("/")
    response.set_cookie(
        SESSION_COOKIE,
        cookie,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=APP_BASE_URL.startswith("https"),
    )
    return response


@app.post("/api/auth/logout")
async def auth_logout():
    response = JSONResponse({"error": False, "content": None})
    response.delete_cookie(SESSION_COOKIE)
    return response


@app.post("/api/auth/login")
async def auth_login(
    email:    Annotated[str, Form()],
    password: Annotated[str, Form()],
):
    # DB-backed login
    if DATABASE_URL:
        stored_hash = await get_password_hash(email)
        if not stored_hash:
            return JSONResponse({"error": True, "content": "invalid-credentials"}, status_code=401)
        if not bcrypt.checkpw(password.encode(), stored_hash.encode()):
            return JSONResponse({"error": True, "content": "invalid-credentials"}, status_code=401)
        db_user = await get_user_by_email(email)
        if not db_user.get("email_verified"):
            return JSONResponse({"error": True, "content": "email-not-verified"}, status_code=403)
        user = {
            "email":   db_user["email"],
            "name":    db_user["name"] or email.split("@")[0],
            "picture": db_user["picture"] or "",
        }
    else:
        # Fallback: single admin account via env vars (no DB)
        if not ADMIN_EMAIL or not ADMIN_PASSWORD:
            return JSONResponse({"error": True, "content": "password-login-not-configured"})
        if email != ADMIN_EMAIL or password != ADMIN_PASSWORD:
            return JSONResponse({"error": True, "content": "invalid-credentials"})
        user = {"email": ADMIN_EMAIL, "name": ADMIN_EMAIL.split("@")[0], "picture": ""}

    cookie = make_session_cookie(user)
    response = JSONResponse({"error": False, "content": user})
    response.set_cookie(
        SESSION_COOKIE,
        cookie,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=APP_BASE_URL.startswith("https"),
    )
    return response


# ---------------------------------------------------------------------------
# /api/auth/register
# ---------------------------------------------------------------------------

@app.post("/api/auth/register")
async def auth_register(
    email:    Annotated[str, Form()],
    password: Annotated[str, Form()],
):
    if not DATABASE_URL:
        return JSONResponse({"error": True, "content": "db-not-configured"}, status_code=503)

    email = email.strip().lower()
    if not email or not password:
        return JSONResponse({"error": True, "content": "missing-fields"}, status_code=400)
    if len(password) < 8:
        return JSONResponse({"error": True, "content": "password-too-short"}, status_code=400)

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    token = secrets.token_urlsafe(32)
    name  = email.split("@")[0]

    row = await create_user_with_password(email, name, password_hash, token)
    if row is None:
        return JSONResponse({"error": True, "content": "email-already-registered"}, status_code=409)

    verification_link = f"{APP_BASE_URL}/api/auth/verify-email?token={token}"
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, send_verification_email, email, verification_link
        )
    except Exception as e:
        return JSONResponse({"error": True, "content": f"email-send-failed: {e}"}, status_code=500)

    return JSONResponse({"error": False, "content": "verification-email-sent"})


@app.get("/api/auth/verify-email")
async def auth_verify_email(token: str):
    row = await verify_email_token(token)
    if row is None:
        return RedirectResponse("/?error=invalid-or-expired-token")

    user = {"email": row["email"], "name": row["name"] or row["email"], "picture": row.get("picture") or ""}
    cookie = make_session_cookie(user)
    response = RedirectResponse("/")
    response.set_cookie(
        SESSION_COOKIE, cookie,
        max_age=SESSION_MAX_AGE, httponly=True, samesite="lax",
        secure=APP_BASE_URL.startswith("https"),
    )
    return response


# ---------------------------------------------------------------------------
# /api/me
# ---------------------------------------------------------------------------

@app.get("/api/me")
async def me(request: Request):
    user = get_current_user(request)
    if user is None:
        return JSONResponse({"error": True, "content": "not-connected"}, status_code=401)
    return JSONResponse({"error": False, "content": user})


# ---------------------------------------------------------------------------
# /api/suggest-params — Auto-tune viterbi params for a specific MIDI file
# ---------------------------------------------------------------------------

# dotted keys from tune_viterbi → flat keys used by the frontend
_DOTTED_TO_FLAT = {
    "local_cost.w_span":                    "w_span",
    "local_cost.w_high":                    "w_high",
    "local_cost.w_string_range":            "w_string_range",
    "local_cost.w_preferred_zone":          "w_preferred_zone",
    "local_cost.w_high_string":             "w_high_string",
    "string_discontinuity.w_holes":         "w_holes",
    "string_discontinuity.w_gap":           "w_gap",
    "string_discontinuity.w_blocks":        "w_blocks",
    "transition_cost.w_jump":               "w_jump",
    "transition_cost.jump_power":           "jump_power",
    "transition_cost.jump_threshold_penalty": "jump_threshold_penalty",
    "transition_cost.w_avg_jump":           "w_avg_jump",
    "transition_cost.w_string_center":      "w_string_center",
    "transition_cost.close_jump_bonus":     "close_jump_bonus",
    "transition_cost.w_span_change":                    "w_span_change",
    "transition_cost.w_streak":                         "w_streak",
    "transition_cost.w_same_string_bonus":              "w_same_string_bonus",
    "transition_cost.same_string_pitch_threshold":      "same_string_pitch_threshold",
    "transition_cost.w_string_jump":                    "w_string_jump",
    "transition_cost.string_jump_threshold":            "string_jump_threshold",
}


@app.post("/api/suggest-params")
async def suggest_params(
    request:     Request,
    midi_base64: Annotated[str,           Form()],
    midi_name:   Annotated[Optional[str], Form()] = "input.mid",
    n_trials:    Annotated[Optional[int], Form()] = 60,
    beam_size:   Annotated[Optional[int], Form()] = 20,
):
    if get_current_user(request) is None:
        return JSONResponse({"error": True, "content": "not-connected"})
    if not os.path.exists(PROFILE_PATH):
        return JSONResponse({"error": True, "content": "tune-profile-not-built"})

    b64 = midi_base64.split(",", 1)[-1] if "," in midi_base64 else midi_base64
    try:
        midi_bytes = base64.b64decode(b64)
    except Exception:
        return JSONResponse({"error": True, "content": "invalid-midi-file"})

    if len(midi_bytes) > MAX_MIDI_BYTES:
        return JSONResponse({"error": True, "content": "midi-file-too-large"})

    import json as _json
    with open(PROFILE_PATH) as f:
        profile = _json.load(f)

    base_cfg = load_config(CONFIG_PATH)

    def suggest() -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            midi_path = os.path.join(tmp, "input.mid")
            raw_jsonl  = os.path.join(tmp, "raw.jsonl")

            with open(midi_path, "wb") as f:
                f.write(midi_bytes)

            midi_to_jsonl_active_compressed(
                midi_path=midi_path,
                out_path=raw_jsonl,
                gp_quarter_ticks=960,
                step=60,
            )

            best_params = tune_file(
                input_jsonl=raw_jsonl,
                base_cfg=base_cfg,
                profile=profile,
                n_trials=n_trials or 60,
                beam_size=beam_size or 20,
                verbose=False,
            )

        # Convert dotted keys → flat keys, round to 4 decimal places
        return {
            _DOTTED_TO_FLAT[k]: round(v, 4)
            for k, v in best_params.items()
            if k in _DOTTED_TO_FLAT
        }

    try:
        loop = asyncio.get_event_loop()
        flat_params = await loop.run_in_executor(_executor, suggest)
    except Exception as e:
        return JSONResponse({"error": True, "content": str(e)})

    return JSONResponse({"error": False, "content": flat_params})


# ---------------------------------------------------------------------------
# /api/mp3/stems — Separate MP3 → transcribe each stem → return MIDIs
# ---------------------------------------------------------------------------

@app.post("/api/mp3/stems")
async def mp3_stems(
    request:         Request,
    mp3_base64:      Annotated[str,            Form()],
    mp3_name:        Annotated[Optional[str],  Form()] = "input.mp3",
    # Which stems to transcribe (comma-separated; drums are always skipped)
    stems:           Annotated[Optional[str],  Form()] = "guitar,bass",
    # Demucs model: "htdemucs_6s" (6 stems, guitar separated) or "htdemucs" (4 stems)
    model:           Annotated[Optional[str],  Form()] = "htdemucs_6s",
    # Basic Pitch thresholds
    onset_threshold: Annotated[Optional[float], Form()] = 0.5,
    frame_threshold: Annotated[Optional[float], Form()] = 0.3,
    min_note_length: Annotated[Optional[float], Form()] = 127.70,
    min_frequency:   Annotated[Optional[float], Form()] = None,
    max_frequency:   Annotated[Optional[float], Form()] = None,
):
    """
    Separate an audio file (MP3, WAV, …) into stems and transcribe each to MIDI.

    Returns JSON:
      { "error": false, "content": { "guitar": "<base64 MIDI>", "bass": "<base64 MIDI>" } }

    The base64 MIDIs can be passed directly to /api/convert as midi_base64.
    """
    if get_current_user(request) is None:
        return JSONResponse({"error": True, "content": "not-connected"})

    b64 = mp3_base64.split(",", 1)[-1] if "," in mp3_base64 else mp3_base64
    try:
        mp3_bytes = base64.b64decode(b64)
    except Exception:
        return JSONResponse({"error": True, "content": "invalid-audio-file"})

    if len(mp3_bytes) > MAX_MP3_BYTES:
        return JSONResponse({"error": True, "content": "audio-file-too-large"})

    requested_stems = {s.strip() for s in (stems or "guitar,bass").split(",") if s.strip()}

    def separate_and_transcribe() -> dict:
        from mp3_to_midi import mp3_to_midis
        import base64 as _b64

        with tempfile.TemporaryDirectory() as tmp:
            audio_path = os.path.join(tmp, mp3_name or "input.mp3")
            with open(audio_path, "wb") as f:
                f.write(mp3_bytes)

            midi_paths = mp3_to_midis(
                audio_path=audio_path,
                output_dir=tmp,
                stems=requested_stems,
                model=model or "htdemucs_6s",
                onset_threshold=onset_threshold if onset_threshold is not None else 0.5,
                frame_threshold=frame_threshold if frame_threshold is not None else 0.3,
                minimum_note_length=min_note_length if min_note_length is not None else 127.70,
                minimum_frequency=min_frequency,
                maximum_frequency=max_frequency,
            )

            result = {}
            for stem_name, midi_path in midi_paths.items():
                with open(midi_path, "rb") as f:
                    result[stem_name] = _b64.b64encode(f.read()).decode("ascii")
            return result

    try:
        loop = asyncio.get_event_loop()
        stem_midis = await loop.run_in_executor(_executor, separate_and_transcribe)
    except Exception as e:
        return JSONResponse({"error": True, "content": str(e)})

    return JSONResponse({"error": False, "content": stem_midis})


# ---------------------------------------------------------------------------
# /api/convert — Main endpoint
# ---------------------------------------------------------------------------

@app.post("/api/convert")
async def convert(
    request:      Request,
    midi_base64:  Annotated[str,           Form()],
    midi_name:    Annotated[Optional[str], Form()] = "input.mid",
    # General
    step:         Annotated[Optional[int], Form()] = 60,
    gpq:          Annotated[Optional[int], Form()] = 960,
    tempo:        Annotated[Optional[int], Form()] = 120,
    # Search
    max_fret:     Annotated[Optional[int], Form()] = None,
    per_pitch_k:  Annotated[Optional[int], Form()] = None,
    chord_k:      Annotated[Optional[int], Form()] = None,
    beam_size:    Annotated[Optional[int], Form()] = None,
    # Local cost
    w_span:                Annotated[Optional[float], Form()] = None,
    w_high:                Annotated[Optional[float], Form()] = None,
    high_fret_threshold:   Annotated[Optional[int],   Form()] = None,
    w_open_bonus:          Annotated[Optional[float], Form()] = None,
    w_string_range:        Annotated[Optional[float], Form()] = None,
    preferred_min_fret:    Annotated[Optional[int],   Form()] = None,
    preferred_max_fret:    Annotated[Optional[int],   Form()] = None,
    w_preferred_zone:      Annotated[Optional[float], Form()] = None,
    high_string_threshold: Annotated[Optional[int],   Form()] = None,
    w_high_string:         Annotated[Optional[float], Form()] = None,
    # String discontinuity
    w_holes:  Annotated[Optional[float], Form()] = None,
    w_gap:    Annotated[Optional[float], Form()] = None,
    w_blocks: Annotated[Optional[float], Form()] = None,
    # Transition cost
    w_jump:                 Annotated[Optional[float], Form()] = None,
    jump_power:             Annotated[Optional[float], Form()] = None,
    jump_threshold:         Annotated[Optional[float], Form()] = None,
    jump_threshold_penalty: Annotated[Optional[float], Form()] = None,
    w_avg_jump:             Annotated[Optional[float], Form()] = None,
    avg_jump_power:         Annotated[Optional[float], Form()] = None,
    w_span_change:          Annotated[Optional[float], Form()] = None,
    w_string_center:        Annotated[Optional[float], Form()] = None,
    close_jump_threshold:   Annotated[Optional[float], Form()] = None,
    close_jump_bonus:       Annotated[Optional[float], Form()] = None,
    rest_enter_penalty:     Annotated[Optional[float], Form()] = None,
    rest_exit_penalty:      Annotated[Optional[float], Form()] = None,
    w_streak:               Annotated[Optional[float], Form()] = None,
    streak_min_len:         Annotated[Optional[int],   Form()] = None,
    streak_speed_threshold: Annotated[Optional[int],   Form()] = None,
    same_string_pitch_threshold: Annotated[Optional[int],   Form()] = None,
    w_same_string_bonus:         Annotated[Optional[float], Form()] = None,
    string_jump_threshold:       Annotated[Optional[int],   Form()] = None,
    w_string_jump:               Annotated[Optional[float], Form()] = None,
    tuning:                      Annotated[Optional[str],   Form()] = None,
):
    user = get_current_user(request)
    if user is None:
        return JSONResponse({"error": True, "content": "not-connected"}, status_code=401)

    # ── Paywall check ─────────────────────────────────────────────────────
    if DATABASE_URL and not DEV_MODE:
        allowed, used, limit = await check_and_increment_usage(user["email"])
        if not allowed:
            return JSONResponse({
                "error": True,
                "content": "usage-limit-reached",
                "conversions_used": used,
                "conversions_limit": limit,
            }, status_code=402)

    # ── Decode MIDI ──────────────────────────────────────────────────────
    b64 = midi_base64.split(",", 1)[-1] if "," in midi_base64 else midi_base64
    try:
        midi_bytes = base64.b64decode(b64)
    except Exception:
        return JSONResponse({"error": True, "content": "invalid-midi-file"})

    if len(midi_bytes) > MAX_MIDI_BYTES:
        return JSONResponse({"error": True, "content": "midi-file-too-large"})

    # ── Build config with overrides ───────────────────────────────────────
    cfg = load_config(CONFIG_PATH)

    def set_param(section: str, key: str, val, cast=float):
        if val is not None:
            cfg[section][key] = cast(val)

    set_param("search", "max_fret",    max_fret,    int)
    set_param("search", "per_pitch_k", per_pitch_k, int)
    set_param("search", "chord_k",     chord_k,     int)
    set_param("search", "beam_size",   beam_size,   int)

    set_param("local_cost", "w_span",                w_span)
    set_param("local_cost", "w_high",                w_high)
    set_param("local_cost", "high_fret_threshold",   high_fret_threshold,   int)
    set_param("local_cost", "w_open_bonus",          w_open_bonus)
    set_param("local_cost", "w_string_range",        w_string_range)
    set_param("local_cost", "preferred_min_fret",    preferred_min_fret,    int)
    set_param("local_cost", "preferred_max_fret",    preferred_max_fret,    int)
    set_param("local_cost", "w_preferred_zone",      w_preferred_zone)
    set_param("local_cost", "high_string_threshold", high_string_threshold, int)
    set_param("local_cost", "w_high_string",         w_high_string)

    set_param("string_discontinuity", "w_holes",  w_holes)
    set_param("string_discontinuity", "w_gap",    w_gap)
    set_param("string_discontinuity", "w_blocks", w_blocks)

    set_param("transition_cost", "w_jump",                 w_jump)
    set_param("transition_cost", "jump_power",             jump_power)
    set_param("transition_cost", "jump_threshold",         jump_threshold)
    set_param("transition_cost", "jump_threshold_penalty", jump_threshold_penalty)
    set_param("transition_cost", "w_avg_jump",             w_avg_jump)
    set_param("transition_cost", "avg_jump_power",         avg_jump_power)
    set_param("transition_cost", "w_span_change",          w_span_change)
    set_param("transition_cost", "w_string_center",        w_string_center)
    set_param("transition_cost", "close_jump_threshold",   close_jump_threshold)
    set_param("transition_cost", "close_jump_bonus",       close_jump_bonus)
    set_param("transition_cost", "rest_enter_penalty",     rest_enter_penalty)
    set_param("transition_cost", "rest_exit_penalty",      rest_exit_penalty)
    set_param("transition_cost", "w_streak",               w_streak)
    set_param("transition_cost", "streak_min_len",              streak_min_len,              int)
    set_param("transition_cost", "streak_speed_threshold",      streak_speed_threshold,      int)
    set_param("transition_cost", "same_string_pitch_threshold", same_string_pitch_threshold, int)
    set_param("transition_cost", "w_same_string_bonus",         w_same_string_bonus)
    set_param("transition_cost", "string_jump_threshold",       string_jump_threshold, int)
    set_param("transition_cost", "w_string_jump",               w_string_jump)

    # ── Run Viterbi in thread pool (CPU-bound) ────────────────────────────
    step_  = step  or 60
    gpq_   = gpq   or 960
    tempo_ = tempo or 120

    parsed_tuning = None
    if tuning:
        try:
            parsed_tuning = [int(x.strip()) for x in tuning.split(',') if x.strip()]
        except ValueError:
            return JSONResponse({"error": True, "content": "invalid-tuning"}, status_code=400)

    def process() -> bytes:
        t = parsed_tuning or cfg.get("guitar", {}).get("tuning", E_STD_TUNING)
        with tempfile.TemporaryDirectory() as tmp:
            midi_path  = os.path.join(tmp, "input.mid")
            raw_jsonl  = os.path.join(tmp, "raw.jsonl")
            pred_jsonl = os.path.join(tmp, "pred.jsonl")
            gp5_path   = os.path.join(tmp, "output.gp5")

            with open(midi_path, "wb") as f:
                f.write(midi_bytes)

            midi_to_jsonl_active_compressed(
                midi_path=midi_path,
                out_path=raw_jsonl,
                gp_quarter_ticks=gpq_,
                step=step_,
            )

            events = load_events_from_jsonl(raw_jsonl)
            preds  = viterbi_decode(events, cfg)
            save_predicted_jsonl(events, preds, pred_jsonl)

            rows = load_pred_events(pred_jsonl)
            build_gp5_from_pred_rows(
                pred_rows=rows,
                out_gp5_path=gp5_path,
                title=os.path.splitext(os.path.basename(midi_name or "output"))[0],
                tempo=tempo_,
                time_sig=(4, 4),
                quarter_ticks=gpq_,
                tuning=t,
            )

            with open(gp5_path, "rb") as f:
                return f.read()

    try:
        loop = asyncio.get_event_loop()
        gp5_bytes = await loop.run_in_executor(_executor, process)
    except Exception as e:
        return JSONResponse({"error": True, "content": str(e)}, status_code=500)

    stem = (midi_name or "output").rsplit(".", 1)[0]
    return Response(
        content=gp5_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{stem}.gp5"'},
    )


# ---------------------------------------------------------------------------
# Static frontend (must come last)
# ---------------------------------------------------------------------------

if os.path.isdir(STATIC_DIR):
    for sub in ("assets", "css", "js"):
        sub_dir = os.path.join(STATIC_DIR, sub)
        if os.path.isdir(sub_dir):
            app.mount(f"/{sub}", StaticFiles(directory=sub_dir), name=sub)

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        path = os.path.join(STATIC_DIR, "favicon.ico")
        return FileResponse(path) if os.path.exists(path) else Response(status_code=204)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn

    ap = argparse.ArgumentParser(description="FretFlow backend server")
    ap.add_argument("--dev",  action="store_true", help="Dev mode: bypass auth, enable reload")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    if args.dev:
        os.environ["DEV_MODE"] = "true"
        DEV_MODE = True

    uvicorn.run("server:app", host=args.host, port=args.port, reload=args.dev)
