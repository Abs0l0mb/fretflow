"""
db.py — Async Postgres helpers (asyncpg + Supabase)

Table: users
  id                  UUID PK
  email               TEXT UNIQUE NOT NULL
  name                TEXT
  picture             TEXT
  password_hash       TEXT        (null for Google-only accounts)
  google_id           TEXT UNIQUE (null for password-only accounts)
  stripe_customer_id  TEXT UNIQUE
  plan                TEXT DEFAULT 'free'
  conversions_used    INT  DEFAULT 0
  conversions_reset_at TIMESTAMPTZ DEFAULT now()
  created_at          TIMESTAMPTZ DEFAULT now()
  last_login_at       TIMESTAMPTZ
"""

import os
import asyncpg

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        url = os.environ.get("DATABASE_URL", "")
        if not url:
            raise RuntimeError("DATABASE_URL env var is not set")
        _pool = await asyncpg.create_pool(url, min_size=1, max_size=5)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ---------------------------------------------------------------------------
# User upsert — called on every successful login
# ---------------------------------------------------------------------------

async def upsert_user(*, email: str, name: str, picture: str, google_id: str | None = None) -> dict:
    """
    Insert or update a user row on login.
    Returns the full user row as a dict.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO users (email, name, picture, google_id, last_login_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (email) DO UPDATE SET
            name          = EXCLUDED.name,
            picture       = EXCLUDED.picture,
            google_id     = COALESCE(EXCLUDED.google_id, users.google_id),
            last_login_at = now()
        RETURNING id, email, name, picture, plan,
                  conversions_used, conversions_reset_at, stripe_customer_id
        """,
        email, name, picture, google_id,
    )
    return dict(row)


# ---------------------------------------------------------------------------
# Fetch user
# ---------------------------------------------------------------------------

async def get_user_by_email(email: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT id, email, name, picture, password_hash, plan,
               conversions_used, conversions_reset_at, stripe_customer_id
        FROM users WHERE email = $1
        """,
        email,
    )
    return dict(row) if row else None


async def get_user_by_stripe_customer(customer_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id, email, plan FROM users WHERE stripe_customer_id = $1",
        customer_id,
    )
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Password auth
# ---------------------------------------------------------------------------

async def set_password_hash(email: str, password_hash: str):
    pool = await get_pool()
    await pool.execute(
        "UPDATE users SET password_hash = $1 WHERE email = $2",
        password_hash, email,
    )


async def get_password_hash(email: str) -> str | None:
    pool = await get_pool()
    return await pool.fetchval(
        "SELECT password_hash FROM users WHERE email = $1", email
    )


# ---------------------------------------------------------------------------
# Usage tracking
# ---------------------------------------------------------------------------

FREE_CONVERSIONS_PER_MONTH = int(os.environ.get("FREE_CONVERSIONS_PER_MONTH", "10"))


async def check_and_increment_usage(email: str) -> tuple[bool, int, int]:
    """
    Returns (allowed, conversions_used, limit).
    Resets counter if it's been more than a month.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT plan, conversions_used, conversions_reset_at
                FROM users WHERE email = $1
                FOR UPDATE
                """,
                email,
            )
            if not row:
                return False, 0, FREE_CONVERSIONS_PER_MONTH

            plan  = row["plan"]
            used  = row["conversions_used"]
            reset = row["conversions_reset_at"]

            # Reset counter monthly
            needs_reset = await conn.fetchval(
                "SELECT now() - $1 > interval '1 month'", reset
            )
            if needs_reset:
                used = 0
                await conn.execute(
                    "UPDATE users SET conversions_used = 0, conversions_reset_at = now() WHERE email = $1",
                    email,
                )

            if plan == "pro":
                await conn.execute(
                    "UPDATE users SET conversions_used = conversions_used + 1 WHERE email = $1",
                    email,
                )
                return True, used + 1, -1  # -1 = unlimited

            limit = FREE_CONVERSIONS_PER_MONTH
            if used >= limit:
                return False, used, limit

            await conn.execute(
                "UPDATE users SET conversions_used = conversions_used + 1 WHERE email = $1",
                email,
            )
            return True, used + 1, limit


# ---------------------------------------------------------------------------
# Stripe
# ---------------------------------------------------------------------------

async def set_stripe_customer(email: str, customer_id: str):
    pool = await get_pool()
    await pool.execute(
        "UPDATE users SET stripe_customer_id = $1 WHERE email = $2",
        customer_id, email,
    )


async def set_plan(email: str, plan: str):
    pool = await get_pool()
    await pool.execute(
        "UPDATE users SET plan = $1 WHERE email = $2",
        plan, email,
    )
